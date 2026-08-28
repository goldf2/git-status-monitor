const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileService = require('../src/main/services/fileService');
const { FileService } = fileService;

test('异步仓库扫描跳过依赖目录并返回未预转义的 README 文本', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-scan-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const repoPath = path.join(tempRoot, 'repo');
  const ignoredPath = path.join(tempRoot, 'node_modules', 'ignored');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(ignoredPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Repo\n\nR&D <b>safe</b>\n');

  const repos = await fileService.findGitRepos(tempRoot, { depth: 3 });

  assert.equal(repos.length, 1);
  assert.equal(repos[0].path, repoPath);
  assert.equal(repos[0].readme.description, 'R&D safe');
});

test('受管根本身是 Git 仓库时也进入扫描结果，并继续发现独立子仓库', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-root-repo-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const childRepo = path.join(tempRoot, 'packages', 'child');
  fs.mkdirSync(path.join(tempRoot, '.git'));
  fs.mkdirSync(path.join(childRepo, '.git'), { recursive: true });

  const repos = await fileService.findGitRepos(tempRoot, { depth: 3 });

  assert.deepEqual(repos.map(repo => repo.path), [tempRoot, childRepo]);
  assert.equal(repos[0].name, path.basename(tempRoot));
  assert.equal(repos[0].isGitRepo, true);
});

test('目录浏览可显示隐藏项目和依赖目录，同时递归扫描仍跳过依赖目录', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-hidden-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempRoot, '.env'), 'TOKEN=local-only\n');
  fs.mkdirSync(path.join(tempRoot, '.config'));
  fs.mkdirSync(path.join(tempRoot, 'node_modules', 'package'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'visible.txt'), 'visible\n');

  const defaultItems = fileService.listDirectory(tempRoot);
  assert.deepEqual(defaultItems.map(item => item.name), ['node_modules', 'visible.txt']);

  const visibleItems = fileService.listDirectory(tempRoot, { showHidden: true });
  assert.deepEqual(visibleItems.map(item => item.name), ['.config', 'node_modules', '.env', 'visible.txt']);
  assert.equal(visibleItems.find(item => item.name === '.env').isHidden, true);
  assert.equal(visibleItems.find(item => item.name === 'visible.txt').isHidden, false);

  const recursiveItems = fileService.listDirectory(tempRoot, { showHidden: true, recursive: true });
  assert.equal(recursiveItems.some(item => item.name === 'node_modules'), false);
});

test('顶层目录读取失败必须上报，不能把断开位置伪装成空目录', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-list-error-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const missingPath = path.join(tempRoot, 'detached');
  const service = new FileService({ getTreeRoots: () => [{ path: missingPath }] });

  assert.throws(() => service.listDirectory(missingPath), error => error?.code === 'ENOENT');
});

test('工作区目录校验只接受可用受管目录并提供安全祖先回退', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-workspace-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-workspace-outside-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const projectPath = path.join(tempRoot, 'project');
  const missingRoot = `${tempRoot}-missing-root`;
  const disconnectedProject = path.join(missingRoot, 'project');
  const deletedPath = path.join(projectPath, 'deleted');
  const filePath = path.join(projectPath, 'README.md');
  fs.mkdirSync(projectPath);
  fs.writeFileSync(filePath, 'readme');

  const service = new FileService({
    getTreeRoots: () => [{ path: tempRoot }, { path: missingRoot }]
  });
  const inspection = service.inspectWorkspaceDirectories([
    projectPath,
    disconnectedProject,
    deletedPath,
    filePath,
    outsideRoot,
    'relative/path'
  ]);
  const byPath = new Map(inspection.directories.map(item => [item.path, item]));

  assert.deepEqual(inspection.availableRoots, [tempRoot]);
  assert.equal(byPath.get(projectPath).available, true);
  assert.equal(byPath.get(projectPath).availability, 'available');
  assert.equal(byPath.get(projectPath).configuredRootPath, tempRoot);
  assert.equal(byPath.get(projectPath).rootAvailable, true);
  assert.equal(byPath.get(disconnectedProject).available, false);
  assert.equal(byPath.get(disconnectedProject).availability, 'root-unavailable');
  assert.equal(byPath.get(disconnectedProject).configuredRootPath, missingRoot);
  assert.equal(byPath.get(disconnectedProject).managedRootPath, '');
  assert.equal(byPath.get(disconnectedProject).rootAvailable, false);
  assert.equal(byPath.get(deletedPath).available, false);
  assert.equal(byPath.get(deletedPath).availability, 'path-unavailable');
  assert.equal(byPath.get(deletedPath).nearestAvailablePath, projectPath);
  assert.equal(byPath.get(filePath).available, false);
  assert.equal(byPath.get(filePath).nearestAvailablePath, projectPath);
  assert.equal(byPath.get(outsideRoot).managedRootPath, '');
  assert.equal(byPath.has('relative/path'), false);
});

test('工作区目录校验拒绝通过受管根内部符号链接逃逸', { skip: process.platform === 'win32' }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-workspace-symlink-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-workspace-symlink-outside-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const escapedPath = path.join(tempRoot, 'escaped');
  fs.symlinkSync(outsideRoot, escapedPath, 'dir');

  const service = new FileService({ getTreeRoots: () => [{ path: tempRoot }] });
  const inspection = service.inspectWorkspaceDirectories([escapedPath]);

  assert.equal(inspection.directories[0].available, false);
  assert.equal(inspection.directories[0].nearestAvailablePath, tempRoot);
  assert.equal(service.resolveWorkspaceDirectory(escapedPath).code, 'unsafe-or-unavailable');
});

test('前往文件夹解析接受受管绝对路径、成对引号和用户主目录缩写', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-go-to-root-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const nestedPath = path.join(tempRoot, 'project', 'src');
  fs.mkdirSync(nestedPath, { recursive: true });
  const service = new FileService({ getTreeRoots: () => [{ path: tempRoot }] });

  assert.deepEqual(service.resolveWorkspaceDirectory(`"${nestedPath}"`), {
    ok: true,
    path: nestedPath,
    managedRootPath: tempRoot
  });

  const homeService = new FileService({ getTreeRoots: () => [{ path: os.homedir() }] });
  assert.equal(homeService.resolveWorkspaceDirectory('~').path, path.normalize(os.homedir()));
});

test('前往文件夹解析区分相对路径、受管根外、普通文件和缺失目录', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-go-to-bounds-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-go-to-outside-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const filePath = path.join(tempRoot, 'README.md');
  fs.writeFileSync(filePath, 'readme');
  const service = new FileService({ getTreeRoots: () => [{ path: tempRoot }] });

  assert.equal(service.resolveWorkspaceDirectory('relative/path').code, 'not-absolute');
  assert.equal(service.resolveWorkspaceDirectory(outsideRoot).code, 'outside-managed-root');
  assert.equal(service.resolveWorkspaceDirectory(filePath).code, 'not-directory');
  assert.equal(service.resolveWorkspaceDirectory(path.join(tempRoot, 'missing')).code, 'not-found');
  assert.equal(service.resolveWorkspaceDirectory('\0invalid').code, 'invalid');
});

test('前往已登记但暂时断开的受管根返回可重连提示，而不是误报为受管范围外', () => {
  const missingRoot = path.resolve(os.tmpdir(), `gitfinder-disconnected-${process.pid}`);
  const service = new FileService({ getTreeRoots: () => [{ path: missingRoot }] });
  const result = service.resolveWorkspaceDirectory(path.join(missingRoot, 'project'));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'root-unavailable');
  assert.match(result.message, /受管位置|重新连接/);
});

test('收藏夹目录信息使用一次受管批量检查并只丰富仍可用目录', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-info-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const repoPath = path.join(tempRoot, 'repo');
  const missingPath = path.join(tempRoot, 'missing');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  const service = new FileService({ getTreeRoots: () => [{ path: tempRoot }] });

  const result = service.getWorkspaceDirectoryInfos([repoPath, missingPath]);
  const byPath = new Map(result.directories.map(item => [item.path, item]));
  assert.equal(byPath.get(repoPath).available, true);
  assert.equal(byPath.get(repoPath).info.type, 'directory');
  assert.equal(byPath.get(repoPath).info.isGitRepo, true);
  assert.equal(byPath.get(missingPath).available, false);
  assert.equal(byPath.get(missingPath).info, null);
});

test('既有收藏可安全解析受管根外目录，但不能借接口读取任意路径', (t) => {
  const managedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-managed-'));
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-legacy-'));
  const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-favorite-unrelated-'));
  t.after(() => fs.rmSync(managedRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(legacyRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(unrelatedRoot, { recursive: true, force: true }));
  const service = new FileService({
    getTreeRoots: () => [{ path: managedRoot }],
    getFavorites: () => [{ type: 'dir', path: legacyRoot }]
  });

  const result = service.inspectFavoriteDirectories([legacyRoot, unrelatedRoot]);
  assert.deepEqual(result.directories.map(item => item.path), [legacyRoot]);
  assert.equal(result.directories[0].available, true);
  assert.equal(service.resolveFavoriteDirectory(legacyRoot).ok, true);
  assert.equal(service.resolveFavoriteDirectory(unrelatedRoot).code, 'not-favorite');
});

test('项目文档读写只允许真实受管目录并拒绝符号链接目标', { skip: process.platform === 'win32' }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-project-docs-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const projectPath = path.join(managedRoot, 'project');
  const outsidePath = path.join(tempRoot, 'outside');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.mkdirSync(outsidePath);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });

  service.saveMarkdownDocument(projectPath, 'PROJECT_NOTES.md', '# notes\n');
  assert.equal(service.readMarkdownDocument(projectPath, 'PROJECT_NOTES.md').content, '# notes\n');
  assert.throws(() => service.saveMarkdownDocument(outsidePath, 'PROJECT_NOTES.md', 'outside'), /不在可写受管位置/);
  assert.equal(fs.existsSync(path.join(outsidePath, 'PROJECT_NOTES.md')), false);

  const outsideFile = path.join(outsidePath, 'outside.md');
  const linkedFile = path.join(projectPath, 'LINKED.md');
  fs.writeFileSync(outsideFile, 'protected');
  fs.symlinkSync(outsideFile, linkedFile);
  assert.throws(() => service.saveMarkdownDocument(projectPath, 'LINKED.md', 'changed'), /符号链接/);
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'protected');

  const agentsOutside = path.join(outsidePath, 'AGENTS.md');
  fs.writeFileSync(agentsOutside, '# protected\n');
  fs.symlinkSync(agentsOutside, path.join(projectPath, 'AGENTS.md'));
  assert.throws(() => service.syncProjectControlAgentRules(projectPath, { progressFile: 'PROJECT_PROGRESS.csv' }), /符号链接/);
  assert.equal(fs.readFileSync(agentsOutside, 'utf8'), '# protected\n');
});

test('受管文件解析接受真实文件并拒绝越界和符号链接逃逸', { skip: process.platform === 'win32' }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-managed-path-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(managedRoot);
  fs.mkdirSync(outsideRoot);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const filePath = path.join(managedRoot, 'README.md');
  fs.writeFileSync(filePath, 'readme');
  fs.symlinkSync(outsideRoot, path.join(managedRoot, 'escape'), 'dir');
  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });

  assert.deepEqual(service.resolveWorkspacePath(filePath), {
    ok: true,
    path: filePath,
    type: 'file',
    managedRootPath: managedRoot
  });
  assert.equal(service.resolveWorkspacePath(outsideRoot).code, 'outside-managed-root');
  assert.equal(service.resolveWorkspacePath(path.join(managedRoot, 'escape')).code, 'symlink-escape');
});
