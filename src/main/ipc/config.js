const { ipcMain } = require('electron');
const configService = require('../services/configService');

function registerConfigIPC() {
  ipcMain.handle('config:get', async (event, key) => {
    return configService.get(key);
  });

  ipcMain.handle('config:set', async (event, key, value) => {
    return configService.set(key, value);
  });

  ipcMain.handle('config:getConfig', async () => {
    return configService.getConfig();
  });

  ipcMain.handle('config:getFavorites', async () => {
    return configService.getFavorites();
  });

  ipcMain.handle('config:addFavorite', async (event, item) => {
    return configService.addFavorite(item);
  });

  ipcMain.handle('config:removeFavorite', async (event, id) => {
    return configService.removeFavorite(id);
  });

  ipcMain.handle('config:getTreeRoots', async () => {
    return configService.getTreeRoots();
  });

  ipcMain.handle('config:addTreeRoot', async (event, dirPath, name) => {
    return configService.addTreeRoot(dirPath, name);
  });

  ipcMain.handle('config:removeTreeRoot', async (event, dirPath) => {
    return configService.removeTreeRoot(dirPath);
  });

  ipcMain.handle('config:updateTreeRoot', async (event, dirPath, updates) => {
    return configService.updateTreeRoot(dirPath, updates);
  });

  ipcMain.handle('groups:get', async () => {
    return configService.getGroups();
  });

  ipcMain.handle('groups:create', async (event, name, color, icon) => {
    return configService.createGroup(name, color, icon);
  });

  ipcMain.handle('groups:update', async (event, id, updates) => {
    return configService.updateGroup(id, updates);
  });

  ipcMain.handle('groups:delete', async (event, id) => {
    return configService.deleteGroup(id);
  });

  ipcMain.handle('groups:addRepo', async (event, groupId, repoPath) => {
    return configService.addRepoToGroup(groupId, repoPath);
  });

  ipcMain.handle('groups:removeRepo', async (event, groupId, repoPath) => {
    return configService.removeRepoFromGroup(groupId, repoPath);
  });

  ipcMain.handle('groups:autoDetect', async (event, rootPath, repos) => {
    return configService.autoDetectGroups(rootPath, repos);
  });

  ipcMain.handle('tags:get', async () => {
    return configService.getTags();
  });

  ipcMain.handle('tags:create', async (event, name, color) => {
    return configService.createTag(name, color);
  });

  ipcMain.handle('tags:update', async (event, id, updates) => {
    return configService.updateTag(id, updates);
  });

  ipcMain.handle('tags:delete', async (event, id) => {
    return configService.deleteTag(id);
  });

  ipcMain.handle('tags:addRepo', async (event, tagId, repoPath) => {
    return configService.addTagToRepo(tagId, repoPath);
  });

  ipcMain.handle('tags:removeRepo', async (event, tagId, repoPath) => {
    return configService.removeTagFromRepo(tagId, repoPath);
  });

  ipcMain.handle('tags:getRepoTags', async (event, repoPath) => {
    return configService.getRepoTags(repoPath);
  });

  ipcMain.handle('boards:list', async () => {
    return configService.getBoards();
  });

  ipcMain.handle('boards:get', async (event, id) => {
    return configService.getBoard(id);
  });

  ipcMain.handle('boards:create', async (event, name) => {
    return configService.createBoard(name);
  });

  ipcMain.handle('boards:save', async (event, id, data) => {
    return configService.saveBoard(id, data);
  });

  ipcMain.handle('boards:delete', async (event, id) => {
    return configService.deleteBoard(id);
  });

  // ============ 仓库列表持久化 ============
  ipcMain.handle('repos:get', async () => {
    return configService.getRepos();
  });

  ipcMain.handle('repos:set', async (event, repos, lastScanAt) => {
    return configService.setRepos(repos, lastScanAt);
  });

  ipcMain.handle('repos:merge', async (event, repos) => {
    return configService.mergeRepos(repos);
  });

  ipcMain.handle('repos:remove', async (event, repoPath) => {
    return configService.removeRepo(repoPath);
  });

  ipcMain.handle('repos:clear', async () => {
    return configService.clearRepos();
  });
}

module.exports = { registerConfigIPC };
