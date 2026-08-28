const test = require('node:test');
const assert = require('node:assert/strict');

const ContentQuery = require('../src/renderer/scripts/contentQuery');
const {
  Controller,
  formatSizeDraft,
  parseDateDraft,
  parseExtensions,
  parseSizeDraft,
  scopeLabel
} = require('../src/renderer/scripts/contentFilterController');

function element(id, value = '') {
  const listeners = new Map();
  return {
    id,
    value,
    checked: false,
    disabled: false,
    inert: false,
    style: { display: 'none' },
    textContent: '',
    attributes: {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.({ target: this, ...event }); },
    setAttribute(name, next) { this.attributes[name] = next; },
    focus() { this.focused = true; },
    blur() { this.blurred = true; },
    contains(candidate) { return candidate === this; }
  };
}

function createHarness(query = ContentQuery.defaultQuery()) {
  const calls = [];
  const elements = new Map();
  for (const id of [
    'content-filter-more', 'content-filter-modal', 'content-filter-close-btn',
    'content-filter-cancel-btn', 'content-filter-reset-btn', 'content-filter-apply-btn',
    'content-filter-scope', 'content-filter-lifecycle-section', 'content-filter-git-section', 'content-filter-file-section',
    'content-filter-file-label-section', 'content-filter-file-labels', 'content-filter-file-label-hint',
    'content-filter-git-hint',
    'content-filter-file-hint', 'content-filter-extensions', 'content-filter-modified',
    'content-filter-modified-from', 'content-filter-modified-to',
    'content-filter-size', 'content-filter-size-min', 'content-filter-size-min-unit',
    'content-filter-size-max', 'content-filter-size-max-unit', 'content-filter-feedback'
  ]) elements.set(id, element(id));
  elements.get('content-filter-size').value = 'any';
  elements.get('content-filter-size-min-unit').value = 'b';
  elements.get('content-filter-size-max-unit').value = 'b';
  const lifecycleInputs = ContentQuery.VALID_LIFECYCLES.map(value => {
    const input = element(`lifecycle-${value}`, value);
    input.name = 'content-filter-lifecycle';
    return input;
  });
  const gitStatusInputs = ContentQuery.VALID_GIT_STATUSES.map(value => {
    const input = element(`git-status-${value}`, value);
    input.name = 'content-filter-git-status';
    return input;
  });
  const fileLabelInputs = ['fl_pending', 'fl_client'].map(value => {
    const input = element(`file-label-${value}`, value);
    input.name = 'content-filter-file-label';
    return input;
  });
  const modal = elements.get('content-filter-modal');
  const document = {
    activeElement: elements.get('content-filter-more'),
    getElementById: id => elements.get(id) || null,
    querySelectorAll(selector) {
      if (selector === 'input[name="content-filter-lifecycle"]') return lifecycleInputs;
      if (selector === 'input[name="content-filter-git-status"]') return gitStatusInputs;
      if (selector === 'input[name="content-filter-file-label"]') return fileLabelInputs;
      if (selector === '.modal-overlay') return [modal];
      return [];
    },
    addEventListener() {}
  };
  const state = {
    contentQuery: query,
    searchScope: 'current',
    fileLabels: { version: 1, labels: [], assignments: {} }
  };
  const app = {
    closeToolbarMenus: () => calls.push('close-menus'),
    closeQuickLook: () => calls.push('close-preview'),
    captureActiveWorkspaceTab: () => calls.push('capture-tab'),
    renderWorkspaceTabs: () => calls.push('render-tabs'),
    scheduleWorkspaceTabsPersist: () => calls.push('persist-tabs'),
    updateModeUI: () => calls.push('mode-ui'),
    updateBreadcrumbs: () => calls.push('breadcrumbs'),
    renderContent: () => calls.push('content')
  };
  const window = {
    getComputedStyle: target => target.style,
    requestAnimationFrame: callback => callback()
  };
  const controller = new Controller({ app, state, document, window });
  controller.bind();
  return { controller, state, app, document, window, elements, lifecycleInputs, gitStatusInputs, fileLabelInputs, calls };
}

test('扩展名输入接受常见分隔符并交给统一查询规范化', () => {
  assert.deepEqual(parseExtensions('ts, .tsx；md tar.gz'), ['ts', '.tsx', 'md', 'tar.gz']);
  assert.equal(scopeLabel(ContentQuery.queryForPreset('all-projects')), '所有受管位置 · 项目');
  assert.equal(scopeLabel(ContentQuery.defaultQuery()), '当前目录');
  assert.deepEqual(parseDateDraft('2026-08-27'), { ok: true, value: '2026-08-27' });
  assert.equal(parseDateDraft('2026-02-30').ok, false);
  assert.deepEqual(parseSizeDraft('1.5', 'mb'), { ok: true, value: 1572864 });
  assert.deepEqual(formatSizeDraft(1572864), { value: '1536', unit: 'kb' });
  assert.equal(parseSizeDraft('0.1', 'kb').ok, false);
});

test('精确日期与大小区间应用到当前标签并与粗略预设互斥', () => {
  const { controller, state, elements } = createHarness();
  controller.open();
  elements.get('content-filter-modified').value = '30';
  elements.get('content-filter-modified-from').value = '2026-08-01';
  elements.get('content-filter-modified-to').value = '2026-08-27';
  elements.get('content-filter-size').value = 'over-100mb';
  elements.get('content-filter-size-min').value = '0.5';
  elements.get('content-filter-size-min-unit').value = 'mb';
  elements.get('content-filter-size-max').value = '2';
  elements.get('content-filter-size-max-unit').value = 'mb';

  assert.equal(controller.apply(), true);
  assert.equal(state.contentQuery.modifiedWithinDays, null);
  assert.equal(state.contentQuery.modifiedFrom, '2026-08-01');
  assert.equal(state.contentQuery.modifiedTo, '2026-08-27');
  assert.equal(state.contentQuery.sizeRange, 'any');
  assert.equal(state.contentQuery.minSizeBytes, 512 * 1024);
  assert.equal(state.contentQuery.maxSizeBytes, 2 * 1024 * 1024);
  assert.equal(state.contentQuery.baseType, 'file');

  controller.populate();
  assert.equal(elements.get('content-filter-size-min').value, '512');
  assert.equal(elements.get('content-filter-size-min-unit').value, 'kb');
  assert.equal(elements.get('content-filter-size-max').value, '2');
  assert.equal(elements.get('content-filter-size-max-unit').value, 'mb');
});

test('反向日期或大小区间保持弹窗和原查询不变并聚焦错误字段', () => {
  const harness = createHarness();
  harness.controller.open();
  harness.elements.get('content-filter-modified-from').value = '2026-09-01';
  harness.elements.get('content-filter-modified-to').value = '2026-08-01';
  assert.equal(harness.controller.apply(), false);
  assert.deepEqual(harness.state.contentQuery, ContentQuery.defaultQuery());
  assert.equal(harness.elements.get('content-filter-modal').style.display, 'flex');
  assert.match(harness.elements.get('content-filter-feedback').textContent, /起始修改日期/);
  assert.equal(harness.elements.get('content-filter-modified-from').focused, true);

  harness.elements.get('content-filter-modified-from').value = '';
  harness.elements.get('content-filter-modified-to').value = '';
  harness.elements.get('content-filter-size-min').value = '3';
  harness.elements.get('content-filter-size-min-unit').value = 'mb';
  harness.elements.get('content-filter-size-max').value = '2';
  harness.elements.get('content-filter-size-max-unit').value = 'mb';
  assert.equal(harness.controller.apply(), false);
  assert.match(harness.elements.get('content-filter-feedback').textContent, /最小文件大小/);
});

test('高级筛选弹窗从当前标签查询填充并应用生命周期与时间', () => {
  const { controller, state, elements, lifecycleInputs, calls } = createHarness();
  controller.open();
  assert.equal(elements.get('content-filter-modal').style.display, 'flex');
  assert.equal(elements.get('content-filter-scope').textContent, '筛选范围：当前目录');

  lifecycleInputs.find(input => input.value === 'active').checked = true;
  lifecycleInputs.find(input => input.value === 'frozen').checked = true;
  elements.get('content-filter-modified').value = '30';
  controller.apply();

  assert.equal(state.contentQuery.projectOnly, true);
  assert.deepEqual(state.contentQuery.lifecycles, ['active', 'frozen']);
  assert.equal(state.contentQuery.modifiedWithinDays, 30);
  assert.equal(elements.get('content-filter-modal').style.display, 'none');
  assert.ok(calls.includes('persist-tabs'));
  assert.ok(calls.includes('content'));
});

test('文件条件与项目生命周期互斥，所有位置不递归启用文件条件', () => {
  const current = createHarness();
  current.elements.get('content-filter-extensions').value = 'js,ts';
  current.controller.updateDraftAvailability();
  assert.equal(current.elements.get('content-filter-lifecycle-section').disabled, true);
  assert.equal(current.elements.get('content-filter-file-section').disabled, false);

  const all = createHarness(ContentQuery.queryForPreset('all-projects'));
  all.controller.populate();
  assert.equal(all.elements.get('content-filter-file-section').disabled, true);
  assert.match(all.elements.get('content-filter-file-hint').textContent, /只适用于当前目录/);
});

test('全部仓库中的 Git 状态与查询同步，普通目录不主动启用状态读取', () => {
  const current = createHarness();
  current.controller.populate();
  assert.equal(current.elements.get('content-filter-git-section').disabled, true);
  assert.match(current.elements.get('content-filter-git-hint').textContent, /所有 Git 仓库/);

  const repositories = createHarness(ContentQuery.queryForPreset('all-repositories'));
  repositories.controller.populate();
  assert.equal(repositories.elements.get('content-filter-git-section').disabled, false);
  repositories.gitStatusInputs.find(input => input.value === 'dirty').checked = true;
  repositories.gitStatusInputs.find(input => input.value === 'ahead').checked = true;
  repositories.controller.apply();
  assert.deepEqual(repositories.state.contentQuery.gitStatuses, ['ahead', 'dirty']);
  assert.equal(ContentQuery.collectionKind(repositories.state.contentQuery), 'repositories');
});

test('文件标签条件按当前标签页保存，标签集合支持跨目录聚合', () => {
  const current = createHarness();
  current.controller.populate();
  current.fileLabelInputs.find(input => input.value === 'fl_pending').checked = true;
  current.controller.apply();
  assert.deepEqual(current.state.contentQuery.fileLabelIds, ['fl_pending']);
  assert.equal(current.elements.get('content-filter-file-label-section').disabled, false);

  const all = createHarness(ContentQuery.queryForPreset('all-projects'));
  all.controller.populate();
  assert.equal(all.elements.get('content-filter-file-label-section').disabled, true);
  assert.match(all.elements.get('content-filter-file-label-hint').textContent, /跨目录聚合/);

  const collection = createHarness(ContentQuery.queryForFileLabels(['fl_pending']));
  collection.controller.populate();
  assert.equal(collection.elements.get('content-filter-file-label-section').disabled, false);
  assert.equal(collection.elements.get('content-filter-file-section').disabled, false);
  assert.equal(collection.elements.get('content-filter-lifecycle-section').disabled, true);
  assert.equal(scopeLabel(collection.state.contentQuery), '所有受管位置 · 文件标签');
  collection.controller.resetDraft();
  collection.controller.apply();
  assert.deepEqual(collection.state.contentQuery.fileLabelIds, ['fl_pending']);
  assert.equal(ContentQuery.collectionKind(collection.state.contentQuery), 'file-labels');
});

test('重置只修改草稿，应用后清除高级条件并保留项目范围', () => {
  const query = ContentQuery.normalize({
    ...ContentQuery.queryForPreset('all-projects'),
    lifecycles: ['archived'],
    modifiedWithinDays: 90
  });
  const { controller, state, lifecycleInputs, elements } = createHarness(query);
  controller.populate();
  assert.equal(lifecycleInputs.find(input => input.value === 'archived').checked, true);
  controller.resetDraft();
  assert.equal(state.contentQuery.lifecycles[0], 'archived');
  controller.apply();
  assert.deepEqual(state.contentQuery, ContentQuery.queryForPreset('all-projects'));
  assert.equal(elements.get('content-filter-modal').attributes['aria-hidden'], 'true');
});
