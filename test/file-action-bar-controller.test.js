const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Controller } = require('../src/renderer/scripts/fileActionBarController.js');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.disabled = false;
    this.textContent = '';
    this.label = { textContent: '' };
  }

  querySelector(selector) {
    return selector === 'span' ? this.label : null;
  }
}

function createHarness() {
  const ids = [
    'file-selection-summary',
    'file-preview', 'file-copy', 'file-copy-path', 'file-cut', 'file-paste', 'file-get-info',
    'file-duplicate', 'file-rename', 'file-move', 'file-open-terminal', 'file-open-editor', 'file-labels',
    'file-favorite', 'file-project-settings', 'file-trash',
    'file-new-folder', 'file-new-file', 'file-undo', 'file-redo',
    'file-create-menu-trigger', 'file-history', 'file-actions-menu-trigger'
  ];
  const document = {
    elements: new Map(ids.map(id => [id, new FakeElement(id)])),
    expandedDisabled: false,
    getElementById(id) { return this.elements.get(id) || null; },
    querySelector(selector) {
      return selector === '[data-menu-trigger][aria-expanded="true"]:disabled' && this.expandedDisabled
        ? {}
        : null;
    }
  };
  const state = {
    selectedPaths: new Set(),
    fileClipboard: null,
    fileOperationBusy: false,
    directoryLoad: null,
    fileOperationHistory: [],
    currentPath: '/workspace'
  };
  const selectedItems = [];
  const calls = [];
  const app = {
    getSelectedFileItems: () => selectedItems,
    isFavoritePath: itemPath => itemPath === '/workspace/favorite',
    isFileBrowsingContext: () => true,
    isDirectoryBrowsingContext: () => true,
    isGlobalSearchActive: () => false,
    closeToolbarMenus: () => calls.push('close-menus')
  };
  const controller = new Controller({ app, state, document });
  return { app, calls, controller, document, selectedItems, state };
}

test('没有选择时保持新建和历史入口，禁用需要选择或剪贴板的动作', () => {
  const harness = createHarness();
  harness.controller.update();
  const element = id => harness.document.getElementById(id);
  assert.equal(element('file-selection-summary').textContent, '未选择项目');
  assert.equal(element('file-new-folder').disabled, false);
  assert.equal(element('file-new-file').disabled, false);
  assert.equal(element('file-create-menu-trigger').disabled, false);
  assert.equal(element('file-copy').disabled, true);
  assert.equal(element('file-copy-path').disabled, true);
  assert.equal(element('file-paste').disabled, true);
  assert.equal(element('file-rename').disabled, true);
  assert.equal(element('file-labels').disabled, true);
  assert.equal(element('file-open-terminal').disabled, false);
  assert.equal(element('file-history').disabled, false);
  assert.equal(element('file-actions-menu-trigger').disabled, false);
});

test('单个项目文件夹同步收藏、项目设置和单项动作', () => {
  const harness = createHarness();
  const item = { path: '/workspace/favorite', type: 'directory', isProject: true };
  harness.selectedItems.push(item);
  harness.state.selectedPaths.add(item.path);
  harness.controller.update();
  const element = id => harness.document.getElementById(id);
  assert.equal(element('file-selection-summary').textContent, '已选择 1 项');
  assert.equal(element('file-preview').disabled, false);
  assert.equal(element('file-copy-path').disabled, false);
  assert.equal(element('file-get-info').disabled, false);
  assert.equal(element('file-open-terminal').disabled, false);
  assert.equal(element('file-favorite').disabled, false);
  assert.equal(element('file-favorite').label.textContent, '从收藏夹移除');
  assert.equal(element('file-project-settings').label.textContent, '项目设置…');
  assert.equal(element('file-rename').label.textContent, '重命名');
  assert.equal(element('file-labels').disabled, false);
});

test('多选和剪贴板更新批量文案，限制单项动作', () => {
  const harness = createHarness();
  harness.state.selectedPaths = new Set(['/workspace/a', '/workspace/b']);
  harness.state.fileClipboard = { paths: ['/workspace/c', '/workspace/d'] };
  harness.selectedItems.push(
    { path: '/workspace/a', type: 'file' },
    { path: '/workspace/b', type: 'directory' }
  );
  harness.controller.update();
  const element = id => harness.document.getElementById(id);
  assert.equal(element('file-selection-summary').textContent, '已选择 2 项');
  assert.equal(element('file-paste').disabled, false);
  assert.equal(element('file-paste').label.textContent, '粘贴 2 项');
  assert.equal(element('file-rename').disabled, false);
  assert.equal(element('file-rename').label.textContent, '重命名 2 个项目…');
  assert.equal(element('file-preview').disabled, true);
  assert.equal(element('file-get-info').disabled, true);
  assert.equal(element('file-open-terminal').disabled, true);
  assert.equal(element('file-favorite').disabled, true);
  assert.equal(element('file-labels').disabled, false);
});

test('忙碌、搜索与历史状态分别控制写操作和撤销重做', () => {
  const harness = createHarness();
  harness.state.fileOperationBusy = true;
  harness.state.fileOperationHistory = [
    { undoable: true, undoneAt: 0 },
    { undoable: true, undoneAt: 20, redoable: true, redoInvalidatedAt: 0 }
  ];
  harness.state.fileClipboard = { paths: ['/workspace/source'] };
  harness.app.isGlobalSearchActive = () => true;
  harness.document.expandedDisabled = true;
  harness.controller.update();
  const element = id => harness.document.getElementById(id);
  assert.equal(element('file-new-folder').disabled, true);
  assert.equal(element('file-paste').disabled, true);
  assert.equal(element('file-undo').disabled, true);
  assert.equal(element('file-redo').disabled, true);
  assert.equal(element('file-open-terminal').disabled, true);
  assert.deepEqual(harness.calls, ['close-menus']);

  harness.state.fileOperationBusy = false;
  harness.app.isGlobalSearchActive = () => false;
  harness.document.expandedDisabled = false;
  harness.controller.update();
  assert.equal(element('file-undo').disabled, false);
  assert.equal(element('file-redo').disabled, false);
  assert.equal(element('file-open-terminal').disabled, false);
});

test('目录载入期间禁用文件写操作并显示真实状态', () => {
  const harness = createHarness();
  harness.state.directoryLoad = { status: 'loading' };
  harness.state.fileClipboard = { paths: ['/workspace/source'] };
  harness.controller.update();
  const element = id => harness.document.getElementById(id);

  assert.equal(element('file-selection-summary').textContent, '正在载入当前文件夹…');
  assert.equal(element('file-new-folder').disabled, true);
  assert.equal(element('file-new-file').disabled, true);
  assert.equal(element('file-paste').disabled, true);
  assert.equal(element('file-create-menu-trigger').disabled, true);
  assert.equal(element('file-history').disabled, false);
});

test('跨目录标签集合保留选择操作但禁用没有唯一目标目录的动作', () => {
  const harness = createHarness();
  harness.state.selectedPaths = new Set(['/workspace/a']);
  harness.state.fileClipboard = { paths: ['/workspace/source'] };
  harness.selectedItems.push({ path: '/workspace/a', type: 'file' });
  harness.app.isDirectoryBrowsingContext = () => false;
  harness.controller.update();
  const element = id => harness.document.getElementById(id);
  assert.equal(element('file-copy').disabled, false);
  assert.equal(element('file-cut').disabled, false);
  assert.equal(element('file-rename').disabled, false);
  assert.equal(element('file-trash').disabled, false);
  assert.equal(element('file-new-folder').disabled, true);
  assert.equal(element('file-new-file').disabled, true);
  assert.equal(element('file-paste').disabled, true);
  assert.equal(element('file-duplicate').disabled, true);
  assert.equal(element('file-open-terminal').disabled, false);
});

test('全局搜索未选择项目时不猜测终端目录', () => {
  const harness = createHarness();
  harness.app.isGlobalSearchActive = () => true;
  harness.controller.update();
  assert.equal(harness.document.getElementById('file-open-terminal').disabled, true);
});

test('页面先加载操作栏控制器，App 只保留初始化和更新委托', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src/renderer/scripts/app.js'), 'utf8');
  assert.ok(html.indexOf('scripts/fileActionBarController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupFileActionBarController/);
  assert.match(appSource, /return this\.fileActionBarController\.update\(\)/);
});
