const AppState = {
  currentPath: '',
  currentMode: 'tree',
  cardStyle: 'card',
  sortBy: 'name',
  sortOrder: 'asc',
  selectedRepo: null,
  items: [],
  allRepos: [],
  groups: { groups: [], ungrouped: [] },
  tags: { tags: [], repoTags: {} },
  selectedTags: [],
  searchQuery: '',
  history: [],
  historyIndex: -1
};

const App = {
  async init() {
    try {
      AppState.currentPath = await window.gitFinder.fs.getDefaultPath();
    } catch (e) {
      AppState.currentPath = '';
    }

    this.setupEventListeners();
    this.loadSidebarData();
    this.loadGroups();
    this.loadTags();
    this.navigateTo(AppState.currentPath, true);
    this.updateStatusBar();
  },

  setupEventListeners() {
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
    document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
    document.getElementById('btn-up').addEventListener('click', () => this.goUp());

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.switchView(view);
      });
    });

    document.querySelectorAll('.sidebar-item[data-mode]').forEach(item => {
      item.addEventListener('click', () => {
        const mode = item.dataset.mode;
        this.switchMode(mode);
      });
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      AppState.searchQuery = e.target.value.toLowerCase();
      this.renderContent();
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.sortBy = btn.dataset.sort;
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderContent();
      });
    });

    document.querySelectorAll('.dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.sortOrder = btn.dataset.dir;
        document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderContent();
      });
    });

    document.querySelectorAll('.style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.cardStyle = btn.dataset.style;
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderContent();
      });
    });

    document.getElementById('choose-folder-btn')?.addEventListener('click', async () => {
      const folder = await window.gitFinder.fs.selectFolder();
      if (folder) {
        this.navigateTo(folder);
      }
    });

    document.getElementById('clear-tag-filter')?.addEventListener('click', () => {
      AppState.selectedTags = [];
      this.updateTagFilterBar();
      this.renderContent();
    });

    document.querySelectorAll('.modal-close, .modal-footer .btn[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        document.getElementById(modalId).style.display = 'none';
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
        }
      });
    });

    document.querySelectorAll('.color-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const parent = opt.parentElement;
        parent.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });

    document.getElementById('add-favorite-btn')?.addEventListener('click', async () => {
      if (AppState.selectedRepo) {
        await window.gitFinder.config.addFavorite(AppState.selectedRepo.path, AppState.selectedRepo.name);
        this.loadFavorites();
      }
    });

    document.getElementById('add-group-btn')?.addEventListener('click', () => {
      document.getElementById('new-group-modal').style.display = 'flex';
      document.getElementById('new-group-name').value = '';
      document.getElementById('new-group-name').focus();
    });

    document.getElementById('confirm-new-group-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-group-name').value.trim();
      if (!name) return;
      const colorEl = document.querySelector('#group-color-picker .color-option.active');
      const color = colorEl ? colorEl.dataset.color : '#007AFF';
      AppState.groups = await window.gitFinder.groups.create(name, color);
      this.renderSidebarGroups();
      document.getElementById('new-group-modal').style.display = 'none';
    });

    document.getElementById('add-tag-btn')?.addEventListener('click', () => {
      document.getElementById('new-tag-modal').style.display = 'flex';
      document.getElementById('new-tag-name').value = '';
      document.getElementById('new-tag-name').focus();
    });

    document.getElementById('confirm-new-tag-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-tag-name').value.trim();
      if (!name) return;
      const colorEl = document.querySelector('#tag-color-picker .color-option.active');
      const color = colorEl ? colorEl.dataset.color : '#007AFF';
      AppState.tags = await window.gitFinder.tags.create(name, color);
      this.renderSidebarTags();
      if (AppState.selectedRepo) {
        this.updateDetailPanel();
      }
      document.getElementById('new-tag-modal').style.display = 'none';
    });
  },

  async loadSidebarData() {
    this.loadQuickLocations();
    this.loadFavorites();
  },

  async loadQuickLocations() {
    const locations = await window.gitFinder.fs.getQuickLocations();
    const container = document.getElementById('quick-locations');
    container.innerHTML = locations.map(loc => `
      <div class="sidebar-item" data-path="${loc.path}">
        <span class="sidebar-icon">📍</span>
        <span>${loc.name}</span>
      </div>
    `).join('');

    container.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        this.navigateTo(item.dataset.path);
      });
    });
  },

  async loadFavorites() {
    const favorites = await window.gitFinder.config.getFavorites();
    const container = document.getElementById('favorites-list');
    if (favorites.length === 0) {
      container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#86868b;">暂无收藏</div>';
      return;
    }
    container.innerHTML = favorites.map(fav => `
      <div class="sidebar-item" data-path="${fav.path}">
        <span class="sidebar-icon">⭐</span>
        <span>${fav.name}</span>
      </div>
    `).join('');

    container.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        this.navigateTo(item.dataset.path);
      });
    });
  },

  async loadGroups() {
    AppState.groups = await window.gitFinder.groups.get();
    this.renderSidebarGroups();
  },

  renderSidebarGroups() {
    const container = document.getElementById('groups-list');
    const groups = AppState.groups.groups;

    if (groups.length === 0) {
      container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#86868b;">暂无分组</div>';
      return;
    }

    container.innerHTML = groups.map(group => `
      <div class="sidebar-item" data-group-id="${group.id}">
        <span class="group-color-dot" style="background:${group.color}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${group.name}</span>
        <span class="badge">${group.repoPaths.length}</span>
      </div>
    `).join('');

    container.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        AppState.currentMode = 'group';
        this.updateModeUI();
        this.renderContent();
      });
    });
  },

  async loadTags() {
    AppState.tags = await window.gitFinder.tags.get();
    this.renderSidebarTags();
  },

  renderSidebarTags() {
    const container = document.getElementById('tags-filter-list');
    const tags = AppState.tags.tags;

    if (tags.length === 0) {
      container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#86868b;">暂无标签</div>';
      return;
    }

    container.innerHTML = tags.map(tag => {
      const count = Object.values(AppState.tags.repoTags || {}).filter(ids => ids.includes(tag.id)).length;
      const selected = AppState.selectedTags.includes(tag.id);
      return `
        <div class="sidebar-tag-item ${selected ? 'selected' : ''}" data-tag-id="${tag.id}">
          <span class="sidebar-tag-dot" style="background:${tag.color}"></span>
          <span style="flex:1;">${tag.name}</span>
          <span class="sidebar-tag-count">${count}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.sidebar-tag-item').forEach(item => {
      item.addEventListener('click', () => {
        const tagId = item.dataset.tagId;
        const idx = AppState.selectedTags.indexOf(tagId);
        if (idx >= 0) {
          AppState.selectedTags.splice(idx, 1);
        } else {
          AppState.selectedTags.push(tagId);
        }
        this.renderSidebarTags();
        this.updateTagFilterBar();
        this.renderContent();
      });
    });
  },

  updateTagFilterBar() {
    const bar = document.getElementById('tag-filter-bar');
    const chips = document.getElementById('tag-filter-chips');

    if (AppState.selectedTags.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    const selectedTagObjs = AppState.tags.tags.filter(t => AppState.selectedTags.includes(t.id));
    chips.innerHTML = selectedTagObjs.map(tag => `
      <span class="tag-chip" style="background:${tag.color}20;color:${tag.color};">
        ${tag.name}
        <span style="margin-left:4px;cursor:pointer;opacity:0.7;" data-remove-tag="${tag.id}">×</span>
      </span>
    `).join('');

    chips.querySelectorAll('[data-remove-tag]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagId = el.dataset.removeTag;
        AppState.selectedTags = AppState.selectedTags.filter(id => id !== tagId);
        this.renderSidebarTags();
        this.updateTagFilterBar();
        this.renderContent();
      });
    });
  },

  switchView(view) {
    AppState.currentMode = view;
    this.updateModeUI();
    this.renderContent();
  },

  switchMode(mode) {
    AppState.currentMode = mode;
    this.updateModeUI();
    this.renderContent();
  },

  updateModeUI() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === AppState.currentMode);
    });
    document.querySelectorAll('.sidebar-item[data-mode]').forEach(item => {
      item.classList.toggle('active', item.dataset.mode === AppState.currentMode);
    });

    const sortBar = document.getElementById('sort-bar');
    sortBar.style.display = 'flex';
  },

  navigateTo(path, replace = false) {
    if (!path) return;

    AppState.currentPath = path;

    if (!replace) {
      AppState.history = AppState.history.slice(0, AppState.historyIndex + 1);
      AppState.history.push(path);
      AppState.historyIndex = AppState.history.length - 1;
    }

    this.updateBreadcrumbs();
    this.renderContent();
    this.updateNavButtons();
  },

  goBack() {
    if (AppState.historyIndex > 0) {
      AppState.historyIndex--;
      AppState.currentPath = AppState.history[AppState.historyIndex];
      this.updateBreadcrumbs();
      this.renderContent();
      this.updateNavButtons();
    }
  },

  goForward() {
    if (AppState.historyIndex < AppState.history.length - 1) {
      AppState.historyIndex++;
      AppState.currentPath = AppState.history[AppState.historyIndex];
      this.updateBreadcrumbs();
      this.renderContent();
      this.updateNavButtons();
    }
  },

  goUp() {
    const parent = this.getParentPath(AppState.currentPath);
    if (parent) {
      this.navigateTo(parent);
    }
  },

  getParentPath(path) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 1) return null;
    parts.pop();
    return (path.startsWith('/') ? '/' : '') + parts.join('/');
  },

  updateBreadcrumbs() {
    const container = document.getElementById('breadcrumbs');
    const parts = AppState.currentPath.split(/[\\/]/).filter(Boolean);
    const isAbsolute = AppState.currentPath.startsWith('/');

    let html = '';
    let currentPath = isAbsolute ? '/' : '';

    if (isAbsolute) {
      html += `<span class="breadcrumb-item" data-path="/">Macintosh HD</span>`;
    }

    parts.forEach((part, index) => {
      currentPath += (index === 0 && !isAbsolute ? '' : '/') + part;
      if (index > 0 || isAbsolute) {
        html += `<span class="breadcrumb-separator">›</span>`;
      }
      html += `<span class="breadcrumb-item" data-path="${currentPath}">${part}</span>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('.breadcrumb-item').forEach(item => {
      item.addEventListener('click', () => {
        this.navigateTo(item.dataset.path);
      });
    });
  },

  updateNavButtons() {
    document.getElementById('btn-back').style.opacity = AppState.historyIndex > 0 ? '1' : '0.4';
    document.getElementById('btn-forward').style.opacity = AppState.historyIndex < AppState.history.length - 1 ? '1' : '0.4';
    document.getElementById('btn-up').style.opacity = this.getParentPath(AppState.currentPath) ? '1' : '0.4';
  },

  async renderContent() {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');

    if (!AppState.currentPath) {
      contentArea.innerHTML = '';
      emptyState.style.display = 'flex';
      emptyState.className = 'empty-state';
      return;
    }

    emptyState.style.display = 'none';
    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#86868b;"><div class="loading-spinner" style="margin:0 auto 10px;"></div>加载中...</div>';

    try {
      if (AppState.currentMode === 'tree') {
        await this.renderTreeView();
      } else if (AppState.currentMode === 'grid') {
        await this.renderGridView();
      } else if (AppState.currentMode === 'group') {
        await this.renderGroupView();
      }
    } catch (e) {
      contentArea.innerHTML = `<div style="text-align:center;padding:40px;color:#FF3B30;">加载失败: ${e.message}</div>`;
    }
  },

  async renderTreeView() {
    const contentArea = document.getElementById('content-area');
    const items = await window.gitFinder.fs.listDirectory(AppState.currentPath, {
      showHidden: false,
      recursive: false
    });

    AppState.items = items;

    if (AppState.cardStyle === 'list') {
      this.renderListView(items, contentArea);
    } else {
      this.renderCardView(items, contentArea);
    }
  },

  async renderGridView() {
    const contentArea = document.getElementById('content-area');
    const repos = await window.gitFinder.fs.findGitRepos(AppState.currentPath, { depth: 3 });

    AppState.allRepos = repos;

    const statusPromises = repos.map(async (repo) => {
      try {
        const status = await window.gitFinder.git.getStatus(repo.path, { autoFetch: false });
        const tags = await window.gitFinder.tags.getRepoTags(repo.path);
        return { ...repo, gitStatus: status, tags };
      } catch (e) {
        return { ...repo, gitStatus: { isGitRepo: false }, tags: [] };
      }
    });

    const reposWithStatus = await Promise.all(statusPromises);
    const filtered = this.filterRepos(reposWithStatus);
    const sorted = this.sortRepos(filtered);

    if (AppState.cardStyle === 'list') {
      this.renderListView(sorted, contentArea);
    } else {
      this.renderCardView(sorted, contentArea);
    }

    this.updateStatusBar();
  },

  async renderGroupView() {
    const contentArea = document.getElementById('content-area');
    const groupsData = AppState.groups;

    let html = '';

    for (const group of groupsData.groups) {
      const repos = [];
      for (const repoPath of group.repoPaths) {
        const info = await window.gitFinder.fs.getFileInfo(repoPath);
        if (info && info.isGitRepo) {
          try {
            const status = await window.gitFinder.git.getStatus(repoPath, { autoFetch: false });
            const readme = await window.gitFinder.fs.getReadmePreview(repoPath);
            const tags = await window.gitFinder.tags.getRepoTags(repoPath);
            repos.push({ ...info, gitStatus: status, readme, tags });
          } catch (e) {
            repos.push({ ...info, gitStatus: { isGitRepo: false }, readme: null, tags: [] });
          }
        }
      }

      const filtered = this.filterRepos(repos);
      const sorted = this.sortRepos(filtered);

      html += `
        <div class="group-section">
          <div class="group-section-header" data-group-id="${group.id}">
            <span class="group-section-color" style="background:${group.color}"></span>
            <span class="group-section-arrow">▼</span>
            <span class="group-section-name">${group.name}</span>
            <span class="group-section-count">${sorted.length} 个仓库</span>
          </div>
          <div class="group-section-content">
      `;

      if (AppState.cardStyle === 'list') {
        html += this.getListHtml(sorted);
      } else {
        html += this.getCardsHtml(sorted);
      }

      html += `
          </div>
        </div>
      `;
    }

    if (groupsData.ungrouped && groupsData.ungrouped.length > 0) {
      const repos = [];
      for (const repoPath of groupsData.ungrouped) {
        const info = await window.gitFinder.fs.getFileInfo(repoPath);
        if (info && info.isGitRepo) {
          try {
            const status = await window.gitFinder.git.getStatus(repoPath, { autoFetch: false });
            const readme = await window.gitFinder.fs.getReadmePreview(repoPath);
            const tags = await window.gitFinder.tags.getRepoTags(repoPath);
            repos.push({ ...info, gitStatus: status, readme, tags });
          } catch (e) {
            repos.push({ ...info, gitStatus: { isGitRepo: false }, readme: null, tags: [] });
          }
        }
      }

      const filtered = this.filterRepos(repos);
      const sorted = this.sortRepos(filtered);

      html += `
        <div class="group-section">
          <div class="section-divider"><span>未分组 (${sorted.length})</span></div>
          <div class="group-section-content">
      `;

      if (AppState.cardStyle === 'list') {
        html += this.getListHtml(sorted);
      } else {
        html += this.getCardsHtml(sorted);
      }

      html += `
          </div>
        </div>
      `;
    }

    contentArea.innerHTML = html;
    this.bindCardEvents(contentArea);
  },

  filterRepos(repos) {
    let filtered = [...repos];

    if (AppState.searchQuery) {
      const q = AppState.searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        (r.readme && r.readme.title && r.readme.title.toLowerCase().includes(q)) ||
        (r.readme && r.readme.description && r.readme.description.toLowerCase().includes(q))
      );
    }

    if (AppState.selectedTags.length > 0) {
      filtered = filtered.filter(r => {
        const repoTagIds = (r.tags || []).map(t => t.id);
        return AppState.selectedTags.every(tid => repoTagIds.includes(tid));
      });
    }

    return filtered;
  },

  sortRepos(repos) {
    const sorted = [...repos];
    const { sortBy, sortOrder } = AppState;
    const dir = sortOrder === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let av, bv;

      switch (sortBy) {
        case 'name':
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          return av.localeCompare(bv, 'zh-CN') * dir;

        case 'path':
          return a.path.localeCompare(b.path, 'zh-CN') * dir;

        case 'dir':
          const aParent = this.getParentPath(a.path) || '';
          const bParent = this.getParentPath(b.path) || '';
          if (aParent !== bParent) {
            return aParent.localeCompare(bParent, 'zh-CN') * dir;
          }
          return a.name.localeCompare(b.name, 'zh-CN') * dir;

        case 'status':
          const statusOrder = { dirty: 0, ahead: 1, behind: 2, clean: 3 };
          const aStatus = a.gitStatus?.overallStatus || 'clean';
          const bStatus = b.gitStatus?.overallStatus || 'clean';
          av = statusOrder[aStatus] ?? 99;
          bv = statusOrder[bStatus] ?? 99;
          return (av - bv) * dir;

        case 'time':
          av = new Date(a.modifiedTime).getTime();
          bv = new Date(b.modifiedTime).getTime();
          return (av - bv) * dir;

        case 'size':
          av = a.size || 0;
          bv = b.size || 0;
          return (av - bv) * dir;

        case 'branch':
          av = a.gitStatus?.branch || '';
          bv = b.gitStatus?.branch || '';
          return av.localeCompare(bv) * dir;

        default:
          return 0;
      }
    });

    return sorted;
  },

  renderCardView(items, container) {
    const repos = items.filter(i => i.isGitRepo);
    const dirs = items.filter(i => !i.isGitRepo && i.type === 'directory');
    const files = items.filter(i => i.type === 'file');

    const sortedDirs = this.sortRepos(dirs);
    const sortedRepos = this.sortRepos(repos);

    let html = '';

    if (sortedDirs.length > 0) {
      html += `<div class="section-divider"><span>文件夹 (${sortedDirs.length})</span></div>`;
      html += this.getCardsHtml(sortedDirs);
    }

    if (sortedRepos.length > 0) {
      if (sortedDirs.length > 0) html += '<div style="height:16px;"></div>';
      html += `<div class="section-divider"><span>Git 仓库 (${sortedRepos.length})</span></div>`;
      html += this.getCardsHtml(sortedRepos);
    }

    if (files.length > 0) {
      html += `<div style="height:16px;"></div>`;
      html += `<div class="section-divider"><span>文件 (${files.length})</span></div>`;
      html += this.getCardsHtml(files);
    }

    if (items.length === 0) {
      html = '<div style="text-align:center;padding:60px;color:#86868b;">此目录为空</div>';
    }

    container.innerHTML = html;
    this.bindCardEvents(container);
  },

  getCardsHtml(items) {
    return `<div class="repo-grid">${items.map(item => this.getCardHtml(item)).join('')}</div>`;
  },

  getCardHtml(item) {
    const status = item.gitStatus || {};
    const overallStatus = status.overallStatus || (item.isGitRepo ? 'clean' : 'none');
    const readme = item.readme || {};
    const tags = item.tags || [];

    return `
      <div class="repo-card status-${overallStatus}" data-path="${item.path}" data-is-git="${item.isGitRepo}">
        <div class="repo-card-header">
          <div class="repo-name">
            <span class="repo-icon">${item.type === 'file' ? '📄' : '📁'}</span>
            ${item.name}
          </div>
          ${item.isGitRepo ? `
            <div class="repo-branch-badge">
              <span class="status-indicator status-${overallStatus}"></span>
              ${status.branch || 'main'}
            </div>
          ` : ''}
        </div>
        <div class="repo-path">${item.path}</div>
        ${tags.length > 0 ? `
          <div class="repo-tags">
            ${tags.map(t => `<span class="repo-tag" style="background:${t.color};">${t.name}</span>`).join('')}
          </div>
        ` : ''}
        <div class="repo-readme">
          ${readme.description || (item.isGitRepo ? '暂无描述' : '')}
        </div>
        ${item.isGitRepo && status.lastCommit ? `
          <div class="repo-last-commit">
            <span class="commit-hash">${status.lastCommit.hash}</span>
            <span class="commit-message">${status.lastCommit.message}</span>
          </div>
        ` : ''}
        ${item.isGitRepo ? `
          <div class="repo-actions">
            <button class="action-btn primary" data-action="pull">⬇ 拉取</button>
            <button class="action-btn success" data-action="push">⬆ 推送</button>
            <button class="action-btn warning" data-action="commit">✓ 提交</button>
            <button class="action-btn" data-action="detail">⋯ 详情</button>
          </div>
        ` : ''}
      </div>
    `;
  },

  renderListView(items, container) {
    const repos = items.filter(i => i.isGitRepo);
    const dirs = items.filter(i => !i.isGitRepo && i.type === 'directory');
    const files = items.filter(i => i.type === 'file');

    let html = '<div class="repo-list">';

    for (const item of [...dirs, ...repos, ...files]) {
      const status = item.gitStatus || {};
      html += `
        <div class="repo-list-item" data-path="${item.path}" data-is-git="${item.isGitRepo}">
          <span class="list-repo-icon">${item.type === 'file' ? '📄' : '📁'}</span>
          <span class="list-repo-name">${item.name}</span>
          <span class="list-repo-path">${item.path}</span>
          <span class="list-repo-branch">${item.isGitRepo ? (status.branch || 'main') : ''}</span>
          <span class="list-repo-status">
            ${item.isGitRepo ? `
              ${(status.modified || 0) > 0 ? `<span class="status-count dirty">!${status.modified}</span>` : ''}
              ${(status.ahead || 0) > 0 ? `<span class="status-count ahead">↑${status.ahead}</span>` : ''}
              ${(status.behind || 0) > 0 ? `<span class="status-count behind">↓${status.behind}</span>` : ''}
            ` : ''}
          </span>
        </div>
      `;
    }

    html += '</div>';

    if (items.length === 0) {
      html = '<div style="text-align:center;padding:60px;color:#86868b;">此目录为空</div>';
    }

    container.innerHTML = html;
    this.bindCardEvents(container);
  },

  getListHtml(items) {
    return this.renderListView(items, { innerHTML: '' }).innerHTML;
  },

  bindCardEvents(container) {
    container.querySelectorAll('.repo-card, .repo-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('.action-btn');
        if (actionBtn) {
          e.stopPropagation();
          const action = actionBtn.dataset.action;
          const path = el.dataset.path;
          this.handleCardAction(action, path);
          return;
        }

        const path = el.dataset.path;
        const isGit = el.dataset.isGit === 'true';

        document.querySelectorAll('.repo-card.selected, .repo-list-item.selected').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');

        if (isGit) {
          this.selectRepo(path);
        } else if (el.classList.contains('repo-card') || el.classList.contains('repo-list-item')) {
          if (e.detail === 2) {
            this.navigateTo(path);
          }
        }
      });

      el.addEventListener('dblclick', () => {
        const path = el.dataset.path;
        const isGit = el.dataset.isGit === 'true';
        if (!isGit) {
          this.navigateTo(path);
        }
      });
    });
  },

  async handleCardAction(action, repoPath) {
    switch (action) {
      case 'pull':
        await GitOps.pull(repoPath);
        break;
      case 'push':
        await GitOps.push(repoPath);
        break;
      case 'commit':
        GitOps.openCommitModal(repoPath);
        break;
      case 'detail':
        this.selectRepo(repoPath);
        break;
    }
  },

  async selectRepo(repoPath) {
    const info = await window.gitFinder.fs.getFileInfo(repoPath);
    const status = await window.gitFinder.git.getStatus(repoPath, { autoFetch: false });
    const readme = await window.gitFinder.fs.getReadmePreview(repoPath);
    const tags = await window.gitFinder.tags.getRepoTags(repoPath);

    AppState.selectedRepo = { ...info, gitStatus: status, readme, tags };
    this.updateDetailPanel();
  },

  async updateDetailPanel() {
    const repo = AppState.selectedRepo;
    if (!repo) return;

    document.getElementById('detail-empty').style.display = 'none';
    document.getElementById('detail-content').style.display = 'flex';

    document.getElementById('detail-name').textContent = repo.name;
    document.getElementById('detail-path').textContent = repo.path;

    const status = repo.gitStatus || {};
    const overallStatus = status.overallStatus || 'clean';
    const statusMap = {
      clean: { label: '已同步', cls: 'clean' },
      dirty: { label: '未提交', cls: 'dirty' },
      ahead: { label: '未推送', cls: 'ahead' },
      behind: { label: '需拉取', cls: 'behind' }
    };
    const statusInfo = statusMap[overallStatus] || statusMap.clean;

    document.getElementById('detail-status').innerHTML = `
      <span class="detail-status-badge ${statusInfo.cls}">${statusInfo.label}</span>
      ${status.branch ? `<span class="detail-status-badge" style="background:rgba(0,0,0,0.06);color:#1d1d1f;">${status.branch}</span>` : ''}
    `;

    const readmeEl = document.getElementById('detail-readme');
    const readme = repo.readme || {};
    readmeEl.innerHTML = `
      <div class="detail-readme-title">${readme.title || repo.name}</div>
      <div>${readme.description || '暂无描述'}</div>
    `;

    const gitInfoEl = document.getElementById('detail-git-info');
    gitInfoEl.innerHTML = `
      <div class="git-stats-row">
        <div class="git-stat ${status.modified > 0 ? 'dirty' : ''}">
          <span class="git-stat-value">${status.modified || 0}</span>
          <span class="git-stat-label">修改</span>
        </div>
        <div class="git-stat ${status.ahead > 0 ? 'ahead' : ''}">
          <span class="git-stat-value">${status.ahead || 0}</span>
          <span class="git-stat-label">未推送</span>
        </div>
        <div class="git-stat ${status.behind > 0 ? 'behind' : ''}">
          <span class="git-stat-value">${status.behind || 0}</span>
          <span class="git-stat-label">需拉取</span>
        </div>
      </div>
      ${status.lastCommit ? `
        <div class="detail-last-commit">
          <div class="last-commit-hash">${status.lastCommit.hash}</div>
          <div class="last-commit-message">${status.lastCommit.message}</div>
          <div class="last-commit-meta">
            <span>${status.lastCommit.author}</span>
            <span>${this.formatTime(status.lastCommit.timestamp)}</span>
          </div>
        </div>
      ` : ''}
    `;

    const tagsEl = document.getElementById('detail-tags');
    const tags = repo.tags || [];
    tagsEl.innerHTML = tags.map(t => `
      <span class="detail-tag" style="background:${t.color};">
        ${t.name}
        <span class="detail-tag-remove" data-tag-id="${t.id}">×</span>
      </span>
    `).join('');

    tagsEl.querySelectorAll('.detail-tag-remove').forEach(el => {
      el.addEventListener('click', async () => {
        await window.gitFinder.tags.removeRepo(el.dataset.tagId, repo.path);
        AppState.tags = await window.gitFinder.tags.get();
        repo.tags = await window.gitFinder.tags.getRepoTags(repo.path);
        this.updateDetailPanel();
        this.renderSidebarTags();
      });
    });
  },

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 30) return `${days} 天前`;
    return date.toLocaleDateString();
  },

  updateStatusBar() {
    const left = document.getElementById('status-left');
    const right = document.getElementById('status-right');

    let leftText = '';
    let rightText = '';

    if (AppState.currentMode === 'grid' || AppState.currentMode === 'group') {
      const total = AppState.allRepos.length;
      const dirty = AppState.allRepos.filter(r => r.gitStatus?.overallStatus === 'dirty').length;
      const ahead = AppState.allRepos.filter(r => r.gitStatus?.overallStatus === 'ahead').length;
      leftText = `${total} 个仓库`;
      rightText = `需关注: ${dirty + ahead}`;
    } else if (AppState.currentPath) {
      leftText = AppState.currentPath;
    } else {
      leftText = '就绪';
    }

    left.textContent = leftText;
    right.textContent = rightText;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
