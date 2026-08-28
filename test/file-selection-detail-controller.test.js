const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Controller } = require('../src/renderer/scripts/fileSelectionDetailController.js');

class FakeElement {
  constructor() {
    this.style = { display: '' };
    this.innerHTML = '';
  }

  querySelector() { return null; }
}

function createHarness() {
  const empty = new FakeElement();
  const content = new FakeElement();
  const document = {
    getElementById(id) {
      if (id === 'detail-empty') return empty;
      if (id === 'detail-content') return content;
      return null;
    }
  };
  const state = { selectedRepo: { path: '/old' } };
  const calls = [];
  const app = {
    escapeHtml: value => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;'),
    getFileItemSummary: item => item.summary || '',
    isFavoritePath: itemPath => itemPath === '/workspace/project',
    getItemKindIconHtml: (item, className) => `<span class="${className}" data-kind="${item.kind}"></span>`,
    cancelRepoSelection: () => calls.push(['cancel-repo']),
    toggleFavoritePath: itemPath => calls.push(['favorite', itemPath]),
    showResourceInRelationshipBoard: resource => calls.push(['relationship', resource])
  };
  const fileBrowser = {
    projectLifecycleLabel: item => item.lifecycleLabel || '',
    projectLifecycleKey: item => item.lifecycle || ''
  };
  const controller = new Controller({ app, state, document, fileBrowser });
  return { app, calls, content, controller, document, empty, state };
}

test('空选择和多选继续显示简洁的 Finder 状态', () => {
  const harness = createHarness();
  harness.controller.show([]);
  assert.deepEqual(harness.calls, [['cancel-repo']]);
  assert.equal(harness.state.selectedRepo, null);
  assert.equal(harness.content.style.display, 'none');
  assert.equal(harness.empty.style.display, 'flex');
  assert.match(harness.empty.innerHTML, /选择文件或仓库查看详情/);

  harness.controller.show([{ path: '/a' }, { path: '/b' }]);
  assert.match(harness.empty.innerHTML, /已选择 2 项/);
  assert.match(harness.empty.innerHTML, /可以批量移动或移到废纸篓/);
});

test('单项简介复用统一语义图标并保留项目、Git 和生命周期动作', () => {
  const harness = createHarness();
  harness.controller.show([{
    path: '/workspace/project',
    name: '<project>',
    type: 'directory',
    kind: 'project',
    isProject: true,
    isGitRepo: true,
    project: { projectId: 'project_1' },
    lifecycle: 'active',
    lifecycleLabel: '进行中',
    summary: '多仓库项目'
  }]);

  assert.match(harness.empty.innerHTML, /detail-empty-icon-semantic/);
  assert.match(harness.empty.innerHTML, /detail-empty-kind-icon/);
  assert.match(harness.empty.innerHTML, /data-kind="project"/);
  assert.match(harness.empty.innerHTML, /&lt;project&gt;/);
  assert.match(harness.empty.innerHTML, /进行中 · 多仓库项目/);
  assert.match(harness.empty.innerHTML, /从收藏夹移除/);
  assert.match(harness.empty.innerHTML, /项目设置/);
  assert.match(harness.empty.innerHTML, /关系白板/);
  assert.doesNotMatch(harness.empty.innerHTML, /📁|📄/);
});

test('普通文件使用同一文件类型图标且不显示文件夹动作', () => {
  const harness = createHarness();
  harness.controller.show([{
    path: '/workspace/readme.md',
    name: 'readme.md',
    type: 'file',
    kind: 'file',
    summary: '12 KB'
  }]);
  assert.match(harness.empty.innerHTML, /data-kind="file"/);
  assert.match(harness.empty.innerHTML, /12 KB/);
  assert.doesNotMatch(harness.empty.innerHTML, /添加到收藏夹|设为项目|关系白板/);
});

test('页面先加载选择简介控制器，App 只保留显示委托', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src/renderer/scripts/app.js'), 'utf8');
  assert.ok(html.indexOf('scripts/fileSelectionDetailController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupFileSelectionDetailController/);
  assert.match(appSource, /return this\.fileSelectionDetailController\.show\(items\)/);
});
