const test = require('node:test');
const assert = require('node:assert/strict');

const ContentQuery = require('../src/renderer/scripts/contentQuery');
const SmartCollections = require('../src/renderer/scripts/smartCollections');
const { Controller } = require('../src/renderer/scripts/smartCollectionsController');

function element(id) {
  const listeners = new Map();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    inert: false,
    dataset: {},
    style: { display: 'none' },
    attributes: {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
    blur() { this.blurred = true; },
    contains(candidate) { return candidate === this; },
    querySelectorAll() { return []; },
    replaceChildren() { this.innerHTML = ''; }
  };
}

function createHarness(query = ContentQuery.queryForPreset('all-repositories'), saved = null) {
  const ids = [
    'content-filter-save-collection', 'smart-collection-modal', 'smart-collection-close-btn',
    'smart-collection-cancel-btn', 'smart-collection-save-btn', 'smart-collection-name',
    'smart-collection-title', 'smart-collection-description', 'smart-collection-summary',
    'smart-collection-feedback', 'smart-collection-context-menu', 'smart-collections-sidebar-section',
    'smart-collections-list', 'search-input'
  ];
  const elements = new Map(ids.map(id => [id, element(id)]));
  const writes = [];
  const messages = [];
  const state = {
    currentMode: 'tree',
    contentQuery: query,
    smartCollections: [],
    searchScope: 'current',
    searchQuery: '',
    selectedTags: [],
    filterEnabled: { name: true, readme: true },
    groups: { groups: [{ id: 'group-ui', name: '界面' }] },
    tags: { tags: [{ id: 'tag-ui', name: 'UI' }] }
  };
  const document = {
    activeElement: elements.get('content-filter-save-collection'),
    getElementById: id => elements.get(id) || null,
    addEventListener() {}
  };
  const bridge = {
    config: {
      get: async key => key === 'smartCollections' ? saved : null,
      set: async (key, value) => writes.push({ key, value })
    }
  };
  const app = {
    closeToolbarMenus() {},
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    renderSidebarTags() {},
    setContentQuery(next) { state.currentMode = 'tree'; state.contentQuery = ContentQuery.normalize(next); },
    _showStatusMessage(message, tone) { messages.push({ message, tone }); }
  };
  const window = { requestAnimationFrame: callback => callback() };
  const controller = new Controller({ app, state, bridge, contentQuery: ContentQuery, document, window });
  controller.bind();
  return { controller, state, bridge, elements, writes, messages };
}

test('智能集合控制器加载时清理损坏记录且空集合不占侧栏', async () => {
  const saved = {
    version: 0,
    collections: [
      { id: 'valid_one', name: '项目', query: ContentQuery.queryForPreset('all-projects') },
      { id: 'invalid_current', name: '当前', query: ContentQuery.queryForPreset('current-projects') }
    ]
  };
  const { controller, state, elements, writes } = createHarness(undefined, saved);
  await controller.load();
  assert.equal(state.smartCollections.length, 1);
  assert.equal(elements.get('smart-collections-sidebar-section').hidden, false);
  assert.equal(writes[0].key, 'smartCollections');

  state.smartCollections = [];
  controller.render();
  assert.equal(elements.get('smart-collections-sidebar-section').hidden, true);
});

test('只有全局集合可保存，保存失败不会污染当前侧栏状态', async () => {
  const current = createHarness(ContentQuery.queryForPreset('current-projects'));
  current.controller.updateControls();
  assert.equal(current.elements.get('content-filter-save-collection').disabled, true);
  current.controller.open();
  assert.match(current.messages[0].message, /所有项目/);

  const repositories = createHarness(ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-repositories'),
    gitStatuses: ['dirty']
  }));
  repositories.state.searchQuery = 'api';
  repositories.state.selectedTags = ['tag-ui'];
  repositories.controller.open();
  assert.equal(repositories.elements.get('smart-collection-modal').style.display, 'flex');
  assert.equal(repositories.elements.get('smart-collection-modal').attributes['aria-hidden'], 'false');
  assert.match(repositories.elements.get('smart-collection-name').value, /仓库/);
  repositories.elements.get('smart-collection-name').value = '待处理 API';
  await repositories.controller.save();
  assert.equal(repositories.state.smartCollections.length, 1);
  assert.equal(repositories.writes.at(-1).key, 'smartCollections');
  assert.deepEqual(repositories.state.smartCollections[0].repositoryTagIds, ['tag-ui']);
  assert.equal(repositories.elements.get('smart-collection-modal').style.display, 'none');
  assert.equal(repositories.elements.get('smart-collection-modal').attributes['aria-hidden'], 'true');
});

test('本机配置写入失败时不发布半完成智能集合', async () => {
  const harness = createHarness(ContentQuery.queryForPreset('all-projects'));
  harness.bridge.config.set = async () => { throw new Error('disk full'); };
  harness.controller.open();
  harness.elements.get('smart-collection-name').value = '项目集合';
  await harness.controller.save();
  assert.deepEqual(harness.state.smartCollections, []);
  assert.equal(harness.elements.get('smart-collection-modal').style.display, 'flex');
  assert.match(harness.elements.get('smart-collection-feedback').textContent, /disk full/);
});

test('点击智能集合恢复查询、搜索字段和标签，移除只删除快捷入口', async () => {
  const created = SmartCollections.create(null, {
    name: 'UI 未推送',
    query: ContentQuery.normalize({
      ...ContentQuery.queryForPreset('all-repositories'),
      gitStatuses: ['ahead'],
      repositoryCategory: 'group-ui'
    }),
    searchText: 'web',
    searchFields: ['name'],
    repositoryTagIds: ['tag-ui']
  }, () => 'collection_ui');
  const { controller, state, elements, writes } = createHarness(ContentQuery.queryForPreset('all-projects'));
  state.smartCollections = created.store.collections;
  controller.apply(created.collection);
  assert.equal(ContentQuery.collectionKind(state.contentQuery), 'repositories');
  assert.deepEqual(state.contentQuery.gitStatuses, ['ahead']);
  assert.equal(state.searchQuery, 'web');
  assert.equal(state.filterEnabled.name, true);
  assert.equal(state.filterEnabled.readme, false);
  assert.deepEqual(state.selectedTags, ['tag-ui']);
  assert.equal(elements.get('search-input').value, 'web');

  await controller.remove('collection_ui');
  assert.deepEqual(state.smartCollections, []);
  assert.equal(ContentQuery.collectionKind(state.contentQuery), 'repositories');
  assert.equal(writes.at(-1).key, 'smartCollections');
});

test('智能集合可通过同一安全弹窗重命名并用菜单或拖拽顺序持久化', async () => {
  const first = SmartCollections.create(null, {
    name: '项目',
    query: ContentQuery.queryForPreset('all-projects')
  }, () => 'collection_projects');
  const second = SmartCollections.create(first.store, {
    name: '仓库',
    query: ContentQuery.queryForPreset('all-repositories')
  }, () => 'collection_repositories');
  const harness = createHarness();
  harness.state.smartCollections = second.store.collections;

  harness.controller.openRename('collection_projects');
  assert.equal(harness.elements.get('smart-collection-title').textContent, '重命名智能集合');
  assert.match(harness.elements.get('smart-collection-description').textContent, /不改变筛选条件/);
  harness.elements.get('smart-collection-name').value = '活跃项目';
  await harness.controller.save();
  assert.equal(harness.state.smartCollections[0].name, '活跃项目');
  assert.equal(ContentQuery.collectionKind(harness.state.smartCollections[0].query), 'projects');

  await harness.controller.move('collection_projects', 1);
  assert.deepEqual(harness.state.smartCollections.map(item => item.id), [
    'collection_repositories', 'collection_projects'
  ]);
  await harness.controller.reorderByDrop('collection_projects', 'collection_repositories', false);
  assert.deepEqual(harness.state.smartCollections.map(item => item.id), [
    'collection_projects', 'collection_repositories'
  ]);
  assert.equal(harness.writes.filter(item => item.key === 'smartCollections').length, 3);
});
