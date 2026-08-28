const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  Controller,
  breadcrumbParts,
  getParentPath,
  locationName,
  pathsEqual
} = require('../src/renderer/scripts/directoryNavigationController');
const ContentQuery = require('../src/renderer/scripts/contentQuery');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createHarness(overrides = {}) {
  const calls = [];
  const managedRoots = overrides.managedRoots || ['/workspace'];
  const elements = new Map();
  for (const id of ['current-path', 'btn-back', 'btn-forward', 'btn-up']) {
    elements.set(id, {
      id,
      textContent: '',
      innerHTML: '',
      disabled: false,
      title: '',
      querySelectorAll: () => []
    });
  }
  const state = {
    currentPath: '/workspace/current',
    currentMode: 'tree',
    history: ['/workspace/start', '/workspace/current'],
    historyIndex: 1,
    contentQuery: ContentQuery.defaultQuery(),
    ...overrides.state
  };
  const app = {
    escapeHtml,
    showEmptyState: () => calls.push('empty'),
    closeQuickLook: () => calls.push('close-preview'),
    clearFileSelection: () => calls.push('clear-selection'),
    applyDirectoryViewPreference: (directoryPath, mode) => calls.push(['view-preference', directoryPath, mode]),
    captureActiveWorkspaceTab: () => calls.push('capture-tab'),
    renderWorkspaceTabs: () => calls.push('render-tabs'),
    scheduleWorkspaceTabsPersist: () => calls.push('persist-tabs'),
    renderContent: () => calls.push('content'),
    _syncTreeToCurrentPath: () => calls.push('sync-tree'),
    isManagedPath: candidatePath => managedRoots.some(rootPath => {
      const normalize = value => {
        const normalized = String(value || '').replace(/[\\/]+$/, '');
        return (overrides.platform || 'darwin') === 'win32'
          ? normalized.replace(/\//g, '\\').toLowerCase()
          : normalized;
      };
      const candidate = normalize(candidatePath);
      const root = normalize(rootPath);
      return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
    }),
    _showStatusMessage: (message, kind) => calls.push(['status', message, kind]),
    ...overrides.app
  };
  const bridge = {
    platform: overrides.platform || 'darwin',
    config: {
      set: async (key, value) => calls.push(['config', key, value])
    },
    ...overrides.bridge
  };
  const document = {
    getElementById: id => elements.get(id) || null,
    ...overrides.document
  };
  const controller = new Controller({
    app,
    state,
    bridge,
    workspaceTabs: { MAX_HISTORY: 50 },
    contentQuery: ContentQuery,
    document,
    platform: overrides.platform
  });
  return { controller, state, app, bridge, document, elements, calls };
}

test('上级目录在 POSIX、Windows 盘符和 UNC 根上保持绝对路径', () => {
  assert.equal(getParentPath('/Volumes/project/repo'), '/Volumes/project');
  assert.equal(getParentPath('/Volumes'), '/');
  assert.equal(getParentPath('/'), null);

  assert.equal(getParentPath('C:\\Work\\Repo', 'win32'), 'C:\\Work');
  assert.equal(getParentPath('C:\\Work', 'win32'), 'C:\\');
  assert.equal(getParentPath('C:\\', 'win32'), null);
  assert.equal(getParentPath('C:/Work/Repo', 'win32'), 'C:/Work');

  assert.equal(getParentPath('\\\\server\\share\\folder\\repo', 'win32'), '\\\\server\\share\\folder');
  assert.equal(getParentPath('\\\\server\\share\\folder', 'win32'), '\\\\server\\share');
  assert.equal(getParentPath('\\\\server\\share', 'win32'), null);
});

test('面包屑为盘符和 UNC 共享生成可导航的绝对路径', () => {
  assert.deepEqual(breadcrumbParts('C:\\Work\\Repo', 'win32'), [
    { name: 'C:', absPath: 'C:\\' },
    { name: 'Work', absPath: 'C:\\Work' },
    { name: 'Repo', absPath: 'C:\\Work\\Repo' }
  ]);
  assert.deepEqual(breadcrumbParts('\\\\server\\share\\folder\\repo', 'win32'), [
    { name: 'server\\share', absPath: '\\\\server\\share' },
    { name: 'folder', absPath: '\\\\server\\share\\folder' },
    { name: 'repo', absPath: '\\\\server\\share\\folder\\repo' }
  ]);
  assert.equal(locationName('C:\\', 'win32'), 'C:');
  assert.equal(locationName('/', 'darwin'), '/');
});

test('Windows 路径比较忽略大小写、分隔符和尾部分隔符', () => {
  assert.equal(pathsEqual('C:\\Work\\Repo\\', 'c:/work/repo', 'win32'), true);
  assert.equal(pathsEqual('/Work/Repo', '/work/repo', 'darwin'), false);
  assert.equal(pathsEqual('/', '', 'darwin'), false);
});

test('导航写入有限历史并执行统一的目录切换生命周期', async () => {
  const history = Array.from({ length: 50 }, (_item, index) => `/workspace/${index}`);
  const { controller, state, calls } = createHarness({
    state: {
      currentPath: '/workspace/49',
      history,
      historyIndex: 49
    }
  });

  assert.equal(controller.navigateTo('/workspace/next'), true);
  await Promise.resolve();

  assert.equal(state.currentPath, '/workspace/next');
  assert.equal(state.history.length, 50);
  assert.equal(state.history[0], '/workspace/1');
  assert.equal(state.history.at(-1), '/workspace/next');
  assert.equal(state.historyIndex, 49);
  assert.ok(calls.indexOf('close-preview') < calls.indexOf('content'));
  assert.ok(calls.indexOf('clear-selection') < calls.indexOf('content'));
  assert.ok(calls.includes('capture-tab'));
  assert.ok(calls.includes('render-tabs'));
  assert.ok(calls.includes('persist-tabs'));
  assert.ok(calls.includes('sync-tree'));
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'config' && call[2] === '/workspace/next'));

  const historyLength = state.history.length;
  controller.navigateTo('/workspace/next');
  assert.equal(state.history.length, historyLength);
});

test('后退、前进和上级目录复用同一切换生命周期', async () => {
  const { controller, state, calls } = createHarness();

  assert.equal(controller.goBack(), true);
  assert.equal(state.currentPath, '/workspace/start');
  assert.equal(state.historyIndex, 0);
  assert.equal(controller.goBack(), false);
  assert.equal(controller.goForward(), true);
  assert.equal(state.currentPath, '/workspace/current');
  assert.equal(controller.goUp(), true);
  assert.equal(state.currentPath, '/workspace');
  assert.deepEqual(state.history, ['/workspace/start', '/workspace/current', '/workspace']);
  await Promise.resolve();
  assert.equal(calls.filter(call => call === 'close-preview').length, 3);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'config' && call[2] === '/workspace/start'));
});

test('受管根目录阻止直接导航和上级导航越界', () => {
  const managedRoot = '/Volumes/project/workspace';
  const { controller, state, elements, calls } = createHarness({
    managedRoots: [managedRoot],
    state: {
      currentPath: managedRoot,
      history: [managedRoot],
      historyIndex: 0
    }
  });

  assert.equal(controller.navigateTo('/Volumes/project'), false);
  assert.equal(controller.goUp(), false);
  assert.equal(state.currentPath, managedRoot);
  assert.deepEqual(state.history, [managedRoot]);
  assert.ok(calls.some(call => Array.isArray(call)
    && call[0] === 'status'
    && /受管开发目录/.test(call[1])));

  controller.updateNavButtons();
  assert.equal(elements.get('btn-up').disabled, true);
  assert.match(elements.get('btn-up').title, /受管根目录/);
});

test('受管根子目录仍可返回根目录，且历史导航跳过越界位置', () => {
  const managedRoot = '/Volumes/project/workspace';
  const childPath = `${managedRoot}/src`;
  const { controller, state, elements } = createHarness({
    managedRoots: [managedRoot],
    state: {
      currentPath: childPath,
      history: ['/Volumes/project', managedRoot, childPath],
      historyIndex: 2
    }
  });

  controller.updateNavButtons();
  assert.equal(elements.get('btn-up').disabled, false);
  assert.equal(controller.goUp(), true);
  assert.equal(state.currentPath, managedRoot);

  state.history = ['/Volumes/project', managedRoot];
  state.historyIndex = 1;
  controller.updateNavButtons();
  assert.equal(elements.get('btn-back').disabled, true);
  assert.equal(controller.goBack(), false);
  assert.equal(state.currentPath, managedRoot);
});

test('面包屑只允许点击受管根及其后代，外层祖先仅作位置上下文', () => {
  const managedRoot = '/Volumes/project/workspace';
  const { controller, elements } = createHarness({
    managedRoots: [managedRoot],
    state: { currentPath: `${managedRoot}/src` }
  });

  controller.updateBreadcrumbs();
  const html = elements.get('current-path').innerHTML;
  assert.match(html, /class="crumb-item crumb-context"[^>]+title="\/Volumes"/);
  assert.match(html, /class="crumb-item crumb-context"[^>]+title="\/Volumes\/project"/);
  assert.doesNotMatch(html, /class="crumb-item crumb-link" data-path="\/Volumes(?:"|\/project")/);
  assert.match(html, /class="crumb-item crumb-link" data-path="\/Volumes\/project\/workspace"/);
});

test('Windows 盘符和 UNC 受管根都禁止继续向外导航', () => {
  for (const managedRoot of ['C:\\Work\\Repo', '\\\\server\\share\\Repo']) {
    const { controller, state, elements } = createHarness({
      platform: 'win32',
      managedRoots: [managedRoot],
      state: {
        currentPath: managedRoot,
        history: [managedRoot],
        historyIndex: 0
      }
    });
    assert.equal(controller.goUp(), false);
    controller.updateNavButtons();
    assert.equal(elements.get('btn-up').disabled, true);
    assert.equal(state.currentPath, managedRoot);
  }
});

test('面包屑转义特殊目录名，并为工作区和全局筛选显示明确范围', () => {
  const { controller, state, elements } = createHarness({
    state: { currentPath: '/workspace/<bad&">/final' }
  });
  controller.updateBreadcrumbs();
  const html = elements.get('current-path').innerHTML;
  assert.doesNotMatch(html, /<bad&">/);
  assert.match(html, /&lt;bad&amp;&quot;&gt;/);
  assert.match(html, /data-path="\/workspace"/);

  state.currentMode = 'settings';
  controller.updateBreadcrumbs();
  assert.equal(elements.get('current-path').textContent, '应用设置');
  state.currentMode = 'tasks';
  controller.updateBreadcrumbs();
  assert.equal(elements.get('current-path').textContent, '');
  state.currentMode = 'relationships';
  controller.updateBreadcrumbs();
  assert.equal(elements.get('current-path').textContent, '关系白板');
  state.currentMode = 'tree';
  state.contentQuery = ContentQuery.queryForPreset('all-projects');
  controller.updateBreadcrumbs();
  assert.equal(elements.get('current-path').textContent, '所有受管位置 · 项目');
  state.contentQuery = ContentQuery.queryForPreset('all-repositories');
  controller.updateBreadcrumbs();
  assert.equal(elements.get('current-path').textContent, '所有受管位置 · Git 仓库');
});

test('导航按钮显示真实的前后和 Windows 上级目标', () => {
  const { controller, elements } = createHarness({
    platform: 'win32',
    managedRoots: ['C:\\Work', 'D:\\Other'],
    state: {
      currentPath: 'C:\\Work\\Repo',
      history: ['C:\\Work', 'C:\\Work\\Repo', 'D:\\Other'],
      historyIndex: 1
    }
  });
  controller.updateNavButtons();
  assert.equal(elements.get('btn-back').disabled, false);
  assert.equal(elements.get('btn-forward').disabled, false);
  assert.equal(elements.get('btn-up').disabled, false);
  assert.match(elements.get('btn-back').title, /Work/);
  assert.match(elements.get('btn-forward').title, /Other/);
  assert.match(elements.get('btn-up').title, /Work/);
});

test('聚合筛选禁用目录导航，进入真实目录时恢复当前目录查询', () => {
  const { controller, state, elements } = createHarness({
    state: { contentQuery: ContentQuery.queryForPreset('all-repositories'), searchScope: 'global' }
  });
  controller.updateNavButtons();
  assert.equal(elements.get('btn-back').disabled, true);
  assert.equal(elements.get('btn-forward').disabled, true);
  assert.equal(elements.get('btn-up').disabled, true);

  controller.applyPath('/workspace/next');
  assert.deepEqual(state.contentQuery, ContentQuery.queryForPreset('current-all'));
  assert.equal(state.searchScope, 'current');
});

test('关系白板禁用目录导航以避免把画布误解为当前文件夹', () => {
  const { controller, elements } = createHarness({
    state: { currentMode: 'relationships' }
  });
  controller.updateNavButtons();
  assert.equal(elements.get('btn-back').disabled, true);
  assert.equal(elements.get('btn-forward').disabled, true);
  assert.equal(elements.get('btn-up').disabled, true);
});

test('导航控制器在 App 之前加载且主对象只保留兼容委托', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(html, /directoryNavigationController\.js[\s\S]*app\.js/);
  assert.match(appSource, /setupDirectoryNavigationController/);
  assert.match(appSource, /navigateTo\(path, replace = false\) \{\s*return this\.directoryNavigationController\.navigateTo\(path, replace\);/);
  assert.match(appSource, /getParentPath\(path\) \{\s*return this\.directoryNavigationController\.getParentPath\(path\);/);
});
