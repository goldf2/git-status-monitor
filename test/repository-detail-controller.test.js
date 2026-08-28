const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Controller } = require('../src/renderer/scripts/repositoryDetailController');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(overrides = {}) {
  const calls = [];
  const state = {
    selectedRepo: null,
    controlSlot: 'goals',
    documentMode: 'edit',
    detailSections: {},
    detailSectionOrder: null,
    showAllAssignments: true,
    groups: { groups: [] },
    tags: { tags: [] },
    ...overrides.state
  };
  const empty = { style: {}, innerHTML: '' };
  const content = { style: {} };
  const document = {
    getElementById(id) {
      if (id === 'detail-empty') return empty;
      if (id === 'detail-content') return content;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    ...overrides.document
  };
  const app = {
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
    _findRepoGroups: repoPath => [{ id: `group:${repoPath}` }],
    loadProjectControl: async (repoPath, files, saved) => ({ repoPath, files, saved }),
    loadMarkdownDocuments: async (repoPath, files, saved) => ({ repoPath, files, saved }),
    isMissingProjectPathError: error => error?.code === 'ENOENT',
    ...overrides.app
  };
  const bridge = {
    fs: {
      getFileInfo: async repoPath => ({ name: path.basename(repoPath), path: repoPath }),
      getReadmePreview: async repoPath => ({ title: `README ${repoPath}` }),
      listProjectControlFiles: async () => [{ fileName: 'PROGRESS.md' }],
      listMarkdownDocuments: async () => [{ fileName: 'README.md' }],
      ...overrides.bridge?.fs
    },
    git: {
      getStatus: async repoPath => ({ branch: 'main', repoPath }),
      ...overrides.bridge?.git
    },
    tags: {
      getRepoTags: async repoPath => [{ id: `tag:${repoPath}` }],
      ...overrides.bridge?.tags
    },
    config: {
      get: async key => (key === 'projectControlSelections' ? { '/repo/a': 'PROGRESS.md' } : {}),
      set: async (...args) => calls.push(['config-set', ...args]),
      ...overrides.bridge?.config
    },
    localProjects: {
      describe: async repoPath => ({ isProject: repoPath.endsWith('/a'), project: null }),
      ...overrides.bridge?.localProjects
    },
    groups: overrides.bridge?.groups || {}
  };
  const terminal = {
    setCwd: repoPath => calls.push(['cwd', repoPath]),
    ...overrides.terminal
  };
  const controller = new Controller({ app, state, bridge, document, terminal });
  controller.render = async () => calls.push(['render', state.selectedRepo?.path || null]);
  return { controller, app, state, bridge, document, empty, content, terminal, calls };
}

test('选择仓库并行读取详情，只有完整结果才更新状态和终端目录', async () => {
  const { controller, state, calls } = createHarness();

  const selected = await controller.select('/repo/a');

  assert.equal(selected, true);
  assert.equal(state.selectedRepo.path, '/repo/a');
  assert.equal(state.selectedRepo.gitStatus.branch, 'main');
  assert.equal(state.selectedRepo.readme.title, 'README /repo/a');
  assert.deepEqual(state.selectedRepo.groups, [{ id: 'group:/repo/a' }]);
  assert.equal(state.selectedRepo.projectControl.saved, 'PROGRESS.md');
  assert.equal(state.controlSlot, 'progress');
  assert.equal(state.documentMode, 'preview');
  assert.deepEqual(calls, [
    ['cwd', '/repo/a'],
    ['render', '/repo/a']
  ]);
});

test('较慢的旧仓库请求不能覆盖较新的选择', async () => {
  const firstInfo = deferred();
  const { controller, state, calls } = createHarness({
    bridge: {
      fs: {
        getFileInfo: repoPath => (repoPath === '/repo/slow'
          ? firstInfo.promise
          : Promise.resolve({ name: 'fast', path: repoPath }))
      }
    }
  });

  const slowSelection = controller.select('/repo/slow');
  const fastSelection = controller.select('/repo/fast');
  assert.equal(await fastSelection, true);
  firstInfo.resolve({ name: 'slow', path: '/repo/slow' });
  assert.equal(await slowSelection, false);

  assert.equal(state.selectedRepo.path, '/repo/fast');
  assert.deepEqual(calls, [
    ['cwd', '/repo/fast'],
    ['render', '/repo/fast']
  ]);
});

test('当前仓库读取失败时清空旧详情并显示经过转义的可恢复错误', async () => {
  const missing = Object.assign(new Error('missing <repo>'), { code: 'ENOENT' });
  const { controller, state, empty, content, calls } = createHarness({
    state: { selectedRepo: { path: '/repo/old' } },
    bridge: { fs: { getFileInfo: async () => { throw missing; } } }
  });

  const selected = await controller.select('/repo/missing<script>');

  assert.equal(selected, false);
  assert.equal(state.selectedRepo, null);
  assert.equal(content.style.display, 'none');
  assert.equal(empty.style.display, 'flex');
  assert.match(empty.innerHTML, /项目目录不存在/);
  assert.match(empty.innerHTML, /\/repo\/missing&lt;script&gt;/);
  assert.doesNotMatch(empty.innerHTML, /<script>/);
  assert.equal(calls.length, 0);
});

test('仓库详情渲染保留项目、收藏和 Git 状态语义，并转义外部文本', async () => {
  class FakeElement {
    constructor() {
      this.style = {};
      this.dataset = {};
      this.innerHTML = '';
      this.textContent = '';
      this.title = '';
      this.classList = {
        values: new Set(),
        toggle: (name, active) => {
          if (active) this.classList.values.add(name);
          else this.classList.values.delete(name);
        }
      };
    }

    querySelectorAll() { return []; }
  }

  const elements = new Map([
    'detail-empty',
    'detail-content',
    'detail-name',
    'detail-path',
    'detail-project-settings',
    'detail-relationship-board',
    'toggle-assignments-btn',
    'detail-fav-btn',
    'detail-status',
    'detail-readme',
    'detail-git-info',
    'detail-groups',
    'detail-tags'
  ].map(id => [id, new FakeElement()]));
  const renderCalls = [];
  const state = {
    selectedRepo: {
      name: 'Repo <unsafe>',
      path: '/repo/a',
      localProject: { isProject: true, project: { projectId: 'project_1' } },
      gitStatus: {
        overallStatus: 'dirty',
        branch: '<branch>',
        modified: 2,
        ahead: 1,
        behind: 0,
        hasRemote: true,
        upstream: 'origin/<main>',
        remoteUrl: 'https://example.test/?a=<b>'
      },
      readme: { title: '<README>', description: '<description>' },
      groups: [],
      tags: []
    },
    detailSections: {},
    detailSectionOrder: null,
    showAllAssignments: true,
    groups: { groups: [] },
    tags: { tags: [] }
  };
  const document = {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => new FakeElement()
  };
  const app = {
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
    isFavoritePath: () => true,
    renderMarkdownDocuments: () => renderCalls.push('documents'),
    renderProjectProgress: () => renderCalls.push('progress'),
    safeColor: color => color,
    formatTime: () => '刚刚'
  };
  const controller = new Controller({ app, state, bridge: {}, document });

  assert.equal(await controller.render(), true);
  assert.equal(elements.get('detail-name').textContent, 'Repo <unsafe>');
  assert.equal(elements.get('detail-project-settings').textContent, '项目设置');
  assert.equal(elements.get('detail-relationship-board').dataset.relationshipKind, 'project');
  assert.equal(elements.get('detail-relationship-board').dataset.relationshipRef, 'project_1');
  assert.equal(elements.get('detail-fav-btn').textContent, '★');
  assert.ok(elements.get('detail-fav-btn').classList.values.has('active'));
  assert.match(elements.get('detail-status').innerHTML, /detail-status-badge dirty/);
  assert.match(elements.get('detail-status').innerHTML, /&lt;branch&gt;/);
  assert.doesNotMatch(elements.get('detail-status').innerHTML, /<branch>/);
  assert.match(elements.get('detail-readme').innerHTML, /&lt;README&gt;/);
  assert.match(elements.get('detail-readme').innerHTML, /&lt;description&gt;/);
  assert.match(elements.get('detail-git-info').innerHTML, /origin\/&lt;main&gt;/);
  assert.match(elements.get('detail-git-info').innerHTML, /https:\/\/example\.test\/\?a=&lt;b&gt;/);
  assert.deepEqual(renderCalls, ['documents', 'progress']);
});

test('仓库详情控制器在 App 之前加载，App 只保留兼容委托', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(html, /repositoryDetailController\.js[\s\S]*app\.js/);
  assert.match(appSource, /setupRepositoryDetailController/);
  assert.match(appSource, /selectRepo\(repoPath\) \{\s*return this\.repositoryDetailController\.select\(repoPath\);/);
  assert.match(appSource, /updateDetailPanel\(\) \{\s*return this\.repositoryDetailController\.render\(\);/);
  assert.doesNotMatch(appSource, /window\.gitFinder\.fs\.getFileInfo\(repoPath\)[\s\S]{0,800}window\.gitFinder\.git\.getStatus\(repoPath/);
});
