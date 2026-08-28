const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { app } = require('electron');
const SemanticColors = require('../../shared/semanticColors');
const ProjectShortcuts = require('../../shared/projectShortcuts');
const FileLabels = require('../../shared/fileLabels');

const MAX_CONFIG_TRANSACTION_BYTES = 16 * 1024 * 1024;
const MAX_FAVORITES = 200;
const MAX_FAVORITE_PATH_LENGTH = 32768;
const MAX_TREE_ROOTS = 64;
const MAX_RENDERER_PREFERENCE_BYTES = 2 * 1024 * 1024;
const RENDERER_PREFERENCE_KEYS = new Set([
  'cardStyle',
  'sortBy',
  'sortOrder',
  'columnViewWidth',
  'rememberDirectoryViewPreferences',
  'directoryViewPreferences',
  'showHiddenFiles',
  'preferredTerminal',
  'preferredEditor',
  'workspaceTabSession',
  'lastPath',
  'searchScope',
  'sidebarSectionOrder',
  'sidebarCollapsedSections',
  'smartCollections',
  'projectShortcuts',
  'projectShortcutPreferences',
  'sidebarWidth',
  'detailPanelWidth',
  'hiddenQuickLocations',
  'groupOrder',
  'themeMode',
  'themeScheme',
  'themeReminder',
  'semanticColorProfile',
  'detailSectionOrder',
  'markdownDocumentSelections',
  'projectControlSelections',
  'taskViewMode',
  'taskTimelineCategory'
]);

class ConfigService {
  constructor() {
    this.configDir = null;
    this.configFile = null;
    this.groupsFile = null;
    this.tagsFile = null;
    this.reposFile = null;
    this.registryFile = null;   // 新增:仓库 id↔path 映射注册表
    this.transactionFile = null;
    this.config = null;
    this.groups = null;
    this.tags = null;
    this.repos = null;
    this.registry = null;       // 新增:repoRegistry 内存缓存
    this._migrated = false;     // 迁移标志,避免重复执行
    this._repairingRegistry = false;
    this._configTransactionRecoveryAttempted = false;
    this._configTransactionRecoveryStatus = null;
  }

  _ensureDirs() {
    if (!this.configDir) {
      try {
        this.configDir = app.getPath('userData');
      } catch (e) {
        this.configDir = path.join(os.homedir(), '.gitfinder');
      }
    }

    this.configFile = path.join(this.configDir, 'config.json');
    this.groupsFile = path.join(this.configDir, 'groups.json');
    this.tagsFile = path.join(this.configDir, 'tags.json');
    this.reposFile = path.join(this.configDir, 'repos.json');
    this.registryFile = path.join(this.configDir, 'repoRegistry.json');
    this.transactionFile = path.join(this.configDir, 'config-transaction.json');

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    this._recoverPendingConfigTransaction();
  }

  _writeJsonFileAtomic(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    let handle = null;
    try {
      handle = fs.openSync(tempPath, 'w', 0o600);
      fs.writeFileSync(handle, JSON.stringify(value, null, 2), { encoding: 'utf8' });
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      fs.renameSync(tempPath, filePath);
      try {
        const directoryHandle = fs.openSync(path.dirname(filePath), 'r');
        try { fs.fsyncSync(directoryHandle); } finally { fs.closeSync(directoryHandle); }
      } catch (_) {}
    } finally {
      if (handle !== null) {
        try { fs.closeSync(handle); } catch (_) {}
      }
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  }

  _cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _configTransactionFilePath(key) {
    const files = {
      config: this.configFile,
      groups: this.groupsFile,
      tags: this.tagsFile,
      repos: this.reposFile,
      registry: this.registryFile
    };
    return files[key] || null;
  }

  _configTransactionCacheKey(key) {
    return key === 'registry' ? 'registry' : key;
  }

  _configTransactionChecksum(journal) {
    const payload = { ...journal };
    delete payload.checksum;
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  _validateConfigTransactionJournal(journal) {
    if (!journal || journal.version !== 1 || !journal.id || !journal.operation) {
      throw new Error('配置事务记录格式无效');
    }
    if (!['prepared', 'rollback'].includes(journal.phase) || !Array.isArray(journal.files) || journal.files.length === 0) {
      throw new Error('配置事务阶段无效');
    }
    const keys = new Set();
    for (const item of journal.files) {
      if (!item || !this._configTransactionFilePath(item.key) || keys.has(item.key)) {
        throw new Error('配置事务文件清单无效');
      }
      if (!Object.hasOwn(item, 'before') || !Object.hasOwn(item, 'after')) {
        throw new Error('配置事务缺少前后快照');
      }
      keys.add(item.key);
    }
    if (!/^[a-f0-9]{64}$/.test(String(journal.checksum || ''))
        || this._configTransactionChecksum(journal) !== journal.checksum) {
      throw new Error('配置事务校验失败');
    }
    return journal;
  }

  _writeConfigTransactionJournal(journal) {
    journal.checksum = this._configTransactionChecksum(journal);
    this._writeJsonFileAtomic(this.transactionFile, journal);
  }

  _recoverPendingConfigTransaction() {
    if (this._configTransactionRecoveryAttempted || !this.transactionFile) return;
    this._configTransactionRecoveryAttempted = true;
    const status = {
      checkedAt: Date.now(),
      recovered: false,
      action: null,
      operation: null,
      needsReview: false,
      error: null
    };
    if (!fs.existsSync(this.transactionFile)) {
      this._configTransactionRecoveryStatus = status;
      return;
    }
    try {
      const transactionStat = fs.lstatSync(this.transactionFile);
      if (!transactionStat.isFile() || transactionStat.isSymbolicLink()) {
        throw new Error('配置事务记录不是普通文件');
      }
      if (transactionStat.size > MAX_CONFIG_TRANSACTION_BYTES) {
        throw new Error('配置事务记录超出安全大小限制');
      }
      const journal = this._validateConfigTransactionJournal(JSON.parse(fs.readFileSync(this.transactionFile, 'utf8')));
      const field = journal.phase === 'rollback' ? 'before' : 'after';
      for (const item of journal.files) {
        this._writeJsonFileAtomic(this._configTransactionFilePath(item.key), item[field]);
      }
      fs.rmSync(this.transactionFile, { force: true });
      status.recovered = true;
      status.action = journal.phase === 'rollback' ? 'rolled-back' : 'rolled-forward';
      status.operation = journal.operation;
    } catch (error) {
      status.needsReview = true;
      status.error = error?.message || String(error);
    }
    this._configTransactionRecoveryStatus = status;
  }

  getConfigTransactionRecoveryStatus() {
    this._ensureDirs();
    return this._cloneJson(this._configTransactionRecoveryStatus || {
      checkedAt: Date.now(), recovered: false, action: null, operation: null, needsReview: false, error: null
    });
  }

  _snapshotConfigTransactionFiles(keys) {
    return keys.map(key => {
      const cacheKey = this._configTransactionCacheKey(key);
      if (!this[cacheKey]) throw new Error(`配置尚未加载：${key}`);
      return { key, value: this._cloneJson(this[cacheKey]) };
    });
  }

  _restoreConfigTransactionCaches(snapshot) {
    for (const item of snapshot) {
      this[this._configTransactionCacheKey(item.key)] = this._cloneJson(item.value);
    }
  }

  _commitConfigTransaction(operation, beforeSnapshot, afterSnapshot) {
    if (this._configTransactionRecoveryStatus?.needsReview) {
      throw new Error('存在未解决的配置事务，已拒绝继续修改配置');
    }
    const afterByKey = new Map(afterSnapshot.map(item => [item.key, item.value]));
    const journal = {
      version: 1,
      id: `config_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      operation,
      phase: 'prepared',
      createdAt: Date.now(),
      files: beforeSnapshot.map(item => ({
        key: item.key,
        before: item.value,
        after: afterByKey.get(item.key)
      }))
    };

    try {
      this._writeConfigTransactionJournal(journal);
    } catch (error) {
      this._restoreConfigTransactionCaches(beforeSnapshot);
      throw error;
    }

    try {
      for (const item of journal.files) {
        this._writeJsonFileAtomic(this._configTransactionFilePath(item.key), item.after);
      }
    } catch (error) {
      const originalError = error;
      try {
        journal.phase = 'rollback';
        this._writeConfigTransactionJournal(journal);
        for (const item of [...journal.files].reverse()) {
          this._writeJsonFileAtomic(this._configTransactionFilePath(item.key), item.before);
        }
        this._restoreConfigTransactionCaches(beforeSnapshot);
        fs.rmSync(this.transactionFile, { force: true });
      } catch (rollbackError) {
        this._restoreConfigTransactionCaches(beforeSnapshot);
        this._configTransactionRecoveryStatus = {
          checkedAt: Date.now(),
          recovered: false,
          action: 'rollback-pending',
          operation,
          needsReview: true,
          error: rollbackError?.message || String(rollbackError)
        };
        const transactionError = new Error(`配置事务写入失败且回滚未完成：${originalError.message || String(originalError)}`);
        transactionError.code = 'CONFIG_TRANSACTION_NEEDS_REVIEW';
        throw transactionError;
      }
      throw originalError;
    }

    try { fs.rmSync(this.transactionFile, { force: true }); } catch (_) {}
    return { id: journal.id, operation, files: journal.files.map(item => item.key) };
  }

  _readJsonFile(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
      } catch (_) {}
      const recovered = typeof fallback === 'function' ? fallback() : fallback;
      this._writeJsonFileAtomic(filePath, recovered);
      return recovered;
    }
  }

  // ============ 基础配置 ============

  getConfig() {
    this._ensureDirs();
    if (!this.config) {
      if (fs.existsSync(this.configFile)) {
        this.config = this._readJsonFile(this.configFile, () => this._defaultConfig());
      } else {
        this.config = this._defaultConfig();
        this.saveConfig();
      }
    }
    return this.config;
  }

  _defaultConfig() {
    const homeDir = os.homedir();
    let defaultPath = path.join(homeDir, 'Projects');
    if (process.platform === 'win32') {
      defaultPath = path.join(homeDir, 'Projects');
    }
    return {
      defaultScanPath: defaultPath,
      autoRefresh: true,
      refreshInterval: 60,
      viewMode: 'tree',
      cardStyle: 'card',
      sortBy: 'name',
      sortOrder: 'asc',
      columnViewWidth: 260,
      rememberDirectoryViewPreferences: false,
      directoryViewPreferences: {},
      showHidden: false,
      sidebarWidth: 240,
      detailWidth: 320,
      theme: 'light',
      semanticColorProfile: SemanticColors.profileForPreset('finder'),
      autoFetch: false,
      favorites: [],
      treeRoots: [],
      smartCollections: { version: 1, collections: [] },
      projectShortcuts: ProjectShortcuts.defaultStore(),
      projectShortcutPreferences: ProjectShortcuts.defaultPreferences(),
      fileLabels: FileLabels.defaultStore()
    };
  }

  saveConfig() {
    this._writeJsonFileAtomic(this.configFile, this.config);
  }

  set(key, value) {
    const config = this.getConfig();
    config[key] = value;
    this.saveConfig();
    return config;
  }

  setRendererPreference(key, value) {
    if (!RENDERER_PREFERENCE_KEYS.has(key)) throw new Error(`不允许通过界面直接修改配置项：${String(key || '未知')}`);
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (_) {
      throw new Error('配置值无法序列化');
    }
    if (typeof serialized !== 'string') throw new Error('配置值格式无效');
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RENDERER_PREFERENCE_BYTES) {
      throw new Error('配置值超过界面写入大小限制');
    }
    const parsed = JSON.parse(serialized);
    return this.set(
      key,
      key === 'semanticColorProfile'
        ? SemanticColors.normalizeProfile(parsed)
        : (key === 'projectShortcuts'
            ? ProjectShortcuts.normalizeStore(parsed)
            : (key === 'projectShortcutPreferences' ? ProjectShortcuts.normalizePreferences(parsed) : parsed))
    );
  }

  get(key) {
    const config = this.getConfig();
    return config[key];
  }

  // ============ 本机文件标签 ============

  _fileLabelStore(config = this.getConfig()) {
    config.fileLabels = FileLabels.normalizeStore(config.fileLabels);
    return config.fileLabels;
  }

  _fileLabelPathKey(candidatePath) {
    const normalized = path.normalize(String(candidatePath || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  getFileLabels() {
    return this._cloneJson(this._fileLabelStore());
  }

  getFileLabelsForPaths(candidatePaths) {
    const paths = [...new Set((candidatePaths || []).map(candidatePath => path.normalize(String(candidatePath || ''))).filter(Boolean))];
    const keyed = FileLabels.labelsForPaths(this._fileLabelStore(), paths.map(candidatePath => this._fileLabelPathKey(candidatePath)));
    return Object.fromEntries(paths.map(candidatePath => [candidatePath, keyed[this._fileLabelPathKey(candidatePath)] || []]));
  }

  createFileLabel(name, color) {
    const config = this.getConfig();
    const result = FileLabels.createLabel(this._fileLabelStore(config), { name, color }, {
      idFactory: () => `fl_${crypto.randomUUID().replace(/-/g, '')}`
    });
    config.fileLabels = result.store;
    this.saveConfig();
    return this._cloneJson(result.label);
  }

  updateFileLabel(labelId, updates) {
    const config = this.getConfig();
    const result = FileLabels.updateLabel(this._fileLabelStore(config), labelId, updates);
    config.fileLabels = result.store;
    this.saveConfig();
    return this._cloneJson(result.label);
  }

  deleteFileLabel(labelId) {
    const config = this.getConfig();
    config.fileLabels = FileLabels.deleteLabel(this._fileLabelStore(config), labelId);
    this.saveConfig();
    return this._cloneJson(config.fileLabels);
  }

  updateFileLabelAssignments(candidatePaths, changes) {
    const config = this.getConfig();
    const paths = [...new Set((candidatePaths || []).map(candidatePath => path.normalize(String(candidatePath || ''))).filter(Boolean))];
    config.fileLabels = FileLabels.updateAssignments(
      this._fileLabelStore(config),
      paths.map(candidatePath => this._fileLabelPathKey(candidatePath)),
      changes
    );
    this.saveConfig();
    return this.getFileLabelsForPaths(paths);
  }

  // ============ 收藏夹 ============

  _favoritePathKey(candidatePath) {
    const normalized = path.normalize(String(candidatePath || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  _normalizeFavoriteDirectory(item, config = this.getConfig()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('收藏项格式无效');
    const rawPath = typeof item.path === 'string' ? item.path : '';
    if (!rawPath || rawPath.length > MAX_FAVORITE_PATH_LENGTH || rawPath.includes('\0') || !path.isAbsolute(rawPath)) {
      throw new Error('收藏夹只接受有效的绝对目录路径');
    }
    const directoryPath = path.normalize(rawPath);
    const roots = (config.treeRoots || []).map(root => path.normalize(String(root?.path || ''))).filter(Boolean);
    const containingRoot = roots
      .filter(rootPath => this._pathIsWithin(directoryPath, rootPath))
      .sort((left, right) => right.length - left.length)[0];
    if (!containingRoot) throw new Error('只能收藏已添加位置中的文件夹');

    let linkStat;
    try {
      linkStat = fs.lstatSync(directoryPath);
    } catch (_) {
      throw new Error('要收藏的文件夹不存在或没有读取权限');
    }
    if (linkStat.isSymbolicLink() || !linkStat.isDirectory()) throw new Error('收藏项必须是真实文件夹，不能是文件或符号链接');

    let realDirectory;
    let realRoot;
    try {
      realDirectory = fs.realpathSync.native(directoryPath);
      realRoot = fs.realpathSync.native(containingRoot);
    } catch (_) {
      throw new Error('无法验证收藏文件夹的真实路径');
    }
    if (!this._pathIsWithin(realDirectory, realRoot)) throw new Error('收藏文件夹通过符号链接离开受管位置');

    const cleanedName = String(item.name || path.basename(directoryPath) || directoryPath)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    return {
      id: directoryPath,
      type: 'directory',
      path: directoryPath,
      name: cleanedName || path.basename(directoryPath) || directoryPath
    };
  }

  getFavorites() {
    const config = this.getConfig();
    return config.favorites || [];
  }

  addFavorite(item) {
    const config = this.getConfig();
    if (!config.favorites) config.favorites = [];
    const normalized = this._normalizeFavoriteDirectory(item, config);
    const favoriteKey = this._favoritePathKey(normalized.path);
    const exists = config.favorites.find(favorite => favorite.path && this._favoritePathKey(favorite.path) === favoriteKey);
    if (!exists) {
      if (config.favorites.length >= MAX_FAVORITES) throw new Error(`收藏夹最多保存 ${MAX_FAVORITES} 个文件夹`);
      config.favorites.push({
        ...normalized,
        createdAt: Date.now()
      });
      this.saveConfig();
    }
    return config.favorites;
  }

  toggleFavoriteDirectory(directoryPath) {
    const config = this.getConfig();
    if (!config.favorites) config.favorites = [];
    const normalized = this._normalizeFavoriteDirectory({ path: directoryPath }, config);
    const favoriteKey = this._favoritePathKey(normalized.path);
    const existingIndex = config.favorites.findIndex(favorite => favorite.path && this._favoritePathKey(favorite.path) === favoriteKey);
    if (existingIndex >= 0) {
      config.favorites.splice(existingIndex, 1);
      this.saveConfig();
      return { favorited: false, favorite: normalized, favorites: config.favorites };
    }
    if (config.favorites.length >= MAX_FAVORITES) throw new Error(`收藏夹最多保存 ${MAX_FAVORITES} 个文件夹`);
    const favorite = { ...normalized, createdAt: Date.now() };
    config.favorites.push(favorite);
    this.saveConfig();
    return { favorited: true, favorite, favorites: config.favorites };
  }

  removeFavorite(id) {
    const config = this.getConfig();
    config.favorites = (config.favorites || []).filter(f => {
      const fid = f.id || f.path || (f.type === 'group' ? `group_${f.name}` : f.name);
      return fid !== id;
    });
    this.saveConfig();
    return config.favorites;
  }

  // ============ 目录树根目录 ============

  getTreeRoots() {
    const config = this.getConfig();
    return config.treeRoots || [];
  }

  _normalizeTreeRootDirectory(dirPath) {
    if (typeof dirPath !== 'string' || !dirPath || dirPath.length > MAX_FAVORITE_PATH_LENGTH) {
      throw new Error('目录路径无效');
    }
    if (dirPath.includes('\0') || !path.isAbsolute(dirPath)) throw new Error('目录必须使用绝对路径');
    const directoryPath = path.normalize(dirPath);
    let stat;
    try {
      stat = fs.statSync(directoryPath);
    } catch (_) {
      throw new Error('目录不存在或没有读取权限');
    }
    if (!stat.isDirectory()) throw new Error('添加位置必须是文件夹');
    try {
      fs.realpathSync.native(directoryPath);
    } catch (_) {
      throw new Error('无法验证目录的真实路径');
    }
    return directoryPath;
  }

  addTreeRoot(dirPath, name) {
    const config = this.getConfig();
    if (!config.treeRoots) config.treeRoots = [];
    const directoryPath = this._normalizeTreeRootDirectory(dirPath);
    const directoryKey = this._favoritePathKey(directoryPath);
    const exists = config.treeRoots.find(root => this._favoritePathKey(root.path) === directoryKey);
    if (!exists) {
      if (config.treeRoots.length >= MAX_TREE_ROOTS) throw new Error(`最多添加 ${MAX_TREE_ROOTS} 个受管位置`);
      const baseName = String(name || path.basename(directoryPath) || directoryPath)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160) || path.basename(directoryPath) || directoryPath;
      config.treeRoots.push({ path: directoryPath, name: baseName, expanded: true });
      this.saveConfig();
    }
    return config.treeRoots;
  }

  removeTreeRoot(dirPath) {
    const config = this.getConfig();
    config.treeRoots = (config.treeRoots || []).filter(r => r.path !== dirPath);
    this.saveConfig();
    return config.treeRoots;
  }

  updateTreeRoot(dirPath, updates) {
    const config = this.getConfig();
    const root = (config.treeRoots || []).find(r => r.path === dirPath);
    if (root) {
      if (Object.hasOwn(updates || {}, 'expanded') && typeof updates.expanded === 'boolean') {
        root.expanded = updates.expanded;
      }
      if (Object.hasOwn(updates || {}, 'name')) {
        const name = String(updates.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (name) root.name = name;
      }
      this.saveConfig();
    }
    return config.treeRoots;
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _normalizePathMappings(mappings) {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new Error('缺少需要同步的路径变更');
    }

    return mappings.map(mapping => {
      const from = path.resolve(String(mapping?.from || ''));
      const to = path.resolve(String(mapping?.to || ''));
      if (!mapping?.from || !mapping?.to || from === to) {
        throw new Error('路径变更无效');
      }
      return { from, to };
    });
  }

  _mapManagedPath(candidatePath, mappings) {
    if (!candidatePath) return candidatePath;
    const resolved = path.resolve(candidatePath);
    const mapping = mappings
      .filter(item => this._pathIsWithin(resolved, item.from))
      .sort((a, b) => b.from.length - a.from.length)[0];
    if (!mapping) return candidatePath;
    const relative = path.relative(mapping.from, resolved);
    return relative ? path.join(mapping.to, relative) : mapping.to;
  }

  _remapWorkspaceTabSession(config, mappings) {
    const session = config.workspaceTabSession;
    if (!session || typeof session !== 'object') return;
    for (const tab of [...(session.tabs || []), ...(session.closedTabs || [])]) {
      if (tab.path) {
        tab.path = this._mapManagedPath(tab.path, mappings);
        tab.title = path.basename(tab.path) || tab.title;
      }
      if (Array.isArray(tab.history)) {
        tab.history = tab.history.map(historyPath => this._mapManagedPath(historyPath, mappings));
      }
    }
  }

  _archiveWorkspaceTabs(config, sourcePaths) {
    const session = config.workspaceTabSession;
    if (!session || typeof session !== 'object') return null;
    const isArchivedPath = candidate => candidate && sourcePaths.some(sourcePath => this._pathIsWithin(candidate, sourcePath));
    const containingSource = candidate => sourcePaths
      .filter(sourcePath => candidate && this._pathIsWithin(candidate, sourcePath))
      .sort((left, right) => right.length - left.length)[0];
    const snapshot = { activeTabId: session.activeTabId, tabs: [], closedTabs: [] };

    for (const tab of session.tabs || []) {
      const affected = isArchivedPath(tab.path) || (tab.history || []).some(isArchivedPath);
      if (!affected) continue;
      snapshot.tabs.push(JSON.parse(JSON.stringify(tab)));
      const source = containingSource(tab.path) || sourcePaths.find(sourcePath => (tab.history || []).some(item => this._pathIsWithin(item, sourcePath)));
      const fallback = source ? path.dirname(source) : (config.treeRoots?.[0]?.path || '');
      tab.path = isArchivedPath(tab.path) ? fallback : tab.path;
      tab.title = path.basename(tab.path) || '新标签页';
      tab.history = (tab.history || []).filter(historyPath => !isArchivedPath(historyPath));
      if (tab.path && !tab.history.includes(tab.path)) tab.history.push(tab.path);
      if (tab.history.length > 50) tab.history = tab.history.slice(-50);
      tab.historyIndex = Math.max(0, tab.history.indexOf(tab.path));
    }

    session.closedTabs = (session.closedTabs || []).filter(tab => {
      const affected = isArchivedPath(tab.path) || (tab.history || []).some(isArchivedPath);
      if (affected) snapshot.closedTabs.push(JSON.parse(JSON.stringify(tab)));
      return !affected;
    });
    return snapshot.tabs.length || snapshot.closedTabs.length ? snapshot : null;
  }

  _restoreWorkspaceTabs(config, snapshot) {
    const session = config.workspaceTabSession;
    if (!session || !snapshot) return;
    if (!Array.isArray(session.tabs)) session.tabs = [];
    if (!Array.isArray(session.closedTabs)) session.closedTabs = [];
    const tabsById = new Map((session.tabs || []).map(tab => [tab.id, tab]));
    for (const savedTab of snapshot.tabs || []) {
      const existing = tabsById.get(savedTab.id);
      if (existing) Object.assign(existing, JSON.parse(JSON.stringify(savedTab)));
      else if ((session.tabs || []).length < 20) session.tabs.push(JSON.parse(JSON.stringify(savedTab)));
    }
    const knownIds = new Set([...(session.tabs || []), ...(session.closedTabs || [])].map(tab => tab.id));
    for (const savedTab of snapshot.closedTabs || []) {
      if (!knownIds.has(savedTab.id)) session.closedTabs.push(JSON.parse(JSON.stringify(savedTab)));
    }
    if ((snapshot.tabs || []).some(tab => tab.id === snapshot.activeTabId)) {
      session.activeTabId = snapshot.activeTabId;
    }
    session.closedTabs = (session.closedTabs || []).slice(0, 10);
  }

  validateRebindPaths(mappings) {
    const normalized = this._normalizePathMappings(mappings);
    const targetSet = new Set();
    for (const mapping of normalized) {
      if (targetSet.has(mapping.to)) throw new Error(`多个项目将指向同一目标：${mapping.to}`);
      targetSet.add(mapping.to);
    }

    const registry = this.getRegistry();
    const movingEntries = new Set();
    const plannedPaths = new Map();
    for (const entry of registry.repos || []) {
      const nextPath = this._mapManagedPath(entry.path, normalized);
      if (nextPath !== entry.path) {
        movingEntries.add(entry);
        plannedPaths.set(entry, nextPath);
      }
    }

    for (const [entry, nextPath] of plannedPaths) {
      const collision = (registry.repos || []).find(other => (
        other !== entry
        && !movingEntries.has(other)
        && path.resolve(other.path) === path.resolve(nextPath)
      ));
      if (collision) throw new Error(`目标路径已有仓库记录：${nextPath}`);
    }

    return normalized;
  }

  rebindPaths(mappings) {
    const normalized = this.validateRebindPaths(mappings);
    const registry = this.getRegistry();
    const repos = this.getRepos();
    const config = this.getConfig();
    const transactionKeys = ['registry', 'repos', 'config'];
    const beforeSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);

    try {
      for (const entry of registry.repos || []) {
        const nextPath = this._mapManagedPath(entry.path, normalized);
        if (nextPath !== entry.path) {
          entry.path = nextPath;
          entry.name = path.basename(nextPath);
        }
      }

      for (const repo of repos.repos || []) {
        const nextPath = this._mapManagedPath(repo.path, normalized);
        if (nextPath !== repo.path) {
          repo.path = nextPath;
          repo.name = path.basename(nextPath);
        }
      }

      for (const favorite of config.favorites || []) {
        if (!favorite.path) continue;
        const oldPath = favorite.path;
        const nextPath = this._mapManagedPath(oldPath, normalized);
        if (nextPath !== oldPath) {
          favorite.path = nextPath;
          favorite.name = path.basename(nextPath);
          if (favorite.id === oldPath) favorite.id = nextPath;
        }
      }

      for (const root of config.treeRoots || []) {
        const nextPath = this._mapManagedPath(root.path, normalized);
        if (nextPath !== root.path) {
          root.path = nextPath;
          root.name = path.basename(nextPath) || root.name;
        }
      }

      for (const key of ['lastPath', 'defaultScanPath']) {
        if (config[key]) config[key] = this._mapManagedPath(config[key], normalized);
      }

      this._remapWorkspaceTabSession(config, normalized);

      for (const key of ['projectControlSelections', 'markdownDocumentSelections', 'directoryViewPreferences']) {
        const stored = config[key];
        if (!stored || Array.isArray(stored) || typeof stored !== 'object') continue;
        const remapped = {};
        for (const [storedPath, value] of Object.entries(stored)) {
          remapped[this._mapManagedPath(storedPath, normalized)] = value;
        }
        config[key] = remapped;
      }

      const fileLabelStore = this._fileLabelStore(config);
      const remappedFileLabels = {};
      for (const [storedPath, labelIds] of Object.entries(fileLabelStore.assignments)) {
        const nextPath = this._fileLabelPathKey(this._mapManagedPath(storedPath, normalized));
        remappedFileLabels[nextPath] = [...new Set([...(remappedFileLabels[nextPath] || []), ...labelIds])]
          .slice(0, FileLabels.MAX_LABELS_PER_PATH);
      }
      fileLabelStore.assignments = remappedFileLabels;

      const afterSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);
      this._commitConfigTransaction('rebind-paths', beforeSnapshot, afterSnapshot);
    } catch (error) {
      this._restoreConfigTransactionCaches(beforeSnapshot);
      throw error;
    }
    return { mappings: normalized };
  }

  archivePaths(sourcePaths) {
    const paths = [...new Set((sourcePaths || []).map(sourcePath => path.resolve(sourcePath)))];
    if (paths.length === 0) throw new Error('缺少需要归档的路径');
    const registry = this.getRegistry();
    const repos = this.getRepos();
    const config = this.getConfig();
    const transactionKeys = ['registry', 'repos', 'config'];
    const beforeSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);
    const isArchivedPath = candidate => paths.some(sourcePath => this._pathIsWithin(candidate, sourcePath));
    const removedFavorites = (config.favorites || []).filter(favorite => favorite.path && isArchivedPath(favorite.path));
    const removedRepos = (repos.repos || []).filter(repo => isArchivedPath(repo.path));
    const archivedRepoIds = [];
    const workspaceTabSnapshot = this._archiveWorkspaceTabs(config, paths);
    const fileLabelStore = this._fileLabelStore(config);
    const removedFileLabelAssignments = Object.fromEntries(
      Object.entries(fileLabelStore.assignments)
        .filter(([assignedPath]) => isArchivedPath(assignedPath))
        .map(([assignedPath, labelIds]) => [assignedPath, [...labelIds]])
    );

    try {
      for (const entry of registry.repos || []) {
        if (isArchivedPath(entry.path)) {
          entry.archived = true;
          archivedRepoIds.push(entry.id);
        }
      }
      repos.repos = (repos.repos || []).filter(repo => !isArchivedPath(repo.path));
      config.favorites = (config.favorites || []).filter(favorite => !favorite.path || !isArchivedPath(favorite.path));
      for (const assignedPath of Object.keys(removedFileLabelAssignments)) {
        delete fileLabelStore.assignments[assignedPath];
      }

      const afterSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);
      this._commitConfigTransaction('archive-paths', beforeSnapshot, afterSnapshot);
    } catch (error) {
      this._restoreConfigTransactionCaches(beforeSnapshot);
      throw error;
    }
    return {
      removedFavorites,
      removedRepos,
      archivedRepoIds: [...new Set(archivedRepoIds)],
      workspaceTabSnapshot,
      removedFileLabelAssignments
    };
  }

  restoreArchivedPaths(sourcePaths, snapshot = {}) {
    const paths = [...new Set((sourcePaths || []).map(sourcePath => path.resolve(sourcePath)))];
    if (paths.length === 0) throw new Error('缺少需要恢复的路径');
    const registry = this.getRegistry();
    const repos = this.getRepos();
    const config = this.getConfig();
    const transactionKeys = ['registry', 'repos', 'config'];
    const beforeSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);
    const isRestoredPath = candidate => paths.some(sourcePath => this._pathIsWithin(candidate, sourcePath));
    const restoredIds = new Set(snapshot.archivedRepoIds || []);

    try {
      for (const entry of registry.repos || []) {
        if ((isRestoredPath(entry.path) || restoredIds.has(entry.id)) && fs.existsSync(entry.path)) {
          entry.archived = false;
        }
      }

      const repoPaths = new Set((repos.repos || []).map(repo => repo.path));
      for (const repo of snapshot.removedRepos || []) {
        if (fs.existsSync(repo.path) && !repoPaths.has(repo.path)) {
          repos.repos.push(repo);
          repoPaths.add(repo.path);
        }
      }

      const favoriteKeys = new Set((config.favorites || []).map(favorite => favorite.id || favorite.path));
      for (const favorite of snapshot.removedFavorites || []) {
        const key = favorite.id || favorite.path;
        if (favorite.path && fs.existsSync(favorite.path) && !favoriteKeys.has(key)) {
          config.favorites.push(favorite);
          favoriteKeys.add(key);
        }
      }

      this._restoreWorkspaceTabs(config, snapshot.workspaceTabSnapshot);

      const fileLabelStore = this._fileLabelStore(config);
      const knownLabelIds = new Set(fileLabelStore.labels.map(label => label.id));
      for (const [assignedPath, labelIds] of Object.entries(snapshot.removedFileLabelAssignments || {})) {
        if (!isRestoredPath(assignedPath) || !fs.existsSync(assignedPath)) continue;
        const restoredLabelIds = (Array.isArray(labelIds) ? labelIds : []).filter(labelId => knownLabelIds.has(labelId));
        if (!restoredLabelIds.length) continue;
        fileLabelStore.assignments[assignedPath] = [...new Set([
          ...(fileLabelStore.assignments[assignedPath] || []),
          ...restoredLabelIds
        ])].slice(0, FileLabels.MAX_LABELS_PER_PATH);
      }

      const afterSnapshot = this._snapshotConfigTransactionFiles(transactionKeys);
      this._commitConfigTransaction('restore-archived-paths', beforeSnapshot, afterSnapshot);
    } catch (error) {
      this._restoreConfigTransactionCaches(beforeSnapshot);
      throw error;
    }
    return { restoredPaths: paths };
  }

  // ============ 仓库注册表(repoId ↔ path 映射)============

  // 生成稳定项目 id：优先使用远程仓库地址，其次使用初始 commit。
  // 当前 HEAD 不能进入身份计算，否则每次提交都会让分类、标签和任务关联失效。
  generateRepoId(repoPath) {
    const gitIdentity = this._getGitIdentity(repoPath);
    const originId = this._idFromOriginUrl(gitIdentity.originUrl);
    if (originId) return originId;

    if (gitIdentity.rootCommit) {
      return `r_${gitIdentity.rootCommit.substr(0, 12)}`;
    }

    return 'r_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
  }

  _getGitIdentity(repoPath) {
    return {
      rootCommit: this._getRootCommit(repoPath),
      headCommit: this._getHeadCommit(repoPath),
      originUrl: this._getOriginUrl(repoPath)
    };
  }

  _getRootCommit(repoPath) {
    try {
      const output = execSync('git rev-list --max-parents=0 HEAD', {
        cwd: repoPath, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      const lines = output.split('\n').filter(l => /^[0-9a-f]{40}$/.test(l));
      if (lines.length > 0) {
        // 取最早的那个 root commit(输出最后一行)
        const rootHash = lines[lines.length - 1];
        return rootHash;
      }
    } catch (e) { /* 空仓库或非 git 目录,继续 fallback */ }
    return null;
  }

  _getHeadCommit(repoPath) {
    try {
      const output = execSync('git rev-parse HEAD', {
        cwd: repoPath, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return /^[0-9a-f]{40}$/.test(output) ? output : null;
    } catch (e) { return null; }
  }

  _normalizeOriginUrl(url) {
    if (!url) return '';
    return String(url)
      .trim()
      .replace(/\.git$/, '')
      .replace(/^git@([^:]+):/, 'https://$1/')
      .toLowerCase();
  }

  _idFromOriginUrl(url) {
    const normalized = this._normalizeOriginUrl(url);
    if (!normalized) return null;
    return 'r_' + crypto.createHash('sha256').update(normalized).digest('hex').substr(0, 12);
  }

  // 获取 origin URL(用于 registry 记录,也作为无 commit 时的兜底 id 来源)
  _getOriginUrl(repoPath) {
    try {
      return execSync('git remote get-url origin', {
        cwd: repoPath, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore']
      }).trim() || null;
    } catch (e) { return null; }
  }

  getRegistry() {
    this._ensureDirs();
    if (!this.registry) {
      if (fs.existsSync(this.registryFile)) {
        this.registry = this._readJsonFile(this.registryFile, { version: 1, repos: [] });
        this._repairRegistryIds();
        this._syncRegistryArchivedState();
      } else {
        this.registry = { version: 1, repos: [] };
        this.saveRegistry();
      }
    }
    return this.registry;
  }

  _repairRegistryIds() {
    if (!this.registry || this._repairingRegistry) return;
    const repos = this.registry.repos || [];

    const replacements = new Map();
    let changed = false;
    this._repairingRegistry = true;
    try {
      for (const entry of repos) {
        const oldId = entry.id;
        if (!oldId) continue;
        const nextId = this._stableIdForRegistryEntry(entry);
        if (nextId && nextId !== oldId) {
          entry.id = nextId;
          if (!replacements.has(oldId)) replacements.set(oldId, new Set());
          replacements.get(oldId).add(nextId);
          changed = true;
        }
      }

      if (changed) {
        this.saveRegistry();
        for (const [oldId, newIds] of replacements.entries()) {
          this._replaceRepoIdInStoredData(oldId, [...newIds]);
        }
      }
      if (this._removeSupersededRegistryEntries()) {
        this.saveRegistry();
      }
    } finally {
      this._repairingRegistry = false;
    }
  }

  _removeSupersededRegistryEntries() {
    const repos = this.registry?.repos || [];
    const existingIds = new Set(
      repos.filter(entry => entry.path && fs.existsSync(entry.path)).map(entry => entry.id)
    );
    const seen = new Set();
    const next = [];
    let changed = false;

    for (const entry of repos) {
      const key = `${entry.id}\u0000${entry.path}`;
      const isMissingDuplicate = existingIds.has(entry.id)
        && entry.path
        && !fs.existsSync(entry.path);
      if (seen.has(key) || isMissingDuplicate) {
        changed = true;
        continue;
      }
      seen.add(key);
      next.push(entry);
    }

    if (changed) this.registry.repos = next;
    return changed;
  }

  _stableIdForRegistryEntry(entry) {
    if (entry.path && fs.existsSync(entry.path)) {
      return this.generateRepoId(entry.path);
    }
    const originId = this._idFromOriginUrl(entry.originUrl);
    return originId || entry.id;
  }

  _replaceRepoIdInStoredData(oldId, newIds) {
    const uniqueNewIds = [...new Set(newIds.filter(Boolean))];
    if (!uniqueNewIds.length) return;
    this._replaceRepoIdInGroupsData(oldId, uniqueNewIds);
    this._replaceRepoIdInTagsData(oldId, uniqueNewIds);
    this._syncRepoIdsFromRegistry();
  }

  _replaceRepoIdInGroupsData(oldId, newIds) {
    const replaceList = (ids = []) => {
      const result = [];
      for (const id of ids) {
        if (id === oldId) {
          result.push(...newIds);
        } else {
          result.push(id);
        }
      }
      return [...new Set(result)];
    };

    if (this.groups) {
      for (const group of this.groups.groups || []) {
        group.repoIds = replaceList(group.repoIds);
      }
      this.groups.ungroupedIds = replaceList(this.groups.ungroupedIds);
      this.saveGroups();
      return;
    }

    if (!fs.existsSync(this.groupsFile)) return;
    const data = this._readJsonFile(this.groupsFile, { version: 2, groups: [], ungroupedIds: [] });
    for (const group of data.groups || []) {
      group.repoIds = replaceList(group.repoIds);
    }
    data.ungroupedIds = replaceList(data.ungroupedIds);
    this._writeJsonFileAtomic(this.groupsFile, data);
  }

  _replaceRepoIdInTagsData(oldId, newIds) {
    const apply = (data) => {
      if (!data.repoTags || !data.repoTags[oldId]) return false;
      const tagIds = data.repoTags[oldId];
      for (const newId of newIds) {
        data.repoTags[newId] = [...new Set([...(data.repoTags[newId] || []), ...tagIds])];
      }
      delete data.repoTags[oldId];
      return true;
    };

    if (this.tags) {
      if (apply(this.tags)) this.saveTags();
      return;
    }

    if (!fs.existsSync(this.tagsFile)) return;
    const data = this._readJsonFile(this.tagsFile, { version: 2, tags: [], repoTags: {} });
    if (apply(data)) {
      this._writeJsonFileAtomic(this.tagsFile, data);
    }
  }

  _syncRepoIdsFromRegistry() {
    const pathToId = new Map((this.registry.repos || []).map(r => [r.path, r.id]));
    const apply = (data) => {
      let changed = false;
      for (const repo of data.repos || []) {
        const nextId = pathToId.get(repo.path);
        if (nextId && repo.id !== nextId) {
          repo.id = nextId;
          changed = true;
        }
      }
      return changed;
    };

    if (this.repos) {
      if (apply(this.repos)) this.saveRepos();
      return;
    }

    if (!fs.existsSync(this.reposFile)) return;
    const data = this._readJsonFile(this.reposFile, { version: 2, lastScanAt: 0, repos: [] });
    if (apply(data)) {
      this._writeJsonFileAtomic(this.reposFile, data);
    }
  }

  _syncRegistryArchivedState() {
    if (!this.registry || !fs.existsSync(this.reposFile)) return;
    let reposData;
    try {
      reposData = this._readJsonFile(this.reposFile, { version: 2, lastScanAt: 0, repos: [] });
    } catch (e) {
      return;
    }
    const activePaths = new Set((reposData.repos || []).map(r => r.path));
    if (activePaths.size === 0) return;

    let changed = false;
    for (const entry of this.registry.repos || []) {
      const archived = !activePaths.has(entry.path);
      if (entry.archived !== archived) {
        entry.archived = archived;
        changed = true;
      }
    }
    if (changed) this.saveRegistry();
  }

  saveRegistry() {
    this._ensureDirs();
    this._writeJsonFileAtomic(this.registryFile, this.registry);
  }

  // 通过 path 获取已存在的 id(只读,不创建)
  getIdByPath(repoPath) {
    const reg = this.getRegistry();
    const entry = reg.repos.find(r => r.path === repoPath);
    return entry ? entry.id : null;
  }

  // 通过 id 获取 path
  getPathById(repoId) {
    const reg = this.getRegistry();
    const entry = reg.repos.find(r => r.id === repoId);
    return entry ? entry.path : null;
  }

  // 通过 path 获取 id,若不存在则创建新条目
  // options: { name, scanRefresh(更新 lastScannedAt) }
  ensureRepoId(repoPath, options = {}) {
    const reg = this.getRegistry();
    let entry = reg.repos.find(r => r.path === repoPath);
    const now = Date.now();
    if (entry) {
      // 已存在:若 archived 则恢复;更新扫描时间
      if (entry.archived) entry.archived = false;
      if (options.name && entry.name !== options.name) entry.name = options.name;
      if (options.scanRefresh !== false) entry.lastScannedAt = now;
      this.saveRegistry();
      return entry.id;
    }
    // 不存在：先用稳定身份匹配已经移动且旧路径已失效的注册项。
    const id = this.generateRepoId(repoPath);
    const relocated = reg.repos.find(r => r.id === id && r.path && !fs.existsSync(r.path));
    if (relocated) {
      relocated.path = repoPath;
      relocated.originUrl = this._getOriginUrl(repoPath);
      relocated.name = options.name || path.basename(repoPath);
      relocated.lastScannedAt = now;
      relocated.archived = false;
      reg.repos = reg.repos.filter(r => r === relocated || r.id !== id || !r.path || fs.existsSync(r.path));
      this.saveRegistry();
      return relocated.id;
    }

    entry = {
      id,
      path: repoPath,
      originUrl: this._getOriginUrl(repoPath),
      name: options.name || path.basename(repoPath),
      addedAt: now,
      lastScannedAt: now,
      archived: false
    };
    reg.repos.push(entry);
    this.saveRegistry();
    return id;
  }

  // 列出所有归档仓库(本地已删除但保留配置的)
  listArchived() {
    const reg = this.getRegistry();
    return reg.repos.filter(r => r.archived);
  }

  // 列出所有活跃仓库
  listActive() {
    const reg = this.getRegistry();
    return reg.repos.filter(r => !r.archived);
  }

  // 重新生成仓库 id(应对 hash 冲突或 id 损坏)
  // 注意:此操作会更新 registry 中的 id,但不会自动同步到 groups/tags 中的关联
  // 调用方需自行处理关联迁移,或调用 rebindRepoId
  regenerateRepoId(repoPath) {
    const reg = this.getRegistry();
    const entry = reg.repos.find(r => r.path === repoPath);
    if (!entry) return null;
    const oldId = entry.id;
    const newId = this.generateRepoId(repoPath);
    if (oldId === newId) return newId;
    entry.id = newId;
    this.saveRegistry();
    // 同步迁移 groups 和 tags 中的关联
    this._rebindIdInGroups(oldId, newId);
    this._rebindIdInTags(oldId, newId);
    return newId;
  }

  // 把 groups 中 oldId 替换为 newId
  _rebindIdInGroups(oldId, newId) {
    const groupsData = this.getGroups();
    let changed = false;
    for (const g of groupsData.groups) {
      if (g.repoIds && g.repoIds.includes(oldId)) {
        g.repoIds = g.repoIds.map(id => id === oldId ? newId : id);
        changed = true;
      }
    }
    if (groupsData.ungroupedIds && groupsData.ungroupedIds.includes(oldId)) {
      groupsData.ungroupedIds = groupsData.ungroupedIds.map(id => id === oldId ? newId : id);
      changed = true;
    }
    if (changed) this.saveGroups();
  }

  // 把 tags.repoTags 中 oldId 替换为 newId
  _rebindIdInTags(oldId, newId) {
    const tagsData = this.getTags();
    if (tagsData.repoTags[oldId]) {
      tagsData.repoTags[newId] = tagsData.repoTags[oldId];
      delete tagsData.repoTags[oldId];
      this.saveTags();
    }
  }

  // ============ 仓库组 ============

  getGroups() {
    this._ensureDirs();
    if (!this.groups) {
      if (fs.existsSync(this.groupsFile)) {
        this.groups = this._readJsonFile(this.groupsFile, { version: 2, groups: [], ungroupedIds: [] });
        this._migrateGroupsV1toV2();
      } else {
        this.groups = { version: 2, groups: [], ungroupedIds: [] };
        this.saveGroups();
      }
    }
    // 返回前附加 repoPaths 字段(向后兼容渲染层)
    return this._attachPathsToGroups(this.groups);
  }

  // 把内存中的 groups 从 v1(repoPaths)迁移到 v2(repoIds)
  _migrateGroupsV1toV2() {
    if (!this.groups || this.groups.version === 2) return;
    const oldGroups = this.groups.groups || [];
    for (const g of oldGroups) {
      if (g.repoPaths && !g.repoIds) {
        g.repoIds = g.repoPaths.map(p => this.ensureRepoId(p));
      }
    }
    if (this.groups.ungrouped && !this.groups.ungroupedIds) {
      this.groups.ungroupedIds = this.groups.ungrouped.map(p => this.ensureRepoId(p));
    }
    this.groups.version = 2;
    this.saveGroups();
  }

  // 返回前在 group 上附加 repoPaths 字段(基于 registry 翻译)
  // 不修改磁盘存储,只影响返回给调用方的对象
  _attachPathsToGroups(groupsData) {
    const reg = this.getRegistry();
    const idToPaths = new Map();
    for (const repo of reg.repos) {
      if (repo.archived) continue;
      if (!repo.id || !repo.path) continue;
      if (!idToPaths.has(repo.id)) idToPaths.set(repo.id, []);
      idToPaths.get(repo.id).push(repo.path);
    }
    const translate = (ids) => {
      const paths = [];
      for (const id of ids || []) {
        paths.push(...(idToPaths.get(id) || []));
      }
      return [...new Set(paths)];
    };
    // 浅拷贝顶层 + 深拷贝 groups 数组,避免渲染层修改污染内存
    const result = { ...groupsData, groups: groupsData.groups.map(g => ({ ...g })) };
    for (const g of result.groups) {
      g.repoPaths = translate(g.repoIds);
    }
    result.ungrouped = translate(result.ungroupedIds);
    return result;
  }

  saveGroups() {
    this._writeJsonFileAtomic(this.groupsFile, this.groups);
  }

  createGroup(name, color = '#007AFF', icon = 'folder') {
    this.getGroups();  // 触发加载/迁移
    const id = 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this.groups.groups.push({
      id,
      name,
      color,
      icon,
      repoIds: [],
      collapsed: false
    });
    this.saveGroups();
    return this._attachPathsToGroups(this.groups);
  }

  updateGroup(id, updates) {
    this.getGroups();
    const group = this.groups.groups.find(g => g.id === id);
    if (group) {
      Object.assign(group, updates);
      this.saveGroups();
    }
    return this._attachPathsToGroups(this.groups);
  }

  deleteGroup(id) {
    this.getGroups();
    const group = this.groups.groups.find(g => g.id === id);
    if (group) {
      // 把该组下的 repoId 合并到 ungroupedIds(去重)
      const ids = group.repoIds || [];
      const existing = new Set(this.groups.ungroupedIds || []);
      for (const rid of ids) {
        if (!existing.has(rid)) this.groups.ungroupedIds.push(rid);
      }
      this.groups.groups = this.groups.groups.filter(g => g.id !== id);
      this.saveGroups();
    }
    return this._attachPathsToGroups(this.groups);
  }

  // 接受 repoPath(向后兼容渲染层),内部翻译为 repoId 存储
  addRepoToGroup(groupId, repoPath) {
    this.getGroups();
    const group = this.groups.groups.find(g => g.id === groupId);
    if (group) {
      const repoId = this.ensureRepoId(repoPath);
      if (!group.repoIds) group.repoIds = [];
      if (!group.repoIds.includes(repoId)) {
        group.repoIds.push(repoId);
      }
      this.groups.ungroupedIds = (this.groups.ungroupedIds || []).filter(id => id !== repoId);
      this.saveGroups();
    }
    return this._attachPathsToGroups(this.groups);
  }

  removeRepoFromGroup(groupId, repoPath) {
    this.getGroups();
    const group = this.groups.groups.find(g => g.id === groupId);
    if (group) {
      const repoId = this.getIdByPath(repoPath);
      if (repoId) {
        group.repoIds = (group.repoIds || []).filter(id => id !== repoId);
        if (!(this.groups.ungroupedIds || []).includes(repoId)) {
          this.groups.ungroupedIds.push(repoId);
        }
        this.saveGroups();
      }
    }
    return this._attachPathsToGroups(this.groups);
  }

  autoDetectGroups(rootPath, repos) {
    this.getGroups();
    const dirMap = new Map();

    repos.forEach(repo => {
      const relativePath = path.relative(rootPath, repo.path);
      const parts = relativePath.split(path.sep);
      const repoId = this.ensureRepoId(repo.path, { name: repo.name });
      if (parts.length > 1) {
        const groupName = parts[0];
        if (!dirMap.has(groupName)) {
          dirMap.set(groupName, []);
        }
        dirMap.get(groupName).push(repoId);
      } else {
        if (!(this.groups.ungroupedIds || []).includes(repoId)) {
          this.groups.ungroupedIds.push(repoId);
        }
      }
    });

    const colors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FFCC00', '#5AC8FA', '#FF2D55'];
    let colorIndex = 0;

    dirMap.forEach((repoIds, name) => {
      const exists = this.groups.groups.find(g => g.name === name);
      if (!exists) {
        this.groups.groups.push({
          id: 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          name,
          color: colors[colorIndex % colors.length],
          icon: 'folder',
          repoIds,
          collapsed: false
        });
        colorIndex++;
      }
    });

    this.groups.ungroupedIds = [...new Set(this.groups.ungroupedIds || [])];
    this.saveGroups();
    return this._attachPathsToGroups(this.groups);
  }

  // ============ 标签 ============

  getTags() {
    this._ensureDirs();
    if (!this.tags) {
      if (fs.existsSync(this.tagsFile)) {
        this.tags = this._readJsonFile(this.tagsFile, { version: 2, tags: [], repoTags: {} });
        this._migrateTagsV1toV2();
      } else {
        this.tags = { version: 2, tags: [], repoTags: {} };
        this.saveTags();
      }
    }
    return this.tags;
  }

  // 把内存中的 tags 从 v1(repoTags key=path)迁移到 v2(key=repoId)
  _migrateTagsV1toV2() {
    if (!this.tags || this.tags.version === 2) return;
    const oldRepoTags = this.tags.repoTags || {};
    const newRepoTags = {};
    for (const [repoPath, tagIds] of Object.entries(oldRepoTags)) {
      // 检测 key 是 path(包含 / 或 \)还是已经是 repoId(以 r_ 开头)
      if (/^r_[0-9a-z]+$/.test(repoPath)) {
        // 已经是 repoId,直接保留
        newRepoTags[repoPath] = tagIds;
      } else {
        const repoId = this.ensureRepoId(repoPath);
        newRepoTags[repoId] = tagIds;
      }
    }
    this.tags.repoTags = newRepoTags;
    this.tags.version = 2;
    this.saveTags();
  }

  saveTags() {
    this._writeJsonFileAtomic(this.tagsFile, this.tags);
  }

  createTag(name, color = '#007AFF') {
    this.getTags();
    const exists = this.tags.tags.find(t => t.name === name);
    if (exists) return this.tags;

    const id = 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this.tags.tags.push({ id, name, color, description: '' });
    this.saveTags();
    return this.tags;
  }

  updateTag(id, updates) {
    this.getTags();
    const tag = this.tags.tags.find(t => t.id === id);
    if (tag) {
      Object.assign(tag, updates);
      this.saveTags();
    }
    return this.tags;
  }

  deleteTag(id) {
    this.getTags();
    this.tags.tags = this.tags.tags.filter(t => t.id !== id);
    Object.keys(this.tags.repoTags).forEach(repoId => {
      this.tags.repoTags[repoId] = this.tags.repoTags[repoId].filter(tid => tid !== id);
    });
    this.saveTags();
    return this.tags;
  }

  // 接受 repoPath(向后兼容渲染层),内部翻译为 repoId 存储
  addTagToRepo(tagId, repoPath) {
    this.getTags();
    const repoId = this.ensureRepoId(repoPath);
    if (!this.tags.repoTags[repoId]) {
      this.tags.repoTags[repoId] = [];
    }
    if (!this.tags.repoTags[repoId].includes(tagId)) {
      this.tags.repoTags[repoId].push(tagId);
      this.saveTags();
    }
    return this.tags;
  }

  removeTagFromRepo(tagId, repoPath) {
    this.getTags();
    const repoId = this.getIdByPath(repoPath);
    if (repoId && this.tags.repoTags[repoId]) {
      this.tags.repoTags[repoId] = this.tags.repoTags[repoId].filter(id => id !== tagId);
      this.saveTags();
    }
    return this.tags;
  }

  getRepoTags(repoPath) {
    this.getTags();
    const repoId = this.getIdByPath(repoPath);
    const tagIds = (repoId && this.tags.repoTags[repoId]) || [];
    return this.tags.tags.filter(t => tagIds.includes(t.id));
  }

  // ============ 仓库列表持久化 ============

  getRepos() {
    this._ensureDirs();
    if (!this.repos) {
      if (fs.existsSync(this.reposFile)) {
        this.repos = this._readJsonFile(this.reposFile, { version: 2, lastScanAt: 0, repos: [] });
        this._migrateReposV1toV2();
      } else {
        this.repos = { version: 2, lastScanAt: 0, repos: [] };
      }
    }
    return this.repos;
  }

  // 把内存中的 repos 从 v1(无 id)迁移到 v2(有 id 字段)
  _migrateReposV1toV2() {
    if (!this.repos || this.repos.version === 2) return;
    for (const r of this.repos.repos) {
      if (!r.id) {
        // scanRefresh: false 避免迁移时刷新所有 lastScannedAt
        r.id = this.ensureRepoId(r.path, { name: r.name, scanRefresh: false });
      }
    }
    this.repos.version = 2;
    this.saveRepos();
  }

  saveRepos() {
    this._ensureDirs();
    this._writeJsonFileAtomic(this.reposFile, this.repos);
  }

  // 覆盖保存整个仓库列表
  // 不在新列表中的旧仓库:在 registry 中标记 archived=true(保留 groups/tags 关联)
  // repos.json 只反映"当前扫描到的活跃仓库"
  setRepos(repos, lastScanAt = Date.now()) {
    this.getRepos();
    this.getRegistry();
    const now = Date.now();
    const newPathSet = new Set();
    const existingMap = new Map((this.repos.repos || []).map(r => [r.path, r]));
    const existingIdMap = new Map((this.repos.repos || []).map(r => [r.id, r]));
    this.repos.repos = repos.map(r => {
      const repoId = this.ensureRepoId(r.path, { name: r.name });
      newPathSet.add(r.path);
      const existing = existingMap.get(r.path) || existingIdMap.get(repoId);
      return {
        id: repoId,
        path: r.path,
        name: r.name || path.basename(r.path),
        addedAt: existing?.addedAt || now,
        lastScannedAt: now
      };
    });
    this.repos.lastScanAt = lastScanAt;
    this.saveRepos();

    // 在 registry 中把本次未扫描到的旧路径标记为 archived
    const reg = this.getRegistry();
    for (const entry of reg.repos) {
      if (newPathSet.has(entry.path)) {
        entry.archived = false;
        entry.lastScannedAt = now;
      } else {
        entry.archived = true;
      }
    }
    this.saveRegistry();
    return this.repos;
  }

  // 合并新增仓库(去重,保留已有 addedAt)
  mergeRepos(newRepos) {
    this.getRepos();
    const now = Date.now();
    const existingMap = new Map((this.repos.repos || []).map(r => [r.path, r]));
    for (const r of newRepos) {
      const repoId = this.ensureRepoId(r.path, { name: r.name });
      const existing = existingMap.get(r.path);
      if (existing) {
        existing.lastScannedAt = now;
        if (r.name && existing.name !== r.name) existing.name = r.name;
      } else {
        this.repos.repos.push({
          id: repoId,
          path: r.path,
          name: r.name || path.basename(r.path),
          addedAt: now,
          lastScannedAt: now
        });
      }
    }
    this.repos.lastScanAt = now;
    this.saveRepos();
    return this.repos;
  }

  // 把单个仓库从 repos.json 移除,并在 registry 中标记 archived(保留配置)
  removeRepo(repoPath) {
    this.getRepos();
    this.repos.repos = (this.repos.repos || []).filter(r => r.path !== repoPath);
    this.saveRepos();
    // 在 registry 中标记 archived
    const repoId = this.getIdByPath(repoPath);
    if (repoId) {
      const reg = this.getRegistry();
      const entry = reg.repos.find(r => r.id === repoId);
      if (entry) {
        entry.archived = true;
        this.saveRegistry();
      }
    }
    return this.repos;
  }

  // 彻底删除仓库的所有痕迹(registry + groups + tags 中的关联)
  // 用于用户主动选择"永久删除"归档仓库时
  purgeRepo(repoId) {
    // 1. 从 registry 移除
    const reg = this.getRegistry();
    reg.repos = reg.repos.filter(r => r.id !== repoId);
    this.saveRegistry();
    // 2. 从 repos.json 移除(若存在)
    this.getRepos();
    this.repos.repos = (this.repos.repos || []).filter(r => r.id !== repoId);
    this.saveRepos();
    // 3. 从 groups 中移除
    this.getGroups();
    for (const g of this.groups.groups) {
      g.repoIds = (g.repoIds || []).filter(id => id !== repoId);
    }
    this.groups.ungroupedIds = (this.groups.ungroupedIds || []).filter(id => id !== repoId);
    this.saveGroups();
    // 4. 从 tags.repoTags 移除
    this.getTags();
    if (this.tags.repoTags[repoId]) {
      delete this.tags.repoTags[repoId];
      this.saveTags();
    }
    return { purged: true };
  }

  clearRepos() {
    this.getRepos();
    // 把所有当前活跃仓库标记为 archived(保留 registry 关联)
    const reg = this.getRegistry();
    for (const entry of reg.repos) {
      if (!entry.archived) entry.archived = true;
    }
    this.saveRegistry();
    this.repos.repos = [];
    this.repos.lastScanAt = 0;
    this.saveRepos();
    return this.repos;
  }
}

module.exports = new ConfigService();
