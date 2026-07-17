const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitFinder', {
  fs: {
    listDirectory: (path, options) => ipcRenderer.invoke('fs:listDirectory', path, options),
    findGitRepos: (rootPath, options) => ipcRenderer.invoke('fs:findGitRepos', rootPath, options),
    getFileInfo: (path) => ipcRenderer.invoke('fs:getFileInfo', path),
    getReadmePreview: (dirPath) => ipcRenderer.invoke('fs:getReadmePreview', dirPath),
    listProjectControlFiles: (repoPath) => ipcRenderer.invoke('fs:listProjectControlFiles', repoPath),
    listMarkdownDocuments: (repoPath) => ipcRenderer.invoke('fs:listMarkdownDocuments', repoPath),
    readMarkdownDocument: (repoPath, fileName) => ipcRenderer.invoke('fs:readMarkdownDocument', repoPath, fileName),
    saveMarkdownDocument: (repoPath, fileName, content) => ipcRenderer.invoke('fs:saveMarkdownDocument', repoPath, fileName, content),
    readProjectControlFile: (repoPath, fileName) => ipcRenderer.invoke('fs:readProjectControlFile', repoPath, fileName),
    saveProjectControlFile: (repoPath, fileName, content) => ipcRenderer.invoke('fs:saveProjectControlFile', repoPath, fileName, content),
    syncProjectControlAgentRules: (repoPath, selections) => ipcRenderer.invoke('fs:syncProjectControlAgentRules', repoPath, selections),
    showInFinder: (path) => ipcRenderer.invoke('fs:showInFinder', path),
    openFile: (path) => ipcRenderer.invoke('fs:openFile', path),
    getDefaultPath: () => ipcRenderer.invoke('fs:getDefaultPath'),
    getQuickLocations: () => ipcRenderer.invoke('fs:getQuickLocations'),
    getMountedVolumes: () => ipcRenderer.invoke('fs:getMountedVolumes'),
    selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
    autoDetectTags: (repoPath) => ipcRenderer.invoke('fs:autoDetectTags', repoPath),
    getDirSize: (dirPath) => ipcRenderer.invoke('fs:getDirSize', dirPath)
  },

  git: {
    isGitRepo: (repoPath) => ipcRenderer.invoke('git:isGitRepo', repoPath),
    getStatus: (repoPath, options) => ipcRenderer.invoke('git:getStatus', repoPath, options),
    batchStatus: (repoPaths, options) => ipcRenderer.invoke('git:batchStatus', repoPaths, options),
    pull: (repoPath) => ipcRenderer.invoke('git:pull', repoPath),
    push: (repoPath) => ipcRenderer.invoke('git:push', repoPath),
    fetch: (repoPath) => ipcRenderer.invoke('git:fetch', repoPath),
    commit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
    getLog: (repoPath, limit) => ipcRenderer.invoke('git:getLog', repoPath, limit),
    getDiff: (repoPath) => ipcRenderer.invoke('git:getDiff', repoPath),
    getStagedDiff: (repoPath) => ipcRenderer.invoke('git:getStagedDiff', repoPath),
    getRemotes: (repoPath) => ipcRenderer.invoke('git:getRemotes', repoPath),
    addRemote: (repoPath, name, url) => ipcRenderer.invoke('git:addRemote', repoPath, name, url),
    setRemoteUrl: (repoPath, name, url) => ipcRenderer.invoke('git:setRemoteUrl', repoPath, name, url),
    removeRemote: (repoPath, name) => ipcRenderer.invoke('git:removeRemote', repoPath, name),
    getBranches: (repoPath) => ipcRenderer.invoke('git:getBranches', repoPath),
    checkoutBranch: (repoPath, branchName) => ipcRenderer.invoke('git:checkoutBranch', repoPath, branchName),
    clearCache: () => ipcRenderer.invoke('git:clearCache')
  },

  terminal: {
    execute: (command, cwd) => ipcRenderer.invoke('terminal:execute', command, cwd),
    openExternal: (cwd) => ipcRenderer.invoke('terminal:openExternal', cwd)
  },

  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    getConfig: () => ipcRenderer.invoke('config:getConfig'),
    getFavorites: () => ipcRenderer.invoke('config:getFavorites'),
    addFavorite: (item) => ipcRenderer.invoke('config:addFavorite', item),
    removeFavorite: (id) => ipcRenderer.invoke('config:removeFavorite', id),
    getTreeRoots: () => ipcRenderer.invoke('config:getTreeRoots'),
    addTreeRoot: (dirPath, name) => ipcRenderer.invoke('config:addTreeRoot', dirPath, name),
    removeTreeRoot: (dirPath) => ipcRenderer.invoke('config:removeTreeRoot', dirPath),
    updateTreeRoot: (dirPath, updates) => ipcRenderer.invoke('config:updateTreeRoot', dirPath, updates)
  },

  groups: {
    get: () => ipcRenderer.invoke('groups:get'),
    create: (name, color, icon) => ipcRenderer.invoke('groups:create', name, color, icon),
    update: (id, updates) => ipcRenderer.invoke('groups:update', id, updates),
    delete: (id) => ipcRenderer.invoke('groups:delete', id),
    addRepo: (groupId, repoPath) => ipcRenderer.invoke('groups:addRepo', groupId, repoPath),
    removeRepo: (groupId, repoPath) => ipcRenderer.invoke('groups:removeRepo', groupId, repoPath),
    autoDetect: (rootPath, repos) => ipcRenderer.invoke('groups:autoDetect', rootPath, repos)
  },

  tags: {
    get: () => ipcRenderer.invoke('tags:get'),
    create: (name, color) => ipcRenderer.invoke('tags:create', name, color),
    update: (id, updates) => ipcRenderer.invoke('tags:update', id, updates),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
    addRepo: (tagId, repoPath) => ipcRenderer.invoke('tags:addRepo', tagId, repoPath),
    removeRepo: (tagId, repoPath) => ipcRenderer.invoke('tags:removeRepo', tagId, repoPath),
    getRepoTags: (repoPath) => ipcRenderer.invoke('tags:getRepoTags', repoPath)
  },

  repos: {
    get: () => ipcRenderer.invoke('repos:get'),
    set: (repos, lastScanAt) => ipcRenderer.invoke('repos:set', repos, lastScanAt),
    merge: (repos) => ipcRenderer.invoke('repos:merge', repos),
    remove: (repoPath) => ipcRenderer.invoke('repos:remove', repoPath),
    clear: () => ipcRenderer.invoke('repos:clear'),
    // 新增:仓库注册表相关 API
    getIdByPath: (repoPath) => ipcRenderer.invoke('repos:getIdByPath', repoPath),
    getPathById: (repoId) => ipcRenderer.invoke('repos:getPathById', repoId),
    listArchived: () => ipcRenderer.invoke('repos:listArchived'),
    listActive: () => ipcRenderer.invoke('repos:listActive'),
    getRegistry: () => ipcRenderer.invoke('repos:getRegistry'),
    regenerateId: (repoPath) => ipcRenderer.invoke('repos:regenerateId', repoPath),
    purge: (repoId) => ipcRenderer.invoke('repos:purge', repoId),
    restore: (repoId) => ipcRenderer.invoke('repos:restore', repoId)
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onAvailable: (cb) => ipcRenderer.on('updater:available', (_e, data) => cb(data)),
    onDownloading: (cb) => ipcRenderer.on('updater:downloading', cb),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_e, data) => cb(data)),
    onDownloaded: (cb) => ipcRenderer.on('updater:downloaded', cb),
    onUpToDate: (cb) => ipcRenderer.on('updater:up-to-date', cb),
    onError: (cb) => ipcRenderer.on('updater:error', (_e, msg) => cb(msg))
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version')
  },

  platform: process.platform
});
