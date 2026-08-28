const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EditActionRouter = require('../src/renderer/scripts/editActionRouter');

test('编辑动作只接受固定白名单并统一全选别名', () => {
  assert.equal(EditActionRouter.normalizeAction('selectAll'), 'select-all');
  assert.equal(EditActionRouter.normalizeAction('copy'), 'copy');
  assert.equal(EditActionRouter.normalizeAction('delete'), '');
});

test('输入框、Quick Look、弹窗和已选文本继续走原生编辑', () => {
  assert.deepEqual(EditActionRouter.route('paste', { editable: true, fileBrowsing: true }), {
    kind: 'native', action: 'paste'
  });
  assert.deepEqual(EditActionRouter.route('select-all', { quickLookOpen: true, fileBrowsing: true }), {
    kind: 'native', action: 'select-all'
  });
  assert.deepEqual(EditActionRouter.route('undo', { blockingModal: true, fileBrowsing: true }), {
    kind: 'native', action: 'undo'
  });
  assert.deepEqual(EditActionRouter.route('copy', { hasTextSelection: true, fileBrowsing: true }), {
    kind: 'native', action: 'copy'
  });
});

test('目录编辑动作包含可撤销和可重做的文件操作', () => {
  for (const action of ['undo', 'redo', 'cut', 'copy', 'paste', 'select-all']) {
    assert.deepEqual(EditActionRouter.route(action, { fileBrowsing: true }), {
      kind: 'file', action
    });
  }
  assert.deepEqual(EditActionRouter.route('copy', { fileBrowsing: false }), {
    kind: 'native', action: 'copy'
  });
});

test('macOS 与 Windows 编辑快捷键复用同一路由且保留 Option 粘贴移动', () => {
  assert.equal(EditActionRouter.shortcutAction({ key: 'a', metaKey: true }, 'darwin'), 'select-all');
  assert.equal(EditActionRouter.shortcutAction({ key: 'z', metaKey: true, shiftKey: true }, 'darwin'), 'redo');
  assert.equal(EditActionRouter.shortcutAction({ key: 'y', ctrlKey: true }, 'win32'), 'redo');
  assert.equal(EditActionRouter.shortcutAction({ key: 'v', ctrlKey: true }, 'win32'), 'paste');
  assert.equal(EditActionRouter.shortcutAction({ key: 'v', metaKey: true, altKey: true }, 'darwin'), '');
  assert.equal(EditActionRouter.shortcutAction({ key: 'c', ctrlKey: true }, 'darwin'), '');
});

test('应用菜单、受信原生桥和渲染层文件路由完整连接', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const fileOperationsIpc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/fileOperations.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/fileOperationController.js'), 'utf8');

  assert.ok(html.indexOf('scripts/editActionRouter.js') < html.indexOf('scripts/app.js'));
  assert.ok(html.indexOf('scripts/fileOperationController.js') < html.indexOf('scripts/app.js'));
  assert.match(mainSource, /id: `edit-\$\{action\}`/);
  assert.match(mainSource, /sendShortcut\(`edit:\$\{action\}`\)/);
  assert.match(mainSource, /editItem\('全选', 'select-all', 'CmdOrCtrl\+A'\)/);
  assert.match(mainSource, /label: '复制为路径名'/);
  assert.match(mainSource, /sendShortcut\('copy-pathnames'\)/);
  assert.doesNotMatch(mainSource, /role: 'selectAll'/);
  assert.match(mainSource, /registerTrustedHandler\('app:perform-native-edit'/);
  assert.match(mainSource, /'select-all': 'selectAll'/);
  assert.match(preloadSource, /performNativeEdit: \(action\) => ipcRenderer\.invoke\('app:perform-native-edit', action\)/);
  assert.match(preloadSource, /redo: \(operationId\) => ipcRenderer\.invoke\('fileOps:redo', operationId\)/);
  assert.match(fileOperationsIpc, /registerTrustedHandler\('fileOps:redo'/);
  assert.match(appSource, /action\.startsWith\('edit:'\)/);
  assert.match(appSource, /EditActionRouter\.shortcutAction\(event, window\.gitFinder\.platform\)/);
  assert.match(appSource, /redoLastFileOperation\(\)/);
  assert.match(appSource, /selectAllVisibleFiles\(\)/);
  assert.match(appSource, /new window\.FileOperationController\.Controller/);
  assert.match(controllerSource, /this\.bridge\.fileOps\.redo\(operation\.id\)/);
  assert.match(controllerSource, /this\.editActionRouter\.route/);
});
