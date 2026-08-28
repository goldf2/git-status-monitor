const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isManagedRepoPath } = require('../src/main/ipc/git');

test('Git 审查路径必须位于真实受管根目录内，符号链接不能逃逸', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-git-ipc-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const repoPath = path.join(managedRoot, 'repo');
  const outsidePath = path.join(tempRoot, 'outside');
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(outsidePath);
  fs.symlinkSync(outsidePath, path.join(managedRoot, 'escaped-link'));

  assert.equal(isManagedRepoPath(repoPath, [{ path: managedRoot }]), true);
  assert.equal(isManagedRepoPath(outsidePath, [{ path: managedRoot }]), false);
  assert.equal(isManagedRepoPath(path.join(managedRoot, 'escaped-link'), [{ path: managedRoot }]), false);
  assert.equal(isManagedRepoPath('relative/repo', [{ path: managedRoot }]), false);
});
