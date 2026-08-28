const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('前往文件夹通过受信主进程解析路径并只把确认目录交给导航', () => {
  const root = path.join(__dirname, '..');
  const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc', 'filesystem.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');

  assert.match(preloadSource, /resolveWorkspaceDirectory:.*fs:resolveWorkspaceDirectory/);
  assert.match(ipcSource, /fs:resolveWorkspaceDirectory[\s\S]*fileService\.resolveWorkspaceDirectory/);
  assert.match(appSource, /submitGoToFolderDialog[\s\S]*resolveWorkspaceDirectory\(input\.value\)/);
  assert.match(appSource, /if \(!result\?\.ok\)[\s\S]*navigateTo\(result\.path\)/);
});

test('前往文件夹具备工具栏、应用菜单、跨平台快捷键和可访问弹窗入口', () => {
  const root = path.join(__dirname, '..');
  const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.match(htmlSource, /id="btn-go-to-folder"[\s\S]*id="go-to-folder-modal"/);
  assert.match(htmlSource, /role="dialog"[\s\S]*aria-labelledby="go-to-folder-title"/);
  assert.match(appSource, /btn-go-to-folder[\s\S]*openGoToFolderDialog/);
  assert.match(appSource, /platform === 'darwin'[\s\S]*event\.metaKey[\s\S]*event\.shiftKey[\s\S]*toLowerCase\(\) === 'g'/);
  assert.match(appSource, /event\.ctrlKey[\s\S]*toLowerCase\(\) === 'l'/);
  assert.match(mainSource, /label: '前往文件夹…'[\s\S]*'Cmd\+Shift\+G'[\s\S]*'Ctrl\+L'[\s\S]*open-go-to-folder/);
});

test('前往文件夹关闭前先移出焦点，并用 inert 隔离隐藏内容', () => {
  const root = path.join(__dirname, '..');
  const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');
  const openStart = appSource.indexOf('openGoToFolderDialog()');
  const closeStart = appSource.indexOf('closeGoToFolderDialog({ restoreFocus = true } = {})');
  const closeEnd = appSource.indexOf('setGoToFolderFeedback(message)', closeStart);
  const openSource = appSource.slice(openStart, closeStart);
  const closeSource = appSource.slice(closeStart, closeEnd);

  assert.match(htmlSource, /id="go-to-folder-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(openSource, /modal\.inert = false;[\s\S]*aria-hidden', 'false'/);
  assert.match(closeSource, /modal\.inert = true;[\s\S]*aria-hidden', 'true'/);
  assert.ok(closeSource.indexOf('restoreTarget.focus()') < closeSource.indexOf("modal.setAttribute('aria-hidden', 'true')"));
});
