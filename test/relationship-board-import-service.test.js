const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RelationshipBoardService } = require('../src/main/services/relationshipBoardService');
const {
  RelationshipBoardImportService,
  PREVIEW_TOKEN_PATTERN,
  OPERATION_ID_PATTERN
} = require('../src/main/services/relationshipBoardImportService');

function makeTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-relationship-import-'));
}

function currentStore() {
  return {
    schemaVersion: 1,
    activeBoardId: 'board_import001',
    entities: [{
      id: 'entity_server01',
      type: 'server',
      name: 'Con01',
      details: { environment: 'production' },
      source: 'manual',
      verifiedAt: '2026-08-27T12:00:00.000Z'
    }],
    relationships: [],
    boards: [{
      id: 'board_import001',
      name: '当前部署',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [{ entityId: 'entity_server01', x: 500, y: 80 }]
    }]
  };
}

function importedStore() {
  return {
    schemaVersion: 1,
    activeBoardId: 'board_import001',
    entities: [
      {
        id: 'entity_server01',
        type: 'server',
        name: 'Con01 imported',
        details: { hostLabel: 'con01.internal' },
        source: 'observed',
        verifiedAt: '2026-08-20T12:00:00.000Z',
        reviewIntervalDays: 7
      },
      {
        id: 'entity_deploy01',
        type: 'deployment',
        name: 'MES production',
        details: { environment: 'production', status: 'observed running' },
        source: 'observed',
        verifiedAt: '2026-08-26T12:00:00.000Z'
      }
    ],
    relationships: [{
      id: 'relationship_import01',
      type: 'runs_on',
      sourceId: 'entity_deploy01',
      targetId: 'entity_server01',
      source: 'observed',
      verifiedAt: '2026-08-26T12:00:00.000Z'
    }],
    boards: [{
      id: 'board_import001',
      name: '外部部署',
      viewport: { x: 10, y: 20, zoom: 0.8 },
      placements: [
        { entityId: 'entity_server01', x: 900, y: 80 },
        { entityId: 'entity_deploy01', x: 580, y: 80 }
      ]
    }]
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function setup(directory, options = {}) {
  const boardStore = new RelationshipBoardService({
    baseDirectory: path.join(directory, 'user-data'),
    now: options.now || (() => new Date('2026-08-28T12:00:00.000Z'))
  });
  boardStore.save(currentStore());
  const sourcePath = path.join(directory, 'relationship-import.json');
  writeJson(sourcePath, importedStore());
  const service = new RelationshipBoardImportService({
    boardStore,
    now: options.now || (() => new Date('2026-08-28T12:00:00.000Z')),
    previewTtlMs: options.previewTtlMs
  });
  return { boardStore, sourcePath, service };
}

test('JSON 导入预览零写入，确认后只合并新增更新并创建备份', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { boardStore, sourcePath, service } = setup(directory);
  const before = JSON.stringify(boardStore.load().store);

  const preview = service.previewFromFile(sourcePath);

  assert.match(preview.previewToken, PREVIEW_TOKEN_PATTERN);
  assert.match(preview.operationId, OPERATION_ID_PATTERN);
  assert.equal(preview.hasChanges, true);
  assert.deepEqual(preview.counts, {
    addedEntities: 1,
    updatedEntities: 1,
    addedRelationships: 1,
    updatedRelationships: 0,
    addedBoards: 0,
    updatedBoards: 1
  });
  assert.match(preview.boundary, /不删除现有节点、关系或白板/);
  assert.equal(JSON.stringify(boardStore.load().store), before);

  const applied = service.applyImport({
    operationId: preview.operationId,
    previewToken: preview.previewToken
  });

  assert.equal(applied.applied, true);
  assert.equal(applied.alreadyApplied, false);
  assert.match(applied.backupFileName, /^relationship-boards\.import-backup-/);
  const loaded = boardStore.load().store;
  assert.equal(loaded.entities.length, 2);
  assert.equal(loaded.relationships.length, 1);
  assert.equal(loaded.boards.length, 1);
  assert.equal(loaded.boards[0].name, '当前部署');
  assert.equal(loaded.boards[0].placements.length, 2);
  assert.equal(loaded.entities[0].details.environment, 'production');
  assert.equal(loaded.entities[0].details.hostLabel, 'con01.internal');
  assert.equal(loaded.entities[0].verifiedAt, '2026-08-27T12:00:00.000Z');
  assert.equal(loaded.entities[0].reviewIntervalDays, 7);
  assert.equal(loaded.entities[0].source, 'imported');
  assert.equal(loaded.relationships[0].source, 'imported');
  assert.equal(fs.existsSync(path.join(boardStore.baseDirectory, applied.backupFileName)), true);

  const retried = service.applyImport({
    operationId: preview.operationId,
    previewToken: preview.previewToken
  });
  assert.equal(retried.alreadyApplied, true);
  assert.equal(boardStore.load().store.relationships.length, 1);
});

test('导入应用拒绝过期、篡改以及预览后变化的本机事实', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = new Date('2026-08-28T12:00:00.000Z');
  const { boardStore, sourcePath, service } = setup(directory, {
    now: () => now,
    previewTtlMs: 1000
  });
  const preview = service.previewFromFile(sourcePath);

  assert.throws(() => service.applyImport({
    operationId: 'relationship_import_00000000000000000000000000000000',
    previewToken: preview.previewToken
  }), /不匹配|失效/);

  const changed = boardStore.load().store;
  changed.entities[0].details.notes = '本机刚刚修改';
  boardStore.save(changed);
  assert.throws(() => service.applyImport(preview), /白板已在预览后发生变化/);

  const nextPreview = service.previewFromFile(sourcePath);
  now = new Date('2026-08-28T12:00:02.000Z');
  assert.throws(() => service.applyImport(nextPreview), /已失效|已过期/);
});

test('导入文件在预览后变化时拒绝应用且保留本机数据', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { boardStore, sourcePath, service } = setup(directory);
  const before = boardStore.load().store;
  const preview = service.previewFromFile(sourcePath);
  const changedImport = importedStore();
  changedImport.entities[1].name = 'Changed after preview';
  writeJson(sourcePath, changedImport);

  assert.throws(() => service.applyImport(preview), /文件已在预览后发生变化/);
  assert.deepEqual(boardStore.load().store, before);
});

test('导入新白板时重映射并保留视觉分组成员关系', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { boardStore, service } = setup(directory);
  const imported = {
    schemaVersion: 1,
    activeBoardId: 'board_group0001',
    entities: [
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} },
      { id: 'entity_group001', type: 'group', name: '生产环境', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_group0001',
      name: '视觉分组',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [
        { entityId: 'entity_group001', x: 40, y: 40 },
        { entityId: 'entity_server01', x: 100, y: 120, groupId: 'entity_group001' }
      ]
    }]
  };

  const merged = service._mergeStores(boardStore.load().store, imported);
  const board = merged.store.boards.find(item => item.id === 'board_group0001');
  const group = merged.store.entities.find(item => item.type === 'group' && item.name === '生产环境');
  const member = board.placements.find(item => item.entityId === 'entity_server01');

  assert.equal(member.groupId, group.id);
});

test('导入已有白板时只补充分组成员而不覆盖本机已有布局', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { boardStore, service } = setup(directory);
  const imported = {
    schemaVersion: 1,
    activeBoardId: 'board_import001',
    entities: [
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} },
      { id: 'entity_group001', type: 'group', name: '生产环境', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_import001',
      name: '当前部署',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [
        { entityId: 'entity_group001', x: 40, y: 40 },
        { entityId: 'entity_server01', x: 100, y: 120, groupId: 'entity_group001' }
      ]
    }]
  };

  const merged = service._mergeStores(boardStore.load().store, imported);
  const board = merged.store.boards.find(item => item.id === 'board_import001');
  const group = merged.store.entities.find(item => item.type === 'group' && item.name === '生产环境');
  const member = board.placements.find(item => item.entityId === 'entity_server01');

  assert.equal(member.groupId, group.id);
  assert.equal(member.x, 500);
  assert.equal(member.y, 80);
  assert.match(merged.changes.find(change => change.kind === 'board').detail, /恢复 1 个分组成员/);
});

test('导入拒绝疑似凭据、符号链接和非关系白板结构', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { sourcePath, service } = setup(directory);
  const secret = importedStore();
  secret.entities[0].details.notes = 'password=do-not-import';
  writeJson(sourcePath, secret);
  assert.throws(() => service.previewFromFile(sourcePath), /疑似包含密码、令牌或私钥/);

  writeJson(sourcePath, importedStore());
  const linkPath = path.join(directory, 'linked-import.json');
  fs.symlinkSync(sourcePath, linkPath);
  assert.throws(() => service.previewFromFile(linkPath), /必须是普通 JSON 文件/);

  writeJson(sourcePath, { hello: 'world' });
  assert.throws(() => service.previewFromFile(sourcePath), /关系白板数据无效/);
});

test('导入保存失败时不覆盖当前事实并保留导入前备份', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const setupResult = setup(directory);
  const realStore = setupResult.boardStore;
  const before = realStore.load().store;
  const failingStore = {
    load: () => realStore.load(),
    createImportBackup: () => realStore.createImportBackup(),
    save: () => { throw new Error('simulated import save failure'); }
  };
  const service = new RelationshipBoardImportService({
    boardStore: failingStore,
    now: () => new Date('2026-08-28T12:00:00.000Z')
  });
  const preview = service.previewFromFile(setupResult.sourcePath);

  assert.throws(() => service.applyImport(preview), /simulated import save failure/);
  assert.deepEqual(realStore.load().store, before);
  assert.equal(
    fs.readdirSync(realStore.baseDirectory).filter(name => name.startsWith('relationship-boards.import-backup-')).length,
    1
  );
});
