#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gitService = require('../src/main/services/gitService');

function git(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-batch-benchmark-'));
  const template = path.join(root, 'template');
  const repositoryCount = 40;
  try {
    fs.mkdirSync(template);
    git(template, ['init', '-q']);
    git(template, ['config', 'user.email', 'gitfinder-benchmark@example.invalid']);
    git(template, ['config', 'user.name', 'GitFinder Benchmark']);
    fs.writeFileSync(path.join(template, 'README.md'), '# benchmark\n');
    git(template, ['add', '--all']);
    git(template, ['commit', '-q', '-m', 'initial']);

    const repoPaths = [];
    for (let index = 0; index < repositoryCount; index += 1) {
      const repoPath = path.join(root, `repo-${String(index).padStart(2, '0')}`);
      fs.cpSync(template, repoPath, { recursive: true });
      if (index % 5 === 0) fs.appendFileSync(path.join(repoPath, 'README.md'), `dirty ${index}\n`);
      repoPaths.push(repoPath);
    }

    gitService.clearAllCache();
    const startedAt = process.hrtime.bigint();
    const result = await gitService.batchStatus(repoPaths, {
      requestId: `benchmark-${Date.now()}`,
      concurrency: 6,
      forceRefresh: true,
      includeSummary: true
    });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const dirty = result.results.filter(item => item.status.overallStatus === 'dirty').length;

    assert.equal(result.cancelled, false);
    assert.equal(result.completed, repositoryCount);
    assert.equal(result.results.length, repositoryCount);
    assert.equal(dirty, repositoryCount / 5);
    assert.equal(result.results.every(item => item.status.isGitRepo === true), true);

    process.stdout.write(`${JSON.stringify({
      repositories: repositoryCount,
      concurrency: 6,
      gitFetches: 0,
      dirty,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      repositoriesPerSecond: Number((repositoryCount / (elapsedMs / 1000)).toFixed(1))
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
