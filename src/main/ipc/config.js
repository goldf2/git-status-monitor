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

  // ============ 仓库注册表(新增)============

  ipcMain.handle('repos:getIdByPath', async (event, repoPath) => {
    return configService.getIdByPath(repoPath);
  });

  ipcMain.handle('repos:getPathById', async (event, repoId) => {
    return configService.getPathById(repoId);
  });

  ipcMain.handle('repos:listArchived', async () => {
    return configService.listArchived();
  });

  ipcMain.handle('repos:listActive', async () => {
    return configService.listActive();
  });

  ipcMain.handle('repos:getRegistry', async () => {
    return configService.getRegistry();
  });

  // 重新生成仓库 id(应对 hash 冲突或 id 损坏)
  // 会自动同步迁移 groups/tags 中的关联
  ipcMain.handle('repos:regenerateId', async (event, repoPath) => {
    return configService.regenerateRepoId(repoPath);
  });

  // 彻底删除归档仓库的所有痕迹(registry + groups + tags 中的关联)
  ipcMain.handle('repos:purge', async (event, repoId) => {
    return configService.purgeRepo(repoId);
  });

  // 恢复归档仓库(把 archived 标记为 false,但不重新加入 repos.json,需要重新扫描)
  ipcMain.handle('repos:restore', async (event, repoId) => {
    const reg = configService.getRegistry();
    const entry = reg.repos.find(r => r.id === repoId);
    if (entry) {
      entry.archived = false;
      configService.saveRegistry();
    }
    return entry;
  });
}

module.exports = { registerConfigIPC };
