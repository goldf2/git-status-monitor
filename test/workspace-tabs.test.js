const test = require('node:test');
const assert = require('node:assert/strict');

const WorkspaceTabs = require('../src/renderer/scripts/workspaceTabs');
const ContentQuery = require('../src/renderer/scripts/contentQuery');

function idFactory() {
  let sequence = 0;
  return () => `tab-test-${++sequence}`;
}

test('标签会话从损坏或过量配置恢复为有限、可导航的安全状态', () => {
  const makeId = idFactory();
  const rawTabs = Array.from({ length: 24 }, (_, index) => ({
    id: index < 2 ? 'duplicate' : `saved-${index}`,
    path: `/workspace/project-${index}`,
    mode: index === 0 ? 'invalid' : 'tree',
    history: Array.from({ length: 60 }, (_entry, historyIndex) => `/workspace/project-${index}/${historyIndex}`),
    historyIndex: 999,
    searchScope: index === 1 ? 'global' : 'current',
    searchQuery: index === 1 ? 'controller' : ''
  }));

  const session = WorkspaceTabs.normalizeSession({ tabs: rawTabs, activeTabId: 'missing' }, '/workspace', makeId);
  assert.equal(session.tabs.length, 20);
  assert.equal(new Set(session.tabs.map(tab => tab.id)).size, 20);
  assert.equal(session.tabs[0].mode, 'tree');
  assert.equal(session.tabs[0].history.length, 50);
  assert.equal(session.tabs[0].historyIndex, 49);
  assert.equal(session.activeTabId, session.tabs[0].id);
});

test('关闭当前标签保留相邻标签状态，恢复关闭标签后重新激活原路径', () => {
  const makeId = idFactory();
  let session = WorkspaceTabs.normalizeSession(null, '/workspace/one', makeId);
  session = WorkspaceTabs.addTab(session, {
    path: '/workspace/two',
    mode: 'tree',
    history: ['/workspace', '/workspace/two'],
    historyIndex: 1
  }, makeId);
  const closedId = session.activeTabId;

  session = WorkspaceTabs.closeTab(session, closedId);
  assert.equal(session.tabs.length, 1);
  assert.equal(session.tabs[0].path, '/workspace/one');
  assert.equal(session.closedTabs[0].path, '/workspace/two');

  session = WorkspaceTabs.restoreClosedTab(session, makeId);
  assert.equal(session.tabs.length, 2);
  assert.equal(session.activeTabId, closedId);
  assert.equal(session.tabs.find(tab => tab.id === closedId).historyIndex, 1);
  assert.equal(session.tabs.find(tab => tab.id === closedId).path, '/workspace/two');
});

test('唯一标签不能关闭，新增标签数量受上限保护', () => {
  const makeId = idFactory();
  let session = WorkspaceTabs.normalizeSession(null, '/workspace', makeId);
  const onlyId = session.activeTabId;
  session = WorkspaceTabs.closeTab(session, onlyId);
  assert.equal(session.tabs.length, 1);
  assert.equal(session.closedTabs.length, 0);

  for (let index = 0; index < 30; index++) {
    session = WorkspaceTabs.addTab(session, { path: `/workspace/${index}` }, makeId);
  }
  assert.equal(session.tabs.length, WorkspaceTabs.MAX_TABS);
});

test('开发任务模式可在工作区标签中持久化', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{ path: '/workspace', mode: 'tasks' }]
  }, '/workspace', makeId);
  assert.equal(session.tabs[0].mode, 'tasks');
});

test('关系白板模式可独立于当前目录在工作区标签中持久化', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{ path: '', mode: 'relationships' }]
  }, '', makeId);
  assert.equal(session.tabs[0].mode, 'relationships');
  assert.equal(session.tabs[0].path, '');
});

test('旧本地项目聚合标签可兼容恢复为全局项目筛选', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{ path: '/workspace', mode: 'projects' }]
  }, '/workspace', makeId);
  assert.equal(session.tabs[0].mode, 'tree');
  assert.deepEqual(session.tabs[0].contentQuery, ContentQuery.queryForPreset('all-projects'));
});

test('旧仓库聚合标签可兼容恢复为全局 Git 仓库筛选', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{ path: '/workspace', mode: 'grid' }]
  }, '/workspace', makeId);
  assert.equal(session.tabs[0].mode, 'tree');
  assert.equal(session.tabs[0].contentQuery.scope, 'all');
  assert.equal(session.tabs[0].contentQuery.repositoryOnly, true);
});

test('每个标签页将旧目录类型迁移为独立内容查询并修复非法值', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [
      { path: '/workspace/code', directoryType: 'repository' },
      { path: '/workspace/product', directoryType: 'project' },
      { path: '/workspace/docs', directoryType: 'unknown' }
    ]
  }, '/workspace', makeId);

  assert.equal(session.tabs[0].contentQuery.repositoryOnly, true);
  assert.equal(session.tabs[1].contentQuery.projectOnly, true);
  assert.deepEqual(session.tabs[2].contentQuery, ContentQuery.defaultQuery());
});

test('新版标签直接保存统一查询并规范化不可能的组合', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{
      path: '/workspace',
      contentQuery: {
        scope: 'current',
        baseType: 'file',
        projectOnly: true,
        repositoryOnly: true
      }
    }]
  }, '/workspace');
  assert.equal(session.version, 2);
  assert.deepEqual(session.tabs[0].contentQuery, ContentQuery.queryForPreset('current-files'));
  assert.equal(Object.hasOwn(session.tabs[0], 'directoryType'), false);
});

test('仓库 Git 状态条件随标签页保存并清理非法状态', () => {
  const session = WorkspaceTabs.normalizeSession({
    version: 2,
    tabs: [{
      path: '/workspace',
      contentQuery: {
        ...ContentQuery.queryForPreset('all-repositories'),
        gitStatuses: ['dirty', 'ahead', 'invalid', 'dirty']
      }
    }]
  }, '/workspace');
  assert.deepEqual(session.tabs[0].contentQuery.gitStatuses, ['ahead', 'dirty']);
  assert.equal(WorkspaceTabs.needsContentQueryMigration(session), false);
});

test('仓库分类条件随标签页保存，旧 v2 查询触发一次迁移', () => {
  const session = WorkspaceTabs.normalizeSession({
    version: 2,
    tabs: [{
      path: '/workspace',
      contentQuery: {
        ...ContentQuery.queryForPreset('all-repositories'),
        repositoryCategory: 'group-tools'
      }
    }]
  }, '/workspace');
  assert.equal(session.tabs[0].contentQuery.repositoryCategory, 'group-tools');
  assert.equal(WorkspaceTabs.needsContentQueryMigration(session), false);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({
    version: 2,
    tabs: [{
      mode: 'tree',
      contentQuery: { version: 2, scope: 'all', baseType: 'directory', repositoryOnly: true }
    }]
  }), true);
});

test('精确日期与大小边界随标签页保存并触发旧查询版本迁移', () => {
  const session = WorkspaceTabs.normalizeSession({
    version: 2,
    tabs: [{
      path: '/workspace',
      contentQuery: {
        ...ContentQuery.queryForPreset('current-files'),
        modifiedFrom: '2026-08-01',
        modifiedTo: '2026-08-27',
        minSizeBytes: 1024,
        maxSizeBytes: 4096
      }
    }]
  }, '/workspace');
  assert.equal(session.tabs[0].contentQuery.modifiedFrom, '2026-08-01');
  assert.equal(session.tabs[0].contentQuery.maxSizeBytes, 4096);
  assert.equal(WorkspaceTabs.needsContentQueryMigration(session), false);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({
    version: 2,
    tabs: [{ contentQuery: { version: 3, scope: 'current', baseType: 'file' } }]
  }), true);
});

test('旧版本、旧模式与旧目录字段会触发一次性内容查询迁移', () => {
  assert.equal(WorkspaceTabs.needsContentQueryMigration({ version: 1, tabs: [] }), true);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({ version: 2, tabs: [{ mode: 'grid' }] }), true);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({ version: 2, tabs: [{ directoryType: 'file', contentQuery: {} }] }), true);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({ version: 2, tabs: [] }), true);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({ version: 2, tabs: [{ contentQuery: { version: 1 } }] }), true);
  assert.equal(WorkspaceTabs.needsContentQueryMigration({
    version: 2,
    tabs: [{ mode: 'tree', contentQuery: { version: ContentQuery.VERSION, scope: 'current', baseType: 'all' } }]
  }), false);
});

test('每个标签页独立保存内容搜索模式并安全回退', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [
      { path: '/workspace/code', globalSearchMode: 'content', globalSearchType: 'file' },
      { path: '/workspace/docs', globalSearchMode: 'unsafe-mode' }
    ]
  }, '/workspace', makeId);

  assert.equal(session.tabs[0].globalSearchMode, 'content');
  assert.equal(session.tabs[1].globalSearchMode, 'metadata');
});

test('标签页可重排且保持活动标签和每页状态对象不变', () => {
  const makeId = idFactory();
  let session = WorkspaceTabs.normalizeSession({
    tabs: [
      { id: 'one', path: '/workspace/one', searchQuery: 'first' },
      { id: 'two', path: '/workspace/two', directoryType: 'file' },
      { id: 'three', path: '/workspace/three', mode: 'dashboard' }
    ],
    activeTabId: 'two'
  }, '/workspace', makeId);
  const originalTwo = session.tabs[1];

  session = WorkspaceTabs.reorderTabs(session, ['three', 'two', 'one']);

  assert.deepEqual(session.tabs.map(tab => tab.id), ['three', 'two', 'one']);
  assert.equal(session.activeTabId, 'two');
  assert.equal(session.tabs[1], originalTwo);
  assert.equal(session.tabs[1].contentQuery.baseType, 'file');
});

test('标签移动会约束边界，非法或不完整顺序不会破坏会话', () => {
  const makeId = idFactory();
  const session = WorkspaceTabs.normalizeSession({
    tabs: [
      { id: 'one', path: '/workspace/one' },
      { id: 'two', path: '/workspace/two' },
      { id: 'three', path: '/workspace/three' }
    ],
    activeTabId: 'one'
  }, '/workspace', makeId);

  const movedRight = WorkspaceTabs.moveTab(session, 'one', 99);
  assert.deepEqual(movedRight.tabs.map(tab => tab.id), ['two', 'three', 'one']);
  const movedLeft = WorkspaceTabs.moveTab(movedRight, 'one', -10);
  assert.deepEqual(movedLeft.tabs.map(tab => tab.id), ['one', 'two', 'three']);
  assert.equal(WorkspaceTabs.reorderTabs(session, ['one', 'missing', 'three']), session);
  assert.equal(WorkspaceTabs.reorderTabs(session, ['one', 'two']), session);
  assert.equal(WorkspaceTabs.moveTab(session, 'missing', 1), session);
});

test('失效标签页优先回退到当前历史位置之前最近的可用目录', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{
      id: 'active',
      path: '/workspace/project/deleted',
      history: ['/workspace', '/workspace/project', '/workspace/project/deleted'],
      historyIndex: 2
    }]
  }, '/workspace');
  const repaired = WorkspaceTabs.repairUnavailablePaths(session, {
    platform: 'darwin',
    availableRoots: ['/workspace'],
    directories: [
      { path: '/workspace', available: true, nearestAvailablePath: '/workspace' },
      { path: '/workspace/project', available: true, nearestAvailablePath: '/workspace/project' },
      { path: '/workspace/project/deleted', available: false, nearestAvailablePath: '/workspace/project' }
    ]
  });

  assert.equal(repaired.changed, true);
  assert.equal(repaired.repairedTabs, 1);
  assert.equal(repaired.removedHistoryEntries, 1);
  assert.equal(repaired.session.tabs[0].path, '/workspace/project');
  assert.deepEqual(repaired.session.tabs[0].history, ['/workspace', '/workspace/project']);
  assert.equal(repaired.session.tabs[0].historyIndex, 1);
});

test('整个受管根暂时断开时保留标签页和历史，等待卷或网络位置重连', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{
      id: 'external',
      path: '/Volumes/External/work/project',
      history: ['/Volumes/External/work', '/Volumes/External/work/project'],
      historyIndex: 1
    }]
  }, '/Volumes/External/work');
  const repaired = WorkspaceTabs.repairUnavailablePaths(session, {
    platform: 'darwin',
    availableRoots: ['/workspace'],
    directories: [
      {
        path: '/Volumes/External/work',
        available: false,
        availability: 'root-unavailable',
        configuredRootPath: '/Volumes/External/work',
        rootAvailable: false,
        nearestAvailablePath: ''
      },
      {
        path: '/Volumes/External/work/project',
        available: false,
        availability: 'root-unavailable',
        configuredRootPath: '/Volumes/External/work',
        rootAvailable: false,
        nearestAvailablePath: ''
      }
    ]
  });

  assert.equal(repaired.changed, false);
  assert.equal(repaired.repairedTabs, 0);
  assert.equal(repaired.deferredTabs, 1);
  assert.equal(repaired.removedHistoryEntries, 0);
  assert.equal(repaired.session.tabs[0].path, '/Volumes/External/work/project');
  assert.deepEqual(repaired.session.tabs[0].history, [
    '/Volumes/External/work',
    '/Volumes/External/work/project'
  ]);
  assert.equal(repaired.session.tabs[0].historyIndex, 1);
});

test('历史均失效时使用最近可用祖先，再退到第一个可用受管根目录', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [
      { id: 'nested', path: '/workspace/project/deleted' },
      { id: 'external', path: '/outside/removed' }
    ]
  }, '/workspace');
  const repaired = WorkspaceTabs.repairUnavailablePaths(session, {
    platform: 'darwin',
    availableRoots: ['/workspace'],
    directories: [
      { path: '/workspace/project/deleted', available: false, nearestAvailablePath: '/workspace/project' },
      { path: '/outside/removed', available: false, nearestAvailablePath: '' }
    ]
  });

  assert.equal(repaired.repairedTabs, 2);
  assert.equal(repaired.session.tabs[0].path, '/workspace/project');
  assert.deepEqual(repaired.session.tabs[0].history, ['/workspace/project']);
  assert.equal(repaired.session.tabs[1].path, '/workspace');
  assert.deepEqual(repaired.session.tabs[1].history, ['/workspace']);
});

test('没有可用受管根目录时清空失效位置，不保留不可导航路径', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{ path: '/workspace/deleted' }]
  }, '/workspace');
  const repaired = WorkspaceTabs.repairUnavailablePaths(session, {
    platform: 'darwin',
    availableRoots: [],
    directories: [{ path: '/workspace/deleted', available: false, nearestAvailablePath: '' }]
  });

  assert.equal(repaired.session.tabs[0].path, '');
  assert.equal(repaired.session.tabs[0].title, '新标签页');
  assert.deepEqual(repaired.session.tabs[0].history, []);
});

test('Windows 路径校验忽略大小写和分隔符差异并清理重复历史', () => {
  const session = WorkspaceTabs.normalizeSession({
    tabs: [{
      path: 'C:\\Work\\Repo',
      history: ['c:/work/repo', 'C:\\Work\\Repo'],
      historyIndex: 1
    }]
  }, 'C:\\Work');
  const repaired = WorkspaceTabs.repairUnavailablePaths(session, {
    platform: 'win32',
    availableRoots: ['C:\\Work'],
    directories: [{ path: 'C:\\Work\\Repo', available: true, nearestAvailablePath: 'C:\\Work\\Repo' }]
  });

  assert.equal(repaired.session.tabs[0].path, 'C:\\Work\\Repo');
  assert.deepEqual(repaired.session.tabs[0].history, ['c:/work/repo']);
  assert.equal(repaired.removedHistoryEntries, 1);
});
