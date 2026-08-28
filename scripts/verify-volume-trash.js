#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileOperationService } = require('../src/main/services/fileOperationService');

async function main() {
  if (process.platform !== 'darwin') throw new Error('此验证脚本仅用于 macOS 各卷废纸篓');
  const parentDirectories = process.argv.slice(2);
  if (parentDirectories.length < 2) {
    throw new Error('用法：node scripts/verify-volume-trash.js <卷A可写目录> <卷B可写目录>');
  }

  const managedRoots = [];
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-trash-history-'));
  let operation = null;
  try {
    for (const parentDirectory of parentDirectories) {
      const parent = path.resolve(parentDirectory);
      const root = fs.mkdtempSync(path.join(parent, 'gitfinder-trash-verify-'));
      managedRoots.push(root);
      fs.writeFileSync(path.join(root, 'trash-check.txt'), `volume=${parent}\n`);
    }

    const configService = {
      getTreeRoots: () => managedRoots.map(root => ({ path: root, name: path.basename(root) })),
      validateRebindPaths: () => {},
      rebindPaths: () => {},
      archivePaths: () => ({ removedFavorites: [], removedRepos: [] }),
      restoreArchivedPaths: () => {}
    };
    const service = new FileOperationService({ configService, historyDir });
    const sources = managedRoots.map(root => path.join(root, 'trash-check.txt'));
    const sourceDevices = sources.map(source => fs.statSync(source).dev);
    const sourceDeviceByPath = new Map(sources.map((source, index) => [source, sourceDevices[index]]));
    assert.equal(new Set(sourceDevices).size, managedRoots.length, '验证来源必须位于不同设备');

    operation = await service.trash(sources);
    operation.items.forEach(item => {
      const volumeRoot = item.source.startsWith(`${path.sep}Volumes${path.sep}`)
        ? path.join(path.sep, 'Volumes', item.source.split(path.sep).filter(Boolean)[1])
        : null;
      const expectedTrash = volumeRoot
        ? path.join(volumeRoot, '.Trashes', String(process.getuid()))
        : path.join(os.homedir(), '.Trash');
      assert.equal(item.target.startsWith(expectedTrash + path.sep), true, `目标未进入来源卷废纸篓：${item.target}`);
      assert.equal(fs.statSync(item.target).dev, sourceDeviceByPath.get(item.source), '废纸篓目标与来源不在同一设备');
      assert.equal(fs.existsSync(item.source), false);
    });

    await service.undo(operation.id);
    operation.items.forEach(item => {
      assert.equal(fs.existsSync(item.source), true, `撤销后来源未恢复：${item.source}`);
      assert.equal(fs.existsSync(item.target), false, `撤销后废纸篓目标仍存在：${item.target}`);
    });

    process.stdout.write(`${JSON.stringify({
      success: true,
      sourceDevices,
      trashTargets: operation.items.map(item => item.target),
      restoredByUndo: true
    }, null, 2)}\n`);
  } finally {
    for (const item of operation?.items || []) {
      if (!fs.existsSync(item.target)) continue;
      fs.mkdirSync(path.dirname(item.source), { recursive: true });
      if (!fs.existsSync(item.source)) fs.renameSync(item.target, item.source);
    }
    for (const root of managedRoots) fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(historyDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
