const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectShortcuts = require('../src/shared/projectShortcuts');

const alpha = {
  projectId: 'project_11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  path: '/workspace/alpha'
};
const nested = {
  projectId: 'project_22222222-2222-4222-8222-222222222222',
  name: 'Nested',
  path: '/workspace/alpha/packages/nested'
};
const windows = {
  projectId: 'project_33333333-3333-4333-8333-333333333333',
  name: 'Windows',
  path: 'C:\\Work\\Windows'
};

test('项目快捷偏好只保存稳定 ID、名称和最近时间，不接受路径或任意字段', () => {
  const store = ProjectShortcuts.normalizeStore({
    version: 99,
    pinned: [{ ...alpha, path: '/secret', token: 'secret' }],
    recent: [{ ...alpha, path: '/secret', lastOpenedAt: 123, extra: true }]
  });

  assert.deepEqual(store, {
    version: 1,
    pinned: [{ projectId: alpha.projectId, name: 'Alpha' }],
    recent: [{ projectId: alpha.projectId, name: 'Alpha', lastOpenedAt: 123 }]
  });
  assert.doesNotMatch(JSON.stringify(store), /workspace|secret|token|path/);
});

test('侧边栏项目偏好只允许布尔值和预设的最近数量', () => {
  assert.deepEqual(ProjectShortcuts.normalizePreferences(null), {
    visible: true,
    showRecent: true,
    recentLimit: 8
  });
  assert.deepEqual(ProjectShortcuts.normalizePreferences({
    visible: false,
    showRecent: false,
    recentLimit: '5',
    path: '/must-not-persist'
  }), {
    visible: false,
    showRecent: false,
    recentLimit: 5
  });
  assert.equal(ProjectShortcuts.normalizePreferences({ recentLimit: 99 }).recentLimit, 8);
});

test('最近项目限频、去重并与固定项目在显示时分组', () => {
  let store = ProjectShortcuts.touchProject(null, alpha, 1_000_000);
  const unchanged = ProjectShortcuts.touchProject(store, alpha, 1_000_001);
  assert.equal(ProjectShortcuts.storesEqual(store, unchanged), true);

  store = ProjectShortcuts.touchProject(store, nested, 2_000_000);
  store = ProjectShortcuts.setPinned(store, alpha, true);
  const display = ProjectShortcuts.resolveDisplay(store, [alpha, nested]);
  assert.deepEqual(display.pinned.map(item => item.projectId), [alpha.projectId]);
  assert.deepEqual(display.recent.map(item => item.projectId), [nested.projectId]);
});

test('目录访问匹配最深层独立项目并兼容 Windows 大小写与分隔符', () => {
  assert.equal(
    ProjectShortcuts.findProjectForPath([alpha, nested], '/workspace/alpha/packages/nested/src').projectId,
    nested.projectId
  );
  assert.equal(
    ProjectShortcuts.findProjectForPath([windows], 'c:/work/windows/src', 'win32').projectId,
    windows.projectId
  );
  assert.equal(ProjectShortcuts.findProjectForPath([alpha], '/workspace/alphabet'), null);
});

test('已固定但暂时找不到的项目保留为不可用入口，最近失效项不占侧栏', () => {
  const store = {
    version: 1,
    pinned: [{ projectId: alpha.projectId, name: alpha.name }],
    recent: [{ projectId: nested.projectId, name: nested.name, lastOpenedAt: 100 }]
  };
  const display = ProjectShortcuts.resolveDisplay(store, []);
  assert.equal(display.pinned[0].available, false);
  assert.deepEqual(display.recent, []);
});
