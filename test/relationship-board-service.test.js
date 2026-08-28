const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RelationshipBoardService, FILE_NAME } = require('../src/main/services/relationshipBoardService');

function makeTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-relationship-board-'));
}

function minimalStore() {
  return {
    schemaVersion: 1,
    activeBoardId: 'board_12345678',
    entities: [{ id: 'entity_server01', type: 'server', name: 'Con01', details: { environment: 'production' } }],
    relationships: [],
    boards: [{
      id: 'board_12345678',
      name: '部署拓扑',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: {
        mode: 'compact',
        projection: 'deployment-summary',
        query: 'Con01',
        entityType: 'server',
        environment: 'production',
        verification: 'all'
      },
      placements: [{ entityId: 'entity_server01', x: 120, y: 80 }]
    }]
  };
}

test('关系白板服务以原子普通文件保存并可跨重启恢复', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = new RelationshipBoardService({ baseDirectory: directory });
  assert.equal(first.load().store.boards.length, 0);
  first.save(minimalStore());

  const restarted = new RelationshipBoardService({ baseDirectory: directory });
  const loaded = restarted.load();
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.store.boards[0].name, '部署拓扑');
  assert.equal(loaded.store.boards[0].placements[0].x, 120);
  assert.equal(loaded.store.boards[0].view.mode, 'compact');
  assert.equal(loaded.store.boards[0].view.projection, 'deployment-summary');
  assert.equal(loaded.store.boards[0].view.query, 'Con01');
  assert.equal(loaded.store.boards[0].view.environment, 'production');
  assert.equal(fs.lstatSync(path.join(directory, FILE_NAME)).isFile(), true);
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.tmp')), []);
});

test('事实复核周期可原子保存并跨重启恢复', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = minimalStore();
  store.entities[0].reviewIntervalDays = 7;

  new RelationshipBoardService({ baseDirectory: directory }).save(store);
  const loaded = new RelationshipBoardService({ baseDirectory: directory }).load();

  assert.equal(loaded.recovered, false);
  assert.equal(loaded.store.entities[0].reviewIntervalDays, 7);
});

test('损坏配置会先备份再恢复为空白安全状态', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, FILE_NAME), '{broken', { mode: 0o600 });
  const service = new RelationshipBoardService({
    baseDirectory: directory,
    now: () => new Date('2026-08-27T12:00:00.000Z')
  });
  const loaded = service.load();
  assert.equal(loaded.recovered, true);
  assert.equal(loaded.store.boards.length, 0);
  assert.ok(loaded.backupPath.endsWith('relationship-boards.corrupt-2026-08-27T12-00-00-000Z.json'));
  assert.equal(fs.readFileSync(loaded.backupPath, 'utf8'), '{broken');
});

test('语义损坏配置会保留原始副本后再写入可用部分', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const damaged = minimalStore();
  damaged.boards[0].placements.push({ entityId: 'missing_entity', x: 300, y: 120 });
  fs.writeFileSync(path.join(directory, FILE_NAME), JSON.stringify(damaged), { mode: 0o600 });
  const service = new RelationshipBoardService({
    baseDirectory: directory,
    now: () => new Date('2026-08-27T12:30:00.000Z')
  });

  const loaded = service.load();

  assert.equal(loaded.recovered, true);
  assert.match(loaded.repairs[0], /不存在的节点/);
  assert.ok(loaded.backupPath.endsWith('relationship-boards.corrupt-2026-08-27T12-30-00-000Z.json'));
  assert.equal(JSON.parse(fs.readFileSync(loaded.backupPath, 'utf8')).boards[0].placements.length, 2);
  assert.equal(loaded.store.boards[0].placements.length, 1);
  assert.equal(new RelationshipBoardService({ baseDirectory: directory }).load().recovered, false);
});

test('保存端严格拒绝敏感字段且不覆盖上一份有效数据', t => {
  const directory = makeTemporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = new RelationshipBoardService({ baseDirectory: directory });
  service.save(minimalStore());
  const invalid = minimalStore();
  invalid.entities[0].details.token = 'secret';
  assert.throws(() => service.save(invalid), /敏感信息/);
  assert.equal(service.load().store.entities[0].details.environment, 'production');
});
