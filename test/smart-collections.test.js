const test = require('node:test');
const assert = require('node:assert/strict');

const ContentQuery = require('../src/renderer/scripts/contentQuery');
const SmartCollections = require('../src/renderer/scripts/smartCollections');

test('智能集合只接受全局项目或仓库查询并限制本机配置规模', () => {
  const candidates = Array.from({ length: 60 }, (_value, index) => ({
    id: `collection_${index}`,
    name: `集合 ${index}`,
    query: ContentQuery.queryForPreset('all-projects')
  }));
  candidates.unshift({
    id: 'current_only',
    name: '当前目录',
    query: ContentQuery.queryForPreset('current-projects')
  });
  candidates.push({ id: 'bad id', name: '损坏', query: ContentQuery.queryForPreset('all-repositories') });
  const store = SmartCollections.normalizeStore({ version: 99, collections: candidates });
  assert.equal(store.version, SmartCollections.VERSION);
  assert.equal(store.collections.length, SmartCollections.MAX_COLLECTIONS);
  assert.equal(store.collections.some(item => item.id === 'current_only'), false);
  assert.equal(store.collections.some(item => item.id === 'bad id'), false);
});

test('保存智能集合规范化名称、搜索字段和仓库标签并拒绝同名', () => {
  const result = SmartCollections.create(null, {
    name: '  未提交\n仓库  ',
    query: ContentQuery.normalize({
      ...ContentQuery.queryForPreset('all-repositories'),
      gitStatuses: ['dirty']
    }),
    searchText: '  api   service ',
    searchFields: ['readme', 'name', 'invalid', 'name'],
    repositoryTagIds: ['tag-b', 'tag-a', 'tag-a', '']
  }, () => 'collection_repo');
  assert.equal(result.ok, true);
  assert.equal(result.collection.name, '未提交 仓库');
  assert.equal(result.collection.searchText, 'api service');
  assert.deepEqual(result.collection.searchFields, ['name', 'readme']);
  assert.deepEqual(result.collection.repositoryTagIds, ['tag-a', 'tag-b']);

  const duplicate = SmartCollections.create(result.store, {
    name: '未提交 仓库',
    query: ContentQuery.queryForPreset('all-repositories')
  }, () => 'collection_second');
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /同名/);
});

test('项目集合不会携带仓库标签，空搜索不会保留无效搜索字段', () => {
  const result = SmartCollections.create(null, {
    name: '开发项目',
    query: ContentQuery.queryForPreset('all-projects'),
    searchText: '',
    searchFields: ['name', 'readme'],
    repositoryTagIds: ['tag-one']
  }, () => 'collection_project');
  assert.equal(result.ok, true);
  assert.deepEqual(result.collection.searchFields, []);
  assert.deepEqual(result.collection.repositoryTagIds, []);
});

test('智能集合可精确判断当前筛选上下文并安全移除', () => {
  const created = SmartCollections.create(null, {
    name: '未推送前端仓库',
    query: ContentQuery.normalize({
      ...ContentQuery.queryForPreset('all-repositories'),
      gitStatuses: ['ahead'],
      repositoryCategory: 'frontend'
    }),
    searchText: 'web',
    searchFields: ['name'],
    repositoryTagIds: ['tag-ui']
  }, () => 'collection_frontend');
  assert.equal(SmartCollections.matchesContext(created.collection, {
    query: created.collection.query,
    searchText: 'web',
    searchFields: ['name'],
    repositoryTagIds: ['tag-ui']
  }), true);
  assert.equal(SmartCollections.matchesContext(created.collection, {
    query: created.collection.query,
    searchText: 'api',
    searchFields: ['name'],
    repositoryTagIds: ['tag-ui']
  }), false);

  const removed = SmartCollections.remove(created.store, 'collection_frontend');
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.store.collections, []);
  assert.equal(SmartCollections.remove(removed.store, 'missing').removed, false);
});

test('智能集合可安全重命名并按用户顺序重排', () => {
  const first = SmartCollections.create(null, {
    name: '开发项目',
    query: ContentQuery.queryForPreset('all-projects')
  }, () => 'collection_projects');
  const second = SmartCollections.create(first.store, {
    name: '未提交仓库',
    query: ContentQuery.queryForPreset('all-repositories')
  }, () => 'collection_repositories');

  const renamed = SmartCollections.rename(second.store, 'collection_projects', '  活跃\n项目  ');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.collection.name, '活跃 项目');
  assert.equal(ContentQuery.collectionKind(renamed.collection.query), 'projects');
  assert.equal(SmartCollections.rename(renamed.store, 'collection_projects', '未提交仓库').ok, false);
  assert.equal(SmartCollections.rename(renamed.store, 'missing', '不存在').ok, false);

  const reordered = SmartCollections.reorder(renamed.store, [
    'collection_repositories', 'missing', 'collection_repositories', 'collection_projects'
  ]);
  assert.equal(reordered.changed, true);
  assert.deepEqual(reordered.store.collections.map(item => item.id), [
    'collection_repositories', 'collection_projects'
  ]);
  assert.equal(SmartCollections.reorder(reordered.store, ['collection_repositories']).changed, false);
});
