const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const configServiceSingleton = require('../src/main/services/configService');
const ConfigService = configServiceSingleton.constructor;

function git(repoPath, args) {
  return execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' }).trim();
}

function createRepo(root, name = 'repo') {
  const repoPath = path.join(root, name);
  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, ['init']);
  git(repoPath, ['config', 'user.email', 'gitfinder-test@example.invalid']);
  git(repoPath, ['config', 'user.name', 'GitFinder Test']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# test\n');
  git(repoPath, ['add', 'README.md']);
  git(repoPath, ['commit', '-m', 'initial']);
  return repoPath;
}

function createService(configDir) {
  const service = new ConfigService();
  service.configDir = configDir;
  return service;
}

test('仓库 ID 在新提交后保持稳定', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-identity-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const repoPath = createRepo(tempRoot);
  const service = createService(path.join(tempRoot, 'config'));

  const firstId = service.generateRepoId(repoPath);
  fs.writeFileSync(path.join(repoPath, 'second.txt'), 'second\n');
  git(repoPath, ['add', 'second.txt']);
  git(repoPath, ['commit', '-m', 'second']);
  const secondId = service.generateRepoId(repoPath);

  assert.equal(secondId, firstId);
});

test('仓库目录移动后重绑定原注册项并保留 ID', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-relocate-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const configDir = path.join(tempRoot, 'config');
  const oldPath = createRepo(tempRoot, 'old-name');
  const service = createService(configDir);

  service.setRepos([{ path: oldPath, name: 'old-name' }], 1);
  const oldId = service.getIdByPath(oldPath);
  const newPath = path.join(tempRoot, 'new-name');
  fs.renameSync(oldPath, newPath);
  service.setRepos([{ path: newPath, name: 'new-name' }], 2);

  const registry = service.getRegistry();
  assert.equal(registry.repos.length, 1);
  assert.equal(registry.repos[0].path, newPath);
  assert.equal(registry.repos[0].id, oldId);
  assert.equal(registry.repos[0].archived, false);
  assert.equal(service.getRepos().repos[0].id, oldId);
});

test('损坏的配置会保留备份并恢复为可写默认配置', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-corrupt-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(path.join(configDir, 'config.json'), '{broken json');
  const service = createService(configDir);

  const config = service.getConfig();
  const backups = fs.readdirSync(configDir).filter(name => name.startsWith('config.json.corrupt-'));

  assert.equal(config.viewMode, 'tree');
  assert.equal(backups.length, 1);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8')));
  assert.equal(fs.readdirSync(configDir).some(name => name.endsWith('.tmp')), false);
});

test('目录移动、归档和恢复会同步仓库、分类与收藏路径', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-rebind-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const oldParent = path.join(managedRoot, 'old-parent');
  fs.mkdirSync(managedRoot);
  const repoPath = createRepo(oldParent, 'repo');
  const service = createService(path.join(tempRoot, 'config'));
  service.addTreeRoot(managedRoot, 'managed');
  service.setRepos([{ path: repoPath, name: 'repo' }], 1);
  service.addFavorite({ type: 'dir', path: repoPath, name: 'repo' });
  const group = service.createGroup('Desktop', '#007AFF');
  const groupId = group.groups[0].id;
  service.addRepoToGroup(groupId, repoPath);
  const repoId = service.getIdByPath(repoPath);
  service.set('workspaceTabSession', {
    version: 1,
    activeTabId: 'tab-repo',
    tabs: [{
      id: 'tab-repo',
      path: repoPath,
      title: 'repo',
      mode: 'tree',
      history: [managedRoot, oldParent, repoPath],
      historyIndex: 2
    }],
    closedTabs: [{ id: 'closed-repo', path: repoPath, history: [repoPath], historyIndex: 0 }]
  });
  service.set('directoryViewPreferences', {
    [oldParent]: { style: 'list', sortBy: 'time', sortOrder: 'desc', columnWidth: 312, updatedAt: 100 },
    [repoPath]: { style: 'card', sortBy: 'name', sortOrder: 'asc', updatedAt: 200 }
  });
  const fileLabel = service.createFileLabel('待处理', '#ff5f57');
  service.updateFileLabelAssignments([repoPath, path.join(repoPath, 'README.md')], { addIds: [fileLabel.id] });

  const newParent = path.join(managedRoot, 'new-parent');
  fs.renameSync(oldParent, newParent);
  service.validateRebindPaths([{ from: oldParent, to: newParent }]);
  service.rebindPaths([{ from: oldParent, to: newParent }]);
  const newRepoPath = path.join(newParent, 'repo');

  assert.equal(service.getIdByPath(newRepoPath), repoId);
  assert.equal(service.getRepos().repos[0].path, newRepoPath);
  assert.equal(service.getFavorites()[0].path, newRepoPath);
  assert.deepEqual(service.getGroups().groups[0].repoPaths, [newRepoPath]);
  assert.equal(service.get('workspaceTabSession').tabs[0].path, newRepoPath);
  assert.deepEqual(service.get('workspaceTabSession').tabs[0].history, [managedRoot, newParent, newRepoPath]);
  assert.deepEqual(service.get('directoryViewPreferences'), {
    [newParent]: { style: 'list', sortBy: 'time', sortOrder: 'desc', columnWidth: 312, updatedAt: 100 },
    [newRepoPath]: { style: 'card', sortBy: 'name', sortOrder: 'asc', updatedAt: 200 }
  });
  assert.deepEqual(service.getFileLabelsForPaths([
    newRepoPath,
    path.join(newRepoPath, 'README.md')
  ]), {
    [newRepoPath]: [fileLabel],
    [path.join(newRepoPath, 'README.md')]: [fileLabel]
  });

  const snapshot = service.archivePaths([newParent]);
  assert.equal(service.listActive().some(repo => repo.id === repoId), false);
  assert.equal(service.getRepos().repos.length, 0);
  assert.equal(service.getFavorites().length, 0);
  assert.equal(snapshot.removedFavorites.length, 1);
  assert.equal(service.get('workspaceTabSession').tabs[0].path, managedRoot);
  assert.equal(service.get('workspaceTabSession').closedTabs.length, 0);
  assert.deepEqual(service.getFileLabels().assignments, {});
  assert.equal(Object.keys(snapshot.removedFileLabelAssignments).length, 2);

  service.restoreArchivedPaths([newParent], snapshot);
  assert.equal(service.listActive().some(repo => repo.id === repoId), true);
  assert.equal(service.getRepos().repos[0].path, newRepoPath);
  assert.equal(service.getFavorites()[0].path, newRepoPath);
  assert.deepEqual(service.getGroups().groups[0].repoPaths, [newRepoPath]);
  assert.equal(service.get('workspaceTabSession').tabs[0].path, newRepoPath);
  assert.equal(service.get('workspaceTabSession').closedTabs[0].path, newRepoPath);
  assert.deepEqual(service.getFileLabelsForPaths([newRepoPath])[newRepoPath], [fileLabel]);
});

test('文件夹收藏只接受真实受管目录，重复添加幂等且可原子切换', { skip: false }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-outside-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const directoryPath = path.join(managedRoot, 'folder');
  const filePath = path.join(managedRoot, 'README.md');
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(filePath, 'readme');
  const service = createService(path.join(tempRoot, 'config'));
  service.addTreeRoot(managedRoot, 'managed');

  service.addFavorite({ type: 'dir', path: directoryPath, name: '固定目录' });
  service.addFavorite({ type: 'directory', path: directoryPath, name: '重复目录' });
  assert.equal(service.getFavorites().length, 1);
  assert.deepEqual(service.getFavorites()[0], {
    id: directoryPath,
    type: 'directory',
    path: directoryPath,
    name: '固定目录',
    createdAt: service.getFavorites()[0].createdAt
  });

  assert.equal(service.toggleFavoriteDirectory(directoryPath).favorited, false);
  assert.equal(service.getFavorites().length, 0);
  assert.equal(service.toggleFavoriteDirectory(directoryPath).favorited, true);
  assert.equal(service.getFavorites().length, 1);

  assert.throws(() => service.addFavorite({ path: 'relative/path' }), /绝对目录/);
  assert.throws(() => service.addFavorite({ path: outsideRoot }), /已添加位置/);
  assert.throws(() => service.addFavorite({ path: filePath }), /真实文件夹/);
  if (process.platform !== 'win32') {
    const escapedPath = path.join(managedRoot, 'escaped');
    fs.symlinkSync(outsideRoot, escapedPath, 'dir');
    assert.throws(() => service.addFavorite({ path: escapedPath }), /符号链接/);
  }
});

test('渲染层配置写入只允许偏好键，不能替换受管根或收藏', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-renderer-config-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  fs.mkdirSync(managedRoot);
  const service = createService(path.join(tempRoot, 'config'));
  service.addTreeRoot(managedRoot, 'managed');

  service.setRendererPreference('cardStyle', 'list');
  assert.equal(service.get('cardStyle'), 'list');
  service.setRendererPreference('columnViewWidth', 320);
  assert.equal(service.get('columnViewWidth'), 320);
  service.setRendererPreference('semanticColorProfile', {
    preset: 'custom',
    colors: { folder: '#ABCDEF', project: 'invalid', gitBadge: '#7654A1', gitMark: '#FFFFFF', extra: '#000000' },
    lifecycle: { active: '#123456', frozen: 'invalid', extra: '#000000' },
    extra: true
  });
  const semanticColors = service.get('semanticColorProfile');
  assert.equal(semanticColors.colors.folder, '#abcdef');
  assert.equal(semanticColors.colors.project, '#0a84ff');
  assert.equal(semanticColors.colors.gitBadge, '#7654a1');
  assert.equal(semanticColors.lifecycle.active, '#123456');
  assert.equal(Object.hasOwn(semanticColors.colors, 'extra'), false);
  assert.equal(Object.hasOwn(semanticColors, 'extra'), false);
  service.setRendererPreference('smartCollections', {
    version: 1,
    collections: [{ id: 'collection_one', name: '开发中项目', query: { scope: 'all', projectOnly: true } }]
  });
  assert.equal(service.get('smartCollections').collections[0].id, 'collection_one');
  service.setRendererPreference('projectShortcuts', {
    version: 1,
    pinned: [{
      projectId: 'project_11111111-1111-4111-8111-111111111111',
      name: 'Alpha',
      path: '/must-not-persist'
    }],
    recent: []
  });
  assert.deepEqual(service.get('projectShortcuts').pinned, [{
    projectId: 'project_11111111-1111-4111-8111-111111111111',
    name: 'Alpha'
  }]);
  service.setRendererPreference('projectShortcutPreferences', {
    visible: false,
    showRecent: true,
    recentLimit: '5',
    path: '/must-not-persist'
  });
  assert.deepEqual(service.get('projectShortcutPreferences'), {
    visible: false,
    showRecent: true,
    recentLimit: 5
  });
  assert.throws(() => service.setRendererPreference('treeRoots', []), /不允许/);
  assert.throws(() => service.setRendererPreference('favorites', []), /不允许/);
  assert.throws(() => service.setRendererPreference('themeMode', 'x'.repeat(2 * 1024 * 1024 + 1)), /大小限制/);
  assert.deepEqual(service.getTreeRoots(), [{ path: managedRoot, name: 'managed', expanded: true }]);
});

test('受管根必须是真实存在目录且界面更新不能改写路径', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-tree-root-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const directoryPath = path.join(tempRoot, 'workspace');
  const filePath = path.join(tempRoot, 'README.md');
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(filePath, 'readme');
  const service = createService(path.join(tempRoot, 'config'));

  assert.throws(() => service.addTreeRoot('relative/path'), /绝对路径/);
  assert.throws(() => service.addTreeRoot(filePath), /必须是文件夹/);
  assert.throws(() => service.addTreeRoot(path.join(tempRoot, 'missing')), /不存在/);
  service.addTreeRoot(directoryPath, ' Workspace ');
  service.updateTreeRoot(directoryPath, { path: tempRoot, expanded: false, name: '开发目录' });
  assert.deepEqual(service.getTreeRoots(), [{ path: directoryPath, name: '开发目录', expanded: false }]);
});

test('路径配置事务中途写入失败会恢复全部文件和内存快照', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-config-rollback-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const oldPath = createRepo(managedRoot, 'before');
  const newPath = path.join(managedRoot, 'after');
  const service = createService(path.join(tempRoot, 'config'));
  service.addTreeRoot(managedRoot, 'managed');
  service.setRepos([{ path: oldPath, name: 'before' }], 1);
  service.addFavorite({ type: 'dir', path: oldPath, name: 'before' });
  fs.renameSync(oldPath, newPath);

  const originalWrite = service._writeJsonFileAtomic.bind(service);
  let injected = false;
  service._writeJsonFileAtomic = (filePath, value) => {
    if (!injected && filePath === service.reposFile && value?.repos?.some(repo => repo.path === newPath)) {
      injected = true;
      throw new Error('injected config write failure');
    }
    return originalWrite(filePath, value);
  };

  assert.throws(
    () => service.rebindPaths([{ from: oldPath, to: newPath }]),
    /injected config write failure/
  );
  assert.equal(service.getRegistry().repos[0].path, oldPath);
  assert.equal(service.getRepos().repos[0].path, oldPath);
  assert.equal(service.getFavorites()[0].path, oldPath);
  assert.equal(JSON.parse(fs.readFileSync(service.registryFile, 'utf8')).repos[0].path, oldPath);
  assert.equal(JSON.parse(fs.readFileSync(service.reposFile, 'utf8')).repos[0].path, oldPath);
  assert.equal(JSON.parse(fs.readFileSync(service.configFile, 'utf8')).favorites[0].path, oldPath);
  assert.equal(fs.existsSync(service.transactionFile), false);
});

test('启动时会把中断的路径配置事务一致地向前恢复', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-config-recovery-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const oldPath = createRepo(managedRoot, 'before');
  const newPath = path.join(managedRoot, 'after');
  const configDir = path.join(tempRoot, 'config');
  const service = createService(configDir);
  service.addTreeRoot(managedRoot, 'managed');
  service.setRepos([{ path: oldPath, name: 'before' }], 1);
  service.addFavorite({ type: 'dir', path: oldPath, name: 'before' });
  const groupId = service.createGroup('Desktop', '#7357bd').groups[0].id;
  service.addRepoToGroup(groupId, oldPath);
  const keys = ['registry', 'repos', 'config'];
  const before = service._snapshotConfigTransactionFiles(keys);

  fs.renameSync(oldPath, newPath);
  service.rebindPaths([{ from: oldPath, to: newPath }]);
  const after = service._snapshotConfigTransactionFiles(keys);
  for (const item of before) {
    service._writeJsonFileAtomic(service._configTransactionFilePath(item.key), item.value);
  }
  service._writeJsonFileAtomic(service.registryFile, after.find(item => item.key === 'registry').value);
  const afterByKey = new Map(after.map(item => [item.key, item.value]));
  const journal = {
    version: 1,
    id: 'config_recovery_test',
    operation: 'rebind-paths',
    phase: 'prepared',
    createdAt: Date.now(),
    files: before.map(item => ({ key: item.key, before: item.value, after: afterByKey.get(item.key) }))
  };
  service._writeConfigTransactionJournal(journal);

  const restarted = createService(configDir);
  const recovery = restarted.getConfigTransactionRecoveryStatus();

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.action, 'rolled-forward');
  assert.equal(recovery.operation, 'rebind-paths');
  assert.equal(restarted.getRegistry().repos[0].path, newPath);
  assert.equal(restarted.getRepos().repos[0].path, newPath);
  assert.equal(restarted.getFavorites()[0].path, newPath);
  assert.deepEqual(restarted.getGroups().groups[0].repoPaths, [newPath]);
  assert.equal(fs.existsSync(path.join(configDir, 'config-transaction.json')), false);
});

test('损坏的配置事务记录会原样保留并拒绝后续路径修改', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-config-corrupt-transaction-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const configDir = path.join(tempRoot, 'config');
  const service = createService(configDir);
  service.getConfig();
  service.getRepos();
  service.getRegistry();
  const journalPath = path.join(configDir, 'config-transaction.json');
  fs.writeFileSync(journalPath, '{broken transaction', { mode: 0o600 });

  const restarted = createService(configDir);
  const recovery = restarted.getConfigTransactionRecoveryStatus();

  assert.equal(recovery.needsReview, true);
  assert.match(recovery.error, /JSON|Unexpected|position/i);
  assert.equal(fs.readFileSync(journalPath, 'utf8'), '{broken transaction');
  restarted.getConfig();
  restarted.getRepos();
  restarted.getRegistry();
  const snapshot = restarted._snapshotConfigTransactionFiles(['registry', 'repos', 'config']);
  assert.throws(
    () => restarted._commitConfigTransaction('test-refused', snapshot, snapshot),
    /存在未解决的配置事务/
  );
  assert.equal(fs.readFileSync(journalPath, 'utf8'), '{broken transaction');
});
