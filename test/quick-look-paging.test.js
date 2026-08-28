const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QuickLookPaging = require('../src/renderer/scripts/quickLookPaging');

function initialPreview() {
  return {
    kind: 'code',
    language: 'log',
    name: 'large.log',
    path: '/workspace/large.log',
    content: 'first\n',
    paged: true,
    truncated: true,
    startOffset: 0,
    endOffset: 6,
    totalSize: 18,
    startLine: 1,
    nextPageToken: 'token-1',
    limitReached: false
  };
}

test('Quick Look 分页控制器显示当前字节范围和按需读取状态', () => {
  const controller = new QuickLookPaging.Controller();
  controller.start(initialPreview());
  const state = controller.viewState();
  assert.equal(state.active, true);
  assert.equal(state.sequence, 1);
  assert.equal(state.canLoadNext, true);
  const html = QuickLookPaging.renderControls(state);
  assert.match(html, /第 1 段/);
  assert.match(html, /加载下一段/);
  assert.match(html, /按需读取/);
});

test('Quick Look 只接受与当前文件和连续偏移一致的下一段', async () => {
  const controller = new QuickLookPaging.Controller();
  controller.start(initialPreview());
  const result = await controller.loadNext(async token => {
    assert.equal(token, 'token-1');
    return {
      kind: 'text-page',
      path: '/workspace/large.log',
      previewKind: 'code',
      language: 'log',
      content: 'second\n',
      startOffset: 6,
      endOffset: 13,
      totalSize: 18,
      startLine: 2,
      nextPageToken: 'token-2',
      hasMore: true,
      limitReached: false
    };
  });
  assert.equal(result.stale, false);
  assert.equal(result.preview.content, 'second\n');
  assert.equal(result.preview.startLine, 2);
  assert.equal(controller.viewState().sequence, 2);
  assert.match(QuickLookPaging.renderControls(controller.viewState()), /回到开头/);

  await assert.rejects(() => controller.loadNext(async () => ({
    kind: 'text-page',
    path: '/workspace/other.log',
    content: 'bad',
    startOffset: 13,
    endOffset: 16,
    totalSize: 18
  })), /不一致/);
  assert.match(controller.viewState().error, /不一致/);
});

test('关闭 Quick Look 后迟到的分页结果不会替换当前内容', async () => {
  const controller = new QuickLookPaging.Controller();
  controller.start(initialPreview());
  let resolvePage;
  const pending = controller.loadNext(() => new Promise(resolve => { resolvePage = resolve; }));
  assert.equal(controller.close(), null);
  resolvePage({
    kind: 'text-page',
    path: '/workspace/large.log',
    content: 'late',
    startOffset: 6,
    endOffset: 10,
    totalSize: 18
  });
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(controller.currentPreview(), null);
});

test('关闭尚未翻页的 Quick Look 会交还待撤销令牌', () => {
  const controller = new QuickLookPaging.Controller();
  controller.start(initialPreview());
  assert.equal(controller.close(), 'token-1');
  assert.equal(controller.currentPreview(), null);
});

test('Quick Look 分页错误文本必须转义', () => {
  const html = QuickLookPaging.renderControls({
    active: true,
    sequence: 2,
    startOffset: 10,
    endOffset: 20,
    totalSize: 30,
    error: '<img src=x onerror=alert(1)>'
  });
  assert.doesNotMatch(html, /<img src=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /回到开头|重新打开/);
});

test('大型文本分页通过受信 IPC 暴露且模块在 App 前加载', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/content.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controller = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/quickLookController.js'), 'utf8');
  assert.match(preload, /getTextPage:\s*\(pageToken\)\s*=>\s*ipcRenderer\.invoke\('content:getTextPage', pageToken\)/);
  assert.match(preload, /releaseTextPage:\s*\(pageToken\)\s*=>\s*ipcRenderer\.invoke\('content:releaseTextPage', pageToken\)/);
  assert.match(ipc, /registerTrustedHandler\('content:getTextPage'/);
  assert.match(ipc, /registerTrustedHandler\('content:releaseTextPage'/);
  assert.ok(html.indexOf('scripts/quickLookPaging.js') < html.indexOf('scripts/quickLookController.js'));
  assert.ok(html.indexOf('scripts/quickLookController.js') < html.indexOf('scripts/app.js'));
  assert.match(controller, /getPreview\(item\.path, \{ enablePaging: true \}\)/);
  assert.match(controller, /pagingModule\.renderControls/);
  assert.match(controller, /_releasePagingToken\(\)/);
  assert.doesNotMatch(app, /content\.getTextPage/);
});
