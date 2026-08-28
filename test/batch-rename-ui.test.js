const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const html = read('src/renderer/index.html');
const appSource = read('src/renderer/scripts/app.js');
const controllerSource = read('src/renderer/scripts/batchRenameController.js');
const actionBarSource = read('src/renderer/scripts/fileActionBarController.js');
const preloadSource = read('preload.js');
const ipcSource = read('src/main/ipc/fileOperations.js');
const cssSource = read('src/renderer/styles/content.css');

test('Finder 式批量重命名只占用一个弹窗并提供三种规则', () => {
  for (const id of [
    'batch-rename-modal',
    'batch-rename-mode',
    'batch-rename-search',
    'batch-rename-replacement',
    'batch-rename-text',
    'batch-rename-placement',
    'batch-rename-format-name',
    'batch-rename-preview',
    'batch-rename-risk-check',
    'batch-rename-apply-btn'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /value="replace">替换文本/);
  assert.match(html, /value="add">添加文本/);
  assert.match(html, /value="format">格式化名称/);
  assert.match(html, /确认前不会修改文件/);
  assert.ok(html.indexOf('../shared/batchRename.js') < html.indexOf('scripts/batchRenameController.js'));
  assert.ok(html.indexOf('scripts/batchRenameController.js') < html.indexOf('scripts/app.js'));
});

test('批量重命名通过受信 IPC 先预览再应用', () => {
  for (const operation of ['previewBatchRename', 'applyBatchRename']) {
    assert.match(preloadSource, new RegExp(`${operation}:`));
    assert.match(ipcSource, new RegExp(`fileOps:${operation}`));
    assert.match(controllerSource, new RegExp(`fileOps\\.${operation}`));
  }
  assert.match(controllerSource, /previewGeneration/);
  assert.match(controllerSource, /structureRiskAcknowledged/);
  assert.match(controllerSource, /runFileOperation/);
  assert.match(controllerSource, /失败时会回滚全部项目/);
});

test('工具栏、右键菜单和平台快捷键都允许多选重命名', () => {
  assert.match(appSource, /setupBatchRenameController/);
  assert.match(appSource, /items\.length\s*>\s*1[\s\S]*batchRenameController\.open\(items\)/);
  assert.match(appSource, /querySelector\('\[data-context-action="rename"\]'\)\.disabled\s*=\s*items\.length\s*===\s*0/);
  assert.match(actionBarSource, /rename\.disabled\s*=\s*busy\s*\|\|\s*count\s*===\s*0/);
  assert.match(appSource, /AppState\.selectedPaths\.size\s*>=\s*1/);
  assert.match(actionBarSource, /重命名 \$\{count\} 个项目/);
});

test('批量重命名预览保持可读并尊重隐藏状态与窄窗口', () => {
  assert.match(cssSource, /\.batch-rename-preview/);
  assert.match(cssSource, /\.batch-rename-fields\[hidden\][\s\S]*display:\s*none/);
  assert.match(cssSource, /@media \(max-width: 560px\)[\s\S]*\.batch-rename-format-fields/);
  assert.match(controllerSource, /slice\(0, 100\)/);
  assert.match(controllerSource, /aria-busy/);
});
