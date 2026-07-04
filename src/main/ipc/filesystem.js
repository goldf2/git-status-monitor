const { ipcMain, dialog } = require('electron');
const fileService = require('../services/fileService');
const configService = require('../services/configService');

function registerFilesystemIPC() {
  ipcMain.handle('fs:listDirectory', async (event, path, options) => {
    return fileService.listDirectory(path, options);
  });

  ipcMain.handle('fs:findGitRepos', async (event, rootPath, options) => {
    return fileService.findGitRepos(rootPath, options);
  });

  ipcMain.handle('fs:getFileInfo', async (event, path) => {
    return fileService.getFileInfo(path);
  });

  ipcMain.handle('fs:getReadmePreview', async (event, dirPath) => {
    return fileService.getReadmePreview(dirPath);
  });

  ipcMain.handle('fs:showInFinder', async (event, path) => {
    return fileService.showInFinder(path);
  });

  ipcMain.handle('fs:openFile', async (event, path) => {
    return fileService.openFile(path);
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
    return result.filePaths[0];
  });

  ipcMain.handle('fs:autoDetectTags', async (event, repoPath) => {
    return fileService.autoDetectTags(repoPath);
  });

  ipcMain.handle('fs:getDirSize', async (event, dirPath) => {
    return fileService.getDirSize(dirPath);
  });
}

module.exports = { registerFilesystemIPC };
