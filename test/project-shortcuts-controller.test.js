const test = require('node:test');
const assert = require('node:assert/strict');

const { Controller } = require('../src/renderer/scripts/projectShortcutsController');
const ProjectShortcuts = require('../src/shared/projectShortcuts');

const project = {
  projectId: 'project_11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  path: '/workspace/alpha',
  rootIsGitRepo: true
};

function createHarness() {
  const section = { hidden: true };
  const container = {
    innerHTML: '',
    addEventListener() {}
  };
  const writes = [];
  const values = {
    projectShortcuts: ProjectShortcuts.touchProject(null, project, 1_000),
    projectShortcutPreferences: { visible: false, showRecent: true, recentLimit: 3 }
  };
  const state = {
    currentPath: project.path,
    localProjects: [project],
    projectShortcuts: ProjectShortcuts.defaultStore(),
    projectShortcutPreferences: ProjectShortcuts.defaultPreferences()
  };
  const controller = new Controller({
    state,
    platform: 'darwin',
    document: {
      getElementById(id) {
        if (id === 'project-shortcuts-sidebar-section') return section;
        if (id === 'project-shortcuts-list') return container;
        return null;
      }
    },
    bridge: {
      config: {
        get: async key => values[key],
        set: async (key, value) => {
          values[key] = value;
          writes.push([key, value]);
        }
      },
      localProjects: { list: async () => [project] }
    },
    app: {
      applyContentPreset() {},
      contentCollectionKind: () => '',
      escapeHtml: value => String(value),
      getItemKindIconHtml: () => '<span class="icon"></span>',
      isContentCollection: () => false,
      openLocalProject() {},
      _showStatusMessage() {}
    }
  });
  return { controller, state, section, container, writes };
}

test('项目快捷控制器加载本机偏好并按设置隐藏侧边栏', async () => {
  const { controller, state, section, container } = createHarness();

  await controller.load();

  assert.equal(state.projectShortcutPreferences.visible, false);
  assert.equal(section.hidden, true);
  assert.equal(container.innerHTML, '');
});

test('修改项目区偏好立即更新侧边栏，清除最近记录保留其他数据', async () => {
  const { controller, state, section, container, writes } = createHarness();
  await controller.load();

  await controller.savePreferences({ visible: true, showRecent: true, recentLimit: 3 });
  assert.equal(section.hidden, false);
  assert.match(container.innerHTML, /所有项目/);
  assert.match(container.innerHTML, /最近/);
  assert.match(container.innerHTML, /Alpha/);

  assert.equal(await controller.clearRecent(), true);
  assert.deepEqual(state.projectShortcuts.recent, []);
  assert.ok(writes.some(([key]) => key === 'projectShortcutPreferences'));
  assert.ok(writes.some(([key]) => key === 'projectShortcuts'));
});
