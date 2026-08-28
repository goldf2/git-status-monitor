const fs = require('node:fs');
const path = require('node:path');
const gitService = require('../services/gitService');
const configService = require('../services/configService');
const { registerTrustedHandler } = require('./security');
const ipcMain = { handle: registerTrustedHandler };

function isManagedRepoPath(repoPath, roots = configService.getTreeRoots()) {
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) return false;
  let realRepoPath;
  try {
    realRepoPath = fs.realpathSync.native(repoPath);
  } catch {
    return false;
  }
  return (roots || []).some(root => {
    const rootPath = typeof root === 'string' ? root : root?.path;
    if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) return false;
    try {
      const realRootPath = fs.realpathSync.native(rootPath);
      const relative = path.relative(realRootPath, realRepoPath);
      return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  });
}

function assertManagedRepoPath(repoPath) {
  if (!isManagedRepoPath(repoPath)) {
    throw new Error('仅允许访问已添加的受管开发目录内的 Git 仓库');
  }
}

function registerGitIPC() {
  ipcMain.handle('git:isGitRepo', async (event, repoPath) => {
    return gitService.isGitRepo(repoPath);
  });

  ipcMain.handle('git:getStatus', async (event, repoPath, options) => {
    return gitService.getStatus(repoPath, options);
  });

  ipcMain.handle('git:batchStatus', async (event, repoPaths, options) => {
    if (Array.isArray(repoPaths)) repoPaths.forEach(assertManagedRepoPath);
    const safeOptions = options && typeof options === 'object' ? {
      requestId: options.requestId,
      concurrency: options.concurrency,
      autoFetch: options.autoFetch === true,
      forceRefresh: options.forceRefresh === true,
      includeSummary: options.includeSummary === true
    } : {};
    return gitService.batchStatus(repoPaths, {
      ...safeOptions,
      onProgress: progress => {
        if (!event.sender.isDestroyed()) event.sender.send('git:batchStatusProgress', progress);
      }
    });
  });

  ipcMain.handle('git:getBatchStatusProgress', async (event, requestId) => {
    return gitService.getBatchStatusProgress(requestId);
  });

  ipcMain.handle('git:cancelBatchStatus', async (event, requestId) => {
    return gitService.cancelBatchStatus(requestId);
  });

  ipcMain.handle('git:pull', async (event, repoPath) => {
    return await gitService.pull(repoPath);
  });

  ipcMain.handle('git:push', async (event, repoPath) => {
    return await gitService.push(repoPath);
  });

  ipcMain.handle('git:fetch', async (event, repoPath) => {
    return await gitService.fetch(repoPath);
  });

  ipcMain.handle('git:commit', async (event, repoPath, message) => {
    assertManagedRepoPath(repoPath);
    return await gitService.commit(repoPath, message);
  });

  ipcMain.handle('git:getWorkingTree', async (event, repoPath) => {
    assertManagedRepoPath(repoPath);
    return gitService.getWorkingTree(repoPath);
  });

  ipcMain.handle('git:getFileDiff', async (event, repoPath, filePath, options) => {
    assertManagedRepoPath(repoPath);
    return gitService.getFileDiff(repoPath, filePath, options);
  });

  ipcMain.handle('git:previewLineSelection', async (event, repoPath, filePath, options) => {
    assertManagedRepoPath(repoPath);
    return gitService.previewLineSelection(repoPath, filePath, options);
  });

  ipcMain.handle('git:applyLineSelection', async (event, repoPath, request) => {
    assertManagedRepoPath(repoPath);
    return gitService.applyLineSelection(repoPath, request);
  });

  ipcMain.handle('git:stageFiles', async (event, repoPath, filePaths) => {
    assertManagedRepoPath(repoPath);
    return gitService.stageFiles(repoPath, filePaths);
  });

  ipcMain.handle('git:unstageFiles', async (event, repoPath, filePaths) => {
    assertManagedRepoPath(repoPath);
    return gitService.unstageFiles(repoPath, filePaths);
  });

  ipcMain.handle('git:getAmendContext', async (event, repoPath) => {
    assertManagedRepoPath(repoPath);
    return gitService.getAmendContext(repoPath);
  });

  ipcMain.handle('git:previewAmend', async (event, repoPath, message) => {
    assertManagedRepoPath(repoPath);
    return gitService.previewAmend(repoPath, message);
  });

  ipcMain.handle('git:applyAmend', async (event, repoPath, request) => {
    assertManagedRepoPath(repoPath);
    return await gitService.applyAmend(repoPath, request);
  });

  ipcMain.handle('git:getLog', async (event, repoPath, limit) => {
    return gitService.getLog(repoPath, limit);
  });

  ipcMain.handle('git:getDiff', async (event, repoPath) => {
    return gitService.getDiff(repoPath);
  });

  ipcMain.handle('git:getStagedDiff', async (event, repoPath) => {
    return gitService.getStagedDiff(repoPath);
  });

  ipcMain.handle('git:getRemotes', async (event, repoPath) => {
    return gitService.getRemotes(repoPath);
  });

  ipcMain.handle('git:addRemote', async (event, repoPath, name, url) => {
    return gitService.addRemote(repoPath, name, url);
  });

  ipcMain.handle('git:setRemoteUrl', async (event, repoPath, name, url) => {
    return gitService.setRemoteUrl(repoPath, name, url);
  });

  ipcMain.handle('git:removeRemote', async (event, repoPath, name) => {
    return gitService.removeRemote(repoPath, name);
  });

  ipcMain.handle('git:getBranches', async (event, repoPath) => {
    return gitService.getBranches(repoPath);
  });

  ipcMain.handle('git:checkoutBranch', async (event, repoPath, branchName) => {
    return gitService.checkoutBranch(repoPath, branchName);
  });

  ipcMain.handle('git:clearCache', async () => {
    gitService.clearAllCache();
    return true;
  });
}

module.exports = { registerGitIPC, isManagedRepoPath };
