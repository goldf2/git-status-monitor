const test = require('node:test');
const assert = require('node:assert/strict');

const ContentQuery = require('../src/renderer/scripts/contentQuery');

const items = [
  { path: '/workspace/docs', name: 'docs', type: 'directory', isGitRepo: false, isProject: false, modifiedTime: '2026-08-01T00:00:00Z' },
  { path: '/workspace/repo', name: 'repo', type: 'directory', isGitRepo: true, isProject: false, groups: [{ id: 'group-tools' }], modifiedTime: '2026-08-26T12:00:00Z' },
  { path: '/workspace/product', name: 'product', type: 'directory', isGitRepo: false, isProject: true, project: { lifecycle: 'frozen' }, modifiedTime: '2026-08-25T12:00:00Z' },
  { path: '/workspace/app', name: 'app', type: 'directory', isGitRepo: true, isProject: true, groups: [{ id: 'group-product' }], project: { lifecycle: 'active' }, modifiedTime: '2026-08-27T01:00:00Z' },
  { path: '/workspace/readme.md', name: 'README.md', type: 'file', size: 800, isGitRepo: false, isProject: false, modifiedTime: '2026-08-27T02:00:00Z' },
  { path: '/workspace/archive.tar.gz', name: 'archive.tar.gz', type: 'file', size: 2 * 1024 * 1024, isGitRepo: false, isProject: false, modifiedTime: '2026-07-01T00:00:00Z' }
];

test('旧目录类型与聚合模式只作为统一查询的迁移输入', () => {
  assert.deepEqual(ContentQuery.fromLegacy('tree', 'project'), ContentQuery.queryForPreset('current-projects'));
  assert.deepEqual(ContentQuery.fromLegacy('projects'), ContentQuery.queryForPreset('all-projects'));
  assert.deepEqual(ContentQuery.fromLegacy('grid'), ContentQuery.queryForPreset('all-repositories'));
});

test('项目与 Git 是可组合属性，不会改变文件夹基础类型', () => {
  const combined = ContentQuery.queryForPreset('current-project-repositories');
  assert.deepEqual(ContentQuery.filterItems(items, combined).map(item => item.path), ['/workspace/app']);
  assert.equal(combined.baseType, 'directory');
  assert.equal(combined.projectOnly, true);
  assert.equal(combined.repositoryOnly, true);
});

test('文件类型会清除不可能成立的项目与 Git 属性', () => {
  assert.deepEqual(ContentQuery.normalize({
    scope: 'current',
    baseType: 'file',
    projectOnly: true,
    repositoryOnly: true
  }), ContentQuery.queryForPreset('current-files'));
});

test('所有位置只允许受支持的项目或仓库集合', () => {
  assert.equal(ContentQuery.collectionKind(ContentQuery.queryForPreset('all-projects')), 'projects');
  assert.equal(ContentQuery.collectionKind(ContentQuery.queryForPreset('all-repositories')), 'repositories');
  assert.equal(ContentQuery.collectionKind(ContentQuery.queryForPreset('all-project-repositories')), 'project-repositories');
  assert.deepEqual(ContentQuery.normalize({ scope: 'all', baseType: 'all' }), ContentQuery.defaultQuery());
});

test('当前属性切换保留另一属性并支持组合筛选', () => {
  const project = ContentQuery.toggleCurrentAttribute(ContentQuery.defaultQuery(), 'project');
  const combined = ContentQuery.toggleCurrentAttribute(project, 'repository');
  const repository = ContentQuery.toggleCurrentAttribute(combined, 'project');
  assert.deepEqual(combined, ContentQuery.queryForPreset('current-project-repositories'));
  assert.deepEqual(repository, ContentQuery.queryForPreset('current-repositories'));
});

test('仓库标签只在仓库集合和仪表盘中出现', () => {
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.defaultQuery(), 'tree'), false);
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.queryForPreset('all-projects'), 'tree'), false);
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.queryForPreset('all-project-repositories'), 'tree'), false);
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.queryForPreset('all-repositories'), 'tree'), true);
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.defaultQuery(), 'dashboard'), true);
  assert.equal(ContentQuery.showsRepositoryMetadata(ContentQuery.queryForPreset('all-repositories'), 'tasks'), false);
});

test('项目生命周期作为项目属性筛选并兼容所有项目集合', () => {
  const current = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    lifecycles: ['frozen', 'invalid', 'active', 'frozen']
  });
  assert.equal(current.baseType, 'directory');
  assert.equal(current.projectOnly, true);
  assert.deepEqual(current.lifecycles, ['active', 'frozen']);
  assert.deepEqual(ContentQuery.filterItems(items, current).map(item => item.path), [
    '/workspace/product',
    '/workspace/app'
  ]);

  const allProjects = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-projects'),
    lifecycles: ['frozen']
  });
  assert.equal(ContentQuery.collectionKind(allProjects), 'projects');
  assert.equal(ContentQuery.matchesAttributes(items[2], allProjects), true);
  assert.equal(ContentQuery.matchesAttributes(items[3], allProjects), false);

  const withoutProject = ContentQuery.toggleCurrentAttribute(current, 'project');
  assert.deepEqual(withoutProject, ContentQuery.queryForPreset('current-directories'));
});

test('扩展名、修改时间和大小使用明确边界组合筛选', () => {
  const extensionQuery = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    extensions: ['.MD', 'tar.gz', 'bad extension', '.md']
  });
  assert.equal(extensionQuery.baseType, 'file');
  assert.deepEqual(extensionQuery.extensions, ['md', 'tar.gz']);
  assert.deepEqual(ContentQuery.filterItems(items, extensionQuery).map(item => item.path), [
    '/workspace/readme.md',
    '/workspace/archive.tar.gz'
  ]);

  const recentSmall = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    modifiedWithinDays: 7,
    sizeRange: 'under-1mb'
  });
  assert.deepEqual(
    ContentQuery.filterItems(items, recentSmall, Date.parse('2026-08-27T12:00:00Z')).map(item => item.path),
    ['/workspace/readme.md']
  );
});

test('精确修改日期和字节区间按包含边界筛选并覆盖粗略预设', () => {
  const localItems = [
    { path: '/before', name: 'before.bin', type: 'file', size: 511, modifiedTime: new Date(2026, 7, 26, 23, 59, 59).toISOString() },
    { path: '/start', name: 'start.bin', type: 'file', size: 512, modifiedTime: new Date(2026, 7, 27, 0, 0, 0).toISOString() },
    { path: '/end', name: 'end.bin', type: 'file', size: 2048, modifiedTime: new Date(2026, 7, 27, 23, 59, 59).toISOString() },
    { path: '/after', name: 'after.bin', type: 'file', size: 2049, modifiedTime: new Date(2026, 7, 28, 0, 0, 0).toISOString() }
  ];
  const query = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    modifiedWithinDays: 7,
    modifiedFrom: '2026-08-27',
    modifiedTo: '2026-08-27',
    sizeRange: 'over-100mb',
    minSizeBytes: 512,
    maxSizeBytes: 2048
  });
  assert.equal(query.baseType, 'file');
  assert.equal(query.modifiedWithinDays, null);
  assert.equal(query.sizeRange, 'any');
  assert.deepEqual(ContentQuery.filterItems(localItems, query).map(item => item.path), ['/start', '/end']);
  assert.equal(ContentQuery.advancedFilterCount(query), 2);
});

test('损坏或反向的精确边界安全回退，目录身份不会携带文件大小条件', () => {
  const invalid = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    modifiedFrom: '2026-02-30',
    modifiedTo: 'not-a-date',
    minSizeBytes: 5000,
    maxSizeBytes: 1000
  });
  assert.equal(invalid.modifiedFrom, null);
  assert.equal(invalid.modifiedTo, null);
  assert.equal(invalid.minSizeBytes, null);
  assert.equal(invalid.maxSizeBytes, null);

  const project = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-projects'),
    minSizeBytes: 1,
    maxSizeBytes: 100
  });
  assert.equal(project.minSizeBytes, null);
  assert.equal(project.maxSizeBytes, null);
  assert.equal(ContentQuery.collectionKind(project), 'projects');
});

test('高级条件可计数和清除，旧查询会补齐安全默认值', () => {
  const query = ContentQuery.normalize({
    version: 1,
    scope: 'current',
    baseType: 'all',
    lifecycles: ['active'],
    modifiedWithinDays: 30
  });
  assert.equal(ContentQuery.VERSION, 6);
  assert.equal(ContentQuery.advancedFilterCount(query), 2);
  assert.deepEqual(ContentQuery.clearAdvanced(query), ContentQuery.queryForPreset('current-projects'));
  assert.deepEqual(ContentQuery.normalize({ version: 1, scope: 'current', baseType: 'all' }), ContentQuery.defaultQuery());
});

test('文件标签筛选适用于当前目录与所有受管位置并使用 OR 语义', () => {
  const labeledItems = [
    { path: '/workspace/a', type: 'directory', fileLabels: [{ id: 'fl_pending', name: '待处理' }] },
    { path: '/workspace/b.txt', type: 'file', fileLabels: [{ id: 'fl_client', name: '客户' }] },
    { path: '/workspace/c', type: 'directory', fileLabels: [] }
  ];
  const query = ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    fileLabelIds: ['fl_pending', 'invalid', 'fl_client', 'fl_pending']
  });
  assert.deepEqual(query.fileLabelIds, ['fl_client', 'fl_pending']);
  assert.deepEqual(ContentQuery.filterItems(labeledItems, query).map(item => item.path), [
    '/workspace/a', '/workspace/b.txt'
  ]);
  assert.equal(ContentQuery.advancedFilterCount(query), 1);
  assert.deepEqual(ContentQuery.clearAdvanced(query), ContentQuery.defaultQuery());
  const collection = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-projects'),
    fileLabelIds: ['fl_pending']
  });
  assert.equal(ContentQuery.collectionKind(collection), 'file-labels');
  assert.deepEqual(collection.fileLabelIds, ['fl_pending']);
  assert.equal(collection.projectOnly, false);
  assert.deepEqual(labeledItems.filter(item => ContentQuery.matchesAttributes(item, collection)).map(item => item.path), [
    '/workspace/a'
  ]);
});

test('Git 综合状态使用 OR，未添加远程作为独立 AND 条件', () => {
  const repos = [
    { type: 'directory', isGitRepo: true, gitStatus: { overallStatus: 'dirty', hasRemote: true } },
    { type: 'directory', isGitRepo: true, gitStatus: { overallStatus: 'ahead', hasRemote: false } },
    { type: 'directory', isGitRepo: true, gitStatus: { overallStatus: 'clean', hasRemote: false } }
  ];
  const query = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-repositories'),
    gitStatuses: ['dirty', 'ahead', 'no-remote', 'invalid']
  });
  assert.deepEqual(query.gitStatuses, ['ahead', 'dirty', 'no-remote']);
  assert.equal(ContentQuery.advancedFilterCount(query), 1);
  assert.deepEqual(repos.filter(item => ContentQuery.matchesAttributes(item, query)), [repos[1]]);
  assert.deepEqual(ContentQuery.clearAdvanced(query), ContentQuery.queryForPreset('all-repositories'));
});

test('移除 Git 仓库属性会同时清除依赖它的状态条件', () => {
  const query = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('current-repositories'),
    gitStatuses: ['dirty']
  });
  assert.deepEqual(
    ContentQuery.toggleCurrentAttribute(query, 'repository'),
    ContentQuery.queryForPreset('current-directories')
  );
});

test('仓库分类作为全局仓库查询条件保存，不形成独立视图', () => {
  const grouped = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-repositories'),
    repositoryCategory: 'group-tools'
  });
  assert.equal(ContentQuery.collectionKind(grouped), 'repositories');
  assert.equal(ContentQuery.matchesAttributes(items[1], grouped), true);
  assert.equal(ContentQuery.matchesAttributes(items[3], grouped), false);

  const ungrouped = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-repositories'),
    repositoryCategory: 'ungrouped'
  });
  assert.equal(ContentQuery.matchesAttributes({ type: 'directory', isGitRepo: true, groups: [] }, ungrouped), true);
  assert.equal(ContentQuery.matchesAttributes(items[1], ungrouped), false);
  assert.equal(ContentQuery.normalize({
    ...ContentQuery.defaultQuery(),
    repositoryCategory: 'group-tools'
  }).repositoryCategory, 'all');
});
