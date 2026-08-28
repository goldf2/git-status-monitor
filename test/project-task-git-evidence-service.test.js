const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProjectTaskGitEvidenceService
} = require('../src/main/services/projectTaskGitEvidenceService');

function createFixture(t, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-task-git-evidence-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const repoPath = path.join(managedRoot, 'repo');
  fs.mkdirSync(repoPath, { recursive: true });

  const task = {
    key: 'PRJ-ONE:TASK-42',
    projectId: 'PRJ-ONE',
    projectName: 'Example',
    taskId: 'TASK-42',
    title: 'Build evidence bridge',
    evidence: options.evidence || [],
    repositories: options.repositories || [{
      id: 'REPO-ONE',
      name: 'Repo One',
      path: repoPath,
      available: true,
      relation: 'evidence',
      notes: 'Task evidence repository'
    }]
  };
  const projectionService = {
    getPortfolio: async () => ({ success: true, readOnly: true, tasks: [task] })
  };
  const calls = { status: 0, workingTree: 0, log: 0, statusOptions: [] };
  let branch = 'main';
  const gitService = {
    getStatus: async (_repoPath, statusOptions) => {
      calls.status += 1;
      calls.statusOptions.push(statusOptions);
      return {
        isGitRepo: true,
        branch,
        overallStatus: 'dirty',
        ahead: 2,
        behind: 1,
        staged: 1,
        modified: 2,
        untracked: 1,
        hasRemote: true,
        upstream: 'origin/main',
        lastCommit: { hash: 'abc1234', message: 'TASK-42 complete bridge', timestamp: 100, author: 'AI' }
      };
    },
    getWorkingTree: () => {
      calls.workingTree += 1;
      return {
        success: true,
        stagedCount: 1,
        unstagedCount: 3,
        conflictCount: 0,
        totalCount: 3,
        limited: false,
        files: [
          { path: 'src/a.js', kind: 'modified', staged: true, unstaged: false, untracked: false, conflict: false },
          { path: 'src/b.js', kind: 'modified', staged: false, unstaged: true, untracked: false, conflict: false },
          { path: 'test/new.test.js', kind: 'untracked', staged: false, unstaged: true, untracked: true, conflict: false }
        ]
      };
    },
    getLog: () => {
      calls.log += 1;
      return [
        { hash: 'abc1234', message: 'TASK-42 complete bridge', timestamp: 100, author: 'AI' },
        { hash: 'def5678', message: 'unrelated maintenance', timestamp: 90, author: 'AI' }
      ];
    }
  };
  const configService = { getTreeRoots: () => [{ path: managedRoot, name: 'Managed' }] };
  return {
    tempRoot,
    managedRoot,
    repoPath,
    task,
    calls,
    gitService,
    projectionService,
    configService,
    setBranch: value => { branch = value; }
  };
}

test('只读证据桥聚合当前 Git 实况，只将明确任务 ID 视为关联提交', async (t) => {
  const fixture = createFixture(t);
  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService,
    now: () => new Date('2026-08-26T06:00:00Z')
  });

  const result = await service.getTaskEvidence(fixture.task.key);
  assert.equal(result.success, true, result.error);
  assert.equal(result.readOnly, true);
  assert.equal(result.task.taskId, 'TASK-42');
  assert.equal(result.repositories.length, 1);
  const repository = result.repositories[0];
  assert.equal(repository.git.branch, 'main');
  assert.equal(repository.git.workingTree.totalCount, 3);
  assert.equal(repository.git.workingTree.files.length, 3);
  assert.equal(repository.git.recentCommits.length, 2);
  assert.equal(repository.git.matchedCommits.length, 1);
  assert.equal(repository.git.matchedCommits[0].hash, 'abc1234');
  assert.equal(repository.git.matchedCommits[0].attribution, 'task-id');
  assert.equal(repository.git.attributionRule, 'exact-task-id-or-declared-hash');
  assert.deepEqual(fixture.calls.statusOptions, [{ autoFetch: false, forceRefresh: false }]);
});

test('缓存避免反复扫描仓库，强制刷新会重读 Git 实况', async (t) => {
  const fixture = createFixture(t);
  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService
  });

  const first = await service.getTaskEvidence(fixture.task.key);
  fixture.setBranch('feature/evidence');
  const cached = await service.getTaskEvidence(fixture.task.key);
  const refreshed = await service.getTaskEvidence(fixture.task.key, { forceRefresh: true });

  assert.equal(first.repositories[0].git.branch, 'main');
  assert.equal(cached.repositories[0].git.branch, 'main');
  assert.equal(refreshed.repositories[0].git.branch, 'feature/evidence');
  assert.equal(fixture.calls.status, 2);
  assert.equal(fixture.calls.statusOptions[1].forceRefresh, true);
});

test('未知任务不能触发仓库读取', async (t) => {
  const fixture = createFixture(t);
  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService
  });

  const result = await service.getTaskEvidence('PRJ-ONE:UNKNOWN');
  assert.equal(result.success, false);
  assert.match(result.error, /任务不存在/);
  assert.equal(fixture.calls.status, 0);
  assert.equal(fixture.calls.workingTree, 0);
  assert.equal(fixture.calls.log, 0);
});

test('关联仓库通过符号链接逃逸受管根时拒绝读取', async (t) => {
  const fixture = createFixture(t);
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-task-git-outside-'));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  fs.rmSync(fixture.repoPath, { recursive: true, force: true });
  fs.symlinkSync(outsideRoot, fixture.repoPath);

  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService
  });
  const result = await service.getTaskEvidence(fixture.task.key);

  assert.equal(result.success, true);
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].success, false);
  assert.match(result.repositories[0].error, /符号链接/);
  assert.equal(fixture.calls.status, 0);
});

test('投影显式声明的提交 hash 可作为强关联证据', async (t) => {
  const fixture = createFixture(t, {
    evidence: [{ id: 'E-1', type: 'commit', summary: 'Verified commit', reference: 'commit:def5678' }]
  });
  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService
  });
  const result = await service.getTaskEvidence(fixture.task.key);
  const declared = result.repositories[0].git.matchedCommits.find(commit => commit.hash === 'def5678');
  assert.equal(declared.attribution, 'declared-hash');
});

test('相似但不完全相同的任务 ID 不会被误归因', async (t) => {
  const fixture = createFixture(t);
  fixture.gitService.getLog = () => [
    { hash: 'abc1234', message: 'TASK-420 is a different task', timestamp: 100, author: 'AI' },
    { hash: '', message: 'invalid commit record', timestamp: 90, author: 'AI' }
  ];
  const service = new ProjectTaskGitEvidenceService({
    projectTaskProjectionService: fixture.projectionService,
    gitService: fixture.gitService,
    configService: fixture.configService
  });

  const result = await service.getTaskEvidence(fixture.task.key);
  assert.deepEqual(result.repositories[0].git.matchedCommits, []);
});
