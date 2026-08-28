const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gitFinder', {
  fs: {
    listDirectory: (path, options) => ipcRenderer.invoke('fs:listDirectory', path, options),
    inspectWorkspaceDirectories: (paths) => ipcRenderer.invoke('fs:inspectWorkspaceDirectories', paths),
    resolveWorkspaceDirectory: (rawInput) => ipcRenderer.invoke('fs:resolveWorkspaceDirectory', rawInput),
    getWorkspaceDirectoryInfos: (paths) => ipcRenderer.invoke('fs:getWorkspaceDirectoryInfos', paths),
    getFavoriteDirectoryInfos: (paths) => ipcRenderer.invoke('fs:getFavoriteDirectoryInfos', paths),
    resolveFavoriteDirectory: (favoritePath) => ipcRenderer.invoke('fs:resolveFavoriteDirectory', favoritePath),
    watchDirectory: (path) => ipcRenderer.invoke('fs:watchDirectory', path),
    unwatchDirectory: (watchId) => ipcRenderer.invoke('fs:unwatchDirectory', watchId),
    onDirectoryChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('fs:directoryChanged', listener);
      return () => ipcRenderer.removeListener('fs:directoryChanged', listener);
    },
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
    getPathForFile: (file) => webUtils.getPathForFile(file),
    autoDetectTags: (repoPath) => ipcRenderer.invoke('fs:autoDetectTags', repoPath),
    getDirSize: (dirPath) => ipcRenderer.invoke('fs:getDirSize', dirPath),
    calculateDirectorySize: (dirPath, requestId) => ipcRenderer.invoke('fs:calculateDirectorySize', dirPath, requestId),
    cancelDirectorySize: (requestId) => ipcRenderer.invoke('fs:cancelDirectorySize', requestId),
    onDirectorySizeProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('fs:directorySizeProgress', listener);
      return () => ipcRenderer.removeListener('fs:directorySizeProgress', listener);
    }
  },

  fileOps: {
    getHistory: (limit) => ipcRenderer.invoke('fileOps:getHistory', limit),
    getRecoveryStatus: () => ipcRenderer.invoke('fileOps:getRecoveryStatus'),
    previewTransfer: (paths, destinationDirectory, mode, options = {}) => ipcRenderer.invoke('fileOps:previewTransfer', paths, destinationDirectory, mode, options),
    applyTransfer: (request) => ipcRenderer.invoke('fileOps:applyTransfer', request),
    getTransferStatus: (operationId) => ipcRenderer.invoke('fileOps:getTransferStatus', operationId),
    cancelTransfer: (operationId) => ipcRenderer.invoke('fileOps:cancelTransfer', operationId),
    move: (paths, destinationDirectory) => ipcRenderer.invoke('fileOps:move', paths, destinationDirectory),
    copy: (paths, destinationDirectory) => ipcRenderer.invoke('fileOps:copy', paths, destinationDirectory),
    rename: (sourcePath, nextName) => ipcRenderer.invoke('fileOps:rename', sourcePath, nextName),
    previewBatchRename: (sourcePaths, options) => ipcRenderer.invoke('fileOps:previewBatchRename', sourcePaths, options),
    applyBatchRename: (request) => ipcRenderer.invoke('fileOps:applyBatchRename', request),
    trash: (paths) => ipcRenderer.invoke('fileOps:trash', paths),
    createDirectory: (parentPath, name) => ipcRenderer.invoke('fileOps:createDirectory', parentPath, name),
    createFile: (parentPath, name) => ipcRenderer.invoke('fileOps:createFile', parentPath, name),
    previewImport: (sourcePaths, destinationDirectory) => ipcRenderer.invoke('fileOps:previewImport', sourcePaths, destinationDirectory),
    applyImport: (request) => ipcRenderer.invoke('fileOps:applyImport', request),
    undo: (operationId) => ipcRenderer.invoke('fileOps:undo', operationId),
    redo: (operationId) => ipcRenderer.invoke('fileOps:redo', operationId)
  },

  clipboard: {
    copyPathnames: (paths) => ipcRenderer.invoke('clipboard:copyPathnames', paths)
  },

  content: {
    getPreview: (filePath, options = {}) => ipcRenderer.invoke('content:getPreview', filePath, options),
    convertBinaryPlist: (filePath) => ipcRenderer.invoke('content:convertBinaryPlist', filePath),
    getTextPage: (pageToken) => ipcRenderer.invoke('content:getTextPage', pageToken),
    releaseTextPage: (pageToken) => ipcRenderer.invoke('content:releaseTextPage', pageToken),
    getThumbnail: (filePath) => ipcRenderer.invoke('content:getThumbnail', filePath),
    search: (query, options) => ipcRenderer.invoke('content:search', query, options),
    getIndexStatus: () => ipcRenderer.invoke('content:getIndexStatus'),
    invalidateIndex: () => ipcRenderer.invoke('content:invalidateIndex'),
    cancelIndexBuild: () => ipcRenderer.invoke('content:cancelIndexBuild'),
    cancelSearch: () => ipcRenderer.invoke('content:cancelSearch')
  },

  projectTasks: {
    getPortfolio: (options) => ipcRenderer.invoke('projectTasks:getPortfolio', options),
    getGitEvidence: (taskKey, options) => ipcRenderer.invoke('projectTasks:getGitEvidence', taskKey, options),
    previewStatusChange: (taskKey, targetStatus) => ipcRenderer.invoke('projectTasks:previewStatusChange', taskKey, targetStatus),
    applyStatusChange: (taskKey, request) => ipcRenderer.invoke('projectTasks:applyStatusChange', taskKey, request),
    previewTaskUpdate: (taskKey, changes) => ipcRenderer.invoke('projectTasks:previewTaskUpdate', taskKey, changes),
    applyTaskUpdate: (taskKey, request) => ipcRenderer.invoke('projectTasks:applyTaskUpdate', taskKey, request),
    previewTaskCreate: (projectId, values) => ipcRenderer.invoke('projectTasks:previewTaskCreate', projectId, values),
    applyTaskCreate: (projectId, request) => ipcRenderer.invoke('projectTasks:applyTaskCreate', projectId, request),
    previewMilestoneUpdate: (milestoneKey, changes) => ipcRenderer.invoke('projectTasks:previewMilestoneUpdate', milestoneKey, changes),
    applyMilestoneUpdate: (milestoneKey, request) => ipcRenderer.invoke('projectTasks:applyMilestoneUpdate', milestoneKey, request)
  },

  localProjects: {
    describe: (directoryPath) => ipcRenderer.invoke('localProjects:describe', directoryPath),
    get: (directoryPath) => ipcRenderer.invoke('localProjects:get', directoryPath),
    list: () => ipcRenderer.invoke('localProjects:list'),
    initialize: (directoryPath, values) => ipcRenderer.invoke('localProjects:initialize', directoryPath, values),
    update: (directoryPath, values) => ipcRenderer.invoke('localProjects:update', directoryPath, values)
  },

  relationshipBoards: {
    get: () => ipcRenderer.invoke('relationshipBoards:get'),
    save: (store) => ipcRenderer.invoke('relationshipBoards:save', store),
    previewImport: () => ipcRenderer.invoke('relationshipBoards:previewImport'),
    applyImport: (request) => ipcRenderer.invoke('relationshipBoards:applyImport', request),
    previewCoolify: (request) => ipcRenderer.invoke('relationshipBoards:previewCoolify', request),
    applyCoolify: (request) => ipcRenderer.invoke('relationshipBoards:applyCoolify', request)
  },

  git: {
    isGitRepo: (repoPath) => ipcRenderer.invoke('git:isGitRepo', repoPath),
    getStatus: (repoPath, options) => ipcRenderer.invoke('git:getStatus', repoPath, options),
    batchStatus: (repoPaths, options) => ipcRenderer.invoke('git:batchStatus', repoPaths, options),
    getBatchStatusProgress: (requestId) => ipcRenderer.invoke('git:getBatchStatusProgress', requestId),
    cancelBatchStatus: (requestId) => ipcRenderer.invoke('git:cancelBatchStatus', requestId),
    onBatchStatusProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('git:batchStatusProgress', listener);
      return () => ipcRenderer.removeListener('git:batchStatusProgress', listener);
    },
    pull: (repoPath) => ipcRenderer.invoke('git:pull', repoPath),
    push: (repoPath) => ipcRenderer.invoke('git:push', repoPath),
    fetch: (repoPath) => ipcRenderer.invoke('git:fetch', repoPath),
    commit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
    getWorkingTree: (repoPath) => ipcRenderer.invoke('git:getWorkingTree', repoPath),
    getFileDiff: (repoPath, filePath, options) => ipcRenderer.invoke('git:getFileDiff', repoPath, filePath, options),
    previewLineSelection: (repoPath, filePath, options) => ipcRenderer.invoke('git:previewLineSelection', repoPath, filePath, options),
    applyLineSelection: (repoPath, request) => ipcRenderer.invoke('git:applyLineSelection', repoPath, request),
    stageFiles: (repoPath, filePaths) => ipcRenderer.invoke('git:stageFiles', repoPath, filePaths),
    unstageFiles: (repoPath, filePaths) => ipcRenderer.invoke('git:unstageFiles', repoPath, filePaths),
    getAmendContext: (repoPath) => ipcRenderer.invoke('git:getAmendContext', repoPath),
    previewAmend: (repoPath, message) => ipcRenderer.invoke('git:previewAmend', repoPath, message),
    applyAmend: (repoPath, request) => ipcRenderer.invoke('git:applyAmend', repoPath, request),
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
    getCapabilities: () => ipcRenderer.invoke('terminal:getCapabilities'),
    selectExecutable: (kind) => ipcRenderer.invoke('terminal:selectExecutable', kind),
    openExternal: (cwd, preferred) => ipcRenderer.invoke('terminal:openExternal', cwd, preferred),
    openInEditor: (targetPath, preferred) => ipcRenderer.invoke('terminal:openInEditor', targetPath, preferred)
  },

  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    getConfig: () => ipcRenderer.invoke('config:getConfig'),
    getTransactionRecoveryStatus: () => ipcRenderer.invoke('config:getTransactionRecoveryStatus'),
    getFavorites: () => ipcRenderer.invoke('config:getFavorites'),
    addFavorite: (item) => ipcRenderer.invoke('config:addFavorite', item),
    toggleFavoriteDirectory: (directoryPath) => ipcRenderer.invoke('config:toggleFavoriteDirectory', directoryPath),
    removeFavorite: (id) => ipcRenderer.invoke('config:removeFavorite', id),
    getTreeRoots: () => ipcRenderer.invoke('config:getTreeRoots'),
    addTreeRoot: (dirPath, name, grantToken) => ipcRenderer.invoke('config:addTreeRoot', dirPath, name, grantToken),
    removeTreeRoot: (dirPath) => ipcRenderer.invoke('config:removeTreeRoot', dirPath),
    updateTreeRoot: (dirPath, updates) => ipcRenderer.invoke('config:updateTreeRoot', dirPath, updates)
  },

  fileLabels: {
    get: () => ipcRenderer.invoke('fileLabels:get'),
    getForPaths: (paths) => ipcRenderer.invoke('fileLabels:getForPaths', paths),
    getCollection: (labelIds) => ipcRenderer.invoke('fileLabels:getCollection', labelIds),
    create: (name, color) => ipcRenderer.invoke('fileLabels:create', name, color),
    update: (labelId, updates) => ipcRenderer.invoke('fileLabels:update', labelId, updates),
    delete: (labelId) => ipcRenderer.invoke('fileLabels:delete', labelId),
    updateAssignments: (paths, changes) => ipcRenderer.invoke('fileLabels:updateAssignments', paths, changes)
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
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    performNativeEdit: (action) => ipcRenderer.invoke('app:perform-native-edit', action),
    onShortcut: (callback) => ipcRenderer.on('app:shortcut', (_event, action) => callback(action))
  },

  platform: process.platform
});
