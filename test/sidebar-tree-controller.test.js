const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  Controller,
  pathIsWithin,
  pathsEqual
} = require('../src/renderer/scripts/sidebarTreeController');

function createHarness(overrides = {}) {
  const calls = [];
  const container = {
    innerHTML: '',
    querySelectorAll: () => []
  };
  const state = {
    currentPath: '/managed/alpha',
    currentMode: 'tree',
    showHiddenFiles: false,
    ...overrides.state
  };
  const app = {
    _treeRoots: [],
    _treeExpandedPaths: new Set(),
    _treeRootsLoaded: false,
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
    getItemKindIconHtml: item => `<i data-kind="${item.isProject ? 'project' : 'directory'}" data-git="${item.isGitRepo === true}"></i>`,
    navigateTo: targetPath => {
      calls.push(['navigate', targetPath]);
      state.currentPath = targetPath;
      return true;
    },
    updateModeUI: () => calls.push('mode-ui'),
    refreshProjectShortcuts: async force => calls.push(['projects', force]),
    _showStatusMessage: (message, kind) => calls.push(['status', message, kind]),
    ...overrides.app
  };
  const roots = overrides.roots || [
    { path: '/managed/alpha', name: 'Alpha <Root>', expanded: true },
    { path: '/managed/offline', name: 'Offline', expanded: true }
  ];
  const bridge = {
    platform: overrides.platform || 'darwin',
    config: {
      getTreeRoots: async () => roots,
      addTreeRoot: async () => roots,
      removeTreeRoot: async () => roots,
      updateTreeRoot: async (rootPath, updates) => calls.push(['root-state', rootPath, updates])
    },
    content: {
      invalidateIndex: async () => calls.push('invalidate-index')
    },
    fs: {
      selectFolder: async () => null,
      getWorkspaceDirectoryInfos: async () => ({
        directories: [
          {
            path: '/managed/alpha',
            available: true,
            info: {
              path: '/managed/alpha',
              name: 'alpha',
              type: 'directory',
              isProject: true,
              isGitRepo: true,
              project: { color: 'purple' }
            }
          },
          { path: '/managed/offline', available: false, info: null }
        ]
      }),
      listDirectory: async directoryPath => {
        calls.push(['list', directoryPath]);
        if (directoryPath === '/managed/alpha') {
          return [{ path: '/managed/alpha/src', name: 'src', type: 'directory', isGitRepo: false }];
        }
        throw new Error('unexpected read');
      }
    },
    ...overrides.bridge
  };
  const document = {
    getElementById: id => (id === 'sidebar-tree' ? container : null),
    ...overrides.document
  };
  const controller = new Controller({ app, state, bridge, document, platform: overrides.platform });
  return { controller, app, state, bridge, document, container, calls, roots };
}

test('路径边界兼容 POSIX、Windows 大小写、盘符和 UNC', () => {
  assert.equal(pathIsWithin('/managed/root/src', '/managed/root', 'darwin'), true);
  assert.equal(pathIsWithin('/managed/rooted', '/managed/root', 'darwin'), false);
  assert.equal(pathIsWithin('c:/Work/Repo/src', 'C:\\work\\repo', 'win32'), true);
  assert.equal(pathIsWithin('C:\\Work\\Other', 'C:\\Work\\Repo', 'win32'), false);
  assert.equal(pathIsWithin('\\\\SERVER\\Share\\Repo', '\\\\server\\share\\repo', 'win32'), true);
  assert.equal(pathsEqual('C:\\Work\\Repo\\', 'c:/work/repo', 'win32'), true);
});

test('位置树直接显示受管根，保留项目与 Git 语义并不读取断开位置', async () => {
  const { controller, app, container, calls } = createHarness();
  await controller.loadRoots();

  assert.equal(app._treeRootsLoaded, true);
  assert.match(container.innerHTML, /data-is-root="true"/);
  assert.match(container.innerHTML, /Alpha &lt;Root&gt;/);
  assert.match(container.innerHTML, /data-kind="project" data-git="true"/);
  assert.match(container.innerHTML, /位置不可用/);
  assert.doesNotMatch(container.innerHTML, /Macintosh HD|💽|💻/);
  assert.deepEqual(calls.filter(call => Array.isArray(call) && call[0] === 'list'), [
    ['list', '/managed/alpha']
  ]);
});

test('无受管根时显示明确空状态，不把系统磁盘伪装成可浏览位置', async () => {
  const { controller, container, calls } = createHarness({ roots: [] });
  await controller.loadRoots();
  assert.match(container.innerHTML, /尚未添加受管目录/);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'list'), false);
});

test('目录树事件只在成功导航后更新模式，断开根保持不可操作', async () => {
  const handlers = new Map();
  function node(pathValue, unavailable = false) {
    const toggle = { addEventListener: (name, handler) => handlers.set(`${pathValue}:toggle:${name}`, handler) };
    const name = { addEventListener: (eventName, handler) => handlers.set(`${pathValue}:name:${eventName}`, handler) };
    return {
      dataset: { path: pathValue },
      getAttribute: attribute => (attribute === 'aria-disabled' && unavailable ? 'true' : 'false'),
      querySelector: selector => (selector === '.tree-node-toggle' ? toggle : name)
    };
  }
  const valid = node('/managed/alpha');
  const unavailable = node('/managed/offline', true);
  const container = {
    innerHTML: '',
    querySelectorAll: selector => (selector === '.tree-node' ? [valid, unavailable] : [])
  };
  const { controller, calls, state } = createHarness({
    state: { currentPath: '/managed/alpha', currentMode: 'settings' },
    document: { getElementById: id => (id === 'sidebar-tree' ? container : null) }
  });

  controller.bind(container);
  await handlers.get('/managed/offline:name:click')({ stopPropagation() {} });
  assert.equal(state.currentMode, 'settings');
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'navigate'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'status'));

  await handlers.get('/managed/alpha:name:click')({ stopPropagation() {} });
  assert.equal(state.currentMode, 'tree');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'navigate' && call[1] === '/managed/alpha'));
});

test('根节点折叠状态持久化，子目录展开仅保存在会话中', async () => {
  const handlers = new Map();
  const makeNode = (pathValue, isRoot) => ({
    dataset: { path: pathValue, isRoot: String(isRoot) },
    getAttribute: () => 'false',
    querySelector: selector => ({
      addEventListener: (name, handler) => handlers.set(`${pathValue}:${selector}:${name}`, handler)
    })
  });
  const rootNode = makeNode('/managed/alpha', true);
  const childNode = makeNode('/managed/alpha/src', false);
  const container = {
    innerHTML: '',
    querySelectorAll: selector => (selector === '.tree-node' ? [rootNode, childNode] : [])
  };
  const { controller, app, calls } = createHarness({
    document: { getElementById: id => (id === 'sidebar-tree' ? container : null) }
  });
  app._treeExpandedPaths.add('/managed/alpha');
  controller.render = async () => calls.push('render');
  controller.bind(container);

  await handlers.get('/managed/alpha:.tree-node-toggle:click')({ stopPropagation() {} });
  assert.equal(app._treeExpandedPaths.has('/managed/alpha'), false);
  assert.ok(calls.some(call => Array.isArray(call)
    && call[0] === 'root-state'
    && call[1] === '/managed/alpha'
    && call[2].expanded === false));

  await handlers.get('/managed/alpha/src:.tree-node-toggle:click')({ stopPropagation() {} });
  assert.equal(app._treeExpandedPaths.has('/managed/alpha/src'), true);
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'root-state').length, 1);
});

test('控制器在 App 之前加载，主对象只保留位置树兼容委托', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(html, /sidebarTreeController\.js[\s\S]*app\.js/);
  assert.match(appSource, /setupSidebarTreeController/);
  assert.match(appSource, /renderSidebarTree\(\) \{\s*return this\.sidebarTreeController\.render\(\);/);
  assert.doesNotMatch(appSource, /getMountedVolumes\(\)/);
});
