const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const performanceModulePath = path.join(projectRoot, 'src/renderer/scripts/directoryPerformance.js');

test('目录性能样本区分读取、筛选、首批 DOM 和完整显示耗时', () => {
  const DirectoryPerformance = require(performanceModulePath);
  const sample = DirectoryPerformance.begin({
    requestId: 7,
    path: '/workspace/huge',
    style: 'card'
  }, 100);

  DirectoryPerformance.markRead(sample, 12000, 142.5);
  DirectoryPerformance.markVisible(sample, 12000, 147.5);
  DirectoryPerformance.setStrategy(sample, 'virtual-card', { itemsPerRow: 2 });
  DirectoryPerformance.markFirstDom(sample, { domItems: 14, itemsPerRow: 2 }, 154);
  DirectoryPerformance.markFirstDom(sample, { domItems: 30, itemsPerRow: 3 }, 158);
  DirectoryPerformance.complete(sample, { domItems: 14, itemsPerRow: 2 }, 160);

  assert.deepEqual(DirectoryPerformance.snapshot(sample), {
    requestId: 7,
    path: '/workspace/huge',
    style: 'card',
    strategy: 'virtual-card',
    sourceItems: 12000,
    visibleItems: 12000,
    domItems: 14,
    itemsPerRow: 2,
    readMs: 42.5,
    filterMs: 5,
    firstDomMs: 54,
    renderMs: 12.5,
    totalMs: 60,
    completed: true,
    cancelled: false
  });
});

test('取消的旧目录样本不会冒充一次成功完成', () => {
  const DirectoryPerformance = require(performanceModulePath);
  const sample = DirectoryPerformance.begin({ requestId: 8, path: '/workspace/old', style: 'list' }, 200);
  DirectoryPerformance.markRead(sample, 4000, 230);
  DirectoryPerformance.cancel(sample, 240);
  DirectoryPerformance.complete(sample, { domItems: 40 }, 260);

  const snapshot = DirectoryPerformance.snapshot(sample);
  assert.equal(snapshot.cancelled, true);
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.totalMs, 40);
});

test('诊断摘要使用明确的显示策略和本机瞬时指标', () => {
  const DirectoryPerformance = require(performanceModulePath);
  const sample = DirectoryPerformance.begin({ requestId: 9, path: '/workspace/huge', style: 'card' }, 0);
  DirectoryPerformance.markRead(sample, 12000, 21.25);
  DirectoryPerformance.markVisible(sample, 11998, 24.75);
  DirectoryPerformance.setStrategy(sample, 'virtual-card', { itemsPerRow: 3 });
  DirectoryPerformance.markFirstDom(sample, { domItems: 21, itemsPerRow: 3 }, 29.5);
  DirectoryPerformance.complete(sample, { domItems: 21, itemsPerRow: 3 }, 31);

  assert.equal(DirectoryPerformance.strategyLabel('virtual-list'), '固定行虚拟列表');
  assert.equal(DirectoryPerformance.strategyLabel('progressive-gallery'), '渐进图库');
  assert.deepEqual(DirectoryPerformance.diagnosticRows(sample), [
    { label: '显示策略', value: '多列虚拟图标（3 列）' },
    { label: '目录项目', value: '11,998 / 12,000' },
    { label: '当前 DOM', value: '21 项' },
    { label: '目录读取', value: '21.3 ms' },
    { label: '筛选准备', value: '3.5 ms' },
    { label: '首批 DOM', value: '29.5 ms' },
    { label: '完整显示', value: '31.0 ms' }
  ]);
});

test('性能诊断模块在 App 前加载，入口收纳在显示菜单且不持久化', () => {
  const indexSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/directoryPerformanceController.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  const moduleSource = fs.readFileSync(performanceModulePath, 'utf8');

  assert.ok(indexSource.indexOf('scripts/directoryPerformance.js') < indexSource.indexOf('scripts/app.js'));
  assert.ok(indexSource.indexOf('scripts/directoryPerformanceController.js') < indexSource.indexOf('scripts/app.js'));
  assert.match(indexSource, /id="directory-performance-diagnostics"/);
  assert.match(indexSource, /id="directory-performance-modal"/);
  assert.match(indexSource, /本次会话内存/);
  assert.match(appSource, /setupDirectoryPerformanceController/);
  assert.match(appSource, /directoryPerformanceController\.markRead/);
  assert.match(appSource, /directoryPerformanceController\.markFirstDom/);
  assert.match(appSource, /directoryPerformanceController\.complete/);
  assert.match(controllerSource, /DirectoryPerformanceController/);
  assert.match(controllerSource, /sort-menu-trigger/);
  assert.match(styleSource, /\.directory-performance-grid/);
  assert.doesNotMatch(moduleSource, /localStorage|sessionStorage|config\.set|gitFinder/);
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage|config\.set|gitFinder/);
});
