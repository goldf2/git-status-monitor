const { dialog } = require('electron');
const { registerTrustedHandler } = require('./security');
const fileService = require('../services/fileService');
const configService = require('../services/configService');
const directoryGrantService = require('../services/directoryGrantService');
const { DirectoryWatchService } = require('../services/directoryWatchService');
const ipcMain = { handle: registerTrustedHandler };
const directoryWatchService = new DirectoryWatchService({
  inspectDirectories: paths => fileService.inspectWorkspaceDirectories(paths)
});
const watchOwners = new Set();
const directorySizeJobs = new Map();
const directorySizeOwners = new Set();
const MAX_DIRECTORY_SIZE_JOBS_PER_SENDER = 2;

function assertManagedWorkspacePath(candidatePath, allowedTypes = ['file', 'directory'], service = fileService) {
  const result = service.resolveWorkspacePath(candidatePath);
  if (!result?.ok) {
    throw new Error(`无法访问受管位置：${result?.message || '路径校验失败'}`);
  }
  const acceptedTypes = Array.isArray(allowedTypes) && allowedTypes.length
    ? allowedTypes
    : ['file', 'directory'];
  if (!acceptedTypes.includes(result.type)) {
    const requirement = acceptedTypes.length > 1
      ? '此操作只支持普通文件或文件夹'
      : (acceptedTypes[0] === 'directory' ? '此操作需要文件夹' : '此操作需要文件');
    throw new Error(requirement);
  }
  return result.path;
}

function registerWatchOwner(sender) {
  if (watchOwners.has(sender.id)) return;
  watchOwners.add(sender.id);
  sender.once('destroyed', () => {
    directoryWatchService.stop(sender.id);
    watchOwners.delete(sender.id);
  });
}

function directorySizeRequestId(rawRequestId) {
  if (typeof rawRequestId !== 'string' || !/^size_[A-Za-z0-9_-]{8,80}$/.test(rawRequestId)) {
    throw new Error('文件夹大小任务标识无效');
  }
  return rawRequestId;
}

function directorySizeJobKey(senderId, requestId) {
  return `${senderId}:${requestId}`;
}

function registerDirectorySizeOwner(sender) {
  if (directorySizeOwners.has(sender.id)) return;
  directorySizeOwners.add(sender.id);
  sender.once('destroyed', () => {
    for (const [key, job] of directorySizeJobs) {
      if (job.senderId !== sender.id) continue;
      job.controller.abort();
      directorySizeJobs.delete(key);
    }
    directorySizeOwners.delete(sender.id);
  });
}

function registerFilesystemIPC() {
  ipcMain.handle('fs:listDirectory', async (event, candidatePath, options) => {
    const safePath = assertManagedWorkspacePath(candidatePath, ['directory']);
    return fileService.listDirectory(safePath, options);
  });

  ipcMain.handle('fs:inspectWorkspaceDirectories', async (event, paths) => {
    return fileService.inspectWorkspaceDirectories(paths);
  });

  ipcMain.handle('fs:resolveWorkspaceDirectory', async (event, rawInput) => {
    return fileService.resolveWorkspaceDirectory(rawInput);
  });

  ipcMain.handle('fs:getWorkspaceDirectoryInfos', async (event, paths) => {
    return fileService.getWorkspaceDirectoryInfos(paths);
  });

  ipcMain.handle('fs:getFavoriteDirectoryInfos', async (event, paths) => {
    return fileService.inspectFavoriteDirectories(paths);
  });

  ipcMain.handle('fs:resolveFavoriteDirectory', async (event, favoritePath) => {
    return fileService.resolveFavoriteDirectory(favoritePath);
  });

  ipcMain.handle('fs:watchDirectory', async (event, directoryPath) => {
    registerWatchOwner(event.sender);
    return directoryWatchService.start(event.sender.id, directoryPath, payload => {
      if (!event.sender.isDestroyed()) event.sender.send('fs:directoryChanged', payload);
    });
  });

  ipcMain.handle('fs:unwatchDirectory', async (event, watchId) => {
    return directoryWatchService.stop(event.sender.id, watchId);
  });

  ipcMain.handle('fs:findGitRepos', async (event, rootPath, options) => {
    const safePath = assertManagedWorkspacePath(rootPath, ['directory']);
    return fileService.findGitRepos(safePath, options);
  });

  ipcMain.handle('fs:getFileInfo', async (event, candidatePath) => {
    const safePath = assertManagedWorkspacePath(candidatePath, ['file', 'directory']);
    return fileService.getFileInfo(safePath);
  });

  ipcMain.handle('fs:getReadmePreview', async (event, dirPath) => {
    const safePath = assertManagedWorkspacePath(dirPath, ['directory']);
    return fileService.getReadmePreview(safePath);
  });

  ipcMain.handle('fs:listProjectControlFiles', async (event, repoPath) => {
    return fileService.listProjectControlFiles(repoPath);
  });

  ipcMain.handle('fs:listMarkdownDocuments', async (event, repoPath) => {
    return fileService.listMarkdownDocuments(repoPath);
  });

  ipcMain.handle('fs:readMarkdownDocument', async (event, repoPath, fileName) => {
    return fileService.readMarkdownDocument(repoPath, fileName);
  });

  ipcMain.handle('fs:saveMarkdownDocument', async (event, repoPath, fileName, content) => {
    return fileService.saveMarkdownDocument(repoPath, fileName, content);
  });

  ipcMain.handle('fs:readProjectControlFile', async (event, repoPath, fileName) => {
    return fileService.readProjectControlFile(repoPath, fileName);
  });

  ipcMain.handle('fs:saveProjectControlFile', async (event, repoPath, fileName, content) => {
    return fileService.saveProjectControlFile(repoPath, fileName, content);
  });

  ipcMain.handle('fs:syncProjectControlAgentRules', async (event, repoPath, selections) => {
    return fileService.syncProjectControlAgentRules(repoPath, selections);
  });

  ipcMain.handle('fs:showInFinder', async (event, candidatePath) => {
    const safePath = assertManagedWorkspacePath(candidatePath, ['file', 'directory']);
    return fileService.showInFinder(safePath);
  });

  ipcMain.handle('fs:openFile', async (event, candidatePath) => {
    const safePath = assertManagedWorkspacePath(candidatePath, ['file']);
    return fileService.openFile(safePath);
  });

  ipcMain.handle('fs:getDefaultPath', async () => {
    return fileService.getDefaultPath();
  });

  ipcMain.handle('fs:getQuickLocations', async () => {
    return fileService.getQuickLocations();
  });

  ipcMain.handle('fs:getMountedVolumes', async () => {
    return fileService.getMountedVolumes();
  });

  ipcMain.handle('fs:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return directoryGrantService.issue(result.filePaths[0]);
  });

  ipcMain.handle('fs:autoDetectTags', async (event, repoPath) => {
    const safePath = assertManagedWorkspacePath(repoPath, ['directory']);
    return fileService.autoDetectTags(safePath);
  });

  ipcMain.handle('fs:getDirSize', async (event, dirPath) => {
    const safePath = assertManagedWorkspacePath(dirPath, ['directory']);
    return fileService.getDirSize(safePath);
  });

  ipcMain.handle('fs:calculateDirectorySize', async (event, dirPath, rawRequestId) => {
    const safePath = assertManagedWorkspacePath(dirPath, ['directory']);
    const requestId = directorySizeRequestId(rawRequestId);
    registerDirectorySizeOwner(event.sender);
    const senderId = event.sender.id;
    const activeJobCount = Array.from(directorySizeJobs.values())
      .filter(job => job.senderId === senderId).length;
    if (activeJobCount >= MAX_DIRECTORY_SIZE_JOBS_PER_SENDER) {
      throw new Error('正在计算的文件夹过多，请等待现有任务完成');
    }
    const key = directorySizeJobKey(senderId, requestId);
    if (directorySizeJobs.has(key)) throw new Error('文件夹大小任务标识重复');
    const controller = new AbortController();
    const job = { senderId, requestId, controller };
    directorySizeJobs.set(key, job);
    try {
      return await fileService.calculateDirectorySize(safePath, {
        signal: controller.signal,
        onProgress: progress => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('fs:directorySizeProgress', { requestId, path: safePath, ...progress });
          }
        }
      });
    } finally {
      if (directorySizeJobs.get(key) === job) directorySizeJobs.delete(key);
    }
  });

  ipcMain.handle('fs:cancelDirectorySize', async (event, rawRequestId) => {
    const requestId = directorySizeRequestId(rawRequestId);
    const job = directorySizeJobs.get(directorySizeJobKey(event.sender.id, requestId));
    if (!job) return false;
    job.controller.abort();
    return true;
  });
}

module.exports = { registerFilesystemIPC, assertManagedWorkspacePath };
