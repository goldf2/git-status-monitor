const { ipcMain } = require('electron');
const gitService = require('../services/gitService');

function registerGitIPC() {
  ipcMain.handle('git:isGitRepo', async (event, repoPath) => {
    return gitService.isGitRepo(repoPath);
  });

  ipcMain.handle('git:getStatus', async (event, repoPath, options) => {
    return gitService.getStatus(repoPath, options);
  });

  ipcMain.handle('git:batchStatus', async (event, repoPaths, options) => {
    return gitService.batchStatus(repoPaths, options);
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
    return await gitService.commit(repoPath, message);
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

module.exports = { registerGitIPC };
