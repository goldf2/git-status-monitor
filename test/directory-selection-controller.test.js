const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ProgressiveDirectoryRender = require('../src/renderer/scripts/progressiveDirectoryRender');
const {
  Controller,
  rangePaths,
  resolveFocusPath
} = require('../src/renderer/scripts/directorySelectionController');

function createClassList() {
  const values = new Set();
  return {
    contains: value => values.has(value),
    remove: value => values.delete(value),
    toggle: (value, force) => {
      if (force) values.add(value);
      else values.delete(value);
    }
  };
}

function createElement(itemPath, type = 'file') {
  const attributes = new Map();
  return {
    classList: createClassList(),
    dataset: { path: itemPath, type, isGit: 'false' },
    tabIndex: -1,
    focusCalls: [],
    scrollCalls: [],
    addEventListener() {},
    focus(options) { this.focusCalls.push(options); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    scrollIntoView(options) { this.scrollCalls.push(options); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); }
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const items = overrides.items || [
    { path: '/workspace/a', name: 'a', type: 'file' },
    { path: '/workspace/b', name: 'b', type: 'directory' },
    { path: '/workspace/c', name: 'c', type: 'file', isGitRepo: true }
  ];
  const elements = items.map(item => createElement(item.path, item.type));
  const renderedRoot = { querySelectorAll: () => elements };
  elements.forEach(element => {
    element.parentElement = { parentElement: renderedRoot };
  });
  const state = {
    cardStyle: 'card',
    fileDisplayOrder: items.map(item => item.path),
    fileKeyboardFocusPath: items[0]?.path || null,
    selectedPaths: new Set(),
    selectionAnchorPath: null,
    visibleItems: items,
    ...overrides.state
  };
  const document = {
    activeElement: null,
    querySelector: selector => elements.find(element => selector.includes(element.dataset.path)) || null,
    querySelectorAll: selector => selector.includes('#content-area') ? elements : [],
    ...overrides.document
  };
  const app = {
    directoryVirtualizer: null,
    cssEscape: value => value,
    isFileBrowsingContext: () => true,
    getSelectedFileItems: () => state.visibleItems.filter(item => state.selectedPaths.has(item.path)),
    showFileSelectionDetail: selected => calls.push(['detail', selected.map(item => item.path)]),
    updateFileActionBar: () => calls.push('actions'),
    updateStatusBar: () => calls.push('status'),
    selectRepo: itemPath => calls.push(['repo', itemPath]),
    bindFileDragSource: () => {},
    activateFileItem: item => calls.push(['activate', item.path]),
    goUp: () => calls.push('up'),
    renderGalleryPreview: item => calls.push(['gallery', item.path]),
    ...overrides.app
  };
  const controller = new Controller({
    app,
    state,
    document,
    fileBrowser: overrides.fileBrowser || {
      nextFileNavigationIndex: (_rects, index, key) => {
        if (key === 'ArrowDown') return Math.min(elements.length - 1, index + 1);
        if (key === 'ArrowUp') return Math.max(0, index - 1);
        return null;
      }
    },
    progressiveRenderer: ProgressiveDirectoryRender
  });
  return { app, calls, controller, document, elements, state };
}

test('焦点回退优先保留可见焦点、范围锚点和已选项', () => {
  const items = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
  assert.equal(resolveFocusPath(items, '/b', '/c', ['/a']), '/b');
  assert.equal(resolveFocusPath(items, '/missing', '/c', ['/a']), '/c');
  assert.equal(resolveFocusPath(items, '/missing', '/other', ['/b']), '/b');
  assert.equal(resolveFocusPath(items, null, null, []), '/a');
  assert.equal(resolveFocusPath([], null, null, []), null);
});

test('Shift 范围始终使用完整目录顺序', () => {
  assert.deepEqual(rangePaths(['/a', '/b', '/c', '/d'], '/b', '/d'), ['/b', '/c', '/d']);
  assert.deepEqual(rangePaths(['/a', '/b', '/c', '/d'], '/d', '/b'), ['/b', '/c', '/d']);
  assert.deepEqual(rangePaths(['/a', '/b'], '/missing', '/b'), ['/b']);
  assert.deepEqual(rangePaths(['/a'], '/a', '/missing'), []);
});

test('单击、Cmd/Ctrl 切换和 Shift 范围选择共用一套语义', () => {
  const { controller, elements, state } = createHarness();

  controller.handleFileSelectionClick({}, elements[1]);
  assert.deepEqual([...state.selectedPaths], ['/workspace/b']);
  assert.equal(state.selectionAnchorPath, '/workspace/b');

  controller.handleFileSelectionClick({ metaKey: true }, elements[2]);
  assert.deepEqual([...state.selectedPaths], ['/workspace/b', '/workspace/c']);
  assert.equal(state.selectionAnchorPath, '/workspace/c');

  controller.handleFileSelectionClick({ metaKey: true }, elements[1]);
  assert.deepEqual([...state.selectedPaths], ['/workspace/c']);

  state.selectionAnchorPath = '/workspace/a';
  controller.handleFileSelectionClick({ shiftKey: true }, elements[2]);
  assert.deepEqual([...state.selectedPaths], ['/workspace/a', '/workspace/b', '/workspace/c']);
});

test('全选同步范围锚点、ARIA、游标焦点、详情和状态栏', () => {
  const { calls, controller, elements, state } = createHarness();

  controller.selectAllVisibleFiles();
  assert.deepEqual([...state.selectedPaths], ['/workspace/a', '/workspace/b', '/workspace/c']);
  assert.equal(state.selectionAnchorPath, '/workspace/a');
  assert.equal(state.fileKeyboardFocusPath, '/workspace/a');
  assert.equal(elements[0].tabIndex, 0);
  assert.equal(elements[1].tabIndex, -1);
  assert.equal(elements[0].getAttribute('aria-selected'), 'true');
  assert.equal(elements[0].classList.contains('selected'), true);
  assert.ok(calls.includes('actions'));
  assert.ok(calls.includes('status'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'detail' && call[1].length === 3));
});

test('Quick Look 切换项目时复用单选语义并保持预览窗口焦点', () => {
  const { calls, controller, elements, state } = createHarness({
    state: { selectedPaths: new Set(['/workspace/a']), selectionAnchorPath: '/workspace/a' }
  });

  assert.equal(controller.selectSinglePath('/workspace/c', { focus: false }), true);
  assert.deepEqual([...state.selectedPaths], ['/workspace/c']);
  assert.equal(state.selectionAnchorPath, '/workspace/c');
  assert.equal(state.fileKeyboardFocusPath, '/workspace/c');
  assert.equal(elements[2].focusCalls.length, 0);
  assert.equal(elements[2].scrollCalls.length, 1);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'repo' && call[1] === '/workspace/c'));
  assert.equal(controller.focusPath('/workspace/c'), true);
  assert.equal(elements[2].focusCalls.length, 1);
  assert.equal(controller.selectSinglePath('/workspace/missing'), false);
  assert.equal(controller.focusPath('/workspace/missing'), false);
});

test('虚拟列表键盘导航先定位完整顺序，再聚焦已渲染行', () => {
  const ensured = [];
  const { app, controller, elements, state } = createHarness({
    state: { cardStyle: 'list', selectedPaths: new Set(['/workspace/a']), selectionAnchorPath: '/workspace/a' }
  });
  app.directoryVirtualizer = { ensureIndex: index => ensured.push(index) };
  const event = {
    key: 'End',
    shiftKey: true,
    target: { closest: () => elements[0] }
  };

  assert.equal(controller.handleVirtualizedListKeyboardNavigation(event), true);
  assert.deepEqual([...state.selectedPaths], ['/workspace/a', '/workspace/b', '/workspace/c']);
  assert.equal(state.fileKeyboardFocusPath, '/workspace/c');
  assert.deepEqual(ensured, [2]);
  assert.equal(elements[2].focusCalls.length, 1);
});

test('虚拟图标网格按完整顺序和当前列数执行方向键与 Shift 范围选择', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    path: `/workspace/${String(index + 1).padStart(2, '0')}`,
    name: String(index + 1),
    type: 'file'
  }));
  const ensured = [];
  const { app, controller, elements, state } = createHarness({
    items,
    state: {
      cardStyle: 'card',
      fileKeyboardFocusPath: items[1].path,
      selectedPaths: new Set([items[1].path]),
      selectionAnchorPath: items[1].path
    }
  });
  app.directoryVirtualizer = {
    ensureIndex: index => ensured.push(index),
    itemsPerRow: () => 4
  };
  const event = {
    key: 'ArrowDown',
    shiftKey: true,
    target: { closest: () => elements[1] }
  };

  assert.equal(controller.handleVirtualizedListKeyboardNavigation(event), true);
  assert.equal(state.fileKeyboardFocusPath, items[5].path);
  assert.deepEqual([...state.selectedPaths], items.slice(1, 6).map(item => item.path));
  assert.deepEqual(ensured, [5]);
  assert.equal(elements[5].focusCalls.length, 1);
});

test('目录选择控制器在 App 之前加载，主对象仅保留兼容委托', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.ok(html.indexOf('scripts/directorySelectionController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupDirectorySelectionController/);
  assert.match(appSource, /handleFileSelectionClick\(event, element\) \{\s*return this\.directorySelectionController\.handleFileSelectionClick\(event, element\);/);
  assert.match(appSource, /selectAllVisibleFiles\(\) \{\s*return this\.directorySelectionController\.selectAllVisibleFiles\(\);/);
});
