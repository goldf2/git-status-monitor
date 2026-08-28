const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const DirectoryLoadState = require('../src/renderer/scripts/directoryLoadState.js');

function createState() {
  return {
    currentPath: '/workspace/first',
    currentMode: 'tree',
    cardStyle: 'card',
    directoryRenderRequestId: 1,
    directoryLoad: null,
    fileDisplayOrder: ['/workspace/first/old.txt']
  };
}

test('目录加载状态只允许当前请求完成，迟到请求不能清除新目录状态', () => {
  const state = createState();
  const first = { requestId: 1, path: '/workspace/first', mode: 'tree', style: 'card' };
  DirectoryLoadState.begin(state, first);
  assert.equal(DirectoryLoadState.status(state), 'loading');
  assert.deepEqual(state.fileDisplayOrder, []);

  state.currentPath = '/workspace/second';
  state.directoryRenderRequestId = 2;
  const second = { requestId: 2, path: '/workspace/second', mode: 'tree', style: 'card' };
  DirectoryLoadState.begin(state, second);

  assert.equal(DirectoryLoadState.finish(state, first), false);
  assert.equal(DirectoryLoadState.status(state), 'loading');
  assert.equal(state.directoryLoad.path, '/workspace/second');
  assert.equal(DirectoryLoadState.finish(state, second), true);
  assert.equal(DirectoryLoadState.status(state), 'idle');
});

test('目录读取失败保留当前请求的错误语义，下一次读取会恢复加载态', () => {
  const state = createState();
  const context = { requestId: 1, path: '/workspace/first', mode: 'tree', style: 'card' };
  DirectoryLoadState.begin(state, context);
  assert.equal(DirectoryLoadState.fail(state, context), true);
  assert.equal(DirectoryLoadState.status(state), 'error');

  state.directoryRenderRequestId = 2;
  const retry = { ...context, requestId: 2 };
  DirectoryLoadState.begin(state, retry);
  assert.equal(DirectoryLoadState.status(state), 'loading');
  assert.equal(DirectoryLoadState.fail(state, context), false);
  assert.equal(DirectoryLoadState.status(state), 'loading');
});

test('目录加载模块在 App 前载入，界面使用可访问加载态而不是零计数', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

  assert.ok(html.indexOf('scripts/directoryLoadState.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /DirectoryLoadState\.begin\(AppState, context\)/);
  assert.match(appSource, /当前目录 · 正在载入…/);
  assert.match(appSource, /rightText = '正在载入当前文件夹…'/);
  assert.match(appSource, /role="status" aria-live="polite"/);
  assert.match(css, /\.directory-load-state/);
});
