const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VirtualDirectoryWindow = require('../src/renderer/scripts/virtualDirectoryWindow');

test('只有超大目录启用固定行虚拟窗口', () => {
  assert.equal(VirtualDirectoryWindow.shouldVirtualize(1000), false);
  assert.equal(VirtualDirectoryWindow.shouldVirtualize(1001), true);
  assert.equal(VirtualDirectoryWindow.shouldVirtualize(200, { threshold: 100 }), true);
});

test('普通文件图标网格只在高度可预测的大目录启用虚拟窗口', () => {
  const plainItems = Array.from({ length: 1001 }, (_, index) => ({
    type: index % 5 === 0 ? 'directory' : 'file',
    path: `/workspace/item-${index}`,
    name: `item-${index}`
  }));
  assert.equal(VirtualDirectoryWindow.canVirtualizeCardItems(plainItems), true);
  assert.equal(VirtualDirectoryWindow.canVirtualizeCardItems(plainItems.slice(0, 1000)), false);
  assert.equal(VirtualDirectoryWindow.canVirtualizeCardItems([
    ...plainItems.slice(0, 1000),
    { type: 'directory', path: '/workspace/repo', name: 'repo', isGitRepo: true }
  ]), false);
  assert.equal(VirtualDirectoryWindow.canVirtualizeCardItems([
    ...plainItems.slice(0, 1000),
    { type: 'directory', path: '/workspace/project', name: 'project', isProject: true }
  ]), false);
});

test('图标网格按可用宽度计算稳定列数', () => {
  assert.equal(VirtualDirectoryWindow.gridColumnCount(279), 1);
  assert.equal(VirtualDirectoryWindow.gridColumnCount(280), 1);
  assert.equal(VirtualDirectoryWindow.gridColumnCount(571), 1);
  assert.equal(VirtualDirectoryWindow.gridColumnCount(572), 2);
  assert.equal(VirtualDirectoryWindow.gridColumnCount(864), 3);
});

test('虚拟窗口在顶部、中段和尾部只保留可见行及有限过扫描', () => {
  const options = { rowHeight: 40, overscan: 5 };
  assert.deepEqual(VirtualDirectoryWindow.calculateWindow(1000, 0, 400, options), {
    start: 0,
    end: 15,
    offset: 0,
    rendered: 15,
    totalHeight: 40000
  });
  assert.deepEqual(VirtualDirectoryWindow.calculateWindow(1000, 4000, 400, options), {
    start: 95,
    end: 115,
    offset: 3800,
    rendered: 20,
    totalHeight: 40000
  });
  assert.deepEqual(VirtualDirectoryWindow.calculateWindow(1000, 39600, 400, options), {
    start: 985,
    end: 1000,
    offset: 39400,
    rendered: 15,
    totalHeight: 40000
  });
});

test('多列虚拟窗口以完整项目索引切片并按行保留总高度', () => {
  const options = { rowHeight: 132, overscan: 2, itemsPerRow: 4 };
  assert.deepEqual(VirtualDirectoryWindow.calculateWindow(1000, 0, 396, options), {
    start: 0,
    end: 20,
    offset: 0,
    rendered: 20,
    totalHeight: 33000
  });
  assert.deepEqual(VirtualDirectoryWindow.calculateWindow(1000, 1320, 396, options), {
    start: 32,
    end: 60,
    offset: 1056,
    rendered: 28,
    totalHeight: 33000
  });
  assert.equal(VirtualDirectoryWindow.scrollTopForIndex(100, 0, 396, 1000, options), 3036);
});

test('键盘目标只在越出视口时调整滚动位置', () => {
  const options = { rowHeight: 40 };
  assert.equal(VirtualDirectoryWindow.scrollTopForIndex(2, 0, 400, 1000, options), 0);
  assert.equal(VirtualDirectoryWindow.scrollTopForIndex(30, 0, 400, 1000, options), 840);
  assert.equal(VirtualDirectoryWindow.scrollTopForIndex(5, 400, 400, 1000, options), 200);
  assert.equal(VirtualDirectoryWindow.scrollTopForIndex(999, 39600, 400, 1000, options), 39600);
});

test('控制器挂载、滚动和键盘定位都会更新有限窗口，销毁后停止监听', () => {
  const listeners = new Map();
  const rendered = [];
  const scrollElement = {
    scrollTop: 100,
    clientHeight: 400,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    }
  };
  const viewportElement = { offsetTop: 100, style: {} };
  const windowElement = { style: {} };
  const controller = new VirtualDirectoryWindow.Controller({
    total: 1000,
    scrollElement,
    viewportElement,
    windowElement,
    rowHeight: 40,
    overscan: 5,
    renderRange: range => rendered.push([range.start, range.end]),
    schedule: callback => { callback(); return callback; },
    cancelSchedule: () => {}
  });

  controller.mount();
  assert.deepEqual(rendered, [[0, 15]]);
  assert.equal(viewportElement.style.height, '40000px');
  assert.equal(windowElement.style.transform, 'translateY(0px)');
  scrollElement.scrollTop = 4100;
  listeners.get('scroll')();
  assert.deepEqual(rendered.at(-1), [95, 115]);
  assert.equal(windowElement.style.transform, 'translateY(3800px)');

  controller.ensureIndex(900);
  assert.equal(scrollElement.scrollTop, 35740);
  assert.ok(rendered.at(-1)[0] <= 900 && rendered.at(-1)[1] > 900);
  controller.destroy();
  assert.equal(listeners.has('scroll'), false);
});

test('图标窗口列数变化时保持原顶部项目并更新总高度', () => {
  let columns = 4;
  const rendered = [];
  const scrollElement = {
    scrollTop: 1320,
    clientHeight: 396,
    addEventListener() {},
    removeEventListener() {}
  };
  const viewportElement = { offsetTop: 0, style: {} };
  const windowElement = { style: {} };
  const controller = new VirtualDirectoryWindow.Controller({
    total: 1000,
    scrollElement,
    viewportElement,
    windowElement,
    rowHeight: 132,
    overscan: 2,
    itemsPerRowProvider: () => columns,
    renderRange: range => rendered.push(range),
    schedule: callback => { callback(); return callback; }
  });

  controller.mount();
  assert.equal(controller.itemsPerRow(), 4);
  assert.equal(viewportElement.style.height, '33000px');
  columns = 2;
  controller.refresh(true);
  assert.equal(controller.itemsPerRow(), 2);
  assert.equal(viewportElement.style.height, '66000px');
  assert.equal(scrollElement.scrollTop, 2640);
  assert.equal(rendered.at(-1).start <= 40 && rendered.at(-1).end > 40, true);
});

test('列表与普通图标虚拟化模块在 App 前加载，并保留完整选择顺序与键盘定位入口', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

  assert.ok(html.indexOf('scripts/virtualDirectoryWindow.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /VirtualDirectoryWindow\.shouldVirtualize/);
  assert.match(appSource, /new window\.VirtualDirectoryWindow\.Controller/);
  assert.match(appSource, /VirtualDirectoryWindow\.canVirtualizeCardItems/);
  assert.match(appSource, /handleVirtualizedListKeyboardNavigation/);
  assert.match(appSource, /AppState\.fileDisplayOrder/);
  assert.match(appSource, /aria-setsize/);
  assert.match(css, /\.virtual-directory-viewport/);
  assert.match(css, /\.virtual-directory-window/);
  assert.match(css, /\.virtual-directory-card-window/);
});
