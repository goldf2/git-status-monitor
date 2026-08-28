const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, shell } = require('electron');

const localProjectSingleton = require('../src/main/services/localProjectService');
const LocalProjectService = localProjectSingleton.constructor;
const { FileOperationService } = require('../src/main/services/fileOperationService');

async function verify() {
  if (process.platform !== 'win32') throw new Error('Windows 运行时验收必须在 Windows runner 上执行');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-windows-runtime-'));
  const managedRoot = path.join(temporaryRoot, 'managed');
  const projectRoot = path.join(managedRoot, 'portable-project');
  const repositoryRoot = path.join(projectRoot, 'packages', 'api');
  const copyDestination = path.join(managedRoot, 'copies');
  const moveDestination = path.join(managedRoot, 'moved');
  const historyDir = path.join(temporaryRoot, 'history');
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.mkdirSync(copyDestination);
  fs.mkdirSync(moveDestination);

  const configCalls = [];
  const configService = {
    getTreeRoots: () => [{ path: managedRoot, name: 'managed' }],
    validateRebindPaths: mappings => configCalls.push({ type: 'validate', mappings }),
    rebindPaths: mappings => configCalls.push({ type: 'rebind', mappings }),
    archivePaths: paths => {
      configCalls.push({ type: 'archive', paths });
      return {};
    },
    restoreArchivedPaths: () => {}
  };
  const projectService = new LocalProjectService({ configService });
  const fileOperations = new FileOperationService({
    configService,
    historyDir,
    platform: 'win32',
    systemTrashItem: candidatePath => shell.trashItem(candidatePath),
    spaceReserveBytes: 0
  });

  try {
    const initialized = projectService.initializeProject(projectRoot, {
      name: 'Portable project',
      color: 'purple',
      excludedRepositories: ['vendor\\reference']
    });
    const manifestPath = path.join(projectRoot, '.gitfinder', 'project.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!initialized.created || manifest.repositories.excluded[0] !== 'vendor/reference') {
      throw new Error('便携项目配置未正确规范化为相对 POSIX 路径');
    }
    if (JSON.stringify(manifest).includes(managedRoot)) throw new Error('项目配置泄漏了 Windows 绝对路径');

    execFileSync('git.exe', ['init', '--quiet', repositoryRoot], { stdio: 'pipe' });
    const repositories = await projectService.discoverRepositories(projectRoot);
    if (repositories.length !== 1 || repositories[0].relativePath !== 'packages/api') {
      throw new Error('Git for Windows 仓库发现失败');
    }

    const sourceFile = path.join(projectRoot, 'notes.txt');
    fs.writeFileSync(sourceFile, 'windows runtime\n');
    const copyPreview = await fileOperations.previewTransfer([sourceFile], copyDestination, 'copy');
    await fileOperations.applyTransfer({
      operationId: copyPreview.operationId,
      previewToken: copyPreview.previewToken,
      sourcePaths: [sourceFile],
      destinationDirectory: copyDestination,
      mode: 'copy',
      conflictPolicy: copyPreview.conflictPolicy
    });
    const copiedFile = path.join(copyDestination, 'notes.txt');
    if (fs.readFileSync(copiedFile, 'utf8') !== 'windows runtime\n') throw new Error('Windows 复制验证失败');

    const movePreview = await fileOperations.previewTransfer([copiedFile], moveDestination, 'move');
    await fileOperations.applyTransfer({
      operationId: movePreview.operationId,
      previewToken: movePreview.previewToken,
      sourcePaths: [copiedFile],
      destinationDirectory: moveDestination,
      mode: 'move',
      conflictPolicy: movePreview.conflictPolicy
    });
    const movedFile = path.join(moveDestination, 'notes.txt');
    if (fs.existsSync(copiedFile) || !fs.existsSync(movedFile)) throw new Error('Windows 移动验证失败');

    const trashOperation = await fileOperations.trash([movedFile]);
    if (fs.existsSync(movedFile) || !trashOperation.systemTrash || trashOperation.undoable) {
      throw new Error('Windows 系统回收站验证失败');
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      checks: {
        projectManifestPortable: true,
        directoryBrowse: fs.readdirSync(projectRoot).includes('packages'),
        gitForWindowsDetected: true,
        copy: true,
        move: true,
        recycleBin: true
      }
    };
    const distDir = path.resolve(__dirname, '..', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'windows-runtime-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

app.whenReady()
  .then(verify)
  .then(() => app.quit())
  .catch(error => {
    console.error(error?.stack || error?.message || String(error));
    app.exit(1);
  });
