const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

class ConfigService {
  constructor() {
    this.configDir = null;
    this.configFile = null;
    this.groupsFile = null;
    this.tagsFile = null;
    this.reposFile = null;
    this.config = null;
    this.groups = null;
    this.tags = null;
    this.repos = null;
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

  // ============ 仓库组 ============

  getGroups() {
    this._ensureDirs();
    if (!this.groups) {
      if (fs.existsSync(this.groupsFile)) {
        this.groups = JSON.parse(fs.readFileSync(this.groupsFile, 'utf-8'));
      } else {
        this.groups = { version: 1, groups: [], ungrouped: [] };
        this.saveGroups();
      }
    }
    return this.groups;
  }

  saveGroups() {
    fs.writeFileSync(this.groupsFile, JSON.stringify(this.groups, null, 2));
  }

  createGroup(name, color = '#007AFF', icon = 'folder') {
    const groupsData = this.getGroups();
    const id = 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    groupsData.groups.push({
      id,
      name,
      color,
      icon,
      repoPaths: [],
      collapsed: false
    });
    this.saveGroups();
    return groupsData;
  }

  updateGroup(id, updates) {
    const groupsData = this.getGroups();
    const group = groupsData.groups.find(g => g.id === id);
    if (group) {
      Object.assign(group, updates);
      this.saveGroups();
    }
    return groupsData;
  }

  deleteGroup(id) {
    const groupsData = this.getGroups();
    const group = groupsData.groups.find(g => g.id === id);
    if (group) {
      groupsData.ungrouped = [...new Set([...groupsData.ungrouped, ...group.repoPaths])];
      groupsData.groups = groupsData.groups.filter(g => g.id !== id);
      this.saveGroups();
    }
    return groupsData;
  }

  addRepoToGroup(groupId, repoPath) {
    const groupsData = this.getGroups();
    const group = groupsData.groups.find(g => g.id === groupId);
    if (group && !group.repoPaths.includes(repoPath)) {
      group.repoPaths.push(repoPath);
      groupsData.ungrouped = groupsData.ungrouped.filter(p => p !== repoPath);
      this.saveGroups();
    }
    return groupsData;
  }

  removeRepoFromGroup(groupId, repoPath) {
    const groupsData = this.getGroups();
    const group = groupsData.groups.find(g => g.id === groupId);
    if (group) {
      group.repoPaths = group.repoPaths.filter(p => p !== repoPath);
      if (!groupsData.ungrouped.includes(repoPath)) {
        groupsData.ungrouped.push(repoPath);
      }
      this.saveGroups();
    }
    return groupsData;
  }

  autoDetectGroups(rootPath, repos) {
    const groupsData = this.getGroups();
    const dirMap = new Map();

    repos.forEach(repo => {
      const relativePath = path.relative(rootPath, repo.path);
      const parts = relativePath.split(path.sep);
      if (parts.length > 1) {
        const groupName = parts[0];
        if (!dirMap.has(groupName)) {
          dirMap.set(groupName, []);
        }
        dirMap.get(groupName).push(repo.path);
      } else {
        groupsData.ungrouped.push(repo.path);
      }
    });

    const colors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FFCC00', '#5AC8FA', '#FF2D55'];
    let colorIndex = 0;

    dirMap.forEach((repoPaths, name) => {
      const exists = groupsData.groups.find(g => g.name === name);
      if (!exists) {
        groupsData.groups.push({
          id: 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          name,
          color: colors[colorIndex % colors.length],
          icon: 'folder',
          repoPaths,
          collapsed: false
        });
        colorIndex++;
      }
    });

    groupsData.ungrouped = [...new Set(groupsData.ungrouped)];
    this.saveGroups();
    return groupsData;
  }

  // ============ 标签 ============

  getTags() {
    this._ensureDirs();
    if (!this.tags) {
      if (fs.existsSync(this.tagsFile)) {
        this.tags = JSON.parse(fs.readFileSync(this.tagsFile, 'utf-8'));
      } else {
        this.tags = { version: 1, tags: [], repoTags: {} };
        this.saveTags();
      }
    }
    return this.tags;
  }

  saveTags() {
    fs.writeFileSync(this.tagsFile, JSON.stringify(this.tags, null, 2));
  }

  createTag(name, color = '#007AFF') {
    const tagsData = this.getTags();
    const exists = tagsData.tags.find(t => t.name === name);
    if (exists) return tagsData;

    const id = 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    tagsData.tags.push({ id, name, color, description: '' });
    this.saveTags();
    return tagsData;
  }

  updateTag(id, updates) {
    const tagsData = this.getTags();
    const tag = tagsData.tags.find(t => t.id === id);
    if (tag) {
      Object.assign(tag, updates);
      this.saveTags();
    }
    return tagsData;
  }

  deleteTag(id) {
    const tagsData = this.getTags();
    tagsData.tags = tagsData.tags.filter(t => t.id !== id);
    Object.keys(tagsData.repoTags).forEach(repoPath => {
      tagsData.repoTags[repoPath] = tagsData.repoTags[repoPath].filter(tid => tid !== id);
    });
    this.saveTags();
    return tagsData;
  }

  addTagToRepo(tagId, repoPath) {
    const tagsData = this.getTags();
    if (!tagsData.repoTags[repoPath]) {
      tagsData.repoTags[repoPath] = [];
    }
    if (!tagsData.repoTags[repoPath].includes(tagId)) {
      tagsData.repoTags[repoPath].push(tagId);
      this.saveTags();
    }
    return tagsData;
  }

  removeTagFromRepo(tagId, repoPath) {
    const tagsData = this.getTags();
    if (tagsData.repoTags[repoPath]) {
      tagsData.repoTags[repoPath] = tagsData.repoTags[repoPath].filter(id => id !== tagId);
      this.saveTags();
    }
    return tagsData;
  }

  getRepoTags(repoPath) {
    const tagsData = this.getTags();
    const tagIds = tagsData.repoTags[repoPath] || [];
    return tagsData.tags.filter(t => tagIds.includes(t.id));
  }

  // ============ 仓库列表持久化 ============

  getRepos() {
    this._ensureDirs();
    if (!this.repos) {
      if (fs.existsSync(this.reposFile)) {
        try {
          this.repos = JSON.parse(fs.readFileSync(this.reposFile, 'utf-8'));
        } catch (e) {
          this.repos = { version: 1, lastScanAt: 0, repos: [] };
        }
      } else {
        this.repos = { version: 1, lastScanAt: 0, repos: [] };
      }
    }
    return this.repos;
  }

  saveRepos() {
    this._ensureDirs();
    fs.writeFileSync(this.reposFile, JSON.stringify(this.repos, null, 2));
  }

  // 覆盖保存整个仓库列表
  setRepos(repos, lastScanAt = Date.now()) {
    this.getRepos();
    const now = Date.now();
    const existingMap = new Map((this.repos.repos || []).map(r => [r.path, r]));
    this.repos.repos = repos.map(r => {
      const existing = existingMap.get(r.path);
      return {
        path: r.path,
        name: r.name || path.basename(r.path),
        addedAt: existing?.addedAt || now,
        lastScannedAt: now
      };
    });
    this.repos.lastScanAt = lastScanAt;
    this.saveRepos();
    return this.repos;
  }

  // 合并新增仓库(去重,保留已有 addedAt)
  mergeRepos(newRepos) {
    this.getRepos();
    const now = Date.now();
    const existingMap = new Map((this.repos.repos || []).map(r => [r.path, r]));
    for (const r of newRepos) {
      const existing = existingMap.get(r.path);
      if (existing) {
        existing.lastScannedAt = now;
        if (r.name && existing.name !== r.name) existing.name = r.name;
      } else {
        this.repos.repos.push({
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

  removeRepo(repoPath) {
    this.getRepos();
    this.repos.repos = (this.repos.repos || []).filter(r => r.path !== repoPath);
    this.saveRepos();
    return this.repos;
  }

  clearRepos() {
    this.getRepos();
    this.repos.repos = [];
    this.repos.lastScanAt = 0;
    this.saveRepos();
    return this.repos;
  }
}

module.exports = new ConfigService();
