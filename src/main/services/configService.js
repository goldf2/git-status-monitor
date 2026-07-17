const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { app } = require('electron');

class ConfigService {
  constructor() {
    this.configDir = null;
    this.configFile = null;
    this.groupsFile = null;
    this.tagsFile = null;
    this.reposFile = null;
    this.registryFile = null;   // 新增:仓库 id↔path 映射注册表
    this.config = null;
    this.groups = null;
    this.tags = null;
    this.repos = null;
    this.registry = null;       // 新增:repoRegistry 内存缓存
    this._migrated = false;     // 迁移标志,避免重复执行
    this._repairingRegistry = false;
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

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // ============ 基础配置 ============

  getConfig() {
    this._ensureDirs();
    if (!this.config) {
      if (fs.existsSync(this.configFile)) {
        this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
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
      showHidden: false,
      sidebarWidth: 240,
      detailWidth: 320,
      theme: 'light',
      autoFetch: false,
      favorites: [],
      treeRoots: []
    };
  }

  saveConfig() {
    fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
  }

  set(key, value) {
    const config = this.getConfig();
    config[key] = value;
    this.saveConfig();
    return config;
  }

  get(key) {
    const config = this.getConfig();
    return config[key];
  }

  // ============ 收藏夹 ============

  getFavorites() {
    const config = this.getConfig();
    return config.favorites || [];
  }

  addFavorite(item) {
    const config = this.getConfig();
    if (!config.favorites) config.favorites = [];
    const id = item.id || item.path || `group_${item.name}`;
    const exists = config.favorites.find(f => (f.id || f.path || (f.type === 'group' ? `group_${f.name}` : f.name)) === id);
    if (!exists) {
      config.favorites.push({
        id,
        type: item.type || 'dir',
        path: item.path || '',
        name: item.name || '',
        groupId: item.groupId || null,
        createdAt: Date.now()
      });
      this.saveConfig();
    }
    return config.favorites;
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

  addTreeRoot(dirPath, name) {
    const config = this.getConfig();
    if (!config.treeRoots) config.treeRoots = [];
    const exists = config.treeRoots.find(r => r.path === dirPath);
    if (!exists) {
      const baseName = name || path.basename(dirPath) || dirPath;
      config.treeRoots.push({ path: dirPath, name: baseName, expanded: true });
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
      Object.assign(root, updates);
      this.saveConfig();
    }
    return config.treeRoots;
  }

  // ============ 仓库注册表(repoId ↔ path 映射)============

  // 生成项目 id:初始 commit 表示仓库血缘,当前 HEAD 表示当前状态
  // 同一血缘且同一 HEAD 的多个本地目录共享分类;任一目录提交更新后 HEAD 改变,自动分裂为独立项目
  generateRepoId(repoPath) {
    const gitIdentity = this._getGitIdentity(repoPath);
    if (gitIdentity.rootCommit && gitIdentity.headCommit) {
      return `r_${gitIdentity.rootCommit.substr(0, 12)}_${gitIdentity.headCommit.substr(0, 12)}`;
    }

    const originId = this._idFromOriginUrl(gitIdentity.originUrl);
    if (originId) return originId;

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
        try {
          this.registry = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'));
          this._repairRegistryIds();
          this._syncRegistryArchivedState();
        } catch (e) {
          this.registry = { version: 1, repos: [] };
        }
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
    } finally {
      this._repairingRegistry = false;
    }
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
    const data = JSON.parse(fs.readFileSync(this.groupsFile, 'utf-8'));
    for (const group of data.groups || []) {
      group.repoIds = replaceList(group.repoIds);
    }
    data.ungroupedIds = replaceList(data.ungroupedIds);
    fs.writeFileSync(this.groupsFile, JSON.stringify(data, null, 2));
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
    const data = JSON.parse(fs.readFileSync(this.tagsFile, 'utf-8'));
    if (apply(data)) {
      fs.writeFileSync(this.tagsFile, JSON.stringify(data, null, 2));
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
    const data = JSON.parse(fs.readFileSync(this.reposFile, 'utf-8'));
    if (apply(data)) {
      fs.writeFileSync(this.reposFile, JSON.stringify(data, null, 2));
    }
  }

  _syncRegistryArchivedState() {
    if (!this.registry || !fs.existsSync(this.reposFile)) return;
    let reposData;
    try {
      reposData = JSON.parse(fs.readFileSync(this.reposFile, 'utf-8'));
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
    fs.writeFileSync(this.registryFile, JSON.stringify(this.registry, null, 2));
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
    // 不存在:生成新 id
    const id = this.generateRepoId(repoPath);
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
        this.groups = JSON.parse(fs.readFileSync(this.groupsFile, 'utf-8'));
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
    fs.writeFileSync(this.groupsFile, JSON.stringify(this.groups, null, 2));
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
        this.tags = JSON.parse(fs.readFileSync(this.tagsFile, 'utf-8'));
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
    fs.writeFileSync(this.tagsFile, JSON.stringify(this.tags, null, 2));
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
        try {
          this.repos = JSON.parse(fs.readFileSync(this.reposFile, 'utf-8'));
          this._migrateReposV1toV2();
        } catch (e) {
          this.repos = { version: 2, lastScanAt: 0, repos: [] };
        }
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
    fs.writeFileSync(this.reposFile, JSON.stringify(this.repos, null, 2));
  }

  // 覆盖保存整个仓库列表
  // 不在新列表中的旧仓库:在 registry 中标记 archived=true(保留 groups/tags 关联)
  // repos.json 只反映"当前扫描到的活跃仓库"
  setRepos(repos, lastScanAt = Date.now()) {
    this.getRepos();
    const now = Date.now();
    const newPathSet = new Set();
    const existingMap = new Map((this.repos.repos || []).map(r => [r.path, r]));
    this.repos.repos = repos.map(r => {
      const repoId = this.ensureRepoId(r.path, { name: r.name });
      newPathSet.add(r.path);
      const existing = existingMap.get(r.path);
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
