const configService = require('../services/configService');
const directoryGrantService = require('../services/directoryGrantService');
const fileService = require('../services/fileService');
const FileLabels = require('../../shared/fileLabels');
const { registerTrustedHandler } = require('./security');
const ipcMain = { handle: registerTrustedHandler };

function resolveManagedFileLabelPaths(candidatePaths, resolver = fileService) {
  if (!Array.isArray(candidatePaths) || candidatePaths.length === 0 || candidatePaths.length > 2000) {
    throw new Error('文件标签需要 1–2000 个受管文件或文件夹');
  }
  const resolvedPaths = [];
  const seen = new Set();
  for (const candidatePath of candidatePaths) {
    const resolved = resolver.resolveWorkspacePath(candidatePath);
    if (!resolved.ok || !['file', 'directory'].includes(resolved.type)) {
      throw new Error(resolved.message || '文件标签只适用于受管文件或文件夹');
    }
    if (!seen.has(resolved.path)) {
      seen.add(resolved.path);
      resolvedPaths.push(resolved.path);
    }
  }
  return resolvedPaths;
}

function resolveFileLabelCollection(labelIds, options = {}) {
  const service = options.configService || configService;
  const resolver = options.fileService || fileService;
  const maxItems = Math.max(1, Math.min(2000, Number(options.maxItems) || 2000));
  const store = FileLabels.normalizeStore(service.getFileLabels());
  const knownIds = new Set(store.labels.map(label => label.id));
  const selectedIds = [...new Set((Array.isArray(labelIds) ? labelIds : [])
    .map(FileLabels.normalizeId)
    .filter(Boolean))];
  if (!selectedIds.length || selectedIds.length > FileLabels.MAX_LABELS) {
    throw new Error(`文件标签集合需要 1–${FileLabels.MAX_LABELS} 个有效标签`);
  }
  if (selectedIds.some(id => !knownIds.has(id))) throw new Error('文件标签集合包含不存在的标签');

  const selectedSet = new Set(selectedIds);
  const labelsById = new Map(store.labels.map(label => [label.id, label]));
  const candidatePaths = FileLabels.pathsForLabelIds(store, selectedIds);
  const items = [];
  let unavailableCount = 0;
  const visibleCandidates = candidatePaths.slice(0, maxItems);
  for (const candidatePath of visibleCandidates) {
    const resolved = resolver.resolveWorkspacePath(candidatePath);
    if (!resolved?.ok || !['file', 'directory'].includes(resolved.type)) {
      unavailableCount += 1;
      continue;
    }
    const info = resolver.getFileInfo(resolved.path);
    if (!info || !['file', 'directory'].includes(info.type)) {
      unavailableCount += 1;
      continue;
    }
    const assigned = (store.assignments[candidatePath] || [])
      .map(id => labelsById.get(id))
      .filter(Boolean);
    items.push({
      ...info,
      fileLabels: assigned,
      gitStatus: info.isGitRepo ? { overallStatus: 'none', branch: 'Git' } : null
    });
  }
  return {
    labelIds: selectedIds,
    labels: store.labels.filter(label => selectedSet.has(label.id)),
    items,
    totalAssigned: candidatePaths.length,
    unavailableCount,
    truncatedCount: Math.max(0, candidatePaths.length - visibleCandidates.length)
  };
}

function registerConfigIPC() {
  ipcMain.handle('config:get', async (event, key) => {
    return configService.get(key);
  });

  ipcMain.handle('config:set', async (event, key, value) => {
    return configService.setRendererPreference(key, value);
  });

  ipcMain.handle('config:getConfig', async () => {
    return configService.getConfig();
  });

  ipcMain.handle('config:getTransactionRecoveryStatus', async () => {
    return configService.getConfigTransactionRecoveryStatus();
  });

  ipcMain.handle('config:getFavorites', async () => {
    return configService.getFavorites();
  });

  ipcMain.handle('config:addFavorite', async (event, item) => {
    return configService.addFavorite(item);
  });

  ipcMain.handle('config:toggleFavoriteDirectory', async (event, directoryPath) => {
    return configService.toggleFavoriteDirectory(directoryPath);
  });

  ipcMain.handle('config:removeFavorite', async (event, id) => {
    return configService.removeFavorite(id);
  });

  ipcMain.handle('config:getTreeRoots', async () => {
    return configService.getTreeRoots();
  });

  ipcMain.handle('config:addTreeRoot', async (event, dirPath, name, grantToken) => {
    const grantedPath = directoryGrantService.consume(dirPath, grantToken);
    return configService.addTreeRoot(grantedPath, name);
  });

  ipcMain.handle('config:removeTreeRoot', async (event, dirPath) => {
    return configService.removeTreeRoot(dirPath);
  });

  ipcMain.handle('config:updateTreeRoot', async (event, dirPath, updates) => {
    return configService.updateTreeRoot(dirPath, updates);
  });

  ipcMain.handle('fileLabels:get', async () => {
    return configService.getFileLabels();
  });

  ipcMain.handle('fileLabels:getForPaths', async (event, candidatePaths) => {
    return configService.getFileLabelsForPaths(resolveManagedFileLabelPaths(candidatePaths));
  });

  ipcMain.handle('fileLabels:getCollection', async (event, labelIds) => {
    return resolveFileLabelCollection(labelIds);
  });

  ipcMain.handle('fileLabels:create', async (event, name, color) => {
    return configService.createFileLabel(name, color);
  });

  ipcMain.handle('fileLabels:update', async (event, labelId, updates) => {
    return configService.updateFileLabel(labelId, updates);
  });

  ipcMain.handle('fileLabels:delete', async (event, labelId) => {
    return configService.deleteFileLabel(labelId);
  });

  ipcMain.handle('fileLabels:updateAssignments', async (event, candidatePaths, changes) => {
    return configService.updateFileLabelAssignments(resolveManagedFileLabelPaths(candidatePaths), changes);
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

module.exports = { registerConfigIPC, resolveFileLabelCollection, resolveManagedFileLabelPaths };
