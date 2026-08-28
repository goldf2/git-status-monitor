const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UnavailableLocation = require('../src/renderer/scripts/unavailableLocationController');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

test('只有整个受管根不可用才进入可重连状态', () => {
  const rootUnavailable = {
    directories: [{ path: '/Volumes/External/work', availability: 'root-unavailable', rootAvailable: false }]
  };
  const deletedChild = {
    directories: [{ path: '/workspace/deleted', availability: 'path-unavailable', rootAvailable: true }]
  };

  assert.equal(UnavailableLocation.isReconnectable('/Volumes/External/work', rootUnavailable), true);
  assert.equal(UnavailableLocation.isReconnectable('/workspace/deleted', deletedChild), false);
  assert.equal(UnavailableLocation.isReconnectable('/outside', { directories: [] }), false);
});

test('断开位置文案保留原路径并转义外部内容', () => {
  const view = UnavailableLocation.presentUnavailableLocation({
    path: '/Volumes/<External>/work',
    attempt: 2,
    escapeHtml: value => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  });

  assert.equal(view.title, '位置暂时不可用');
  assert.match(view.description, /外接磁盘|网络位置/);
  assert.equal(view.path, '/Volumes/&lt;External&gt;/work');
  assert.match(view.retryLabel, /再次重试/);
  assert.match(view.boundary, /保留此标签页/);
});

test('断开状态使用当前内容区提供重试和选择位置，不自动调用挂载或系统文件管理器', () => {
  assert.ok(html.indexOf('scripts/unavailableLocationController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupUnavailableLocationController\(\)/);
  assert.match(appSource, /data-app-action[^\n]*retry-unavailable-location|retry-unavailable-location/);
  assert.match(appSource, /choose-unavailable-location/);
  assert.match(appSource, /availability === 'root-unavailable'/);
  assert.match(cssSource, /\.directory-unavailable-state/);
  assert.doesNotMatch(appSource, /mountVolume|diskutil|net use/);
});

test('重试保持断开位置，重连后原地刷新；根已恢复但目录消失时交回安全修复流程', async () => {
  const contentArea = { innerHTML: '' };
  const statuses = [];
  let currentInspection = {
    directories: [{ path: '/Volumes/External/work', available: false, availability: 'root-unavailable' }]
  };
  const calls = { sidebar: 0, content: 0, repair: 0 };
  const app = {
    escapeHtml: value => String(value),
    _showStatusMessage: (message, type) => statuses.push({ message, type }),
    renderSidebarTree: async () => { calls.sidebar += 1; },
    renderContent: async () => { calls.content += 1; },
    repairUnavailableWorkspaceLocation: async () => { calls.repair += 1; }
  };
  const controller = new UnavailableLocation.Controller({
    app,
    bridge: { fs: { inspectWorkspaceDirectories: async () => currentInspection } },
    document: { getElementById: id => id === 'content-area' ? contentArea : null }
  });

  controller.show('/Volumes/External/work');
  assert.match(contentArea.innerHTML, /位置暂时不可用/);
  assert.equal(await controller.retry(), false);
  assert.match(contentArea.innerHTML, /再次重试/);
  assert.equal(calls.content, 0);

  currentInspection = {
    directories: [{ path: '/Volumes/External/work', available: true, availability: 'available' }]
  };
  assert.equal(await controller.retry(), true);
  assert.equal(calls.sidebar, 1);
  assert.equal(calls.content, 1);
  assert.equal(statuses.at(-1).type, 'success');

  controller.show('/Volumes/External/work/deleted');
  currentInspection = {
    directories: [{ path: '/Volumes/External/work/deleted', available: false, availability: 'path-unavailable' }]
  };
  assert.equal(await controller.retry(), false);
  assert.equal(calls.repair, 1);
});
