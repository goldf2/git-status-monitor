const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ProgressiveDirectoryRender = require('../src/renderer/scripts/progressiveDirectoryRender');

test('小目录单批同步完成，大目录保留全部条目并生成有限批次', () => {
  assert.deepEqual(ProgressiveDirectoryRender.createBatchPlan(80), [
    { from: 0, to: 80, initial: true }
  ]);
  assert.deepEqual(ProgressiveDirectoryRender.createBatchPlan(650, {
    threshold: 320,
    initialBatch: 120,
    batchSize: 180
  }), [
    { from: 0, to: 120, initial: true },
    { from: 120, to: 300, initial: false },
    { from: 300, to: 480, initial: false },
    { from: 480, to: 650, initial: false }
  ]);
  assert.equal(ProgressiveDirectoryRender.shouldRenderProgressively(320), false);
  assert.equal(ProgressiveDirectoryRender.shouldRenderProgressively(321), true);
});

test('批次渲染先同步交付首屏，再逐帧完成且进度单调', async () => {
  const queue = [];
  const cancelled = [];
  const ranges = [];
  const progress = [];
  const renderer = new ProgressiveDirectoryRender.BatchRenderer({
    schedule: callback => {
      queue.push(callback);
      return callback;
    },
    cancelSchedule: handle => cancelled.push(handle)
  });

  const completion = renderer.render(650, {
    onBatch: range => ranges.push(range),
    onProgress: state => progress.push(state.rendered)
  });
  assert.deepEqual(ranges, [{ from: 0, to: 120, initial: true }]);
  assert.deepEqual(progress, [120]);

  while (queue.length) queue.shift()();
  assert.deepEqual(await completion, {
    cancelled: false,
    generation: 1,
    rendered: 650,
    total: 650
  });
  assert.deepEqual(progress, [120, 300, 480, 650]);
  assert.equal(cancelled.length, 0);
});

test('目录切换会取消旧批次，迟到回调不能继续创建条目', async () => {
  const queue = [];
  const ranges = [];
  let current = true;
  const renderer = new ProgressiveDirectoryRender.BatchRenderer({
    schedule: callback => {
      queue.push(callback);
      return callback;
    },
    cancelSchedule: () => {}
  });
  const completion = renderer.render(800, {
    isCurrent: () => current,
    onBatch: range => ranges.push(range)
  });
  assert.equal(ranges.length, 1);
  current = false;
  queue.shift()();
  const result = await completion;
  assert.equal(result.cancelled, true);
  assert.equal(result.reason, 'stale');
  assert.equal(result.rendered, 120);
  assert.equal(ranges.length, 1);
});

test('显式取消会结算旧会话，新渲染不会继承旧进度', async () => {
  const queue = [];
  const renderer = new ProgressiveDirectoryRender.BatchRenderer({
    schedule: callback => {
      queue.push(callback);
      return callback;
    },
    cancelSchedule: () => {}
  });
  const first = renderer.render(900);
  assert.equal(renderer.cancel('directory-changed'), true);
  const firstResult = await first;
  assert.equal(firstResult.cancelled, true);
  assert.equal(firstResult.reason, 'directory-changed');

  const second = renderer.render(12);
  assert.deepEqual(await second, {
    cancelled: false,
    generation: 2,
    rendered: 12,
    total: 12
  });
});

test('批次异常会停止后续调度并交给界面清理进度', async () => {
  const errors = [];
  const renderer = new ProgressiveDirectoryRender.BatchRenderer({
    schedule: () => assert.fail('首批失败后不应继续调度'),
    cancelSchedule: () => {}
  });
  const expected = new Error('render failed');
  await assert.rejects(renderer.render(400, {
    onBatch: () => { throw expected; },
    onError: error => errors.push(error)
  }), expected);
  assert.deepEqual(errors, [expected]);
  assert.equal(renderer.session, null);
});

test('渐进期间范围选择使用完整目录顺序，非目录视图回退到已渲染顺序', () => {
  const visible = ['/a', '/b', '/c', '/d'];
  assert.deepEqual(ProgressiveDirectoryRender.resolveDisplayOrder(
    visible,
    visible,
    ['/a', '/b'],
    '/b'
  ), visible);
  assert.deepEqual(ProgressiveDirectoryRender.resolveDisplayOrder(
    visible,
    ['/a', '/b'],
    ['/c', '/d'],
    '/d'
  ), ['/c', '/d']);
});

test('进度模块在 App 前加载，四种目录视图共用同一批次控制器', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

  assert.ok(html.indexOf('scripts/progressiveDirectoryRender.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /ProgressiveDirectoryRender\.BatchRenderer/);
  assert.match(appSource, /renderDirectoryItemsProgressively\(/);
  assert.match(appSource, /renderCardView\(items, container, context(?: = null)?\)/);
  assert.match(appSource, /renderListView\(items, container, context(?: = null)?\)/);
  assert.match(appSource, /renderColumnView\(items, contentArea, context\)/);
  assert.match(appSource, /renderGalleryView\(items, contentArea, context\)/);
  assert.match(appSource, /directoryRenderRequestId/);
  assert.match(appSource, /isDirectoryRenderContextCurrent\(context\)/);
  assert.match(appSource, /fileDisplayOrder/);
  assert.match(appSource, /bindCardElements\(elements\)/);
  assert.match(appSource, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(css, /\.directory-render-progress/);
  assert.match(css, /\.directory-progress-active \.finder-column-browser/);
});
