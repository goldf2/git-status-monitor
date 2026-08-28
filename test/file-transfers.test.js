const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FileTransfers = require('../src/renderer/scripts/fileTransfers');

test('传输类型明确区分同卷移动、跨卷移动和复制', () => {
  assert.equal(FileTransfers.transferKindLabel('atomic-move'), '同卷原子移动');
  assert.equal(FileTransfers.transferKindLabel('copy-delete'), '跨卷复制后删除');
  assert.equal(FileTransfers.transferKindLabel('copy'), '安全复制');
  assert.equal(FileTransfers.transferKindLabel('skip'), '跳过');
  assert.equal(FileTransfers.conflictActionLabel('keep-both'), '保留两者');
  assert.equal(FileTransfers.conflictActionLabel('replace'), '替换');
});

test('准备阶段可取消，提交阶段明确锁定取消', () => {
  const preview = { mode: 'move', operationType: 'move' };
  const preparing = FileTransfers.progressPresentation({
    state: 'running', phase: 'preparing', progress: 42, cancellable: true, cancelRequested: false, currentSource: '/source'
  }, preview);
  assert.equal(preparing.progress, 42);
  assert.equal(preparing.cancellable, true);
  assert.match(preparing.title, /正在准备移动/);

  const committing = FileTransfers.progressPresentation({
    state: 'running', phase: 'committing', progress: 100, cancellable: false
  }, preview);
  assert.equal(committing.cancellable, false);
  assert.match(committing.detail, /不再接受取消/);
});

test('取消、失败和需检查结果给出不同恢复语义', () => {
  const preview = { mode: 'copy', operationType: 'import' };
  const cancelled = FileTransfers.progressPresentation({ state: 'cancelled', progress: 18 }, preview);
  const failed = FileTransfers.progressPresentation({ state: 'failed', progress: 18, error: '空间变化' }, preview);
  const review = FileTransfers.progressPresentation({ state: 'needs-review', progress: 100, error: '保留两份' }, preview);
  assert.match(cancelled.detail, /来源保持不变/);
  assert.equal(failed.tone, 'danger');
  assert.match(review.title, /人工检查/);
});

test('传输审查界面、预加载桥接和受信 IPC 使用同一组操作', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/fileTransferController.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/fileOperations.js'), 'utf8');

  for (const id of ['transfer-review-modal', 'transfer-review-body', 'transfer-review-cancel-btn', 'transfer-review-apply-btn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const operation of ['previewTransfer', 'applyTransfer', 'getTransferStatus', 'cancelTransfer']) {
    assert.match(controllerSource, new RegExp(`fileOps\\.${operation}`));
    assert.match(preload, new RegExp(`${operation}:`));
    assert.match(ipc, new RegExp(`fileOps:${operation}`));
  }
  assert.match(html, /fileTransfers\.js[\s\S]*fileTransferController\.js[\s\S]*app\.js/);
  assert.match(appSource, /setupFileTransferController/);
  assert.match(controllerSource, /transfer-conflict-policy/);
  assert.match(controllerSource, /conflictPolicy:\s*preview\.conflictPolicy/);
  assert.match(controllerSource, /transfer-structure-risk-ack/);
  assert.match(controllerSource, /structureRiskAcknowledged:\s*Boolean/);
  assert.match(preload, /previewTransfer:\s*\(paths, destinationDirectory, mode, options/);
  assert.match(ipc, /previewTransfer\(paths, destinationDirectory, mode, options\)/);
});

test('启动恢复会把配置事务和已完成传输结果明确告知用户', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/fileOperationController.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const configIpc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/config.js'), 'utf8');

  assert.match(preload, /getTransactionRecoveryStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('config:getTransactionRecoveryStatus'\)/);
  assert.match(configIpc, /config:getTransactionRecoveryStatus/);
  assert.match(controllerSource, /已恢复完成的中断传输，并补齐配置与撤销记录/);
  assert.match(appSource, /已安全\$\{action\}中断的配置同步/);
  assert.match(appSource, /配置事务恢复失败/);
});
