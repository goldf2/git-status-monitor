#!/usr/bin/env node
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileOperationService } = require('../src/main/services/fileOperationService');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  const sourceBase = path.resolve(process.argv[2] || '');
  const destinationBase = path.resolve(process.argv[3] || '');
  if (!process.argv[2] || !process.argv[3]) throw new Error('用法：verify-cross-volume-transfer.js <来源卷目录> <目标卷目录>');
  if (!fs.statSync(sourceBase).isDirectory() || !fs.statSync(destinationBase).isDirectory()) throw new Error('来源卷和目标卷必须是现有目录');
  if (fs.statSync(sourceBase).dev === fs.statSync(destinationBase).dev) throw new Error('两个验证目录位于同一卷，无法验证跨卷语义');

  const sourceRoot = fs.mkdtempSync(path.join(sourceBase, 'gitfinder-xvol-source-'));
  const destinationRoot = fs.mkdtempSync(path.join(destinationBase, 'gitfinder-xvol-destination-'));
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-xvol-history-'));
  const destination = path.join(destinationRoot, 'target');
  fs.mkdirSync(destination);
  let cancelOperationId = null;
  const phases = [];
  const configService = {
    getTreeRoots: () => [{ path: sourceRoot }, { path: destinationRoot }],
    validateRebindPaths: () => {},
    rebindPaths: () => {},
    archivePaths: () => ({}),
    restoreArchivedPaths: () => {}
  };
  const service = new FileOperationService({
    configService,
    historyDir,
    trashDir: path.join(historyDir, 'trash'),
    copyChunkBytes: 1024 * 1024,
    onTransferProgress: status => {
      phases.push(status.phase);
      if (cancelOperationId === status.operationId && status.phase === 'preparing' && status.bytesTransferred >= 2 * 1024 * 1024) {
        service.cancelTransfer(status.operationId);
      }
    }
  });

  try {
    const source = path.join(sourceRoot, 'payload.bin');
    fs.writeFileSync(source, Buffer.alloc(8 * 1024 * 1024, 0x5a));
    const sourceHash = sha256(source);
    const preview = await service.previewTransfer([source], destination, 'move');
    assert.equal(preview.crossVolumeCount, 1);
    assert.equal(preview.items[0].transferKind, 'copy-delete');
    assert.equal(preview.totalBytes, 8 * 1024 * 1024);
    assert.equal(preview.spaceSufficient, true);

    const operation = await service.applyTransfer({
      operationId: preview.operationId,
      previewToken: preview.previewToken,
      sourcePaths: [source],
      destinationDirectory: destination,
      mode: 'move'
    });
    const target = path.join(destination, 'payload.bin');
    assert.equal(fs.existsSync(source), false);
    assert.equal(sha256(target), sourceHash);
    assert.equal(service.getTransferStatus(preview.operationId).state, 'completed');
    assert.equal(phases.includes('preparing'), true);
    assert.equal(phases.includes('committing'), true);

    await service.undo(operation.id);
    assert.equal(sha256(source), sourceHash);
    assert.equal(fs.existsSync(target), false);

    const cancelSource = path.join(sourceRoot, 'cancel.bin');
    fs.writeFileSync(cancelSource, Buffer.alloc(16 * 1024 * 1024, 0x33));
    const cancelPreview = await service.previewTransfer([cancelSource], destination, 'move');
    cancelOperationId = cancelPreview.operationId;
    await assert.rejects(() => service.applyTransfer({
      operationId: cancelPreview.operationId,
      previewToken: cancelPreview.previewToken,
      sourcePaths: [cancelSource],
      destinationDirectory: destination,
      mode: 'move'
    }), /已取消/);
    assert.equal(fs.existsSync(cancelSource), true);
    assert.equal(fs.existsSync(path.join(destination, 'cancel.bin')), false);
    assert.equal(fs.readdirSync(destination).some(name => name.startsWith('.gitfinder-partial-')), false);

    process.stdout.write(JSON.stringify({
      success: true,
      sourceDevice: fs.statSync(sourceRoot).dev,
      destinationDevice: fs.statSync(destinationRoot).dev,
      movedBytes: preview.totalBytes,
      completedState: service.getTransferStatus(preview.operationId).state,
      cancelledState: service.getTransferStatus(cancelPreview.operationId).state,
      sourceRestoredByUndo: true,
      stagingResidue: false
    }, null, 2) + '\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(destinationRoot, { recursive: true, force: true });
    fs.rmSync(historyDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
});
