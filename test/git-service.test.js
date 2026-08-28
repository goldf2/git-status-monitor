const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gitService = require('../src/main/services/gitService');

function git(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
}

function createRepo(t, prefix = 'gitfinder-review-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const repoPath = path.join(tempRoot, 'repo');
  fs.mkdirSync(repoPath);
  git(repoPath, ['init']);
  git(repoPath, ['config', 'user.email', 'gitfinder-test@example.invalid']);
  git(repoPath, ['config', 'user.name', 'GitFinder Test']);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha\n');
  fs.writeFileSync(path.join(repoPath, 'beta.txt'), 'beta\n');
  git(repoPath, ['add', '--all']);
  git(repoPath, ['commit', '-m', 'initial']);
  return { tempRoot, repoPath };
}

function writeNumberedFile(repoPath, replacements = {}) {
  const lines = Array.from({ length: 20 }, (_, index) => replacements[index + 1] || `line ${index + 1}`);
  fs.writeFileSync(path.join(repoPath, 'numbered.txt'), `${lines.join('\n')}\n`);
}

test('批量状态返回已解析的状态对象', async () => {
  const original = gitService.getStatus;
  gitService.getStatus = async (repoPath) => ({ isGitRepo: true, branch: path.basename(repoPath) });
  try {
    const results = await gitService.batchStatus(['/repo/a', '/repo/b']);
    assert.deepEqual(results, [
      { path: '/repo/a', status: { isGitRepo: true, branch: 'a' } },
      { path: '/repo/b', status: { isGitRepo: true, branch: 'b' } }
    ]);
  } finally {
    gitService.getStatus = original;
  }
});

test('批量状态限制并发数、保留输入顺序并不默认 fetch', async () => {
  const original = gitService.getStatus;
  const repoPaths = Array.from({ length: 12 }, (_, index) => `/repo/${index}`);
  let active = 0;
  let maximumActive = 0;
  const receivedOptions = [];
  gitService.getStatus = async (repoPath, options) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    receivedOptions.push(options);
    await new Promise(resolve => setTimeout(resolve, 4 + (11 - Number(path.basename(repoPath)))));
    active -= 1;
    return { isGitRepo: true, branch: path.basename(repoPath) };
  };

  try {
    const result = await gitService.batchStatus(repoPaths, {
      requestId: 'test-concurrency',
      concurrency: 3,
      includeSummary: true
    });
    assert.equal(maximumActive, 3);
    assert.equal(result.cancelled, false);
    assert.equal(result.completed, repoPaths.length);
    assert.deepEqual(result.results.map(item => item.path), repoPaths);
    assert.equal(receivedOptions.every(options => options.autoFetch === false), true);
  } finally {
    gitService.getStatus = original;
  }
});

test('批量状态可取消，取消后不再启动队列中的仓库', async () => {
  const original = gitService.getStatus;
  const repoPaths = Array.from({ length: 10 }, (_, index) => `/repo/cancel-${index}`);
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  gitService.getStatus = async (repoPath) => {
    started += 1;
    await gate;
    return { isGitRepo: true, branch: path.basename(repoPath) };
  };

  try {
    const batchPromise = gitService.batchStatus(repoPaths, {
      requestId: 'test-cancel',
      concurrency: 2,
      includeSummary: true
    });
    while (started < 2) await new Promise(resolve => setTimeout(resolve, 1));
    const cancellation = gitService.cancelBatchStatus('test-cancel');
    release();
    const result = await batchPromise;

    assert.equal(cancellation.cancelled, true);
    assert.equal(result.cancelled, true);
    assert.equal(result.completed, 2);
    assert.equal(started, 2);
    assert.equal(result.results.length, 2);
  } finally {
    gitService.getStatus = original;
  }
});

test('批量状态进度单调增长并可按请求 ID 查询', async () => {
  const original = gitService.getStatus;
  const snapshots = [];
  gitService.getStatus = async repoPath => ({ isGitRepo: true, branch: path.basename(repoPath) });
  try {
    const result = await gitService.batchStatus(['/repo/a', '/repo/b', '/repo/c'], {
      requestId: 'test-progress',
      concurrency: 2,
      includeSummary: true,
      onProgress: progress => snapshots.push(progress)
    });
    const progress = gitService.getBatchStatusProgress('test-progress');
    assert.equal(result.completed, 3);
    assert.equal(progress.done, true);
    assert.equal(progress.completed, 3);
    assert.equal(progress.total, 3);
    assert.deepEqual(snapshots.map(item => item.completed), [...snapshots.map(item => item.completed)].sort((a, b) => a - b));
    assert.equal(snapshots.at(-1).done, true);
  } finally {
    gitService.getStatus = original;
  }
});

test('批量状态拒绝超量、非绝对路径并去除重复仓库', async () => {
  const original = gitService.getStatus;
  gitService.getStatus = async repoPath => ({ isGitRepo: true, branch: path.basename(repoPath) });
  try {
    await assert.rejects(() => gitService.batchStatus(['relative/repo']), /绝对路径/);
    await assert.rejects(
      () => gitService.batchStatus(Array.from({ length: 1001 }, (_, index) => `/repo/${index}`)),
      /最多.*1000/
    );
    const result = await gitService.batchStatus(['/repo/a', '/repo/a', '/repo/b']);
    assert.deepEqual(result.map(item => item.path), ['/repo/a', '/repo/b']);
  } finally {
    gitService.getStatus = original;
  }
});

test('工作区审查区分已暂存、未暂存和未跟踪文件，并返回对应 diff', (t) => {
  const { repoPath } = createRepo(t);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha changed\n');
  fs.writeFileSync(path.join(repoPath, 'beta.txt'), 'beta staged\n');
  git(repoPath, ['add', '--', 'beta.txt']);
  fs.writeFileSync(path.join(repoPath, 'new file.txt'), 'new content\n');

  const review = gitService.getWorkingTree(repoPath);
  assert.equal(review.success, true, review.error);
  assert.equal(review.stagedCount, 1);
  assert.equal(review.unstagedCount, 2);
  assert.deepEqual(review.files.map(file => ({
    path: file.path,
    staged: file.staged,
    unstaged: file.unstaged,
    untracked: file.untracked
  })), [
    { path: 'alpha.txt', staged: false, unstaged: true, untracked: false },
    { path: 'beta.txt', staged: true, unstaged: false, untracked: false },
    { path: 'new file.txt', staged: false, unstaged: true, untracked: true }
  ]);

  const unstagedDiff = gitService.getFileDiff(repoPath, 'alpha.txt', { staged: false });
  const stagedDiff = gitService.getFileDiff(repoPath, 'beta.txt', { staged: true });
  const untrackedDiff = gitService.getFileDiff(repoPath, 'new file.txt', { staged: false });
  assert.equal(unstagedDiff.success, true, unstagedDiff.error);
  assert.match(unstagedDiff.diff, /\+alpha changed/);
  assert.equal(stagedDiff.success, true, stagedDiff.error);
  assert.match(stagedDiff.diff, /\+beta staged/);
  assert.equal(untrackedDiff.success, true, untrackedDiff.error);
  assert.match(untrackedDiff.diff, /\+new content/);
});

test('可以按文件暂存和取消暂存，并拒绝仓库外路径', (t) => {
  const { repoPath } = createRepo(t);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha changed\n');
  fs.writeFileSync(path.join(repoPath, 'new.txt'), 'new\n');

  const stageResult = gitService.stageFiles(repoPath, ['alpha.txt', 'new.txt']);
  assert.equal(stageResult.success, true, stageResult.error);
  assert.equal(gitService.getWorkingTree(repoPath).stagedCount, 2);

  const unstageResult = gitService.unstageFiles(repoPath, ['alpha.txt']);
  assert.equal(unstageResult.success, true, unstageResult.error);
  const review = gitService.getWorkingTree(repoPath);
  assert.equal(review.files.find(file => file.path === 'alpha.txt').staged, false);
  assert.equal(review.files.find(file => file.path === 'new.txt').staged, true);

  const rejected = gitService.stageFiles(repoPath, ['../outside.txt']);
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /仓库目录之外/);
});

test('行级预览不写入索引，只暂存所选 hunk，并可按行取消暂存', (t) => {
  const { repoPath } = createRepo(t, 'gitfinder-line-stage-');
  writeNumberedFile(repoPath);
  git(repoPath, ['add', '--', 'numbered.txt']);
  git(repoPath, ['commit', '-m', 'add numbered file']);
  writeNumberedFile(repoPath, { 2: 'line two changed', 18: 'line eighteen changed' });

  const diff = gitService.getFileDiff(repoPath, 'numbered.txt', { staged: false });
  assert.equal(diff.success, true, diff.error);
  assert.equal(diff.lineSelection.supported, true, diff.lineSelection.reason);
  assert.equal(diff.lineSelection.lines.length, 4);
  const firstHunkIds = diff.lineSelection.lines.filter(line => line.hunkIndex === 0).map(line => line.id);
  const indexBefore = git(repoPath, ['write-tree']);

  const preview = gitService.previewLineSelection(repoPath, 'numbered.txt', {
    staged: false,
    diffFingerprint: diff.fingerprint,
    lineIds: firstHunkIds
  });
  assert.equal(preview.success, true, preview.error);
  assert.equal(git(repoPath, ['write-tree']), indexBefore, '预览不得写入索引');

  const applied = gitService.applyLineSelection(repoPath, {
    previewId: preview.previewId,
    token: preview.token
  });
  assert.equal(applied.success, true, applied.error);
  const repeated = gitService.applyLineSelection(repoPath, {
    previewId: preview.previewId,
    token: preview.token
  });
  assert.equal(repeated.success, true, repeated.error);
  assert.equal(repeated.alreadyApplied, true);
  const stagedDiff = git(repoPath, ['diff', '--cached']);
  const unstagedDiff = git(repoPath, ['diff']);
  assert.match(stagedDiff, /line two changed/);
  assert.doesNotMatch(stagedDiff, /line eighteen changed/);
  assert.match(unstagedDiff, /line eighteen changed/);
  assert.doesNotMatch(unstagedDiff, /line two changed/);

  const staged = gitService.getFileDiff(repoPath, 'numbered.txt', { staged: true });
  const unstagePreview = gitService.previewLineSelection(repoPath, 'numbered.txt', {
    staged: true,
    diffFingerprint: staged.fingerprint,
    lineIds: staged.lineSelection.lines.map(line => line.id)
  });
  assert.equal(unstagePreview.success, true, unstagePreview.error);
  const unstaged = gitService.applyLineSelection(repoPath, {
    previewId: unstagePreview.previewId,
    token: unstagePreview.token
  });
  assert.equal(unstaged.success, true, unstaged.error);
  assert.equal(git(repoPath, ['diff', '--cached']), '');
  assert.match(git(repoPath, ['diff']), /line two changed/);
  assert.match(git(repoPath, ['diff']), /line eighteen changed/);

  const remainingDiff = gitService.getFileDiff(repoPath, 'numbered.txt', { staged: false });
  const secondHunkIds = remainingDiff.lineSelection.lines
    .filter(line => line.hunkIndex === 1)
    .map(line => line.id);
  const secondPreview = gitService.previewLineSelection(repoPath, 'numbered.txt', {
    staged: false,
    diffFingerprint: remainingDiff.fingerprint,
    lineIds: secondHunkIds
  });
  assert.equal(secondPreview.success, true, secondPreview.error);
  const secondApplied = gitService.applyLineSelection(repoPath, {
    previewId: secondPreview.previewId,
    token: secondPreview.token
  });
  assert.equal(secondApplied.success, true, secondApplied.error);
  assert.doesNotMatch(git(repoPath, ['diff', '--cached']), /line two changed/);
  assert.match(git(repoPath, ['diff', '--cached']), /line eighteen changed/);
});

test('行级操作拒绝过期 diff、伪造行身份和不支持的未跟踪文件', (t) => {
  const { repoPath } = createRepo(t, 'gitfinder-line-stale-');
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha first change\n');
  const diff = gitService.getFileDiff(repoPath, 'alpha.txt', { staged: false });
  const ids = diff.lineSelection.lines.map(line => line.id);

  const invalid = gitService.previewLineSelection(repoPath, 'alpha.txt', {
    staged: false,
    diffFingerprint: diff.fingerprint,
    lineIds: ['h99:l99']
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /行|选择/);

  const preview = gitService.previewLineSelection(repoPath, 'alpha.txt', {
    staged: false,
    diffFingerprint: diff.fingerprint,
    lineIds: ids
  });
  assert.equal(preview.success, true, preview.error);
  const forgedToken = gitService.applyLineSelection(repoPath, {
    previewId: preview.previewId,
    token: '00000000-0000-0000-0000-000000000000'
  });
  assert.equal(forgedToken.success, false);
  assert.match(forgedToken.error, /凭证/);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha changed after preview\n');
  const stale = gitService.applyLineSelection(repoPath, { previewId: preview.previewId, token: preview.token });
  assert.equal(stale.success, false);
  assert.match(stale.error, /已变化|重新预览/);

  fs.writeFileSync(path.join(repoPath, 'untracked.txt'), 'new\n');
  const untracked = gitService.getFileDiff(repoPath, 'untracked.txt', { staged: false });
  assert.equal(untracked.lineSelection.supported, false);
  assert.match(untracked.lineSelection.reason, /未跟踪|整文件/);
});

test('工作区审查保留重命名前后的路径', (t) => {
  const { repoPath } = createRepo(t);
  git(repoPath, ['mv', 'alpha.txt', 'renamed alpha.txt']);

  const review = gitService.getWorkingTree(repoPath);
  assert.equal(review.success, true, review.error);
  assert.deepEqual(review.files.find(file => file.kind === 'renamed'), {
    path: 'renamed alpha.txt',
    originalPath: 'alpha.txt',
    indexStatus: 'R',
    worktreeStatus: ' ',
    staged: true,
    unstaged: false,
    untracked: false,
    conflict: false,
    kind: 'renamed'
  });
});

test('存在未解决冲突时拒绝提交', async (t) => {
  const { repoPath } = createRepo(t);
  const baseBranch = git(repoPath, ['branch', '--show-current']);
  git(repoPath, ['checkout', '-q', '-b', 'conflict-side']);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'side change\n');
  git(repoPath, ['add', '--', 'alpha.txt']);
  git(repoPath, ['commit', '-m', 'side change']);
  git(repoPath, ['checkout', '-q', baseBranch]);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'main change\n');
  git(repoPath, ['add', '--', 'alpha.txt']);
  git(repoPath, ['commit', '-m', 'main change']);
  assert.throws(() => git(repoPath, ['merge', 'conflict-side']));

  const review = gitService.getWorkingTree(repoPath);
  assert.equal(review.conflictCount, 1);
  assert.equal(review.files.find(file => file.path === 'alpha.txt').kind, 'conflict');
  const result = await gitService.commit(repoPath, 'must not commit conflict');
  assert.equal(result.success, false);
  assert.match(result.error, /冲突/);
});

test('提交只包含已暂存文件，保留未暂存和未跟踪内容', async (t) => {
  const { tempRoot, repoPath } = createRepo(t, 'gitfinder-commit-');
  const markerPath = path.join(tempRoot, 'shell-was-executed');
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha staged\n');
  fs.writeFileSync(path.join(repoPath, 'beta.txt'), 'beta unstaged\n');
  fs.writeFileSync(path.join(repoPath, 'new.txt'), 'untracked\n');
  git(repoPath, ['add', '--', 'alpha.txt']);

  const message = `literal \"quotes\" $(touch ${markerPath}) ; semicolon`;
  const result = await gitService.commit(repoPath, message);

  assert.equal(result.success, true, result.error);
  assert.equal(fs.existsSync(markerPath), false);
  assert.equal(git(repoPath, ['log', '-1', '--format=%s']), message);
  assert.equal(git(repoPath, ['show', '--format=', '--name-only', 'HEAD']), 'alpha.txt');
  const remaining = gitService.getWorkingTree(repoPath);
  assert.equal(remaining.files.some(file => file.path === 'beta.txt' && file.unstaged), true);
  assert.equal(remaining.files.some(file => file.path === 'new.txt' && file.untracked), true);
});

test('没有已暂存文件时拒绝提交', async (t) => {
  const { repoPath } = createRepo(t);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'only unstaged\n');

  const result = await gitService.commit(repoPath, 'should not commit');
  assert.equal(result.success, false);
  assert.match(result.error, /没有已暂存/);
  assert.equal(git(repoPath, ['log', '-1', '--format=%s']), 'initial');
});

test('amend 预览零写入，应用后仅改写 HEAD 并保留未暂存内容与父提交', async (t) => {
  const { repoPath } = createRepo(t, 'gitfinder-amend-');
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha second baseline\n');
  git(repoPath, ['add', '--', 'alpha.txt']);
  git(repoPath, ['commit', '-m', 'second baseline']);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'alpha staged for amend\n');
  fs.writeFileSync(path.join(repoPath, 'beta.txt'), 'beta remains unstaged\n');
  git(repoPath, ['add', '--', 'alpha.txt']);
  const oldHead = git(repoPath, ['rev-parse', 'HEAD']);
  const oldParent = git(repoPath, ['rev-parse', 'HEAD^']);
  const indexBefore = git(repoPath, ['write-tree']);

  const context = gitService.getAmendContext(repoPath);
  assert.equal(context.success, true, context.error);
  assert.equal(context.head.hash, oldHead);
  assert.equal(context.stagedCount, 1);
  const preview = gitService.previewAmend(repoPath, 'amended message');
  assert.equal(preview.success, true, preview.error);
  assert.equal(git(repoPath, ['rev-parse', 'HEAD']), oldHead, '预览不得改写 HEAD');
  assert.equal(git(repoPath, ['write-tree']), indexBefore, '预览不得改写索引');

  const applied = await gitService.applyAmend(repoPath, {
    previewId: preview.previewId,
    token: preview.token,
    acknowledgePublished: false
  });
  assert.equal(applied.success, true, applied.error);
  assert.notEqual(git(repoPath, ['rev-parse', 'HEAD']), oldHead);
  assert.equal(git(repoPath, ['rev-parse', 'HEAD^']), oldParent);
  assert.equal(git(repoPath, ['log', '-1', '--format=%s']), 'amended message');
  assert.match(git(repoPath, ['show', '--format=', '--name-only', 'HEAD']), /alpha\.txt/);
  assert.match(git(repoPath, ['diff']), /beta remains unstaged/);
});

test('amend 应用拒绝过期索引，并拒绝无 HEAD 与危险 Git 操作状态', async (t) => {
  const { tempRoot, repoPath } = createRepo(t, 'gitfinder-amend-stale-');
  const oldHead = git(repoPath, ['rev-parse', 'HEAD']);
  const preview = gitService.previewAmend(repoPath, 'message only amend');
  assert.equal(preview.success, true, preview.error);
  fs.writeFileSync(path.join(repoPath, 'alpha.txt'), 'staged after preview\n');
  git(repoPath, ['add', '--', 'alpha.txt']);
  const stale = await gitService.applyAmend(repoPath, {
    previewId: preview.previewId,
    token: preview.token,
    acknowledgePublished: false
  });
  assert.equal(stale.success, false);
  assert.match(stale.error, /已变化|重新预览/);
  assert.equal(git(repoPath, ['rev-parse', 'HEAD']), oldHead);

  const gitDir = git(repoPath, ['rev-parse', '--absolute-git-dir']);
  fs.writeFileSync(path.join(gitDir, 'index.lock'), '');
  const unsafe = gitService.previewAmend(repoPath, 'unsafe amend');
  assert.equal(unsafe.success, false);
  assert.match(unsafe.error, /Git 操作|锁|进行中/);
  fs.unlinkSync(path.join(gitDir, 'index.lock'));

  const emptyRepo = path.join(tempRoot, 'empty');
  fs.mkdirSync(emptyRepo);
  git(emptyRepo, ['init']);
  const noHead = gitService.getAmendContext(emptyRepo);
  assert.equal(noHead.success, false);
  assert.match(noHead.error, /提交|HEAD/);
});

test('可能已发布的 HEAD 必须在 amend 应用时显式确认', async (t) => {
  const { tempRoot, repoPath } = createRepo(t, 'gitfinder-amend-published-');
  const remotePath = path.join(tempRoot, 'remote.git');
  fs.mkdirSync(remotePath);
  git(remotePath, ['init', '--bare']);
  git(repoPath, ['remote', 'add', 'origin', remotePath]);
  git(repoPath, ['push', '-u', 'origin', 'HEAD']);

  const preview = gitService.previewAmend(repoPath, 'rewrite published head');
  assert.equal(preview.success, true, preview.error);
  assert.equal(preview.requiresPublishedConfirmation, true);
  assert.ok(preview.publishedRefs.length >= 1);

  const rejected = await gitService.applyAmend(repoPath, {
    previewId: preview.previewId,
    token: preview.token,
    acknowledgePublished: false
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /已发布|确认/);
  const accepted = await gitService.applyAmend(repoPath, {
    previewId: preview.previewId,
    token: preview.token,
    acknowledgePublished: true
  });
  assert.equal(accepted.success, true, accepted.error);
  const rewrittenHead = git(repoPath, ['rev-parse', 'HEAD']);
  const repeated = await gitService.applyAmend(repoPath, {
    previewId: preview.previewId,
    token: preview.token,
    acknowledgePublished: true
  });
  assert.equal(repeated.success, true, repeated.error);
  assert.equal(repeated.alreadyApplied, true);
  assert.equal(git(repoPath, ['rev-parse', 'HEAD']), rewrittenHead);
});

test('强制刷新会跳过状态缓存并读取当前分支', async (t) => {
  const { repoPath } = createRepo(t, 'gitfinder-status-cache-');
  gitService.clearAllCache();
  t.after(() => gitService.clearAllCache());

  const first = await gitService.getStatus(repoPath);
  git(repoPath, ['checkout', '-q', '-b', 'feature/evidence']);
  const cached = await gitService.getStatus(repoPath);
  const refreshed = await gitService.getStatus(repoPath, { forceRefresh: true });

  assert.equal(cached.branch, first.branch);
  assert.equal(refreshed.branch, 'feature/evidence');
});
