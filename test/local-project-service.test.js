const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const localProjectServiceSingleton = require('../src/main/services/localProjectService');
const LocalProjectService = localProjectServiceSingleton.constructor;

function createFixture(t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-project-'));
  const managedRoot = path.join(tempRoot, 'managed');
  fs.mkdirSync(managedRoot);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const configService = { getTreeRoots: () => [{ path: managedRoot, name: 'managed' }] };
  return {
    tempRoot,
    managedRoot,
    service: new LocalProjectService({ configService })
  };
}

function createRepo(directory) {
  fs.mkdirSync(path.join(directory, '.git'), { recursive: true });
}

test('设为项目只创建便携 project.json，不初始化 Git，并保持稳定 projectId', (t) => {
  const { managedRoot, service } = createFixture(t);
  const projectRoot = path.join(managedRoot, '普通目录');
  fs.mkdirSync(projectRoot);

  const first = service.initializeProject(projectRoot, { color: 'purple', lifecycle: 'active' });
  const second = service.initializeProject(projectRoot, { name: '不会覆盖' });
  const manifestPath = path.join(projectRoot, '.gitfinder', 'project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.project.projectId, first.project.projectId);
  assert.match(first.project.projectId, /^project_[0-9a-f-]{36}$/);
  assert.equal(manifest.name, '普通目录');
  assert.equal(manifest.color, 'purple');
  assert.equal(manifest.lifecycle, 'active');
  assert.deepEqual(manifest.repositories, { excluded: [] });
  assert.equal(fs.existsSync(path.join(projectRoot, '.git')), false);
});

test('项目设置保留 projectId，只接受相对排除路径', (t) => {
  const { managedRoot, service } = createFixture(t);
  const projectRoot = path.join(managedRoot, 'workspace');
  fs.mkdirSync(projectRoot);
  const created = service.initializeProject(projectRoot, {});

  const updated = service.updateProject(projectRoot, {
    name: '统一工作区',
    description: '包含多个交付仓库',
    color: 'green',
    lifecycle: 'maintenance',
    excludedRepositories: ['vendor/reference', './examples/demo', 'vendor/reference']
  });

  assert.equal(updated.projectId, created.project.projectId);
  assert.equal(updated.name, '统一工作区');
  assert.deepEqual(updated.repositories.excluded, ['examples/demo', 'vendor/reference']);
  assert.throws(
    () => service.updateProject(projectRoot, { excludedRepositories: ['/tmp/outside'] }),
    /相对路径/
  );
  assert.throws(
    () => service.updateProject(projectRoot, { excludedRepositories: ['../outside'] }),
    /项目目录内部/
  );
});

test('项目可聚合零个或多个仓库，排除目录不会进入结果', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const emptyProject = path.join(managedRoot, 'empty');
  const multiProject = path.join(managedRoot, 'multi');
  fs.mkdirSync(emptyProject);
  fs.mkdirSync(path.join(multiProject, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(multiProject, 'services', 'api'), { recursive: true });
  fs.mkdirSync(path.join(multiProject, 'vendor', 'reference'), { recursive: true });
  service.initializeProject(emptyProject, {});
  service.initializeProject(multiProject, { excludedRepositories: ['vendor/reference'] });
  createRepo(path.join(multiProject, 'apps', 'web'));
  createRepo(path.join(multiProject, 'services', 'api'));
  createRepo(path.join(multiProject, 'vendor', 'reference'));

  const projects = await service.listProjects();
  const empty = projects.find(project => project.path === emptyProject);
  const multi = projects.find(project => project.path === multiProject);

  assert.deepEqual(empty.repositories, []);
  assert.deepEqual(multi.repositories.map(repo => repo.relativePath), ['apps/web', 'services/api']);
  assert.equal(multi.repositoryCount, 2);
  assert.equal(Number.isFinite(Date.parse(multi.modifiedTime)), true);
  assert.equal(multi.repositories.every(repo => !path.isAbsolute(repo.relativePath)), true);
});

test('嵌套 project.json 建立独立子项目并截断父项目仓库扫描', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const parentRoot = path.join(managedRoot, 'parent');
  const parentRepo = path.join(parentRoot, 'packages', 'one');
  const childRoot = path.join(parentRoot, 'child');
  const childRepo = path.join(childRoot, 'repo');
  fs.mkdirSync(parentRepo, { recursive: true });
  fs.mkdirSync(childRepo, { recursive: true });
  service.initializeProject(parentRoot, { name: 'Parent' });
  service.initializeProject(childRoot, { name: 'Child' });
  createRepo(parentRepo);
  createRepo(childRoot);
  createRepo(childRepo);

  const projects = await service.listProjects();
  const parent = projects.find(project => project.path === parentRoot);
  const child = projects.find(project => project.path === childRoot);

  assert.deepEqual(parent.repositories.map(repo => repo.relativePath), ['packages/one']);
  assert.deepEqual(child.repositories.map(repo => repo.relativePath), ['.', 'repo']);
  assert.equal(projects.filter(project => [parentRoot, childRoot].includes(project.path)).length, 2);
});

test('Git 仓库不会自动成为项目，目录条目只叠加项目元数据', (t) => {
  const { managedRoot, service } = createFixture(t);
  const plainRepo = path.join(managedRoot, 'clone');
  const projectRepo = path.join(managedRoot, 'product');
  fs.mkdirSync(plainRepo);
  fs.mkdirSync(projectRepo);
  createRepo(plainRepo);
  createRepo(projectRepo);
  service.initializeProject(projectRepo, { color: 'orange' });

  const plain = service.describeDirectory(plainRepo);
  const project = service.describeDirectory(projectRepo);

  assert.deepEqual(plain, { isProject: false, project: null });
  assert.equal(project.isProject, true);
  assert.equal(project.project.color, 'orange');
});

test('项目清单不能通过符号链接写到受管根之外', (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside');
  const link = path.join(managedRoot, 'linked');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, 'dir');

  assert.throws(() => service.initializeProject(link, {}), /符号链接|受管开发目录/);
  assert.equal(fs.existsSync(path.join(outside, '.gitfinder')), false);
});
