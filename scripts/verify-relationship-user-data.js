const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// Intentionally import before ready: the default service must still resolve
// Electron userData lazily when the first operation runs.
const relationshipBoardService = require('../src/main/services/relationshipBoardService');
const relationshipBoardImportService = require('../src/main/services/relationshipBoardImportService');

async function main() {
  const expectedInput = process.env.GITFINDER_VERIFY_USER_DATA;
  if (!expectedInput) throw new Error('缺少 GITFINDER_VERIFY_USER_DATA');
  const expectedDirectory = fs.realpathSync(path.resolve(expectedInput));
  const actualDirectory = fs.realpathSync(app.getPath('userData'));
  if (actualDirectory !== expectedDirectory) {
    throw new Error(`Electron userData 不一致：${actualDirectory}`);
  }

  const markerStore = {
    schemaVersion: 1,
    activeBoardId: 'board_verify001',
    entities: [{
      id: 'entity_verify001',
      type: 'server',
      name: 'userData 隔离验证',
      details: {},
      source: 'manual',
      verifiedAt: '2026-08-27T12:00:00.000Z'
    }],
    relationships: [],
    boards: [{
      id: 'board_verify001',
      name: 'userData 隔离验证',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [{ entityId: 'entity_verify001', x: 40, y: 40 }]
    }]
  };
  relationshipBoardService.save(markerStore);
  const loaded = relationshipBoardService.load();
  const expectedFile = path.join(expectedDirectory, 'relationship-boards.json');
  if (!fs.lstatSync(expectedFile).isFile()) throw new Error('隔离目录未生成关系白板文件');
  if (loaded.store.entities[0]?.name !== 'userData 隔离验证') throw new Error('隔离文件无法重新载入');

  const importFile = path.join(expectedDirectory, 'relationship-import-verification.json');
  const importStore = {
    ...markerStore,
    entities: [
      ...markerStore.entities,
      {
        id: 'entity_verify002',
        type: 'deployment',
        name: 'JSON 导入隔离验证',
        details: { environment: 'verification' },
        source: 'observed',
        verifiedAt: '2026-08-27T12:00:00.000Z'
      }
    ],
    relationships: [{
      id: 'relationship_verify01',
      type: 'runs_on',
      sourceId: 'entity_verify002',
      targetId: 'entity_verify001',
      source: 'observed',
      verifiedAt: '2026-08-27T12:00:00.000Z'
    }],
    boards: [{
      ...markerStore.boards[0],
      placements: [
        ...markerStore.boards[0].placements,
        { entityId: 'entity_verify002', x: 320, y: 40 }
      ]
    }]
  };
  fs.writeFileSync(importFile, `${JSON.stringify(importStore, null, 2)}\n`, { mode: 0o600 });
  const preview = relationshipBoardImportService.previewFromFile(importFile);
  if (!preview.hasChanges || preview.counts.addedEntities !== 1) throw new Error('隔离 JSON 导入预览无效');
  const applied = relationshipBoardImportService.applyImport(preview);
  if (!applied.applied || applied.store.entities.length !== 2) throw new Error('隔离 JSON 导入应用失败');
  if (!fs.existsSync(path.join(expectedDirectory, applied.backupFileName))) throw new Error('隔离导入未创建备份');
  process.stdout.write(`${JSON.stringify({ userData: actualDirectory, file: expectedFile, importVerified: true, verified: true })}\n`);
}

app.whenReady().then(main).then(
  () => app.exit(0),
  error => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
);
