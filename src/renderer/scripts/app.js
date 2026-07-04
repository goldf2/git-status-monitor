const AppState = {
  currentPath: '',
  currentMode: 'tree',
  cardStyle: 'card',
  sortBy: 'name',
  sortOrder: 'asc',
  showSubrepos: false,
  showGitOnly: false,
  gitOnly: false, // 目录模式:勾选"只显示仓库"=仅显示Git仓库,取消=显示所有文件夹
  selectedRepo: null,
  items: [],
  allRepos: [],
  enrichedRepos: [],
  groups: { groups: [], ungrouped: [] },
  tags: { tags: [], repoTags: {} },
  selectedTags: [],
  selectedStatuses: [], // 状态筛选:dirty|ahead|behind|clean
  selectedCategory: 'all', // 'all' | 'ungrouped' | groupId
  groupOrder: null, // 分类拖拽顺序(null=默认,存储 group.id 数组)
  filterEnabled: { category: true, tag: true, status: true, name: true, readme: true },
  showAllAssignments: true, // 详情面板是否显示未选中的分类/标签
  detailSections: { groups: true, tags: true, readme: true, 'git-actions': true, 'system-actions': true },
  detailSectionOrder: null, // 区域排列顺序(null=默认)
  sidebarSectionOrder: null, // 侧栏 section 排列顺序(null=默认)
  sidebarCollapsedSections: new Set(), // 侧栏 section 折叠状态(存储 section-id)
  searchQuery: '',
  history: [],
  historyIndex: -1,
  reposLastScan: 0,
  scanDepth: 3, // 扫描层级, Infinity = 全部层级
  isLoading: false,
  themeMode: 'light', // 外观模式:light | dark | auto
  themeScheme: 'github', // 配色方案:github | onedark | dracula | monokai | solarized | nord | muted
  themeReminder: 'classic' // 提醒色方案:classic | vivid | soft | colorblind
};

const App = {
  async init() {
    try {
      const savedPath = await window.gitFinder.config.get('lastPath');
      if (savedPath) {
        AppState.currentPath = savedPath;
      } else {
        AppState.currentPath = await window.gitFinder.fs.getDefaultPath();
      }
    } catch (e) {
      AppState.currentPath = '';
    }

    this.setupEventListeners();
    // 初始化内嵌终端
    if (typeof Terminal !== 'undefined') {
      Terminal.init();
    }
    await this.loadTheme();
    await this.loadSidebarData();
    // 先加载持久化的仓库列表(避免启动时重新扫描)
    // 必须在 loadGroups 之前,否则侧边栏分类计数会显示为 0
    await this.loadPersistedRepos();
    this.loadGroups();
    this.loadTags();
    this.updateFilterBar();
    // 加载保存的区域排列顺序
    AppState.detailSectionOrder = await window.gitFinder.config.get('detailSectionOrder');
    // 加载保存的分类拖拽顺序
    AppState.groupOrder = await window.gitFinder.config.get('groupOrder');
    // 加载保存的侧栏 section 顺序
    AppState.sidebarSectionOrder = await window.gitFinder.config.get('sidebarSectionOrder');
    this.applySidebarSectionOrder();
    this.setupSidebarSectionDrag();
    // 加载并应用侧栏 section 折叠状态
    const collapsedSections = await window.gitFinder.config.get('sidebarCollapsedSections');
    if (Array.isArray(collapsedSections)) {
      AppState.sidebarCollapsedSections = new Set(collapsedSections);
      this.applySidebarCollapse();
    }
    this.setupSidebarCollapse();
    // 加载保存的列宽
    await this.loadColumnWidths();

    // 如果有 lastPath 但不在任何已添加根目录下,自动添加为根目录
    if (AppState.currentPath && this._treeRootsLoaded) {
      const underRoot = this._treeRoots.some(r =>
        AppState.currentPath === r.path ||
        AppState.currentPath.startsWith(r.path + '/') ||
        AppState.currentPath.startsWith(r.path + '\\')
      );
      if (!underRoot && this._treeRoots.length === 0) {
        await this.addTreeRoot(AppState.currentPath);
      } else {
        this.navigateTo(AppState.currentPath, true);
      }
    } else if (AppState.currentPath) {
      this.navigateTo(AppState.currentPath, true);
    } else {
      this.showEmptyState();
    }
    this.updateStatusBar();
  },

  setupEventListeners() {
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
    document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
    document.getElementById('btn-up').addEventListener('click', () => this.goUp());

    // 三栏宽度调整
    this.setupColumnResize();

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

    let searchDebounce = null;
    document.getElementById('search-input').addEventListener('input', (e) => {
      AppState.searchQuery = e.target.value.toLowerCase();
      this.updateFilterBar();
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        this.renderContent();
      }, 300);
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

    document.getElementById('btn-show-subrepos')?.addEventListener('click', () => {
      // 已移除子仓库功能
    });

    // 目录模式:只显示仓库勾选框
    document.getElementById('git-only-check')?.addEventListener('change', (e) => {
      AppState.gitOnly = e.target.checked;
      this.renderContent();
    });

    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh');
      btn.classList.add('active');
      if (AppState.currentMode === 'tree') {
        await this.renderContent();
      } else {
        await this.renderGridView(true);
      }
      setTimeout(() => btn.classList.remove('active'), 1000);
    });

    document.getElementById('choose-folder-btn')?.addEventListener('click', async () => {
      await this.openFolderDialog();
    });

    document.getElementById('btn-open-folder')?.addEventListener('click', async () => {
      await this.openFolderDialog();
    });

    document.getElementById('btn-scan')?.addEventListener('click', () => {
      document.getElementById('scan-path-input').value = '';
      document.getElementById('scan-depth-input').value = '';
      document.getElementById('scan-modal').style.display = 'flex';
    });

    document.getElementById('scan-pick-dir-btn')?.addEventListener('click', async () => {
      const folder = await window.gitFinder.fs.selectFolder();
      if (folder) {
        document.getElementById('scan-path-input').value = folder;
      }
    });

    document.getElementById('confirm-scan-btn')?.addEventListener('click', async () => {
      await this.performScan();
    });

    document.getElementById('btn-theme')?.addEventListener('click', () => {
      this.syncThemeModal();
      document.getElementById('theme-modal').style.display = 'flex';
    });

    // 检查更新
    this._setupUpdater();

    // 外观模式选择(浅色/深色/跟随系统)
    document.querySelectorAll('.theme-card[data-mode]').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        this.setMode(mode);
      });
    });

    // 配色方案选择(编程主题)
    document.querySelectorAll('.theme-card[data-scheme]').forEach(card => {
      card.addEventListener('click', () => {
        const scheme = card.dataset.scheme;
        this.setScheme(scheme);
      });
    });

    // 提醒色方案选择(状态色)
    document.querySelectorAll('.theme-card[data-reminder]').forEach(card => {
      card.addEventListener('click', () => {
        const reminder = card.dataset.reminder;
        this.setReminder(reminder);
      });
    });

    // 筛选方式勾选框
    document.getElementById('filter-category-check')?.addEventListener('change', (e) => {
      AppState.filterEnabled.category = e.target.checked;
      this.updateFilterBar();
      this.renderContent();
    });
    document.getElementById('filter-tag-check')?.addEventListener('change', (e) => {
      AppState.filterEnabled.tag = e.target.checked;
      this.updateFilterBar();
      this.renderContent();
    });
    document.getElementById('filter-status-check')?.addEventListener('change', (e) => {
      AppState.filterEnabled.status = e.target.checked;
      this.updateFilterBar();
      this.renderContent();
    });

    // 状态筛选下拉
    const statusBtn = document.getElementById('status-filter-btn');
    const statusDropdown = document.getElementById('status-filter-dropdown');
    if (statusBtn && statusDropdown) {
      statusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const enabled = AppState.filterEnabled.status !== false;
        if (enabled) {
          statusDropdown.style.display = statusDropdown.style.display === 'block' ? 'none' : 'block';
        }
      });
      statusDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const val = cb.value;
          if (cb.checked) {
            if (!AppState.selectedStatuses.includes(val)) {
              AppState.selectedStatuses.push(val);
            }
          } else {
            AppState.selectedStatuses = AppState.selectedStatuses.filter(s => s !== val);
          }
          this.updateFilterBar();
          this.renderContent();
        });
      });
      // 外部点击关闭
      document.addEventListener('click', (e) => {
        if (!statusDropdown.contains(e.target) && e.target !== statusBtn) {
          statusDropdown.style.display = 'none';
        }
      });
    }
    document.getElementById('filter-name-check')?.addEventListener('change', (e) => {
      AppState.filterEnabled.name = e.target.checked;
      this.updateFilterBar();
      this.renderContent();
    });
    document.getElementById('filter-readme-check')?.addEventListener('change', (e) => {
      AppState.filterEnabled.readme = e.target.checked;
      this.updateFilterBar();
      this.renderContent();
    });

    document.getElementById('clear-all-filters')?.addEventListener('click', () => {
      AppState.selectedTags = [];
      AppState.selectedStatuses = [];
      AppState.selectedCategory = 'all';
      AppState.searchQuery = '';
      document.getElementById('search-input').value = '';
      // 重置状态筛选下拉勾选
      document.querySelectorAll('#status-filter-dropdown input[type="checkbox"]').forEach(cb => cb.checked = false);
      this.renderSidebarTags();
      this.renderSidebarGroups();
      this.updateFilterBar();
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
        const repoPath = AppState.selectedRepo.path;
        const allTags = await window.gitFinder.tags.get();
        let favTag = allTags.tags.find(t => t.name === '收藏');
        const repoTags = await window.gitFinder.tags.getRepoTags(repoPath);
        const hasFavTag = repoTags.some(t => t.name === '收藏');

        if (!favTag) {
          const result = await window.gitFinder.tags.create('收藏', '#FFCC00');
          favTag = result.tags.find(t => t.name === '收藏');
        }

        if (hasFavTag) {
          await window.gitFinder.tags.removeRepo(favTag.id, repoPath);
        } else {
          await window.gitFinder.tags.addRepo(favTag.id, repoPath);
        }
        this.loadTags();
        this.renderContent();
        this.updateDetailPanel();
      } else if (AppState.currentPath) {
        await window.gitFinder.config.addFavorite({
          type: 'dir',
          path: AppState.currentPath,
          name: AppState.currentPath.split('/').pop()
        });
        this.loadFavorites();
      }
    });

    document.getElementById('add-group-bottom-btn')?.addEventListener('click', () => {
      document.getElementById('new-group-modal').style.display = 'flex';
      document.getElementById('new-group-name').value = '';
      document.getElementById('new-group-name').focus();
    });

    // 详情面板:切换显示未选中的分类/标签气泡
    document.getElementById('toggle-assignments-btn')?.addEventListener('click', () => {
      AppState.showAllAssignments = !AppState.showAllAssignments;
      const btn = document.getElementById('toggle-assignments-btn');
      btn.textContent = AppState.showAllAssignments ? '隐藏未选' : '显示全部';
      btn.classList.toggle('active', !AppState.showAllAssignments);
      this.updateDetailPanel();
    });

    // 详情面板区域折叠
    document.querySelectorAll('.detail-section.collapsible .section-toggle').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.classList.contains('drag-handle')) return;
        header.closest('.detail-section').classList.toggle('collapsed');
      });
    });

    document.getElementById('add-tag-bottom-btn')?.addEventListener('click', () => {
      document.getElementById('new-tag-modal').style.display = 'flex';
      document.getElementById('new-tag-name').value = '';
      document.getElementById('new-tag-name').focus();
    });

    document.getElementById('confirm-new-group-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-group-name').value.trim();
      if (!name) return;
      const colorEl = document.querySelector('#group-color-picker .color-option.active');
      const color = colorEl ? colorEl.dataset.color : '#007AFF';
      const result = await window.gitFinder.groups.create(name, color);
      AppState.groups = result;
      // 若有选中的仓库,则将新分类分配给该仓库
      if (AppState.selectedRepo) {
        const newGroup = result.groups.find(g => g.name === name);
        if (newGroup) {
          await window.gitFinder.groups.addRepo(newGroup.id, AppState.selectedRepo.path);
          AppState.groups = await window.gitFinder.groups.get();
          AppState.selectedRepo.groups = this._findRepoGroups(AppState.selectedRepo.path);
          this.updateDetailPanel();
        }
      }
      this.renderSidebarGroups();
      this.renderContent();
      document.getElementById('new-group-modal').style.display = 'none';
    });

    document.getElementById('detail-fav-btn')?.addEventListener('click', async () => {
      if (!AppState.selectedRepo) return;
      const repoPath = AppState.selectedRepo.path;
      const allTags = await window.gitFinder.tags.get();
      let favTag = allTags.tags.find(t => t.name === '收藏');
      const repoTags = await window.gitFinder.tags.getRepoTags(repoPath);
      const hasFavTag = repoTags.some(t => t.name === '收藏');

      if (!favTag) {
        const result = await window.gitFinder.tags.create('收藏', '#FFCC00');
        favTag = result.tags.find(t => t.name === '收藏');
      }

      if (hasFavTag) {
        await window.gitFinder.tags.removeRepo(favTag.id, repoPath);
      } else {
        await window.gitFinder.tags.addRepo(favTag.id, repoPath);
      }
      AppState.tags = await window.gitFinder.tags.get();
      AppState.selectedRepo.tags = await window.gitFinder.tags.getRepoTags(repoPath);
      this.updateDetailPanel();
      this.loadTags();
      this.renderContent();
    });

    document.getElementById('confirm-new-tag-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-tag-name').value.trim();
      if (!name) return;
      const colorEl = document.querySelector('#tag-color-picker .color-option.active');
      const color = colorEl ? colorEl.dataset.color : '#007AFF';
      const result = await window.gitFinder.tags.create(name, color);
      AppState.tags = result;
      // 若有选中的仓库,则将新标签分配给该仓库
      if (AppState.selectedRepo) {
        const newTag = result.tags.find(t => t.name === name);
        if (newTag) {
          await window.gitFinder.tags.addRepo(newTag.id, AppState.selectedRepo.path);
          AppState.tags = await window.gitFinder.tags.get();
          AppState.selectedRepo.tags = await window.gitFinder.tags.getRepoTags(AppState.selectedRepo.path);
        }
        this.updateDetailPanel();
      }
      this.renderSidebarTags();
      this.renderContent();
      document.getElementById('new-tag-modal').style.display = 'none';
    });
  },

  // ============ 自动升级 ============

  async _setupUpdater() {
    const versionEl = document.getElementById('app-version');
    const btn = document.getElementById('btn-check-update');
    if (!btn || !versionEl) return;

    // 显示当前版本
    try {
      const version = await window.gitFinder.app.getVersion();
      versionEl.textContent = `v${version}`;
    } catch (e) {
      versionEl.textContent = 'v-';
    }

    // 点击版本号也触发检查
    versionEl.addEventListener('click', () => this._checkForUpdates());
    btn.addEventListener('click', () => this._checkForUpdates());

    // 监听主进程的更新事件
    window.gitFinder.updater.onUpToDate(() => {
      btn.classList.remove('checking');
      btn.textContent = '已是最新';
      setTimeout(() => { btn.textContent = '检查更新'; }, 3000);
    });

    window.gitFinder.updater.onDownloading(() => {
      btn.classList.remove('checking');
      btn.classList.add('has-update');
      btn.textContent = '下载中...';
    });

    window.gitFinder.updater.onProgress((data) => {
      btn.textContent = `下载中 ${Math.round(data.percent)}%`;
    });

    window.gitFinder.updater.onError((msg) => {
      btn.classList.remove('checking', 'has-update');
      btn.textContent = '检查更新';
      this._showStatusMessage(`更新失败: ${msg}`, 'error');
    });
  },

  async _checkForUpdates() {
    const btn = document.getElementById('btn-check-update');
    if (!btn) return;
    btn.classList.add('checking');
    btn.textContent = '检查中...';
    try {
      const result = await window.gitFinder.updater.check();
      btn.classList.remove('checking');
      if (result.available) {
        btn.classList.add('has-update');
        btn.textContent = `新版本 ${result.version}`;
      } else if (result.reason === 'development') {
        btn.textContent = '开发模式';
        setTimeout(() => { btn.textContent = '检查更新'; }, 2000);
      } else if (result.error) {
        btn.textContent = '检查更新';
        this._showStatusMessage(`检查更新失败: ${result.error}`, 'error');
      } else {
        btn.textContent = '已是最新';
        setTimeout(() => { btn.textContent = '检查更新'; }, 3000);
      }
    } catch (e) {
      btn.classList.remove('checking');
      btn.textContent = '检查更新';
    }
  },

  _showStatusMessage(msg, type) {
    const el = document.getElementById('status-left');
    if (!el) return;
    const original = el.textContent;
    el.textContent = msg;
    setTimeout(() => { el.textContent = original; }, 4000);
  },

  // 应用侧栏 section 排列顺序
  applySidebarSectionOrder() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const order = AppState.sidebarSectionOrder;
    if (!order || !Array.isArray(order) || order.length === 0) return;
    const sections = new Map(
      Array.from(sidebar.querySelectorAll('.sidebar-section[data-section-id]'))
        .map(el => [el.dataset.sectionId, el])
    );
    // 按 order 顺序重新插入
    order.forEach(id => {
      const el = sections.get(id);
      if (el) sidebar.appendChild(el);
    });
  },

  // 侧栏 section 拖拽排序
  setupSidebarSectionDrag() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.dataset.sectionDragInit) return;
    sidebar.dataset.sectionDragInit = '1';

    let draggedSection = null;

    sidebar.addEventListener('mousedown', (e) => {
      if (!e.target.classList.contains('sidebar-drag-handle')) return;
      const section = e.target.closest('.sidebar-section[data-section-id]');
      if (!section) return;
      // 启用 draggable
      section.setAttribute('draggable', 'true');
    });

    sidebar.addEventListener('dragstart', (e) => {
      const section = e.target.closest('.sidebar-section[data-section-id]');
      if (!section || section.getAttribute('draggable') !== 'true') return;
      draggedSection = section;
      section.classList.add('sidebar-section-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', section.dataset.sectionId);
    });

    sidebar.addEventListener('dragend', (e) => {
      const section = e.target.closest('.sidebar-section[data-section-id]');
      if (section) {
        section.classList.remove('sidebar-section-dragging');
        section.removeAttribute('draggable');
      }
      draggedSection = null;
      this.saveSidebarSectionOrder();
    });

    sidebar.addEventListener('dragover', (e) => {
      if (!draggedSection) return;
      const target = e.target.closest('.sidebar-section[data-section-id]');
      if (!target || target === draggedSection) return;
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (e.clientY < midpoint) {
        sidebar.insertBefore(draggedSection, target);
      } else {
        sidebar.insertBefore(draggedSection, target.nextSibling);
      }
    });
  },

  // 保存侧栏 section 顺序到配置
  saveSidebarSectionOrder() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const order = Array.from(sidebar.querySelectorAll('.sidebar-section[data-section-id]'))
      .map(el => el.dataset.sectionId);
    AppState.sidebarSectionOrder = order;
    window.gitFinder.config.set('sidebarSectionOrder', order);
  },

  // 应用侧栏 section 折叠状态
  applySidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.querySelectorAll('.sidebar-section[data-section-id]').forEach(section => {
      const id = section.dataset.sectionId;
      section.classList.toggle('collapsed', AppState.sidebarCollapsedSections.has(id));
    });
  },

  // 绑定侧栏 section 折叠事件
  setupSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.dataset.collapseInit) return;
    sidebar.dataset.collapseInit = '1';

    sidebar.addEventListener('click', (e) => {
      // 点击拖拽手柄不触发折叠
      if (e.target.classList.contains('sidebar-drag-handle')) return;
      // 点击操作按钮不触发折叠
      if (e.target.closest('.sidebar-tree-btn')) return;
      // 点击 sidebar-title 内的任意位置(箭头、文字)触发折叠
      const title = e.target.closest('.sidebar-title');
      if (!title) return;
      const section = title.closest('.sidebar-section[data-section-id]');
      if (!section) return;

      const id = section.dataset.sectionId;
      const isCollapsed = section.classList.toggle('collapsed');
      if (isCollapsed) {
        AppState.sidebarCollapsedSections.add(id);
      } else {
        AppState.sidebarCollapsedSections.delete(id);
      }
      this.saveSidebarCollapse();
    });
  },

  // 保存折叠状态到配置
  saveSidebarCollapse() {
    const arr = Array.from(AppState.sidebarCollapsedSections);
    window.gitFinder.config.set('sidebarCollapsedSections', arr);
  },

  // 三栏宽度拖拽调整
  setupColumnResize() {
    const leftHandle = document.getElementById('resize-handle-left');
    const rightHandle = document.getElementById('resize-handle-right');
    const sidebar = document.getElementById('sidebar');
    const detailPanel = document.getElementById('detail-panel');

    const makeResizable = (handle, element, side, minW, maxW) => {
      let startX = 0;
      let startW = 0;
      let dragging = false;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startW = element.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta = e.clientX - startX;
        let newW;
        if (side === 'left') {
          newW = startW + delta;
        } else {
          newW = startW - delta;
        }
        newW = Math.max(minW, Math.min(maxW, newW));
        element.style.width = newW + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // 保存宽度
        const key = side === 'left' ? 'sidebarWidth' : 'detailPanelWidth';
        window.gitFinder.config.set(key, element.offsetWidth);
      });
    };

    if (leftHandle && sidebar) {
      makeResizable(leftHandle, sidebar, 'left', 180, 500);
    }
    if (rightHandle && detailPanel) {
      makeResizable(rightHandle, detailPanel, 'right', 240, 700);
    }
  },

  // 加载保存的列宽
  async loadColumnWidths() {
    const sidebarW = await window.gitFinder.config.get('sidebarWidth');
    const detailW = await window.gitFinder.config.get('detailPanelWidth');
    if (sidebarW) document.getElementById('sidebar').style.width = sidebarW + 'px';
    if (detailW) document.getElementById('detail-panel').style.width = detailW + 'px';
  },

  async loadSidebarData() {
    this.loadFavorites();
    await this.initSidebarTree();
  },

  // ============ 侧边栏目录树(多根目录,访达式浏览器) ============

  _treeRoots: [],
  _treeExpandedPaths: new Set(),
  _treeRootsLoaded: false,

  async initSidebarTree() {
    await this.loadTreeRoots();
  },

  async loadTreeRoots() {
    try {
      this._treeRoots = await window.gitFinder.config.getTreeRoots();
    } catch (e) {
      this._treeRoots = [];
    }
    this._treeRootsLoaded = true;
    // 将默认展开的根目录加入 expanded 集合
    for (const root of this._treeRoots) {
      if (root.expanded !== false) {
        this._treeExpandedPaths.add(root.path);
      }
    }
    await this.renderSidebarTree();
  },

  async addTreeRootDialog() {
    const folder = await window.gitFinder.fs.selectFolder();
    if (!folder) return;
    await this.addTreeRoot(folder);
  },

  async addTreeRoot(dirPath, name) {
    this._treeRoots = await window.gitFinder.config.addTreeRoot(dirPath, name);
    this._treeExpandedPaths.add(dirPath);
    await this.renderSidebarTree();
    this.navigateTo(dirPath);
  },

  async removeTreeRoot(dirPath) {
    this._treeRoots = await window.gitFinder.config.removeTreeRoot(dirPath);
    // 清理该根目录下的展开状态
    for (const p of [...this._treeExpandedPaths]) {
      if (p === dirPath || p.startsWith(dirPath + '/') || p.startsWith(dirPath + '\\')) {
        this._treeExpandedPaths.delete(p);
      }
    }
    await this.renderSidebarTree();
  },

  async renderSidebarTree() {
    const container = document.getElementById('sidebar-tree');
    if (!container) return;

    try {
      const volumes = await window.gitFinder.fs.getMountedVolumes();
      if (!volumes || volumes.length === 0) {
        container.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--text-tertiary);">未检测到挂载磁盘</div>';
        return;
      }

      // 初始化展开路径集合(持久化在内存中)
      if (!this._treeExpandedPaths) {
        this._treeExpandedPaths = new Set();
      }

      let html = '';
      for (const vol of volumes) {
        html += await this._renderTreeNode(vol.path, vol.name, vol.icon || '💽', true, 0);
      }
      container.innerHTML = html;
      this._bindTreeEvents(container);
    } catch (e) {
      container.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#FF3B30;">加载失败</div>';
    }
  },

  async _renderTreeNode(path, name, icon, isVolume, depth) {
    const isExpanded = this._treeExpandedPaths && this._treeExpandedPaths.has(path);
    const selectedClass = AppState.currentPath === path ? 'selected' : '';
    const expandedClass = isExpanded ? 'expanded' : '';
    const indent = depth * 16;

    let html = `
      <div class="tree-node ${selectedClass} ${isVolume ? 'is-volume' : ''}" data-path="${path}" data-depth="${depth}">
        <span class="tree-node-toggle ${expandedClass}" style="margin-left:${indent}px;">${isExpanded ? '▼' : '▶'}</span>
        <span class="tree-node-icon">${icon || '📁'}</span>
        <span class="tree-node-name" title="${path}">${name}</span>
      </div>
    `;

    if (isExpanded) {
      try {
        const items = await window.gitFinder.fs.listDirectory(path, {
          showHidden: false,
          recursive: false
        });
        let dirs = items.filter(i => i.type === 'directory');
        if (dirs.length > 0) {
          for (const child of dirs) {
            html += await this._renderTreeNode(child.path, child.name, child.isGitRepo ? '📦' : '📁', false, depth + 1);
          }
        }
      } catch (e) {
        html += `<div class="tree-node tree-error" style="margin-left:${indent + 16}px;">无法访问</div>`;
      }
    }

    return html;
  },

  _bindTreeEvents(container) {
    container.querySelectorAll('.tree-node').forEach(node => {
      const toggle = node.querySelector('.tree-node-toggle');
      const name = node.querySelector('.tree-node-name');
      const path = node.dataset.path;

      // 点击箭头:展开/折叠
      if (toggle) {
        toggle.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!this._treeExpandedPaths) this._treeExpandedPaths = new Set();
          if (this._treeExpandedPaths.has(path)) {
            this._treeExpandedPaths.delete(path);
          } else {
            this._treeExpandedPaths.add(path);
          }
          await this.renderSidebarTree();
        });
      }

      // 点击名称:导航到目录
      if (name) {
        name.addEventListener('click', async (e) => {
          e.stopPropagation();
          container.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
          node.classList.add('selected');
          if (AppState.currentMode !== 'tree') {
            AppState.currentMode = 'tree';
            this.updateModeUI();
          }
          this.navigateTo(path);
        });
      }
    });
  },

  async _loadGitStatusBadges(container) {
    const gitNodes = container.querySelectorAll('.tree-node[data-is-git="true"]');
    for (const node of gitNodes) {
      const path = node.dataset.path;
      const badge = node.querySelector('.tree-git-status');
      if (!badge || !badge.classList.contains('loading')) continue;
      try {
        const status = await window.gitFinder.git.getStatus(path, { autoFetch: false });
        const branch = status.branch || 'main';
        const isDirty = status.overallStatus === 'dirty';
        const isAhead = status.overallStatus === 'ahead';
        const dotClass = isDirty ? 'dirty' : (isAhead ? 'ahead' : 'clean');
        badge.className = `tree-git-status ${dotClass}`;
        badge.textContent = branch;
      } catch (e) {
        badge.className = 'tree-git-status clean';
        badge.textContent = '?';
      }
    }
  },

  _renderTreeChildren(parentPath, dirs) {
    let html = `<div class="tree-children" data-parent="${parentPath}">`;
    for (const child of dirs) {
      if (child.type !== 'directory') continue;
      const childExpanded = this._treeExpandedPaths.has(child.path);
      if (child.isGitRepo) {
        html += this._renderTreeNode(child.path, child.name, null, false);
      } else {
        html += this._renderTreeNode(child.path, child.name, [], childExpanded);
      }
    }
    html += '</div>';
    return html;
  },

  _syncTreeSelection() {
    const container = document.getElementById('sidebar-tree');
    if (!container) return;
    container.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
    const selected = container.querySelector(`.tree-node[data-path="${AppState.currentPath}"]`);
    if (selected) {
      selected.classList.add('selected');
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  },

  async _syncTreeToCurrentPath() {
    if (!AppState.currentPath || !this._treeRootsLoaded) return;

    // 查找当前路径所属的根目录
    let containingRoot = null;
    for (const root of this._treeRoots) {
      if (AppState.currentPath === root.path ||
          AppState.currentPath.startsWith(root.path + '/') ||
          AppState.currentPath.startsWith(root.path + '\\')) {
        containingRoot = root;
        break;
      }
    }

    if (!containingRoot) return;

    // 展开所有祖先节点
    let pathToExpand = AppState.currentPath;
    const pathsToExpand = [];
    while (pathToExpand && pathToExpand !== containingRoot.path) {
      pathsToExpand.unshift(pathToExpand);
      const parent = this.getParentPath(pathToExpand);
      if (!parent || parent === pathToExpand) break;
      pathToExpand = parent;
    }

    let needsRender = false;
    for (const p of pathsToExpand) {
      if (!this._treeExpandedPaths.has(p)) {
        this._treeExpandedPaths.add(p);
        needsRender = true;
      }
    }

    if (needsRender) {
      await this.renderSidebarTree();
    } else {
      this._syncTreeSelection();
    }
  },

  async loadFavorites() {
    try {
      const [favorites, quickLocs, hiddenQuickLocs] = await Promise.all([
        window.gitFinder.config.getFavorites(),
        window.gitFinder.fs.getQuickLocations(),
        window.gitFinder.config.get('hiddenQuickLocations')
      ]);

      const hiddenSet = new Set(hiddenQuickLocs || []);
      const container = document.getElementById('favorites-list');

      const allItems = [];

      for (const loc of quickLocs) {
        if (hiddenSet.has(loc.path)) continue;
        allItems.push({
          id: loc.path,
          type: 'dir',
          path: loc.path,
          name: loc.name,
          isQuick: true,
          icon: '📍',
          canRemove: true
        });
      }

      const favList = Array.isArray(favorites) ? favorites : [];
      const dirFavorites = favList.filter(f => f.type === 'dir' || !f.type);
      for (const fav of dirFavorites) {
        const favPath = fav.path || '';
        const favName = fav.name || favPath.split('/').pop() || '收藏';
        const isQuick = quickLocs.some(l => l.path === favPath);
        if (isQuick) continue;

        allItems.push({
          id: fav.id || fav.path || fav.name || Math.random().toString(36),
          type: 'dir',
          path: favPath,
          name: favName,
          isQuick: false,
          icon: '⭐',
          canRemove: true
        });
      }

      if (allItems.length === 0) {
        container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#86868b;">暂无收藏</div>';
        return;
      }

      container.innerHTML = allItems.map(item => `
        <div class="sidebar-item" data-id="${item.id}" data-type="${item.type}" data-path="${item.path}">
          <span class="sidebar-icon">${item.icon}</span>
          <span>${item.name}</span>
          ${item.canRemove ? `<button class="sidebar-item-remove" data-id="${item.id}" title="移除收藏">×</button>` : ''}
        </div>
      `).join('');

      container.querySelectorAll('.sidebar-item[data-id]').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('sidebar-item-remove')) return;
          if (item.dataset.path) {
            // 点击收藏目录:自动切换到目录模式
            if (AppState.currentMode !== 'tree') {
              AppState.currentMode = 'tree';
              this.updateModeUI();
            }
            this.navigateTo(item.dataset.path);
          }
        });
      });

      container.querySelectorAll('.sidebar-item-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const favItem = allItems.find(i => i.id === id);
          if (favItem?.isQuick) {
            if (confirm(`从收藏夹移除 "${favItem.name}" ?`)) {
              const hidden = await window.gitFinder.config.get('hiddenQuickLocations') || [];
              if (!hidden.includes(favItem.path)) {
                hidden.push(favItem.path);
                await window.gitFinder.config.set('hiddenQuickLocations', hidden);
              }
            }
          } else {
            await window.gitFinder.config.removeFavorite(id);
          }
          this.loadFavorites();
        });
      });
    } catch (e) {
      console.error('loadFavorites error:', e);
      const container = document.getElementById('favorites-list');
      if (container) {
        container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#FF3B30;">加载失败</div>';
      }
    }
  },

  async loadGroups() {
    AppState.groups = await window.gitFinder.groups.get();
    this.renderSidebarGroups();
  },

  renderSidebarGroups() {
    const container = document.getElementById('groups-list');
    let groups = AppState.groups.groups || [];
    const allRepoCount = AppState.allRepos.length;

    // 按 groupOrder 排序(若有保存的顺序)
    if (AppState.groupOrder && Array.isArray(AppState.groupOrder)) {
      const orderMap = new Map(AppState.groupOrder.map((id, idx) => [id, idx]));
      groups = [...groups].sort((a, b) => {
        const ia = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
        const ib = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
        return ia - ib;
      });
    }

    // 计算未分类仓库数量
    const groupedPaths = new Set();
    for (const g of groups) {
      g.repoPaths.forEach(p => groupedPaths.add(p));
    }
    const ungroupedCount = allRepoCount - groupedPaths.size;

    let html = `
      <div class="sidebar-item category-item ${AppState.selectedCategory === 'all' ? 'active' : ''}" data-category="all">
        <span class="group-color-dot" style="background:#86868b"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">全部项目</span>
        <span class="badge">${allRepoCount}</span>
      </div>
    `;

    for (const group of groups) {
      const active = AppState.selectedCategory === group.id ? 'active' : '';
      html += `
        <div class="sidebar-item category-item category-draggable ${active}" data-category="${group.id}" draggable="true" title="${group.name}（可拖拽排序）">
          <span class="category-drag-handle" title="拖拽排序">⋮⋮</span>
          <span class="group-color-dot" style="background:${group.color}"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${group.name}</span>
          <span class="badge">${group.repoPaths.length}</span>
          <span class="sidebar-item-remove" data-group-id="${group.id}" title="删除分类">×</span>
        </div>
      `;
    }

    const ungroupedActive = AppState.selectedCategory === 'ungrouped' ? 'active' : '';
    html += `
      <div class="sidebar-item category-item ${ungroupedActive}" data-category="ungrouped">
        <span class="group-color-dot" style="background:#C7C7CC"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">未分类</span>
        <span class="badge">${ungroupedCount}</span>
      </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 点击拖拽手柄不触发选中
        if (e.target.classList.contains('category-drag-handle')) return;
        // 点击删除按钮不触发选中
        if (e.target.classList.contains('sidebar-item-remove')) return;
        const category = item.dataset.category;
        AppState.selectedCategory = category;
        AppState.currentMode = 'grid';
        this.updateModeUI();
        this.renderSidebarGroups();
        this.updateFilterBar();
        this.renderContent();
      });
    });

    // 分类删除
    container.querySelectorAll('.sidebar-item-remove[data-group-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const groupId = btn.dataset.groupId;
        const group = (AppState.groups.groups || []).find(g => g.id === groupId);
        if (!group) return;
        if (!confirm(`确认删除分类「${group.name}」?\n该操作会移除所有仓库的分类归属。`)) return;
        await window.gitFinder.groups.delete(groupId);
        AppState.groups = await window.gitFinder.groups.get();
        if (AppState.selectedCategory === groupId) AppState.selectedCategory = 'all';
        this.renderSidebarGroups();
        this.updateFilterBar();
        if (AppState.selectedRepo) {
          AppState.selectedRepo.groups = this._findRepoGroups(AppState.selectedRepo.path);
          this.updateDetailPanel();
        }
        this.renderContent();
      });
    });

    this.setupGroupDrag();
  },

  // 分类项拖拽排序
  setupGroupDrag() {
    const container = document.getElementById('groups-list');
    if (!container || container.dataset.dragInit) return;
    container.dataset.dragInit = '1';

    let draggedItem = null;

    container.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.category-draggable');
      if (!item) return;
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.category);
    });

    container.addEventListener('dragend', (e) => {
      const item = e.target.closest('.category-draggable');
      if (item) item.classList.remove('dragging');
      draggedItem = null;
      this.saveGroupOrder();
    });

    container.addEventListener('dragover', (e) => {
      if (!draggedItem) return;
      e.preventDefault();
      const target = e.target.closest('.category-draggable');
      if (!target || target === draggedItem) return;

      const rect = target.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (e.clientY < midpoint) {
        container.insertBefore(draggedItem, target);
      } else {
        container.insertBefore(draggedItem, target.nextSibling);
      }
    });
  },

  // 保存分类顺序到配置
  saveGroupOrder() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    const order = Array.from(container.querySelectorAll('.category-draggable'))
      .map(el => el.dataset.category);
    AppState.groupOrder = order;
    window.gitFinder.config.set('groupOrder', order);
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
          <span class="sidebar-item-remove" data-tag-id="${tag.id}" title="删除标签">×</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.sidebar-tag-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // 点击删除按钮不触发选中
        if (e.target.classList.contains('sidebar-item-remove')) return;
        const tagId = item.dataset.tagId;
        const idx = AppState.selectedTags.indexOf(tagId);
        if (idx >= 0) {
          AppState.selectedTags.splice(idx, 1);
        } else {
          AppState.selectedTags.push(tagId);
        }
        this.renderSidebarTags();
        this.updateFilterBar();
        this.renderContent();
      });
    });

    // 标签删除
    container.querySelectorAll('.sidebar-item-remove[data-tag-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tagId = btn.dataset.tagId;
        const tag = (AppState.tags.tags || []).find(t => t.id === tagId);
        if (!tag) return;
        if (!confirm(`确认删除标签「${tag.name}」?\n该操作会移除所有仓库的该标签。`)) return;
        await window.gitFinder.tags.delete(tagId);
        AppState.tags = await window.gitFinder.tags.get();
        const sIdx = AppState.selectedTags.indexOf(tagId);
        if (sIdx >= 0) AppState.selectedTags.splice(sIdx, 1);
        this.renderSidebarTags();
        this.updateFilterBar();
        if (AppState.selectedRepo) {
          AppState.selectedRepo.tags = await window.gitFinder.tags.getRepoTags(AppState.selectedRepo.path);
          this.updateDetailPanel();
        }
        this.renderContent();
      });
    });
  },

  // 更新筛选栏:勾选状态 + 当前筛选摘要
  updateFilterBar() {
    // 同步勾选状态
    const catCheck = document.getElementById('filter-category-check');
    const tagCheck = document.getElementById('filter-tag-check');
    const statusCheck = document.getElementById('filter-status-check');
    const nameCheck = document.getElementById('filter-name-check');
    const readmeCheck = document.getElementById('filter-readme-check');
    if (catCheck) catCheck.checked = AppState.filterEnabled.category;
    if (tagCheck) tagCheck.checked = AppState.filterEnabled.tag;
    if (statusCheck) statusCheck.checked = AppState.filterEnabled.status;
    if (nameCheck) nameCheck.checked = AppState.filterEnabled.name;
    if (readmeCheck) readmeCheck.checked = AppState.filterEnabled.readme;

    // 同步状态筛选下拉勾选
    document.querySelectorAll('#status-filter-dropdown input[type="checkbox"]').forEach(cb => {
      cb.checked = AppState.selectedStatuses.includes(cb.value);
    });

    // 渲染筛选摘要
    const summary = document.getElementById('filter-summary');
    if (!summary) return;

    const parts = [];

    // 分类摘要
    if (AppState.filterEnabled.category) {
      const category = AppState.selectedCategory;
      let catLabel = '全部';
      if (category === 'ungrouped') {
        catLabel = '未分类';
      } else if (category !== 'all') {
        const g = (AppState.groups.groups || []).find(g => g.id === category);
        catLabel = g ? g.name : '全部';
      }
      if (category !== 'all') {
        parts.push(`<span class="filter-chip">分类: ${catLabel}</span>`);
      }
    }

    // 标签摘要
    if (AppState.filterEnabled.tag && AppState.selectedTags.length > 0) {
      const selectedTagObjs = AppState.tags.tags.filter(t => AppState.selectedTags.includes(t.id));
      const tagChips = selectedTagObjs.map(tag => `
        <span class="filter-chip" style="background:${tag.color}20;color:${tag.color};">
          ${tag.name}
          <span class="filter-chip-remove" data-remove-tag="${tag.id}">×</span>
        </span>
      `).join('');
      parts.push(`<span class="filter-chip-group">标签: ${tagChips}</span>`);
    }

    // 状态摘要
    if (AppState.filterEnabled.status && AppState.selectedStatuses.length > 0) {
      const statusLabels = {
        dirty: '未提交',
        ahead: '未推送',
        behind: '未拉取',
        clean: '干净'
      };
      const statusChips = AppState.selectedStatuses.map(s => `
        <span class="filter-chip" data-status="${s}">
          ${statusLabels[s] || s}
          <span class="filter-chip-remove" data-remove-status="${s}">×</span>
        </span>
      `).join('');
      parts.push(`<span class="filter-chip-group">状态: ${statusChips}</span>`);
    }

    // 名称摘要
    if (AppState.filterEnabled.name && AppState.searchQuery) {
      parts.push(`<span class="filter-chip">名称: "${AppState.searchQuery}"</span>`);
    }

    // README 摘要
    if (AppState.filterEnabled.readme && AppState.searchQuery) {
      parts.push(`<span class="filter-chip">README: "${AppState.searchQuery}"</span>`);
    }

    summary.innerHTML = parts.length > 0 ? parts.join('') : '<span class="filter-empty">未应用筛选</span>';

    // 标签移除按钮
    summary.querySelectorAll('.filter-chip-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagId = el.dataset.removeTag;
        if (tagId) {
          AppState.selectedTags = AppState.selectedTags.filter(id => id !== tagId);
          this.renderSidebarTags();
        }
        const statusVal = el.dataset.removeStatus;
        if (statusVal) {
          AppState.selectedStatuses = AppState.selectedStatuses.filter(s => s !== statusVal);
        }
        this.updateFilterBar();
        this.renderContent();
      });
    });
  },

  async loadTheme() {
    try {
      // 加载外观模式(默认 light)和配色方案(默认 github)和提醒色(默认 classic)
      const savedMode = await window.gitFinder.config.get('themeMode') || 'light';
      const savedScheme = await window.gitFinder.config.get('themeScheme') || 'github';
      const savedReminder = await window.gitFinder.config.get('themeReminder') || 'classic';

      AppState.themeMode = savedMode;
      AppState.themeScheme = savedScheme;
      AppState.themeReminder = savedReminder;

      this.applyEffectiveMode();
      this._setupSystemThemeListener();
    } catch (e) {
      console.log('Failed to load theme:', e);
    }
  },

  // 设置外观模式:light | dark | auto
  async setMode(mode) {
    AppState.themeMode = mode;
    await window.gitFinder.config.set('themeMode', mode);
    this.applyEffectiveMode();
    this.syncThemeModal();
  },

  // 设置配色方案:github | onedark | dracula | monokai | solarized | nord | muted
  async setScheme(scheme) {
    AppState.themeScheme = scheme;
    await window.gitFinder.config.set('themeScheme', scheme);
    document.documentElement.setAttribute('data-scheme', scheme);
    this.syncThemeModal();
  },

  // 设置提醒色方案:classic | vivid | soft | colorblind
  async setReminder(reminder) {
    AppState.themeReminder = reminder;
    await window.gitFinder.config.set('themeReminder', reminder);
    document.documentElement.setAttribute('data-reminder', reminder);
    this.syncThemeModal();
  },

  // 根据 mode 解析实际的 effective-mode(light/dark)
  applyEffectiveMode() {
    const mode = AppState.themeMode || 'light';
    let effective = mode;
    if (mode === 'auto') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-effective-mode', effective);
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-scheme', AppState.themeScheme || 'github');
    document.documentElement.setAttribute('data-reminder', AppState.themeReminder || 'classic');
  },

  // 监听系统主题变化(auto 模式下自动切换)
  _setupSystemThemeListener() {
    if (this._systemThemeMql) return;
    this._systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
    this._systemThemeMql.addEventListener('change', () => {
      if (AppState.themeMode === 'auto') {
        this.applyEffectiveMode();
      }
    });
  },

  // 同步主题选择弹窗的选中状态
  syncThemeModal() {
    const currentMode = AppState.themeMode || 'light';
    const currentScheme = AppState.themeScheme || 'github';
    const currentReminder = AppState.themeReminder || 'classic';
    document.querySelectorAll('.theme-card[data-mode]').forEach(card => {
      card.classList.toggle('active', card.dataset.mode === currentMode);
    });
    document.querySelectorAll('.theme-card[data-scheme]').forEach(card => {
      card.classList.toggle('active', card.dataset.scheme === currentScheme);
    });
    document.querySelectorAll('.theme-card[data-reminder]').forEach(card => {
      card.classList.toggle('active', card.dataset.reminder === currentReminder);
    });
  },

  // 加载持久化的仓库列表
  async loadPersistedRepos() {
    try {
      const data = await window.gitFinder.repos.get();
      if (data && data.repos && data.repos.length > 0) {
        AppState.allRepos = data.repos.map(r => ({
          name: r.name,
          path: r.path,
          type: 'directory',
          isGitRepo: true,
          readme: null
        }));
        AppState.reposLastScan = data.lastScanAt || 0;
        AppState.enrichedRepos = [];
      }
    } catch (e) {
      console.log('Failed to load persisted repos:', e);
    }
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
    const filterBar = document.getElementById('filter-bar');
    const showFoldersLabel = document.getElementById('git-only-label');
    if (AppState.currentMode === 'tree') {
      // 按文件夹显示:有排序栏,无筛选栏,显示"显示文件夹"勾选框
      sortBar.style.display = 'flex';
      if (filterBar) filterBar.style.display = 'none';
      if (showFoldersLabel) showFoldersLabel.style.display = '';
    } else {
      // 按仓库显示:有排序栏和筛选栏
      sortBar.style.display = 'flex';
      if (filterBar) filterBar.style.display = 'flex';
      if (showFoldersLabel) showFoldersLabel.style.display = 'none';
    }
  },

  async openFolderDialog() {
    const folder = await window.gitFinder.fs.selectFolder();
    if (folder) {
      // 将选择的文件夹添加为目录树根目录(内容管理器:不断添加新内容)
      await this.addTreeRoot(folder);
    }
  },

  // 扫描指定目录下的 Git 仓库
  async performScan() {
    const scanPath = document.getElementById('scan-path-input').value.trim();
    const depthRaw = document.getElementById('scan-depth-input').value.trim();

    if (!scanPath) {
      alert('请先选择要扫描的目录');
      return;
    }

    // 解析层级:空 = 全部层级(Infinity),否则取数字
    let depth = Infinity;
    if (depthRaw !== '') {
      const parsed = parseInt(depthRaw, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        alert('层级必须是非负整数,或留空表示扫描所有层级');
        return;
      }
      depth = parsed;
    }

    // 更新全局扫描层级
    AppState.scanDepth = depth;

    // 若该目录尚未添加为根目录,则添加(不触发导航,避免切换到目录模式)
    const exists = (this._treeRoots || []).some(r => r.path === scanPath);
    if (!exists) {
      this._treeRoots = await window.gitFinder.config.addTreeRoot(scanPath);
      this._treeExpandedPaths.add(scanPath);
      await this.renderSidebarTree();
    }

    // 关闭弹窗
    document.getElementById('scan-modal').style.display = 'none';

    // 切换到项目模式并强制重新扫描
    AppState.currentMode = 'grid';
    AppState.selectedCategory = 'all';
    this.updateModeUI();
    this.renderSidebarGroups();
    this.updateFilterBar();
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
      <div style="text-align:center;padding:60px;color:#86868b;">
        <div class="loading-spinner" style="margin:0 auto 10px;"></div>
        <div style="font-size:14px;">正在扫描 ${scanPath} ${depth === Infinity ? '(全部层级)' : `(深度 ${depth})`}...</div>
      </div>`;

    await this.renderGridView(true);
    this.updateStatusBar();
  },

  showEmptyState() {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    contentArea.innerHTML = '';
    emptyState.style.display = 'flex';

    document.getElementById('current-path').textContent =
      '点击左侧目录下方的「添加目录」按钮添加项目目录';
  },

  navigateTo(path, replace = false) {
    if (!path) {
      this.showEmptyState();
      return;
    }

    AppState.currentPath = path;

    if (!replace) {
      AppState.history = AppState.history.slice(0, AppState.historyIndex + 1);
      AppState.history.push(path);
      AppState.historyIndex = AppState.history.length - 1;
    }

    window.gitFinder.config.set('lastPath', path);
    this.updateBreadcrumbs();
    this.renderContent();
    this.updateNavButtons();
    // 同步目录树:自动展开并高亮当前路径
    this._syncTreeToCurrentPath();
  },

  goBack() {
    if (AppState.historyIndex > 0) {
      AppState.historyIndex--;
      AppState.currentPath = AppState.history[AppState.historyIndex];
      this.updateBreadcrumbs();
      this.renderContent();
      this.updateNavButtons();
      this._syncTreeToCurrentPath();
    }
  },

  goForward() {
    if (AppState.historyIndex < AppState.history.length - 1) {
      AppState.historyIndex++;
      AppState.currentPath = AppState.history[AppState.historyIndex];
      this.updateBreadcrumbs();
      this.renderContent();
      this.updateNavButtons();
      this._syncTreeToCurrentPath();
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
    const container = document.getElementById('current-path');
    if (!container) return;
    // 仅在目录模式下显示当前路径
    if (AppState.currentMode !== 'tree' || !AppState.currentPath) {
      container.textContent = '';
      return;
    }
    // 拆分路径为多段,构建面包屑
    const sep = AppState.currentPath.includes('\\') ? '\\' : '/';
    const parts = AppState.currentPath.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) {
      container.innerHTML = '<span class="crumb-item">/</span>';
      return;
    }
    // 深路径时折叠中间段(只显示首段、末两段,中间用 … 表示)
    let displayParts = parts.map((name, idx) => {
      // 重建该段对应的绝对路径
      const absPath = (AppState.currentPath[0] === '/' ? '/' : '') + parts.slice(0, idx + 1).join(sep);
      return { name, absPath, idx };
    });
    const MAX = 4;
    if (displayParts.length > MAX) {
      const head = displayParts[0];
      const tail = displayParts.slice(-2);
      displayParts = [head, { name: '…', absPath: null, ellipsis: true }, ...tail];
    }
    let html = '';
    displayParts.forEach((p, i) => {
      if (i > 0) html += '<span class="crumb-sep">›</span>';
      const isLast = i === displayParts.length - 1;
      if (p.ellipsis) {
        html += '<span class="crumb-ellipsis">…</span>';
      } else if (isLast) {
        html += `<span class="crumb-item crumb-current" title="${p.absPath}">${p.name}</span>`;
      } else {
        html += `<a class="crumb-item crumb-link" data-path="${p.absPath}" title="${p.absPath}">${p.name}</a>`;
      }
    });
    container.innerHTML = html;
    // 绑定点击跳转
    container.querySelectorAll('.crumb-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPath = link.dataset.path;
        if (targetPath && targetPath !== AppState.currentPath) {
          this.navigateTo(targetPath);
        }
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
      this.showEmptyState();
      return;
    }

    emptyState.style.display = 'none';
    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#86868b;"><div class="loading-spinner" style="margin:0 auto 10px;"></div>加载中...</div>';

    try {
      if (AppState.currentMode === 'tree') {
        await this.renderTreeView();
      } else if (AppState.currentMode === 'grid') {
        await this.renderGridView();
      }
    } catch (e) {
      console.error('renderContent error:', e);
      contentArea.innerHTML = `
        <div style="text-align:center;padding:40px;color:#FF3B30;">
          <div style="font-size:14px;margin-bottom:8px;">加载失败</div>
          <div style="font-size:12px;color:#86868b;margin-bottom:16px;">${e.message}</div>
          <button class="btn btn-primary" onclick="App.openFolderDialog()">选择其他文件夹</button>
        </div>`;
    }
  },

  async renderTreeView() {
    const contentArea = document.getElementById('content-area');
    let items = await window.gitFinder.fs.listDirectory(AppState.currentPath, {
      showHidden: false,
      recursive: false
    });

    AppState.items = items;

    // 只显示仓库:勾选=仅显示Git仓库,取消=显示所有目录
    if (AppState.gitOnly) {
      items = items.filter(i => i.isGitRepo);
    } else {
      items = items.filter(i => i.type === 'directory');
    }

    // 名称筛选(目录树只按名称/路径过滤,README 在此模式不适用)
    if (AppState.filterEnabled.name && AppState.searchQuery) {
      const q = AppState.searchQuery;
      items = items.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q)
      );
    }

    // 无结果显示空白
    if (!items.length) {
      contentArea.innerHTML = '';
      this.updateStatusBar();
      return;
    }

    if (AppState.cardStyle === 'list') {
      this.renderListView(items, contentArea);
    } else {
      this.renderCardView(items, contentArea);
    }
  },

  async renderGridView(forceRefresh = false) {
    const contentArea = document.getElementById('content-area');

    const roots = this._treeRoots || [];
    if (roots.length === 0) {
      contentArea.innerHTML = `
        <div style="text-align:center;padding:60px;color:#86868b;">
          <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">📂</div>
          <div style="font-size:14px;margin-bottom:6px;">尚未添加任何目录</div>
          <div style="font-size:12px;margin-bottom:16px;">添加目录后,项目模式将聚合展示所有已添加目录下的 Git 仓库</div>
          <button class="btn btn-primary" onclick="App.addTreeRootDialog()">+ 添加目录</button>
        </div>`;
      this.updateStatusBar();
      return;
    }

    const now = Date.now();
    const needsRescan = forceRefresh || !AppState.allRepos.length;

    if (needsRescan) {
      const reposArrays = await Promise.all(
        roots.map(root => window.gitFinder.fs.findGitRepos(root.path, { depth: AppState.scanDepth }).catch(() => []))
      );
      const seen = new Set();
      let repos = [];
      for (const arr of reposArrays) {
        for (const r of arr) {
          if (!seen.has(r.path)) {
            seen.add(r.path);
            repos.push(r);
          }
        }
      }
      AppState.allRepos = repos;
      AppState.reposLastScan = now;
      AppState.enrichedRepos = [];
      // 持久化扫描结果到配置文件
      try {
        await window.gitFinder.repos.set(repos, now);
      } catch (e) {
        console.log('Failed to persist repos:', e);
      }
      // 重新扫描后更新侧边栏分类计数
      this.renderSidebarGroups();
    }

    if (!AppState.allRepos.length) {
      contentArea.innerHTML = `
        <div style="text-align:center;padding:60px;color:#86868b;">
          <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">📂</div>
          <div style="font-size:14px;margin-bottom:6px;">已添加的目录下未找到 Git 仓库</div>
          <div style="font-size:12px;margin-bottom:16px;">尝试添加包含 Git 仓库的目录,或切换到目录模式浏览</div>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-primary" onclick="App.addTreeRootDialog()">+ 添加目录</button>
            <button class="btn" onclick="App.switchMode('tree')">目录模式</button>
          </div>
        </div>`;
      this.updateStatusBar();
      return;
    }

    let displayRepos = this._prepareDisplayRepos();

    if (!displayRepos.length) {
      contentArea.innerHTML = '';
      this.updateStatusBar();
      return;
    }

    this._renderGridContent(displayRepos, contentArea);

    if (!AppState.enrichedRepos.length || forceRefresh) {
      await this._enrichReposAsync();
    }

    this.updateStatusBar();
  },

  _prepareDisplayRepos() {
    let repos = AppState.enrichedRepos.length ? AppState.enrichedRepos : AppState.allRepos.map(r => ({
      ...r,
      gitStatus: { isGitRepo: true, branch: '', modified: 0, ahead: 0, behind: 0, overallStatus: 'clean' },
      tags: [],
      readme: r.readme || null,
      groups: []
    }));

    const filtered = this.filterRepos(repos);
    return this.sortRepos(filtered);
  },

  _renderGridContent(displayRepos, contentArea) {
    // 按选中分类过滤
    const filtered = this._filterByCategory(displayRepos);

    // 平铺展示：所有仓库一个网格,无分区分隔(分类过滤通过左侧项目分类完成)
    if (AppState.cardStyle === 'list') {
      this.renderListView(filtered, contentArea);
    } else {
      contentArea.innerHTML = this.getCardsHtml(filtered);
      this.bindCardEvents(contentArea);
    }
  },

  // 按选中分类过滤仓库
  _filterByCategory(repos) {
    // 分类筛选(受 filterEnabled.category 控制)
    if (!AppState.filterEnabled.category) return repos;

    const category = AppState.selectedCategory;
    if (category === 'all') return repos;

    const groups = AppState.groups?.groups || [];
    const groupedPaths = new Set();
    for (const g of groups) {
      g.repoPaths.forEach(p => groupedPaths.add(p));
    }

    if (category === 'ungrouped') {
      // 未分类:不在任何组中的仓库
      return repos.filter(r => !groupedPaths.has(r.path));
    }

    // 选中的是具体组
    const selectedGroup = groups.find(g => g.id === category);
    if (!selectedGroup) return repos;
    const groupPathSet = new Set(selectedGroup.repoPaths);
    return repos.filter(r => groupPathSet.has(r.path));
  },

  async _enrichReposAsync() {
    const enriched = [];
    const pathToRepo = new Map(AppState.allRepos.map(r => [r.path, r]));

    await Promise.all(AppState.allRepos.map(async (repo) => {
      try {
        const [status, tags, readme] = await Promise.all([
          window.gitFinder.git.getStatus(repo.path, { autoFetch: false }).catch(() => ({ isGitRepo: false })),
          window.gitFinder.tags.getRepoTags(repo.path).catch(() => []),
          window.gitFinder.fs.getReadmePreview(repo.path).catch(() => null)
        ]);
        const groups = this._findRepoGroups(repo.path);
        enriched.push({ ...repo, gitStatus: status, tags, readme: readme || repo.readme, groups });
        this._updateRepoCard(repo.path, status, tags, readme, groups);
      } catch (e) {
        enriched.push({ ...repo, gitStatus: { isGitRepo: false }, tags: [], readme: repo.readme, groups: [] });
      }
    }));

    AppState.enrichedRepos = enriched;

    // enrichment 完成后,如果当前是 grid 模式且有筛选条件,需要重新渲染
    // 因为首次渲染用了默认 gitStatus(都是 clean),状态筛选可能误过滤掉真实匹配的仓库
    if (AppState.currentMode === 'grid') {
      const hasFilter = (AppState.filterEnabled.status && AppState.selectedStatuses.length > 0) ||
                        (AppState.filterEnabled.tag && AppState.selectedTags.length > 0) ||
                        (AppState.searchQuery && (AppState.filterEnabled.name || AppState.filterEnabled.readme));
      if (hasFilter) {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
          const displayRepos = this._prepareDisplayRepos();
          this._renderGridContent(displayRepos, contentArea);
          this.updateStatusBar();
        }
      }
    }
  },

  _updateRepoCard(path, status, tags, readme, groups) {
    const card = document.querySelector(`[data-path="${path}"]`);
    if (!card) return;

    const overallStatus = status.overallStatus || 'clean';
    card.className = card.className.replace(/status-\w+/g, '') + ` status-${overallStatus}`;

    const statusIndicator = card.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.className = `status-indicator status-${overallStatus}`;
    }

    const branchBadge = card.querySelector('.repo-branch-badge');
    if (branchBadge) {
      branchBadge.innerHTML = `<span class="status-indicator status-${overallStatus}"></span>${status.branch || 'main'}`;
    }

    if (readme && readme.description) {
      const readmeEl = card.querySelector('.repo-readme');
      if (readmeEl) readmeEl.textContent = readme.description;
    }
  },

  // 查找仓库所属的所有组
  _findRepoGroups(repoPath) {
    const result = [];
    for (const group of AppState.groups.groups) {
      if (group.repoPaths.includes(repoPath)) {
        result.push(group);
      }
    }
    return result;
  },

  filterRepos(repos) {
    let filtered = [...repos];

    // 名称/README 筛选(分别受 filterEnabled.name 和 filterEnabled.readme 控制)
    // 仅当至少一个筛选开启时才应用搜索过滤
    if (AppState.searchQuery && (AppState.filterEnabled.name || AppState.filterEnabled.readme)) {
      const q = AppState.searchQuery.toLowerCase();
      const nameEnabled = AppState.filterEnabled.name;
      const readmeEnabled = AppState.filterEnabled.readme;
      filtered = filtered.filter(r => {
        if (nameEnabled) {
          if (r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) {
            return true;
          }
        }
        if (readmeEnabled) {
          if (r.readme && r.readme.title && r.readme.title.toLowerCase().includes(q)) {
            return true;
          }
          if (r.readme && r.readme.description && r.readme.description.toLowerCase().includes(q)) {
            return true;
          }
        }
        return false;
      });
    }

    // 标签筛选(受 filterEnabled.tag 控制)
    if (AppState.filterEnabled.tag && AppState.selectedTags.length > 0) {
      filtered = filtered.filter(r => {
        const repoTagIds = (r.tags || []).map(t => t.id);
        return AppState.selectedTags.every(tid => repoTagIds.includes(tid));
      });
    }

    // 状态筛选(受 filterEnabled.status 控制)
    if (AppState.filterEnabled.status && AppState.selectedStatuses.length > 0) {
      filtered = filtered.filter(r => {
        const overall = (r.gitStatus && r.gitStatus.overallStatus) || 'clean';
        return AppState.selectedStatuses.includes(overall);
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
    const groups = item.groups || [];

    return `
      <div class="repo-card status-${overallStatus}" data-path="${item.path}" data-is-git="${item.isGitRepo}">
        <div class="repo-card-header">
          <div class="repo-name">
            <span class="repo-icon">${item.type === 'file' ? '📄' : '📁'}</span>
            ${item.name}
          </div>
          <div class="repo-branch-badge">
            <span class="status-indicator status-${overallStatus}"></span>
            ${status.branch || 'main'}
          </div>
        </div>
        <div class="repo-path">${item.path}</div>
        ${tags.length > 0 ? `
          <div class="repo-tags">
            ${tags.map(t => `<span class="repo-tag" style="background:${t.color}20;color:${t.color};border:1px solid ${t.color}40;">${t.name}</span>`).join('')}
          </div>
        ` : ''}
        ${groups.length > 0 ? `
          <div class="repo-meta">
            <div class="repo-meta-row">
              <span class="repo-meta-label">组:</span>
              ${groups.map(g => `<span class="repo-meta-chip" style="background:${g.color}20;color:${g.color};border:1px solid ${g.color}40;">📁 ${g.name}</span>`).join('')}
            </div>
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
    container.innerHTML = this._getListHtml(items);
    this.bindCardEvents(container);
  },

  _getListHtml(items) {
    const repos = items.filter(i => i.isGitRepo);
    const dirs = items.filter(i => !i.isGitRepo && i.type === 'directory');
    const files = items.filter(i => i.type === 'file');

    let html = '<div class="repo-list">';

    for (const item of [...dirs, ...repos, ...files]) {
      html += this._getListItemHtml(item);
    }

    html += '</div>';

    if (items.length === 0) {
      html = '<div style="text-align:center;padding:60px;color:#86868b;">此目录为空</div>';
    }

    return html;
  },

  // 渲染单个列表项 HTML(供 _getListHtml 和分组列表复用)
  _getListItemHtml(item) {
    const status = item.gitStatus || {};
    const groups = item.groups || [];
    const overallStatus = status.overallStatus || (item.isGitRepo ? 'clean' : 'none');
    return `
      <div class="repo-list-item status-${overallStatus}" data-path="${item.path}" data-is-git="${item.isGitRepo}">
        <span class="list-status-dot">${item.isGitRepo ? `<span class="status-indicator status-${overallStatus}" title="${overallStatus}"></span>` : ''}</span>
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
        ${groups.length > 0 ? `<span class="list-repo-groups">${groups.map(g => `<span class="group-dot" style="background:${g.color}" title="${g.name}"></span>`).join('')}</span>` : ''}
      </div>
    `;
  },

  getListHtml(items) {
    return this._getListHtml(items);
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
        await this.selectRepo(repoPath);
        GitOps.pull(repoPath);
        break;
      case 'push':
        await this.selectRepo(repoPath);
        GitOps.push(repoPath);
        break;
      case 'commit':
        await this.selectRepo(repoPath);
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
    const groups = this._findRepoGroups(repoPath);

    AppState.selectedRepo = { ...info, gitStatus: status, readme, tags, groups };
    // 同步终端工作目录
    if (typeof Terminal !== 'undefined') {
      Terminal.setCwd(repoPath);
    }
    this.updateDetailPanel();
  },

  // 更新详情面板区域可见性
  updateDetailSections() {
    document.querySelectorAll('.detail-content [data-section-id]').forEach(section => {
      const id = section.dataset.sectionId;
      const visible = AppState.detailSections[id] !== false;
      section.style.display = visible ? '' : 'none';
    });
  },

  // 应用保存的区域排列顺序
  applyDetailSectionOrder() {
    if (!AppState.detailSectionOrder) return;
    const container = document.querySelector('.detail-content');
    if (!container) return;
    const sections = {};
    container.querySelectorAll('[data-section-id]').forEach(s => {
      sections[s.dataset.sectionId] = s;
    });
    // 按保存顺序重新插入(append 会移动元素到末尾)
    AppState.detailSectionOrder.forEach(id => {
      if (sections[id]) container.appendChild(sections[id]);
    });
  },

  // 保存区域排列顺序到配置
  async saveDetailSectionOrder() {
    const order = [];
    document.querySelectorAll('.detail-content [data-section-id]').forEach(s => {
      order.push(s.dataset.sectionId);
    });
    AppState.detailSectionOrder = order;
    await window.gitFinder.config.set('detailSectionOrder', order);
  },

  // 设置详情区域拖拽排序
  setupDetailSectionDrag() {
    const sections = document.querySelectorAll('.detail-section[data-section-id]');
    let draggedSection = null;

    sections.forEach(section => {
      // 跳过已初始化的区域
      if (section.dataset.dragInit) return;
      section.dataset.dragInit = '1';

      // 添加拖拽手柄到标题
      const h4 = section.querySelector('h4, .section-toggle');
      if (h4 && !h4.querySelector('.drag-handle')) {
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '⋮⋮';
        handle.title = '拖拽排序';
        h4.insertBefore(handle, h4.firstChild);
      }

      // 仅在手柄按下时启用拖拽
      section.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('drag-handle')) {
          section.draggable = true;
        }
      });

      section.addEventListener('dragstart', (e) => {
        draggedSection = section;
        section.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });

      section.addEventListener('dragend', () => {
        section.classList.remove('dragging');
        section.draggable = false;
        draggedSection = null;
        this.saveDetailSectionOrder();
      });

      section.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedSection || draggedSection === section) return;
        const rect = section.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          section.parentNode.insertBefore(draggedSection, section);
        } else {
          section.parentNode.insertBefore(draggedSection, section.nextSibling);
        }
      });
    });
  },

  async updateDetailPanel() {
    const repo = AppState.selectedRepo;
    if (!repo) return;

    document.getElementById('detail-empty').style.display = 'none';
    document.getElementById('detail-content').style.display = 'flex';

    document.getElementById('detail-name').textContent = repo.name;
    document.getElementById('detail-path').textContent = repo.path;

    // 同步区域显示状态
    this.updateDetailSections();
    // 应用保存的排列顺序
    this.applyDetailSectionOrder();
    // 设置拖拽排序
    this.setupDetailSectionDrag();

    // 同步显示开关按钮状态
    const toggleBtn = document.getElementById('toggle-assignments-btn');
    if (toggleBtn) {
      toggleBtn.textContent = AppState.showAllAssignments ? '隐藏未选' : '显示全部';
      toggleBtn.classList.toggle('active', !AppState.showAllAssignments);
    }

    const tags = repo.tags || [];
    const hasFavTag = tags.some(t => t.name === '收藏');
    const favBtn = document.getElementById('detail-fav-btn');
    favBtn.classList.toggle('active', hasFavTag);
    favBtn.textContent = hasFavTag ? '★' : '☆';

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

    // 分类:显示已有分类,已加入的高亮,点击切换赋值
    const groupsEl = document.getElementById('detail-groups');
    const repoGroups = repo.groups || [];
    const repoGroupIds = new Set(repoGroups.map(g => g.id));
    const allGroups = AppState.groups.groups || [];
    const visibleGroups = AppState.showAllAssignments ? allGroups : allGroups.filter(g => repoGroupIds.has(g.id));
    if (visibleGroups.length === 0) {
      groupsEl.innerHTML = '<div style="font-size:12px;color:#86868b;">暂无分类,点击下方按钮新建</div>';
    } else {
      groupsEl.innerHTML = visibleGroups.map(g => {
        const assigned = repoGroupIds.has(g.id);
        const style = assigned
          ? `background:${g.color};color:#fff;border:1px solid ${g.color};`
          : `background:rgba(0,0,0,0.04);color:#86868b;border:1px solid rgba(0,0,0,0.1);`;
        return `<span class="detail-tag toggle" data-group-id="${g.id}" style="${style}" title="${assigned ? '点击移除' : '点击加入'}">${g.name}</span>`;
      }).join('');
      groupsEl.querySelectorAll('.detail-tag.toggle[data-group-id]').forEach(el => {
        el.addEventListener('click', async () => {
          const groupId = el.dataset.groupId;
          if (repoGroupIds.has(groupId)) {
            await window.gitFinder.groups.removeRepo(groupId, repo.path);
          } else {
            await window.gitFinder.groups.addRepo(groupId, repo.path);
          }
          AppState.groups = await window.gitFinder.groups.get();
          repo.groups = this._findRepoGroups(repo.path);
          this.updateDetailPanel();
          this.renderSidebarGroups();
          this.renderContent();
        });
      });
    }

    // 标签:显示已有标签,已赋值的高亮,点击切换赋值
    const tagsEl = document.getElementById('detail-tags');
    const repoTagIds = new Set(tags.map(t => t.id));
    const allTags = AppState.tags.tags || [];
    const visibleTags = AppState.showAllAssignments ? allTags : allTags.filter(t => repoTagIds.has(t.id));
    if (visibleTags.length === 0) {
      tagsEl.innerHTML = '<div style="font-size:12px;color:#86868b;">暂无标签,点击下方按钮新建</div>';
    } else {
      tagsEl.innerHTML = visibleTags.map(t => {
        const assigned = repoTagIds.has(t.id);
        const style = assigned
          ? `background:${t.color};color:#fff;border:1px solid ${t.color};`
          : `background:rgba(0,0,0,0.04);color:#86868b;border:1px solid rgba(0,0,0,0.1);`;
        return `<span class="detail-tag toggle" data-tag-id="${t.id}" style="${style}" title="${assigned ? '点击移除' : '点击赋值'}">${t.name}</span>`;
      }).join('');
      tagsEl.querySelectorAll('.detail-tag.toggle[data-tag-id]').forEach(el => {
        el.addEventListener('click', async () => {
          const tagId = el.dataset.tagId;
          if (repoTagIds.has(tagId)) {
            await window.gitFinder.tags.removeRepo(tagId, repo.path);
          } else {
            await window.gitFinder.tags.addRepo(tagId, repo.path);
          }
          AppState.tags = await window.gitFinder.tags.get();
          repo.tags = await window.gitFinder.tags.getRepoTags(repo.path);
          this.updateDetailPanel();
          this.renderSidebarTags();
          this.renderContent();
        });
      });
    }
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

    if (AppState.currentMode === 'grid') {
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
