const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RepoStatusBatch = require('../src/renderer/scripts/repoStatusBatch');

test('仓库状态批次只接受当前请求的进度和结果', () => {
  const state = RepoStatusBatch.createState([
    { path: '/repo/a', name: 'a' },
    { path: '/repo/b', name: 'b' }
  ], 'batch-new');

  assert.equal(RepoStatusBatch.applyProgress(state, {
    requestId: 'batch-old',
    completed: 2,
    total: 2,
    latest: { path: '/repo/a', status: { branch: 'stale' } }
  }), false);
  assert.equal(state.items[0].gitStatus.branch, '');

  assert.equal(RepoStatusBatch.applyProgress(state, {
    requestId: 'batch-new',
    completed: 1,
    total: 2,
    latest: { path: '/repo/a', status: { branch: 'main', overallStatus: 'clean' } }
  }), true);
  assert.equal(state.items[0].gitStatus.branch, 'main');
  assert.deepEqual(state.progress, { completed: 1, total: 2, running: 0, cancelled: false, done: false });
});

test('本地元数据合并不会覆盖已到达的 Git 状态', () => {
  const state = RepoStatusBatch.createState([{ path: '/repo/a', name: 'a' }], 'batch-a');
  RepoStatusBatch.applyProgress(state, {
    requestId: 'batch-a',
    completed: 1,
    total: 1,
    latest: { path: '/repo/a', status: { branch: 'feature', overallStatus: 'dirty' } }
  });
  assert.equal(RepoStatusBatch.applyMetadata(state, 'batch-a', '/repo/a', {
    tags: [{ name: '本地' }],
    readme: { description: '说明' },
    groups: [{ name: '工具' }]
  }), true);
  assert.equal(state.items[0].gitStatus.branch, 'feature');
  assert.equal(state.items[0].readme.description, '说明');
  assert.equal(state.items[0].tags[0].name, '本地');
});

test('进度文案区分扫描、取消中、已取消和完成', () => {
  assert.equal(RepoStatusBatch.formatProgress({ completed: 3, total: 10 }), '正在读取 Git 状态 3/10');
  assert.equal(RepoStatusBatch.formatProgress({ completed: 3, total: 10, cancelling: true }), '正在取消 Git 状态读取…');
  assert.equal(RepoStatusBatch.formatProgress({ completed: 3, total: 10, cancelled: true, done: true }), '已取消，保留已读取的 3/10 个仓库');
  assert.equal(RepoStatusBatch.formatProgress({ completed: 10, total: 10, done: true }), '已更新 10 个仓库的 Git 状态');
});

test('桌面端把批量状态进度、取消和旧请求隔离连接到可见界面', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/git.js'), 'utf8');
  const index = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');

  assert.match(index, /id="repo-status-work"[\s\S]*?id="repo-status-cancel"/);
  assert.ok(index.indexOf('scripts/repoStatusBatch.js') < index.indexOf('scripts/app.js'));
  assert.match(preload, /cancelBatchStatus:\s*\(requestId\)/);
  assert.match(preload, /onBatchStatusProgress:\s*\(callback\)/);
  assert.match(ipc, /repoPaths\.forEach\(assertManagedRepoPath\)/);
  assert.match(appSource, /progress\?\.requestId !== AppState\.repoEnrichmentRequestId/);
  assert.match(appSource, /batchStatus\(repoPaths,[\s\S]*?autoFetch:\s*false[\s\S]*?includeSummary:\s*true/);
  assert.match(appSource, /cancelRepoStatusBatch\(\)/);
});
