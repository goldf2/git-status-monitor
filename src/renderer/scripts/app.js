const AppState = {
  currentPath: '',
  currentMode: 'tree',
  cardStyle: 'card',
  defaultCardStyle: 'card',
  sortBy: 'name',
  defaultSortBy: 'name',
  sortOrder: 'asc',
  defaultSortOrder: 'asc',
  columnViewWidth: 260,
  defaultColumnViewWidth: 260,
  rememberDirectoryViewPreferences: false,
  directoryViewPreferences: {},
  showSubrepos: false,
  showGitOnly: false,
  showHiddenFiles: false,
  contentQuery: window.ContentQuery.defaultQuery(),
  smartCollections: [],
  projectShortcuts: window.ProjectShortcuts.defaultStore(),
  projectShortcutPreferences: window.ProjectShortcuts.defaultPreferences(),
  selectedRepo: null,
  selectedPaths: new Set(),
  selectionAnchorPath: null,
  fileKeyboardFocusPath: null,
  visibleItems: [],
  fileDisplayOrder: [],
  directoryRenderRequestId: 0,
  directoryLoad: null,
  directoryRenderProgress: null,
  directoryPerformance: null,
  fileOperationHistory: [],
  fileOperationBusy: false,
  externalImportPreview: null,
  externalImportApplying: false,
  externalImportError: null,
  externalImportStatus: null,
  transferPreview: null,
  transferApplying: false,
  transferError: null,
  transferStatus: null,
  transferContext: null,
  fileRecoveryStatus: null,
  fileClipboard: null,
  fileDrag: null,
  workspaceTabDrag: null,
  workspaceSession: null,
  directoryWatchId: null,
  directoryWatchPath: '',
  items: [],
  favorites: [],
  allRepos: [],
  enrichedRepos: [],
  repoEnrichmentComplete: false,
  repoEnrichmentRequestId: null,
  repoEnrichmentProgress: null,
  repoEnrichmentCancelling: false,
  groups: { groups: [], ungrouped: [] },
  tags: { tags: [], repoTags: {} },
  fileLabels: window.FileLabels.defaultStore(),
  fileLabelCollectionMeta: null,
  selectedTags: [],
  selectedStatuses: [], // 状态筛选:dirty|ahead|behind|clean
  selectedCategory: 'all', // 'all' | 'ungrouped' | groupId
  groupOrder: null, // 分类拖拽顺序(null=默认,存储 group.id 数组)
  filterEnabled: { tag: true, status: true, name: true, readme: true },
  showAllAssignments: true, // 详情面板是否显示未选中的分类/标签
  detailSections: { groups: true, tags: true, readme: true, documents: true, progress: true, 'git-actions': true, 'system-actions': true },
  detailSectionOrder: null, // 区域排列顺序(null=默认)
  sidebarSectionOrder: null, // 侧栏 section 排列顺序(null=默认)
  sidebarCollapsedSections: new Set(), // 侧栏 section 折叠状态(存储 section-id)
  searchQuery: '',
  searchScope: 'current',
  globalSearchMode: 'metadata',
  globalSearchType: 'all',
  globalSearchResults: [],
  globalSearchMeta: null,
  globalSearchLoading: false,
  globalSearchRequestId: null,
  globalIndexStatus: null,
  globalIndexPollTimer: null,
  galleryPreviewRequestId: 0,
  settingsReturnMode: null,
  localProjects: [],
  localProjectsLoading: false,
  projectDialog: null,
  developerTools: null,
  history: [],
  historyIndex: -1,
  reposLastScan: 0,
  scanDepth: 3, // 扫描层级, Infinity = 全部层级
  scanDirectoryGrantToken: '',
  isLoading: false,
  themeMode: 'light', // 外观模式:light | dark | auto
  themeScheme: 'github', // 配色方案:github | onedark | dracula | monokai | solarized | nord | muted
  themeReminder: 'classic', // 提醒色方案:classic | vivid | soft | colorblind
  semanticColorProfile: null,
  controlSlot: 'progress',
  documentMode: 'preview',
  dashboardStats: null,
  taskPortfolio: null,
  taskPortfolioLoading: false,
  selectedTaskKey: null,
  selectedMilestoneKey: null,
  taskViewMode: 'list',
  taskBoardScrollLeft: 0,
  taskListScrollTop: 0,
  taskRelationScrollTop: 0,
  taskTimelineScrollTop: 0,
  taskTimelineCategory: 'all',
  milestoneStatusFilter: 'open',
  taskFilters: { projectId: 'all', status: 'open', priority: 'all', leafOnly: true },
  taskGitEvidenceByKey: new Map(),
  taskGitEvidenceLoading: new Set(),
  taskStatusPreview: null,
  taskStatusPreviewLoading: false,
  taskStatusApplying: false,
  taskEditTaskKey: null,
  taskEditDraft: null,
  taskEditPreview: null,
  taskEditStage: 'form',
  taskEditPreviewLoading: false,
  taskEditApplying: false,
  taskCreateDraft: null,
  taskCreatePreview: null,
  taskCreateStage: 'form',
  taskCreatePreviewLoading: false,
  taskCreateApplying: false,
  milestoneEditKey: null,
  milestoneEditDraft: null,
  milestoneEditPreview: null,
  milestoneEditStage: 'form',
  milestoneEditPreviewLoading: false,
  milestoneEditApplying: false,
  relationshipSummary: null
};

const App = {
  directoryBatchRenderer: null,
  directoryVirtualizer: null,
  galleryThumbnailLoader: null,
  quickLookController: null,
  fileOperationController: null,
  fileOperationDialogController: null,
  fileActionBarController: null,
  fileLabelController: null,
  fileSelectionDetailController: null,
  repositoryDetailController: null,
  fileOperationHistoryController: null,
  fileInfoController: null,
  batchRenameController: null,
  fileTransferController: null,
  contentFilterController: null,
  smartCollectionsController: null,
  projectShortcutsController: null,
  directoryNavigationController: null,
  sidebarTreeController: null,
  repositoryRootScanner: null,
  directoryPerformanceController: null,
  unavailableLocationController: null,
  directorySelectionController: null,
  relationshipBoardController: null,

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

    this.setupQuickLookController();
    this.setupFileOperationController();
    this.setupFileOperationDialogController();
    this.setupFileActionBarController();
    this.setupFileLabelController();
    this.setupFileSelectionDetailController();
    this.setupRepositoryDetailController();
    this.setupFileOperationHistoryController();
    this.setupFileInfoController();
    this.setupBatchRenameController();
    this.setupFileTransferController();
    this.setupContentFilterController();
    this.setupSmartCollectionsController();
    this.setupProjectShortcutsController();
    this.setupDirectoryNavigationController();
    this.setupSidebarTreeController();
    this.setupRepositoryRootScanner();
    this.setupDirectoryPerformanceController();
    this.setupUnavailableLocationController();
    this.setupDirectorySelectionController();
    this.setupRelationshipBoardController();
    this.setupEventListeners();
    // 初始化内嵌终端
    if (typeof Terminal !== 'undefined') {
      Terminal.init();
    }
    await this.loadTheme();
    await this.fileLabelController.load();
    const savedCardStyle = await window.gitFinder.config.get('cardStyle').catch(() => null);
    if (['card', 'list', 'column', 'gallery'].includes(savedCardStyle)) AppState.cardStyle = savedCardStyle;
    AppState.defaultCardStyle = AppState.cardStyle;
    const savedSortBy = await window.gitFinder.config.get('sortBy').catch(() => null);
    if (['name', 'path', 'dir', 'status', 'time', 'size', 'branch'].includes(savedSortBy)) AppState.sortBy = savedSortBy;
    AppState.defaultSortBy = AppState.sortBy;
    const savedSortOrder = await window.gitFinder.config.get('sortOrder').catch(() => null);
    if (['asc', 'desc'].includes(savedSortOrder)) AppState.sortOrder = savedSortOrder;
    AppState.defaultSortOrder = AppState.sortOrder;
    const [savedColumnViewWidth, rememberDirectoryViews, rawDirectoryViewPreferences] = await Promise.all([
      window.gitFinder.config.get('columnViewWidth').catch(() => null),
      window.gitFinder.config.get('rememberDirectoryViewPreferences').catch(() => false),
      window.gitFinder.config.get('directoryViewPreferences').catch(() => ({}))
    ]);
    AppState.columnViewWidth = window.DirectoryViewPreferences.normalizeColumnWidth(savedColumnViewWidth);
    AppState.defaultColumnViewWidth = AppState.columnViewWidth;
    AppState.rememberDirectoryViewPreferences = rememberDirectoryViews === true;
    AppState.directoryViewPreferences = window.DirectoryViewPreferences.normalizeStore(rawDirectoryViewPreferences, {
      platform: window.gitFinder.platform
    });
    this.applyDirectoryViewPreference(AppState.currentPath, 'tree');
    const savedShowHiddenFiles = await window.gitFinder.config.get('showHiddenFiles').catch(() => false);
    AppState.showHiddenFiles = savedShowHiddenFiles === true;
    const savedTaskViewMode = await window.gitFinder.config.get('taskViewMode').catch(() => null);
    if (['list', 'board', 'timeline', 'milestones', 'relations'].includes(savedTaskViewMode)) AppState.taskViewMode = savedTaskViewMode;
    const savedTaskTimelineCategory = await window.gitFinder.config.get('taskTimelineCategory').catch(() => null);
    if (['all', 'activity', 'test', 'evidence', 'acceptance', 'automation'].includes(savedTaskTimelineCategory)) {
      AppState.taskTimelineCategory = savedTaskTimelineCategory;
    }
    const savedSearchScope = await window.gitFinder.config.get('searchScope');
    if (savedSearchScope === 'global') AppState.searchScope = 'global';
    await this.loadWorkspaceTabs();
    this.updateSearchScopeUI();
    await this.loadSidebarData();
    await this.loadProjectShortcuts();
    // 先加载持久化的仓库列表(避免启动时重新扫描)
    // 必须在 loadGroups 之前,否则侧边栏分类计数会显示为 0
    await this.loadPersistedRepos();
    await this.loadGroups();
    await this.loadTags();
    await this.smartCollectionsController.load();
    await this.loadFileOperationHistory();
    await this.loadConfigTransactionRecoveryStatus();
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

    // 根目录只能由系统文件夹选择器显式授权，不能从历史路径静默扩大受管范围。
    const restoreWorkspaceView = AppState.currentMode !== 'tree' || this.isContentCollection();
    if (AppState.currentPath && this._treeRootsLoaded) {
      const underRoot = this._treeRoots.some(r =>
        AppState.currentPath === r.path ||
        AppState.currentPath.startsWith(r.path + '/') ||
        AppState.currentPath.startsWith(r.path + '\\')
      );
      if (!underRoot) {
        if (this._treeRoots.length === 0) {
          AppState.currentPath = '';
        } else {
          AppState.currentPath = this._treeRoots[0].path;
        }
      }
    }
    if (restoreWorkspaceView) {
      this.captureActiveWorkspaceTab();
      this.renderWorkspaceTabs();
      this.updateModeUI();
      this.updateBreadcrumbs();
      await this.renderContent();
    } else if (AppState.currentPath) {
      this.navigateTo(AppState.currentPath, true);
    } else {
      this.showEmptyState();
    }
    if (this.isGlobalSearchActive()) await this.performGlobalSearch();
    this.updateStatusBar();
    // 首屏可用后在后台核对仓库索引，自动吸收目录移动和归档变化。
    setTimeout(() => this.reconcileRepositoryIndex().catch(error => {
      console.warn('仓库索引后台核对失败:', error);
    }), 0);
    setTimeout(() => this.refreshProjectShortcuts().catch(error => {
      console.warn('项目快捷入口后台刷新失败:', error);
    }), 0);
  },

  setupQuickLookController() {
    this.quickLookController = new window.QuickLookController.Controller({
      renderMarkdown: content => this.renderMarkdown(content),
      escapeHtml: value => this.escapeHtml(value),
      formatFileSize: value => this.formatFileSize(value),
      formatItemDate: value => this.formatItemDate(value),
      getItemByPath: itemPath => AppState.visibleItems.find(candidate => candidate.path === itemPath),
      activateDirectory: item => this.activateFileItem(item)
    });
    this.quickLookController.bind();
  },

  setupFileOperationController() {
    this.fileOperationController = new window.FileOperationController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      editActionRouter: window.EditActionRouter
    });
  },

  setupFileOperationDialogController() {
    this.fileOperationDialogController = new window.FileOperationDialogController.Controller({
      document,
      window
    });
    this.fileOperationDialogController.bind();
  },

  setupFileActionBarController() {
    this.fileActionBarController = new window.FileActionBarController.Controller({
      app: this,
      state: AppState,
      document
    });
  },

  setupFileLabelController() {
    this.fileLabelController = new window.FileLabelController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      window
    });
    this.fileLabelController.bind();
  },

  setupFileSelectionDetailController() {
    this.fileSelectionDetailController = new window.FileSelectionDetailController.Controller({
      app: this,
      state: AppState,
      document,
      fileBrowser: window.FileBrowser
    });
  },

  setupRepositoryDetailController() {
    this.repositoryDetailController = new window.RepositoryDetailController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      terminal: typeof Terminal !== 'undefined' ? Terminal : null
    });
  },

  setupFileOperationHistoryController() {
    this.fileOperationHistoryController = new window.FileOperationHistoryController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      window
    });
    this.fileOperationHistoryController.bind();
  },

  setupFileInfoController() {
    this.fileInfoController = new window.FileInfoController.Controller({
      app: this,
      bridge: window.gitFinder,
      document,
      window
    });
    this.fileInfoController.bind();
  },

  setupBatchRenameController() {
    this.batchRenameController = new window.BatchRenameController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      window,
      model: window.BatchRename
    });
    this.batchRenameController.bind();
  },

  setupFileTransferController() {
    this.fileTransferController = new window.FileTransferController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      presentation: window.FileTransfers,
      contentQuery: window.ContentQuery
    });
  },

  setupContentFilterController() {
    this.contentFilterController = new window.ContentFilterController.Controller({
      app: this,
      state: AppState,
      contentQuery: window.ContentQuery
    });
    this.contentFilterController.bind();
  },

  setupSmartCollectionsController() {
    this.smartCollectionsController = new window.SmartCollectionsController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      contentQuery: window.ContentQuery
    });
    this.smartCollectionsController.bind();
  },

  setupProjectShortcutsController() {
    this.projectShortcutsController = new window.ProjectShortcutsController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      platform: window.gitFinder.platform
    });
    this.projectShortcutsController.bind();
  },

  setupDirectoryNavigationController() {
    this.directoryNavigationController = new window.DirectoryNavigationController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      workspaceTabs: window.WorkspaceTabs,
      contentQuery: window.ContentQuery
    });
  },

  setupSidebarTreeController() {
    this.sidebarTreeController = new window.SidebarTreeController.Controller({
      app: this,
      state: AppState,
      bridge: window.gitFinder,
      document,
      platform: window.gitFinder.platform
    });
  },

  setupRepositoryRootScanner() {
    this.repositoryRootScanner = new window.RepositoryRootScanner.Scanner({
      bridge: window.gitFinder,
      platform: window.gitFinder.platform
    });
  },

  setupDirectoryPerformanceController() {
    this.directoryPerformanceController = new window.DirectoryPerformanceController.Controller({
      app: this,
      state: AppState,
      document,
      performanceApi: window.DirectoryPerformance,
      virtualWindow: window.VirtualDirectoryWindow,
      progressiveRender: window.ProgressiveDirectoryRender
    });
    this.directoryPerformanceController.bind();
  },

  setupUnavailableLocationController() {
    this.unavailableLocationController = new window.UnavailableLocationController.Controller({
      app: this,
      bridge: window.gitFinder,
      document
    });
  },

  setupDirectorySelectionController() {
    this.directorySelectionController = new window.DirectorySelectionController.Controller({
      app: this,
      state: AppState,
      fileBrowser: window.FileBrowser,
      progressiveRenderer: window.ProgressiveDirectoryRender
    });
  },

  setupRelationshipBoardController() {
    this.relationshipBoardController = new window.RelationshipBoardController.Controller({
      bridge: window.gitFinder,
      notify: (message, type) => this._showStatusMessage(message, type),
      onSummaryChanged: summary => {
        AppState.relationshipSummary = summary;
        if (AppState.currentMode === 'relationships') this.updateStatusBar();
      }
    });
  },

  setupEventListeners() {
    this.setupToolbarMenus();
    this.applyPlatformConventions();
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
    document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
    document.getElementById('btn-up').addEventListener('click', () => this.goUp());
    document.getElementById('workspace-new-tab')?.addEventListener('click', () => this.createWorkspaceTab());

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
      this.captureActiveWorkspaceTab();
      this.scheduleWorkspaceTabsPersist();
      this.updateFilterBar();
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        if (AppState.currentMode === 'tasks') this.renderContent();
        else if (AppState.searchScope === 'global') this.performGlobalSearch();
        else this.renderContent();
      }, AppState.searchScope === 'global' ? 180 : 300);
    });
    document.getElementById('search-scope-btn')?.addEventListener('click', () => this.toggleSearchScope());

    document.querySelectorAll('.sort-btn[data-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.sortBy = btn.dataset.sort;
        this.persistCurrentDirectoryViewPreference();
        this.updateToolbarMenuState();
        this.renderContent();
      });
    });

    document.querySelectorAll('.dir-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        AppState.sortOrder = btn.dataset.dir;
        this.persistCurrentDirectoryViewPreference();
        this.updateToolbarMenuState();
        this.renderContent();
      });
    });

    document.querySelectorAll('.style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setDirectoryViewStyle(btn.dataset.style);
      });
    });

    document.getElementById('toggle-hidden-files')?.addEventListener('click', () => {
      this.toggleHiddenFiles();
    });

    document.getElementById('btn-show-subrepos')?.addEventListener('click', () => {
      // 已移除子仓库功能
    });

    document.querySelectorAll('.directory-base-btn').forEach(button => {
      button.addEventListener('click', () => {
        if (this.contentCollectionKind() === 'file-labels') {
          this.setContentQuery({
            ...window.ContentQuery.normalize(AppState.contentQuery),
            baseType: ['all', 'directory', 'file'].includes(button.dataset.contentBase)
              ? button.dataset.contentBase
              : 'all',
            extensions: [],
            sizeRange: 'any',
            minSizeBytes: null,
            maxSizeBytes: null
          });
          return;
        }
        const presets = { all: 'current-all', directory: 'current-directories', file: 'current-files' };
        this.applyCurrentContentPreset(presets[button.dataset.contentBase] || 'current-all');
      });
    });

    document.querySelectorAll('.directory-attribute-btn').forEach(button => {
      button.addEventListener('click', () => this.toggleCurrentContentAttribute(button.dataset.contentAttribute));
    });

    document.querySelectorAll('.content-preset-btn').forEach(button => {
      button.addEventListener('click', () => this.applyContentPreset(button.dataset.contentPreset));
    });

    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh');
      btn.classList.add('active');
      if (this.isGlobalSearchActive()) {
        await this.performGlobalSearch(true);
      } else if (AppState.currentMode === 'tree') {
        await this.renderContent();
      } else if (AppState.currentMode === 'dashboard') {
        await this.openDashboard(true);
      } else if (AppState.currentMode === 'tasks') {
        await this.renderProjectTasks(true);
      } else if (['projects', 'project-repositories'].includes(this.contentCollectionKind())) {
        await this.renderProjectsView(true);
      } else if (this.contentCollectionKind() === 'repositories') {
        await this.renderGridView(true);
      } else {
        await this.renderContent();
      }
      setTimeout(() => btn.classList.remove('active'), 1000);
    });
    document.getElementById('repo-status-cancel')?.addEventListener('click', () => this.cancelRepoStatusBatch());
    this._removeRepoStatusProgressListener = window.gitFinder.git.onBatchStatusProgress?.(
      progress => this.handleRepoStatusBatchProgress(progress)
    );
    this._removeDirectoryWatchListener = window.gitFinder.fs.onDirectoryChanged?.(
      payload => this.handleDirectoryWatchEvent(payload)
    );
    window.addEventListener('beforeunload', () => {
      this._removeRepoStatusProgressListener?.();
      this._removeDirectoryWatchListener?.();
      this.fileInfoController?.destroy?.();
      const watchId = AppState.directoryWatchId;
      if (watchId) window.gitFinder.fs.unwatchDirectory(watchId).catch(() => {});
      const requestId = AppState.repoEnrichmentRequestId;
      if (requestId && !AppState.repoEnrichmentProgress?.done) {
        window.gitFinder.git.cancelBatchStatus(requestId).catch(() => {});
      }
    }, { once: true });

    document.getElementById('file-new-file')?.addEventListener('click', () => this.createFileFromToolbar());
    document.getElementById('file-new-folder')?.addEventListener('click', () => this.createDirectoryFromToolbar());
    document.getElementById('file-preview')?.addEventListener('click', () => this.toggleQuickLook());
    document.getElementById('file-copy')?.addEventListener('click', () => this.copySelectedItems());
    document.getElementById('file-copy-path')?.addEventListener('click', () => this.copySelectedPathnames());
    document.getElementById('file-cut')?.addEventListener('click', () => this.cutSelectedItems());
    document.getElementById('file-paste')?.addEventListener('click', () => this.pasteFileClipboard());
    document.getElementById('file-get-info')?.addEventListener('click', () => this.openSelectedFileInfo());
    document.getElementById('file-duplicate')?.addEventListener('click', () => this.duplicateSelectedItems());
    document.getElementById('file-rename')?.addEventListener('click', () => this.renameSelectedItem());
    document.getElementById('file-move')?.addEventListener('click', () => this.moveSelectedItems());
    document.getElementById('file-open-editor')?.addEventListener('click', () => this.openSelectedInEditor());
    document.getElementById('file-labels')?.addEventListener('click', () => this.openSelectedFileLabels());
    document.getElementById('file-favorite')?.addEventListener('click', () => this.toggleSelectedFavorite());
    document.getElementById('file-trash')?.addEventListener('click', () => this.trashSelectedItems());
    document.getElementById('file-project-settings')?.addEventListener('click', () => this.openSelectedProjectSettings());
    document.getElementById('file-undo')?.addEventListener('click', () => this.undoLastFileOperation());
    document.getElementById('file-redo')?.addEventListener('click', () => this.redoLastFileOperation());
    document.getElementById('btn-go-to-folder')?.addEventListener('click', () => this.openGoToFolderDialog());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsPage());
    document.getElementById('detail-editor-btn')?.addEventListener('click', () => {
      if (AppState.selectedRepo?.path) this.openPathInEditor(AppState.selectedRepo.path);
    });
    document.getElementById('go-to-folder-form')?.addEventListener('submit', event => {
      event.preventDefault();
      this.submitGoToFolderDialog();
    });
    document.getElementById('go-to-folder-input')?.addEventListener('input', () => this.setGoToFolderFeedback(''));
    document.getElementById('go-to-folder-close-btn')?.addEventListener('click', () => this.closeGoToFolderDialog());
    document.getElementById('go-to-folder-cancel-btn')?.addEventListener('click', () => this.closeGoToFolderDialog());
    document.getElementById('go-to-folder-modal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) this.closeGoToFolderDialog();
    });
    document.getElementById('go-to-folder-recent')?.addEventListener('click', event => {
      const suggestion = event.target.closest('[data-go-to-path]');
      const input = document.getElementById('go-to-folder-input');
      if (!suggestion || !input) return;
      input.value = suggestion.dataset.goToPath || '';
      this.setGoToFolderFeedback('');
      input.focus();
      input.select();
    });
    document.getElementById('external-import-close-btn')?.addEventListener('click', () => this.handleExternalImportCancel());
    document.getElementById('external-import-cancel-btn')?.addEventListener('click', () => this.handleExternalImportCancel());
    document.getElementById('external-import-apply-btn')?.addEventListener('click', () => this.applyExternalImport());
    document.getElementById('external-import-modal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) this.handleExternalImportCancel();
    });
    document.getElementById('transfer-review-close-btn')?.addEventListener('click', () => this.handleTransferReviewCancel());
    document.getElementById('transfer-review-cancel-btn')?.addEventListener('click', () => this.handleTransferReviewCancel());
    document.getElementById('transfer-review-apply-btn')?.addEventListener('click', () => this.applyReviewedTransfer());
    document.getElementById('transfer-review-body')?.addEventListener('change', event => {
      if (event.target?.id === 'transfer-conflict-policy') this.changeTransferConflictPolicy(event.target.value);
      if (event.target?.id === 'transfer-structure-risk-ack') {
        this.setTransferStructureRiskAcknowledged(event.target.checked);
      }
    });
    document.getElementById('transfer-review-modal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) this.handleTransferReviewCancel();
    });
    document.addEventListener('keydown', event => this.handleFileKeyboardShortcut(event));
    this.setupFileContextMenu();
    document.getElementById('local-project-close-btn')?.addEventListener('click', () => this.closeLocalProjectDialog());
    document.getElementById('local-project-cancel-btn')?.addEventListener('click', () => this.closeLocalProjectDialog());
    document.getElementById('local-project-save-btn')?.addEventListener('click', () => this.saveLocalProjectDialog());
    document.getElementById('local-project-modal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) this.closeLocalProjectDialog();
    });
    window.gitFinder.app.onShortcut(action => {
      if (action === 'new-tab') this.createWorkspaceTab();
      if (action === 'restore-tab') this.restoreClosedWorkspaceTab();
      if (action === 'close-tab') this.closeWorkspaceTab();
      if (action === 'open-go-to-folder') this.openGoToFolderDialog();
      if (action === 'open-settings') this.openSettingsPage();
      if (action === 'open-file-history') this.fileOperationHistoryController.open();
      if (action === 'show-file-info') this.openSelectedFileInfo();
      if (action === 'copy-pathnames') this.copySelectedPathnames();
      if (action.startsWith('view:')) this.switchView(action.slice(5));
      if (action.startsWith('edit:')) this.handleEditAction(action.slice(5), { source: 'menu' });
    });
    this.setupFileDragAndDrop();
    this.setupWorkspaceTabDrag();

    document.getElementById('choose-folder-btn')?.addEventListener('click', async () => {
      await this.openFolderDialog();
    });

    document.getElementById('content-area')?.addEventListener('click', (event) => {
      const action = event.target.closest('[data-app-action]')?.dataset.appAction;
      if (action === 'open-folder') this.openFolderDialog();
      if (action === 'retry-unavailable-location') this.unavailableLocationController.retry();
      if (action === 'choose-unavailable-location') this.openFolderDialog();
      if (action === 'add-root') this.addTreeRootDialog();
      if (action === 'tree-mode') this.switchMode('tree');
      if (action === 'open-local-project') this.openLocalProject(event.target.closest('[data-project-path]')?.dataset.projectPath);
      if (action === 'edit-local-project') this.openLocalProjectDialog(event.target.closest('[data-project-path]')?.dataset.projectPath);
      if (action === 'manage-file-labels') this.fileLabelController.open([]);
      if (action === 'show-relationship-resource') {
        const button = event.target.closest('[data-relationship-kind]');
        this.showResourceInRelationshipBoard({
          kind: button?.dataset.relationshipKind,
          refId: button?.dataset.relationshipRef,
          path: button?.dataset.relationshipPath
        });
      }
      if (action === 'refresh-local-projects') this.renderProjectsView(true);
      if (action === 'choose-local-project') this.chooseLocalProjectDirectory();
      if (action === 'open-settings') this.openSettingsPage();
      if (action === 'close-settings') this.closeSettingsPage();
      if (action === 'save-settings') this.saveAppSettings();
      if (action === 'clear-directory-view-preferences') this.clearDirectoryViewPreferences();
      if (action === 'clear-recent-projects') this.clearRecentProjects();
      if (action === 'select-terminal') this.selectDeveloperToolExecutable('terminal');
      if (action === 'select-editor') this.selectDeveloperToolExecutable('editor');
      if (action === 'open-theme-settings') this.openThemeSettings();
      if (action === 'file-project-settings') this.openLocalProjectDialog(event.target.closest('[data-project-path]')?.dataset.projectPath);
      if (this.isFileBrowsingContext() && !event.target.closest('.repo-card, .repo-list-item') && !action) {
        this.clearFileSelection();
        this.updateStatusBar();
      }
    });

    document.getElementById('btn-open-folder')?.addEventListener('click', async () => {
      await this.openFolderDialog();
    });

    // 侧栏"位置"区域的"添加目录"按钮
    document.getElementById('btn-add-tree-root')?.addEventListener('click', async () => {
      await this.openFolderDialog();
    });

    document.getElementById('btn-scan')?.addEventListener('click', () => {
      document.getElementById('scan-path-input').value = '';
      document.getElementById('scan-depth-input').value = '';
      document.getElementById('scan-modal').style.display = 'flex';
    });

    document.getElementById('scan-pick-dir-btn')?.addEventListener('click', async () => {
      const selection = await window.gitFinder.fs.selectFolder();
      if (selection?.path) {
        document.getElementById('scan-path-input').value = selection.path;
        AppState.scanDirectoryGrantToken = selection.grantToken || '';
      }
    });

    document.getElementById('confirm-scan-btn')?.addEventListener('click', async () => {
      await this.performScan();
    });

    document.getElementById('btn-theme')?.addEventListener('click', () => this.openThemeSettings());

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

    // 仓库分类是内容筛选，不再占用左侧固定导航区。
    const categoryButton = document.getElementById('category-filter-btn');
    const categoryDropdown = document.getElementById('category-filter-dropdown');
    categoryButton?.addEventListener('click', event => {
      event.stopPropagation();
      const opening = categoryDropdown?.hidden !== false;
      if (categoryDropdown) categoryDropdown.hidden = !opening;
      categoryButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        requestAnimationFrame(() => {
          categoryDropdown?.querySelector('.category-item.active, .category-item')?.focus();
        });
      }
    });
    document.addEventListener('click', event => {
      if (!categoryDropdown || categoryDropdown.hidden) return;
      if (categoryDropdown.contains(event.target) || categoryButton?.contains(event.target)) return;
      categoryDropdown.hidden = true;
      categoryButton?.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !categoryDropdown || categoryDropdown.hidden) return;
      categoryDropdown.hidden = true;
      categoryButton?.setAttribute('aria-expanded', 'false');
      categoryButton?.focus();
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
        // 始终可展开下拉,无论 filterEnabled.status 是否启用
        statusDropdown.style.display = statusDropdown.style.display === 'block' ? 'none' : 'block';
      });
      statusDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const val = cb.value;
          let statuses = this.activeRepositoryStatusFilters();
          if (cb.checked) {
            if (!statuses.includes(val)) statuses = [...statuses, val];
          } else {
            statuses = statuses.filter(status => status !== val);
          }
          this.setActiveRepositoryStatusFilters(statuses);
          this.updateFilterBar();
          this.updateDirectoryTypeFilterUI();
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
      this.setActiveRepositoryStatusFilters([]);
      this.setActiveRepositoryCategory('all');
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

    document.getElementById('add-favorite-btn')?.addEventListener('click', () => this.addCurrentFavorite());

    document.getElementById('add-group-bottom-btn')?.addEventListener('click', () => {
      const dropdown = document.getElementById('category-filter-dropdown');
      if (dropdown) dropdown.hidden = true;
      document.getElementById('category-filter-btn')?.setAttribute('aria-expanded', 'false');
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

    document.querySelectorAll('.progress-format-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchControlSlot(btn.dataset.controlSlot));
    });

    document.getElementById('progress-editor')?.addEventListener('input', () => {
      const repo = AppState.selectedRepo;
      if (!repo?.projectControl) return;
      const slot = AppState.controlSlot;
      repo.projectControl[slot].content = document.getElementById('progress-editor').value;
      repo.projectControl[slot].dirty = true;
      this.updateProgressSaveStatus('未保存');
      if (repo.projectControl[slot].format === 'csv') {
        this.renderProjectControlPreview(repo.projectControl[slot].content);
      }
    });

    document.getElementById('progress-file-select')?.addEventListener('change', event => {
      this.selectProjectControlFile(event.target.value);
    });
    document.getElementById('control-init-btn')?.addEventListener('click', () => this.initializeSelectedProjectControlFiles());
    document.getElementById('control-create-csv-btn')?.addEventListener('click', () => this.createProjectControlCsv());
    document.getElementById('control-add-row-btn')?.addEventListener('click', () => this.addProjectControlRow());
    document.getElementById('control-ai-rules-btn')?.addEventListener('click', () => this.syncProjectControlAgentRules());
    document.getElementById('progress-save-btn')?.addEventListener('click', () => this.saveProjectControlFile());

    document.getElementById('document-file-select')?.addEventListener('change', event => {
      this.selectMarkdownDocument(event.target.value);
    });
    document.querySelectorAll('.document-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchDocumentMode(btn.dataset.documentMode));
    });
    document.getElementById('document-textarea')?.addEventListener('input', () => {
      const repo = AppState.selectedRepo;
      if (!repo?.projectDocs?.current) return;
      repo.projectDocs.current.content = document.getElementById('document-textarea').value;
      repo.projectDocs.current.dirty = true;
      this.renderMarkdownDocumentPreview(repo.projectDocs.current.content);
      this.updateDocumentSaveStatus('未保存');
    });
    document.getElementById('document-create-btn')?.addEventListener('click', () => this.createMarkdownDocument());
    document.getElementById('document-save-btn')?.addEventListener('click', () => this.saveMarkdownDocument());

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
      this.renderSidebarGroups();
      this.renderContent();
      document.getElementById('new-group-modal').style.display = 'none';
    });

    document.getElementById('detail-fav-btn')?.addEventListener('click', () => {
      if (AppState.selectedRepo?.path) this.toggleFavoritePath(AppState.selectedRepo.path);
    });
    document.getElementById('detail-project-settings')?.addEventListener('click', () => {
      if (AppState.selectedRepo?.path) this.openLocalProjectDialog(AppState.selectedRepo.path);
    });
    document.getElementById('detail-relationship-board')?.addEventListener('click', event => {
      const button = event.currentTarget;
      this.showResourceInRelationshipBoard({
        kind: button.dataset.relationshipKind,
        refId: button.dataset.relationshipRef,
        path: button.dataset.relationshipPath
      });
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

  applyPlatformConventions() {
    if (window.gitFinder.platform === 'darwin') return;
    const shortcuts = {
      'file-new-folder': 'Ctrl+Shift+N',
      'file-copy': 'Ctrl+C',
      'file-copy-path': 'Ctrl+Shift+C',
      'file-cut': 'Ctrl+X',
      'file-paste': 'Ctrl+V',
      'file-get-info': 'Alt+Enter',
      'file-duplicate': 'Ctrl+D',
      'file-rename': 'F2',
      'file-trash': 'Delete',
      'file-undo': 'Ctrl+Z',
      'file-redo': 'Ctrl+Y'
    };
    for (const [id, label] of Object.entries(shortcuts)) {
      const key = document.querySelector(`#${id} kbd`);
      if (key) key.textContent = label;
    }
    const contextShortcuts = {
      open: 'Enter',
      'get-info': 'Alt+Enter',
      copy: 'Ctrl+C',
      'copy-path': 'Ctrl+Shift+C',
      cut: 'Ctrl+X',
      duplicate: 'Ctrl+D',
      rename: 'F2',
      trash: 'Delete'
    };
    for (const [action, label] of Object.entries(contextShortcuts)) {
      const key = document.querySelector(`[data-context-action="${action}"] kbd`);
      if (key) key.textContent = label;
    }
    document.querySelectorAll('#file-trash span, [data-context-action="trash"] span:first-child').forEach(element => {
      element.textContent = '移入回收站';
    });
    const newTab = document.getElementById('workspace-new-tab');
    if (newTab) newTab.title = '新建标签页 (Ctrl+T)';
    const settingsButton = document.getElementById('btn-settings');
    if (settingsButton) settingsButton.title = '应用设置 (Ctrl+,)';
    const goToFolderButton = document.getElementById('btn-go-to-folder');
    if (goToFolderButton) goToFolderButton.title = '前往文件夹 (Ctrl+L)';
    const hiddenShortcut = document.querySelector('#toggle-hidden-files kbd');
    if (hiddenShortcut) hiddenShortcut.textContent = 'Ctrl+Shift+.';
    const viewShortcuts = { card: 'Ctrl+1', list: 'Ctrl+2', column: 'Ctrl+3', gallery: 'Ctrl+4' };
    document.querySelectorAll('.style-btn[data-style]').forEach(button => {
      const key = button.querySelector('kbd');
      if (key) key.textContent = viewShortcuts[button.dataset.style] || '';
    });
    const revealButton = document.getElementById('detail-open-btn');
    if (revealButton) revealButton.textContent = '在文件资源管理器中显示';
  },

  populateDeveloperToolSelect(select, tools, preferred, emptyLabel) {
    if (!select) return;
    select.innerHTML = '';
    const candidates = [...(tools || [])];
    if (preferred && !candidates.some(tool => tool.id === preferred || tool.path === preferred)) {
      candidates.unshift({ id: preferred, name: `自定义：${preferred}`, path: preferred });
    }
    if (!candidates.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = emptyLabel;
      select.appendChild(option);
      return;
    }
    for (const tool of candidates) {
      const option = document.createElement('option');
      option.value = tool.path || tool.id;
      option.textContent = tool.name;
      option.title = tool.path || '';
      if (preferred && (preferred === tool.path || preferred === tool.id)) option.selected = true;
      select.appendChild(option);
    }
  },

  async openSettingsPage(sectionId = '') {
    if (AppState.currentMode !== 'settings') {
      AppState.settingsReturnMode = AppState.currentMode;
    }
    this.closeQuickLook();
    this.clearFileSelection();
    AppState.currentMode = 'settings';
    this.updateModeUI();
    this.updateBreadcrumbs();
    await this.renderContent();
    if (sectionId) document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
  },

  async openDeveloperToolSettings() {
    await this.openSettingsPage('settings-developer-tools');
  },

  async renderSettingsView() {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';
    const selected = (value, candidate) => value === candidate ? ' selected' : '';
    const modeLabels = { light: '浅色', dark: '深色', auto: '跟随系统' };
    const schemeLabels = {
      github: 'GitHub', onedark: 'One Dark', dracula: 'Dracula', monokai: 'Monokai',
      solarized: 'Solarized', nord: 'Nord', muted: '柔和'
    };
    const semanticColors = window.SemanticColors.normalizeProfile(AppState.semanticColorProfile);
    const projectShortcutPreferences = window.ProjectShortcuts.normalizePreferences(AppState.projectShortcutPreferences);
    const recentProjectCount = window.ProjectShortcuts.normalizeStore(AppState.projectShortcuts).recent.length;
    const semanticPresetOptions = Object.entries(window.SemanticColors.PRESETS)
      .map(([id, preset]) => `<option value="${id}"${selected(semanticColors.preset, id)}>${this.escapeHtml(preset.label)}</option>`)
      .join('');
    const semanticRoleInputs = [
      ['folder', '普通目录', '文件夹本体，不表示 Git'],
      ['project', '默认项目', '项目没有有效自选色时使用'],
      ['gitBadge', 'Git 角标', '只表示仓库属性'],
      ['gitMark', 'Git 线条', '角标内的分支图形']
    ].map(([key, label, hint]) => `
      <label class="semantic-color-control" for="semantic-color-${key}">
        <span><strong>${label}</strong><small>${hint}</small></span>
        <span class="semantic-color-input-wrap">
          <input id="semantic-color-${key}" data-semantic-role="${key}" type="color" value="${semanticColors.colors[key]}">
          <code data-semantic-value="${key}">${semanticColors.colors[key]}</code>
        </span>
      </label>`).join('');
    const lifecycleColorInputs = window.SemanticColors.LIFECYCLE_KEYS.map(key => `
      <label class="semantic-lifecycle-color" for="semantic-lifecycle-${key}">
        <span>${this.escapeHtml(window.SemanticColors.LIFECYCLE_LABELS[key])}</span>
        <input id="semantic-lifecycle-${key}" data-semantic-lifecycle="${key}" type="color" value="${semanticColors.lifecycle[key]}">
        <code data-semantic-lifecycle-value="${key}">${semanticColors.lifecycle[key]}</code>
      </label>`).join('');
    contentArea.innerHTML = `
      <div class="app-settings-page">
        <header class="app-settings-header">
          <div>
            <span class="app-settings-kicker">GitFinder</span>
            <h1>应用设置</h1>
            <p>这些偏好只保存在本机，不会写入项目的便携配置。</p>
          </div>
          <button class="btn" data-app-action="close-settings" type="button">完成</button>
        </header>

        <section class="app-settings-section" aria-labelledby="settings-browsing-title">
          <div class="app-settings-section-heading">
            <h2 id="settings-browsing-title">目录显示</h2>
            <p>设置目录页默认采用的视图和排列方式。</p>
          </div>
          <div class="app-settings-controls">
            <label class="app-settings-row" for="settings-card-style">
              <span><strong>默认视图</strong><small>在图标、列表、分栏和图库之间切换</small></span>
              <select id="settings-card-style">
                <option value="card"${selected(AppState.defaultCardStyle, 'card')}>图标</option>
                <option value="list"${selected(AppState.defaultCardStyle, 'list')}>列表</option>
                <option value="column"${selected(AppState.defaultCardStyle, 'column')}>分栏</option>
                <option value="gallery"${selected(AppState.defaultCardStyle, 'gallery')}>图库</option>
              </select>
            </label>
            <label class="app-settings-row" for="settings-sort-by">
              <span><strong>排列依据</strong><small>文件夹仍始终排在普通文件之前</small></span>
              <select id="settings-sort-by">
                <option value="name"${selected(AppState.defaultSortBy, 'name')}>名称</option>
                <option value="path"${selected(AppState.defaultSortBy, 'path')}>路径</option>
                <option value="dir"${selected(AppState.defaultSortBy, 'dir')}>目录</option>
                <option value="status"${selected(AppState.defaultSortBy, 'status')}>Git 状态</option>
                <option value="time"${selected(AppState.defaultSortBy, 'time')}>修改时间</option>
                <option value="size"${selected(AppState.defaultSortBy, 'size')}>大小</option>
                <option value="branch"${selected(AppState.defaultSortBy, 'branch')}>分支</option>
              </select>
            </label>
            <label class="app-settings-row" for="settings-sort-order">
              <span><strong>排列方向</strong><small>适用于目录和仓库视图</small></span>
              <select id="settings-sort-order">
                <option value="asc"${selected(AppState.defaultSortOrder, 'asc')}>升序</option>
                <option value="desc"${selected(AppState.defaultSortOrder, 'desc')}>降序</option>
              </select>
            </label>
            <label class="app-settings-row" for="settings-column-view-width">
              <span><strong>分栏宽度</strong><small>也可在分栏边界直接拖动；方向键微调，双击恢复 260 像素</small></span>
              <span class="app-settings-range-control">
                <input id="settings-column-view-width" type="range" min="${window.DirectoryViewPreferences.MIN_COLUMN_WIDTH}" max="${window.DirectoryViewPreferences.MAX_COLUMN_WIDTH}" step="4" value="${AppState.defaultColumnViewWidth}">
                <output id="settings-column-view-width-value" for="settings-column-view-width">${AppState.defaultColumnViewWidth} px</output>
              </span>
            </label>
            <label class="app-settings-row" for="settings-remember-directory-views">
              <span><strong>记住每个目录的显示方式</strong><small>开启后，每个目录分别保存视图、排列方式和分栏宽度</small></span>
              <input class="app-settings-toggle" id="settings-remember-directory-views" type="checkbox"${AppState.rememberDirectoryViewPreferences ? ' checked' : ''}>
            </label>
            <div class="app-settings-row">
              <span><strong>目录显示记录</strong><small>已记住 ${Object.keys(AppState.directoryViewPreferences).length} 个目录；最多保留 ${window.DirectoryViewPreferences.MAX_ENTRIES} 个最近记录</small></span>
              <button class="btn" data-app-action="clear-directory-view-preferences" type="button"${Object.keys(AppState.directoryViewPreferences).length ? '' : ' disabled'}>清除记录…</button>
            </div>
            <label class="app-settings-row" for="settings-show-hidden">
              <span><strong>显示隐藏项目</strong><small>在目录页和左侧目录树中显示以“.”开头的文件与文件夹</small></span>
              <input class="app-settings-toggle" id="settings-show-hidden" type="checkbox"${AppState.showHiddenFiles ? ' checked' : ''}>
            </label>
            <div class="app-settings-row">
              <span><strong>文件标签</strong><small>已创建 ${AppState.fileLabels.labels.length} 个；只保存在本机，不会写入项目或 Git</small></span>
              <button class="btn" data-app-action="manage-file-labels" type="button">管理标签…</button>
            </div>
          </div>
        </section>

        <section class="app-settings-section" aria-labelledby="settings-sidebar-title">
          <div class="app-settings-section-heading">
            <h2 id="settings-sidebar-title">侧边栏</h2>
            <p>项目区是快捷导航，不是独立的项目视图。</p>
          </div>
          <div class="app-settings-controls">
            <label class="app-settings-row" for="settings-show-project-shortcuts">
              <span><strong>显示项目快捷入口</strong><small>在左侧显示“所有项目”、已固定项目和最近项目</small></span>
              <input class="app-settings-toggle" id="settings-show-project-shortcuts" type="checkbox"${projectShortcutPreferences.visible ? ' checked' : ''}>
            </label>
            <label class="app-settings-row" for="settings-show-recent-projects">
              <span><strong>显示最近项目</strong><small>只影响侧边栏显示，不删除项目身份或任何文件</small></span>
              <input class="app-settings-toggle" id="settings-show-recent-projects" type="checkbox"${projectShortcutPreferences.showRecent ? ' checked' : ''}>
            </label>
            <label class="app-settings-row" for="settings-recent-project-limit">
              <span><strong>最近项目数量</strong><small>已固定项目不计入这个数量</small></span>
              <select id="settings-recent-project-limit">
                ${window.ProjectShortcuts.RECENT_LIMIT_OPTIONS.map(limit => `<option value="${limit}"${selected(projectShortcutPreferences.recentLimit, limit)}>${limit} 个</option>`).join('')}
              </select>
            </label>
            <div class="app-settings-row">
              <span><strong>最近项目记录</strong><small>已记录 ${recentProjectCount} 个；清除后会在下次打开项目时重新生成</small></span>
              <button class="btn" data-app-action="clear-recent-projects" type="button"${recentProjectCount ? '' : ' disabled'}>清除记录…</button>
            </div>
          </div>
        </section>

        <section class="app-settings-section" aria-labelledby="settings-appearance-title">
          <div class="app-settings-section-heading">
            <h2 id="settings-appearance-title">外观</h2>
            <p>主题设置仍可从顶部太阳图标快速打开。</p>
          </div>
          <div class="app-settings-controls">
            <div class="app-settings-row">
              <span><strong>当前主题</strong><small>${this.escapeHtml(modeLabels[AppState.themeMode] || '浅色')} · ${this.escapeHtml(schemeLabels[AppState.themeScheme] || AppState.themeScheme || 'GitHub')}</small></span>
              <button class="btn" data-app-action="open-theme-settings" type="button">主题与配色…</button>
            </div>
            <label class="app-settings-row" for="semantic-color-preset">
              <span><strong>语义色彩预设</strong><small>蓝色文件夹表示目录/项目，紫色角标表示 Git 属性</small></span>
              <select id="semantic-color-preset">
                ${semanticPresetOptions}
                <option value="custom"${selected(semanticColors.preset, 'custom')}>自定义</option>
              </select>
            </label>
            <div class="semantic-color-editor">
              <div class="semantic-color-preview" id="semantic-color-preview" aria-label="语义色彩预览">
                <div><span class="semantic-preview-icon file-kind-icon file-kind-directory"><svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2.25 4.25c0-1.1.9-2 2-2h4.2c.6 0 1.17.27 1.55.74l1.23 1.51h8.52c1.1 0 2 .9 2 2v9.25c0 1.1-.9 2-2 2H4.25c-1.1 0-2-.9-2-2V4.25Z"/></svg></span><span>普通目录</span></div>
                <div><span class="semantic-preview-icon file-kind-icon file-kind-project"><svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2.25 4.25c0-1.1.9-2 2-2h4.2c.6 0 1.17.27 1.55.74l1.23 1.51h8.52c1.1 0 2 .9 2 2v9.25c0 1.1-.9 2-2 2H4.25c-1.1 0-2-.9-2-2V4.25Z"/></svg></span><span>默认项目</span></div>
                <div><span class="semantic-preview-icon file-kind-icon file-kind-directory"><svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2.25 4.25c0-1.1.9-2 2-2h4.2c.6 0 1.17.27 1.55.74l1.23 1.51h8.52c1.1 0 2 .9 2 2v9.25c0 1.1-.9 2-2 2H4.25c-1.1 0-2-.9-2-2V4.25Z"/></svg><span class="file-kind-git-badge"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2.2v5.2c0 1.4 1.1 2.5 2.5 2.5h2.2M3 4.6h1.8c1.4 0 2.5-1.1 2.5-2.5"/><circle cx="3" cy="2.1" r="1"/><circle cx="7.4" cy="2.1" r="1"/><circle cx="8.7" cy="9.9" r="1"/></svg></span></span><span>Git 仓库</span></div>
              </div>
              <div class="semantic-status-legend" aria-label="Git 状态条图例">
                <strong>卡片顶端状态条</strong>
                <span data-status="clean">已同步</span>
                <span data-status="dirty">未提交</span>
                <span data-status="ahead">未推送</span>
                <span data-status="behind">需拉取</span>
              </div>
              <div class="semantic-color-controls">${semanticRoleInputs}</div>
              <details class="semantic-lifecycle-details">
                <summary>高级：生命周期标签颜色</summary>
                <p>生命周期颜色只用于状态标签，不会改变项目文件夹颜色。</p>
                <div class="semantic-lifecycle-grid">${lifecycleColorInputs}</div>
              </details>
              <div class="semantic-color-footer">
                <span id="semantic-color-feedback" role="status" aria-live="polite"></span>
                <button class="btn" id="semantic-color-reset" type="button">恢复默认</button>
              </div>
            </div>
          </div>
        </section>

        <section class="app-settings-section" id="settings-developer-tools" aria-labelledby="settings-tools-title">
          <div class="app-settings-section-heading">
            <h2 id="settings-tools-title">开发工具</h2>
            <p>配置“打开终端”和“在代码编辑器中打开”使用的本机程序。</p>
          </div>
          <div class="app-settings-controls developer-tools-body">
            <div class="developer-tool-status" id="developer-tools-status">正在检测本机终端、Git 和代码编辑器…</div>
            <div class="app-settings-row app-settings-picker-row">
              <label for="preferred-terminal"><strong>默认终端</strong><small>macOS Terminal、Windows Terminal 或自定义程序</small></label>
              <div class="developer-tool-picker">
                <select id="preferred-terminal"></select>
                <button class="btn" data-app-action="select-terminal" type="button">选择程序…</button>
              </div>
            </div>
            <div class="app-settings-row app-settings-picker-row">
              <label for="preferred-editor"><strong>默认代码编辑器</strong><small>VS Code、PyCharm 或自定义程序</small></label>
              <div class="developer-tool-picker">
                <select id="preferred-editor"></select>
                <button class="btn" data-app-action="select-editor" type="button">选择程序…</button>
              </div>
            </div>
            <div class="developer-git-status" id="developer-git-status"></div>
          </div>
        </section>

        <section class="app-settings-section" aria-labelledby="settings-projects-title">
          <div class="app-settings-section-heading">
            <h2 id="settings-projects-title">项目身份</h2>
            <p>项目设置属于具体文件夹，不属于全局应用偏好。</p>
          </div>
          <div class="app-settings-controls">
            <div class="app-settings-row">
              <span><strong>设为本地项目</strong><small>创建 .gitfinder/project.json；不会执行 git init、提交或推送</small></span>
              <button class="btn" data-app-action="choose-local-project" type="button">选择文件夹…</button>
            </div>
          </div>
        </section>

        <footer class="app-settings-footer">
          <button class="btn" data-app-action="close-settings" type="button">取消</button>
          <button class="btn btn-primary" data-app-action="save-settings" type="button">保存设置</button>
        </footer>
      </div>`;

    const columnWidthInput = document.getElementById('settings-column-view-width');
    const columnWidthValue = document.getElementById('settings-column-view-width-value');
    columnWidthInput?.addEventListener('input', () => {
      if (columnWidthValue) columnWidthValue.textContent = `${columnWidthInput.value} px`;
    });

    const updateProjectShortcutSettingsAvailability = () => {
      const visible = document.getElementById('settings-show-project-shortcuts')?.checked === true;
      const recentToggle = document.getElementById('settings-show-recent-projects');
      const recentLimit = document.getElementById('settings-recent-project-limit');
      if (recentToggle) recentToggle.disabled = !visible;
      if (recentLimit) recentLimit.disabled = !visible || recentToggle?.checked !== true;
    };
    document.getElementById('settings-show-project-shortcuts')?.addEventListener('change', updateProjectShortcutSettingsAvailability);
    document.getElementById('settings-show-recent-projects')?.addEventListener('change', updateProjectShortcutSettingsAvailability);
    updateProjectShortcutSettingsAvailability();

    this.bindSemanticColorSettings();

    await this.hydrateDeveloperToolSettings();
    this.updateStatusBar();
  },

  readSemanticColorSettings() {
    const current = window.SemanticColors.normalizeProfile(AppState.semanticColorProfile);
    const preset = document.getElementById('semantic-color-preset')?.value || current.preset;
    const colors = {};
    const lifecycle = {};
    for (const key of window.SemanticColors.ROLE_KEYS) {
      colors[key] = document.getElementById(`semantic-color-${key}`)?.value || current.colors[key];
    }
    for (const key of window.SemanticColors.LIFECYCLE_KEYS) {
      lifecycle[key] = document.getElementById(`semantic-lifecycle-${key}`)?.value || current.lifecycle[key];
    }
    return window.SemanticColors.normalizeProfile({ version: 1, preset, colors, lifecycle });
  },

  populateSemanticColorSettings(value) {
    const profile = window.SemanticColors.normalizeProfile(value);
    const preset = document.getElementById('semantic-color-preset');
    if (preset) preset.value = profile.preset;
    for (const key of window.SemanticColors.ROLE_KEYS) {
      const input = document.getElementById(`semantic-color-${key}`);
      if (input) input.value = profile.colors[key];
    }
    for (const key of window.SemanticColors.LIFECYCLE_KEYS) {
      const input = document.getElementById(`semantic-lifecycle-${key}`);
      if (input) input.value = profile.lifecycle[key];
    }
    this.updateSemanticColorSettingsPreview(profile);
  },

  updateSemanticColorSettingsPreview(value = this.readSemanticColorSettings()) {
    const profile = window.SemanticColors.normalizeProfile(value);
    const preview = document.getElementById('semantic-color-preview');
    if (preview) {
      for (const [name, color] of Object.entries(window.SemanticColors.cssVariables(profile))) {
        preview.style.setProperty(name, color);
      }
      preview.style.setProperty('--project-folder-color', profile.colors.project);
    }
    for (const key of window.SemanticColors.ROLE_KEYS) {
      const label = document.querySelector(`[data-semantic-value="${key}"]`);
      if (label) label.textContent = profile.colors[key];
    }
    for (const key of window.SemanticColors.LIFECYCLE_KEYS) {
      const label = document.querySelector(`[data-semantic-lifecycle-value="${key}"]`);
      if (label) label.textContent = profile.lifecycle[key];
    }
    const feedback = document.getElementById('semantic-color-feedback');
    if (feedback) {
      const collisions = window.SemanticColors.roleCollisions(profile);
      feedback.dataset.warning = collisions.length ? 'true' : 'false';
      feedback.textContent = collisions.length
        ? '文件夹与 Git 角标颜色过于接近，建议拉开色相或明度。'
        : '文件夹本体与 Git 角标保持可辨识。';
    }
    return profile;
  },

  bindSemanticColorSettings() {
    const preset = document.getElementById('semantic-color-preset');
    preset?.addEventListener('change', () => {
      if (Object.hasOwn(window.SemanticColors.PRESETS, preset.value)) {
        this.populateSemanticColorSettings(window.SemanticColors.profileForPreset(preset.value));
      } else {
        this.updateSemanticColorSettingsPreview();
      }
    });
    document.querySelectorAll('[data-semantic-role], [data-semantic-lifecycle]').forEach(input => {
      input.addEventListener('input', () => {
        if (preset) preset.value = 'custom';
        this.updateSemanticColorSettingsPreview();
      });
    });
    document.getElementById('semantic-color-reset')?.addEventListener('click', () => {
      this.populateSemanticColorSettings(window.SemanticColors.profileForPreset('finder'));
    });
    this.updateSemanticColorSettingsPreview(window.SemanticColors.normalizeProfile(AppState.semanticColorProfile));
  },

  async hydrateDeveloperToolSettings() {
    const status = document.getElementById('developer-tools-status');
    if (!status) return;
    status.textContent = '正在检测本机终端、Git 和代码编辑器…';
    try {
      const [capabilities, preferredTerminal, preferredEditor] = await Promise.all([
        window.gitFinder.terminal.getCapabilities(),
        window.gitFinder.config.get('preferredTerminal'),
        window.gitFinder.config.get('preferredEditor')
      ]);
      AppState.developerTools = capabilities;
      this.populateDeveloperToolSelect(
        document.getElementById('preferred-terminal'),
        capabilities.terminals,
        preferredTerminal,
        '未发现终端，请选择程序'
      );
      this.populateDeveloperToolSelect(
        document.getElementById('preferred-editor'),
        capabilities.editors,
        preferredEditor,
        '未发现编辑器，请选择程序'
      );
      status.textContent = `已发现 ${capabilities.terminals.length} 个终端、${capabilities.editors.length} 个代码编辑器`;
      const gitStatus = document.getElementById('developer-git-status');
      if (!gitStatus) return;
      gitStatus.dataset.available = capabilities.git.installed ? 'true' : 'false';
      gitStatus.textContent = capabilities.git.installed
        ? `Git 已就绪：${capabilities.git.path}`
        : 'Git 未发现。Windows 请安装 Git for Windows 或将 git.exe 加入 PATH。';
    } catch (error) {
      status.textContent = error?.message || String(error);
    }
  },

  async closeSettingsPage() {
    if (AppState.currentMode !== 'settings') return;
    const nextMode = AppState.settingsReturnMode && AppState.settingsReturnMode !== 'settings'
      ? AppState.settingsReturnMode
      : 'tree';
    AppState.settingsReturnMode = null;
    AppState.currentMode = nextMode;
    this.updateModeUI();
    this.updateBreadcrumbs();
    await this.renderContent();
  },

  closeDeveloperToolSettings() {
    return this.closeSettingsPage();
  },

  openThemeSettings() {
    this.syncThemeModal();
    const modal = document.getElementById('theme-modal');
    if (modal) modal.style.display = 'flex';
  },

  async selectDeveloperToolExecutable(kind) {
    const selectedPath = await window.gitFinder.terminal.selectExecutable(kind);
    if (!selectedPath) return;
    const select = document.getElementById(kind === 'terminal' ? 'preferred-terminal' : 'preferred-editor');
    if (!select) return;
    const option = document.createElement('option');
    option.value = selectedPath;
    option.textContent = `自定义：${selectedPath.split(/[\\/]/).at(-1)}`;
    option.selected = true;
    select.appendChild(option);
  },

  getDefaultDirectoryViewPreference() {
    return {
      style: AppState.defaultCardStyle,
      sortBy: AppState.defaultSortBy,
      sortOrder: AppState.defaultSortOrder,
      columnWidth: AppState.defaultColumnViewWidth
    };
  },

  applyDirectoryViewPreference(directoryPath = AppState.currentPath, mode = AppState.currentMode) {
    let preference = this.getDefaultDirectoryViewPreference();
    if (AppState.rememberDirectoryViewPreferences
        && mode === 'tree'
        && window.ContentQuery.isCurrent(AppState.contentQuery)
        && directoryPath) {
      preference = window.DirectoryViewPreferences.preferenceForDirectory(
        AppState.directoryViewPreferences,
        directoryPath,
        preference,
        { platform: window.gitFinder.platform }
      );
    }
    AppState.cardStyle = preference.style;
    AppState.sortBy = preference.sortBy;
    AppState.sortOrder = preference.sortOrder;
    AppState.columnViewWidth = window.DirectoryViewPreferences.normalizeColumnWidth(
      preference.columnWidth,
      AppState.defaultColumnViewWidth
    );
    this.updateToolbarMenuState();
    return preference;
  },

  persistCurrentDirectoryViewPreference() {
    let write;
    if (AppState.rememberDirectoryViewPreferences && this.isDirectoryBrowsingContext() && AppState.currentPath) {
      AppState.directoryViewPreferences = window.DirectoryViewPreferences.rememberDirectory(
        AppState.directoryViewPreferences,
        AppState.currentPath,
        {
          style: AppState.cardStyle,
          sortBy: AppState.sortBy,
          sortOrder: AppState.sortOrder,
          columnWidth: AppState.columnViewWidth
        },
        { platform: window.gitFinder.platform }
      );
      write = window.gitFinder.config.set('directoryViewPreferences', AppState.directoryViewPreferences);
    } else {
      AppState.defaultCardStyle = AppState.cardStyle;
      AppState.defaultSortBy = AppState.sortBy;
      AppState.defaultSortOrder = AppState.sortOrder;
      AppState.defaultColumnViewWidth = AppState.columnViewWidth;
      write = Promise.all([
        window.gitFinder.config.set('cardStyle', AppState.defaultCardStyle),
        window.gitFinder.config.set('sortBy', AppState.defaultSortBy),
        window.gitFinder.config.set('sortOrder', AppState.defaultSortOrder),
        window.gitFinder.config.set('columnViewWidth', AppState.defaultColumnViewWidth)
      ]);
    }
    Promise.resolve(write).catch(error => {
      this._showStatusMessage(`显示偏好保存失败：${error?.message || String(error)}`, 'error');
    });
  },

  setDirectoryViewStyle(style) {
    if (!['card', 'list', 'column', 'gallery'].includes(style)) return;
    if (['column', 'gallery'].includes(style) && !this.isFileBrowsingContext()) return;
    AppState.cardStyle = style;
    this.persistCurrentDirectoryViewPreference();
    this.updateToolbarMenuState();
    return this.renderContent();
  },

  async saveAppSettings() {
    const cardStyle = ['card', 'list', 'column', 'gallery'].includes(document.getElementById('settings-card-style')?.value)
      ? document.getElementById('settings-card-style').value
      : AppState.defaultCardStyle;
    const sortBy = ['name', 'path', 'dir', 'status', 'time', 'size', 'branch'].includes(document.getElementById('settings-sort-by')?.value)
      ? document.getElementById('settings-sort-by').value
      : AppState.defaultSortBy;
    const sortOrder = ['asc', 'desc'].includes(document.getElementById('settings-sort-order')?.value)
      ? document.getElementById('settings-sort-order').value
      : AppState.defaultSortOrder;
    const columnViewWidth = window.DirectoryViewPreferences.normalizeColumnWidth(
      document.getElementById('settings-column-view-width')?.value,
      AppState.defaultColumnViewWidth
    );
    const rememberDirectoryViewPreferences = document.getElementById('settings-remember-directory-views')?.checked === true;
    const showHiddenFiles = document.getElementById('settings-show-hidden')?.checked === true;
    const projectShortcutPreferences = window.ProjectShortcuts.normalizePreferences({
      visible: document.getElementById('settings-show-project-shortcuts')?.checked === true,
      showRecent: document.getElementById('settings-show-recent-projects')?.checked === true,
      recentLimit: document.getElementById('settings-recent-project-limit')?.value
    });
    const hiddenFilesChanged = showHiddenFiles !== AppState.showHiddenFiles;
    const preferredTerminal = document.getElementById('preferred-terminal')?.value || '';
    const preferredEditor = document.getElementById('preferred-editor')?.value || '';
    const semanticColorProfile = this.readSemanticColorSettings();
    AppState.defaultCardStyle = cardStyle;
    AppState.defaultSortBy = sortBy;
    AppState.defaultSortOrder = sortOrder;
    AppState.defaultColumnViewWidth = columnViewWidth;
    AppState.rememberDirectoryViewPreferences = rememberDirectoryViewPreferences;
    AppState.showHiddenFiles = showHiddenFiles;
    AppState.semanticColorProfile = window.SemanticColors.applyToElement(
      document.documentElement,
      semanticColorProfile
    );
    await Promise.all([
      window.gitFinder.config.set('cardStyle', cardStyle),
      window.gitFinder.config.set('sortBy', sortBy),
      window.gitFinder.config.set('sortOrder', sortOrder),
      window.gitFinder.config.set('columnViewWidth', columnViewWidth),
      window.gitFinder.config.set('rememberDirectoryViewPreferences', rememberDirectoryViewPreferences),
      window.gitFinder.config.set('showHiddenFiles', showHiddenFiles),
      window.gitFinder.config.set('preferredTerminal', preferredTerminal),
      window.gitFinder.config.set('preferredEditor', preferredEditor),
      window.gitFinder.config.set('semanticColorProfile', semanticColorProfile),
      this.projectShortcutsController.savePreferences(projectShortcutPreferences)
    ]);
    const returnMode = AppState.settingsReturnMode && AppState.settingsReturnMode !== 'settings'
      ? AppState.settingsReturnMode
      : 'tree';
    this.applyDirectoryViewPreference(AppState.currentPath, returnMode);
    if (hiddenFilesChanged) await this.renderSidebarTree();
    await this.closeSettingsPage();
    this.updateToolbarMenuState();
    this._showStatusMessage('应用设置已保存在本机', 'success');
  },

  async clearDirectoryViewPreferences() {
    const count = Object.keys(AppState.directoryViewPreferences).length;
    if (!count) return;
    if (!confirm(`清除 ${count} 个目录的显示记录？全局默认视图不会改变。`)) return;
    AppState.directoryViewPreferences = {};
    await window.gitFinder.config.set('directoryViewPreferences', {});
    this.applyDirectoryViewPreference(AppState.currentPath, AppState.settingsReturnMode || 'tree');
    await this.renderSettingsView();
    this._showStatusMessage('已清除目录显示记录', 'success');
  },

  async clearRecentProjects() {
    const count = window.ProjectShortcuts.normalizeStore(AppState.projectShortcuts).recent.length;
    if (!count) return;
    if (!confirm(`清除 ${count} 个最近项目记录？已固定项目会保留。`)) return;
    await this.projectShortcutsController.clearRecent();
    await this.renderSettingsView();
    this._showStatusMessage('已清除最近项目记录', 'success');
  },

  saveDeveloperToolSettings() {
    return this.saveAppSettings();
  },

  async toggleHiddenFiles() {
    AppState.showHiddenFiles = !AppState.showHiddenFiles;
    await window.gitFinder.config.set('showHiddenFiles', AppState.showHiddenFiles);
    this.closeToolbarMenus();
    this.updateToolbarMenuState();
    const settingsToggle = document.getElementById('settings-show-hidden');
    if (settingsToggle) settingsToggle.checked = AppState.showHiddenFiles;
    this.clearFileSelection();
    await this.renderSidebarTree();
    if (AppState.currentMode === 'tree') await this.renderContent();
    this._showStatusMessage(AppState.showHiddenFiles ? '已显示隐藏项目' : '已隐藏点文件和文件夹', 'success');
  },

  async openPathInEditor(targetPath) {
    const preferred = await window.gitFinder.config.get('preferredEditor');
    const result = await window.gitFinder.terminal.openInEditor(targetPath, preferred);
    if (result?.opened) {
      this._showStatusMessage(`已使用 ${result.tool?.name || '代码编辑器'} 打开`, 'success');
      return;
    }
    this._showStatusMessage('未找到可用代码编辑器，请先在设置中选择程序', 'error');
    await this.openDeveloperToolSettings();
  },

  openSelectedInEditor() {
    const items = this.getSelectedFileItems();
    if (items.length === 1) this.openPathInEditor(items[0].path);
  },

  setupToolbarMenus() {
    if (this._toolbarMenusBound) return;
    this._toolbarMenusBound = true;
    const triggers = [...document.querySelectorAll('[data-menu-trigger]')];

    triggers.forEach(trigger => {
      trigger.addEventListener('click', event => {
        event.stopPropagation();
        if (trigger.disabled) return;
        const menuId = trigger.dataset.menuTrigger;
        const menu = document.getElementById(menuId);
        if (!menu) return;
        const shouldOpen = menu.hidden;
        this.closeToolbarMenus();
        if (shouldOpen) this.openToolbarMenu(trigger, menu, { focusFirst: false });
      });
      trigger.addEventListener('keydown', event => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key) || trigger.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById(trigger.dataset.menuTrigger);
        if (!menu) return;
        this.closeToolbarMenus();
        this.openToolbarMenu(trigger, menu, { focusFirst: true, fromEnd: event.key === 'ArrowUp' });
      });
    });

    document.querySelectorAll('.finder-menu').forEach(menu => {
      menu.addEventListener('click', event => {
        event.stopPropagation();
        const item = event.target.closest('.finder-menu-item');
        if (item && !item.disabled) this.closeToolbarMenus();
      });
      menu.addEventListener('keydown', event => {
        const items = [...menu.querySelectorAll('.finder-menu-item:not(:disabled)')];
        if (!items.length) return;
        const currentIndex = Math.max(0, items.indexOf(document.activeElement));
        let nextIndex = null;
        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = items.length - 1;
        if (nextIndex !== null) {
          event.preventDefault();
          event.stopPropagation();
          items[nextIndex].focus();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          const trigger = document.querySelector(`[data-menu-trigger="${menu.id}"]`);
          this.closeToolbarMenus();
          trigger?.focus();
        }
        if (event.key === 'Tab') this.closeToolbarMenus();
      });
    });

    document.addEventListener('click', () => this.closeToolbarMenus());
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const expanded = document.querySelector('[data-menu-trigger][aria-expanded="true"]');
      if (!expanded) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closeToolbarMenus();
      expanded.focus();
    });
    window.addEventListener('blur', () => this.closeToolbarMenus());
    this.updateToolbarMenuState();
  },

  openToolbarMenu(trigger, menu, { focusFirst = false, fromEnd = false } = {}) {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('.finder-menu-host')?.classList.add('open');
    if (!focusFirst) return;
    requestAnimationFrame(() => {
      const items = [...menu.querySelectorAll('.finder-menu-item:not(:disabled)')];
      (fromEnd ? items.at(-1) : items[0])?.focus();
    });
  },

  closeToolbarMenus() {
    document.querySelectorAll('[data-menu-trigger][aria-expanded="true"]').forEach(trigger => {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.closest('.finder-menu-host')?.classList.remove('open');
    });
    document.querySelectorAll('.finder-menu:not([hidden])').forEach(menu => {
      menu.hidden = true;
    });
  },

  updateToolbarMenuState() {
    const viewLabels = { tree: '文件浏览', dashboard: '仪表盘', tasks: '开发任务', relationships: '关系白板', settings: '设置' };
    const sortLabels = { name: '名称', path: '路径', dir: '目录', status: 'Git 状态', time: '修改时间', size: '大小', branch: '分支' };
    const viewLabel = document.getElementById('view-menu-label');
    if (viewLabel) viewLabel.textContent = viewLabels[AppState.currentMode] || '文件浏览';
    const activeWorkspaceView = AppState.currentMode;
    document.querySelectorAll('.view-btn[data-view]').forEach(button => {
      const active = button.dataset.view === activeWorkspaceView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    document.querySelectorAll('.sort-btn[data-sort]').forEach(button => {
      const active = button.dataset.sort === AppState.sortBy;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    document.querySelectorAll('.dir-btn[data-dir]').forEach(button => {
      const active = button.dataset.dir === AppState.sortOrder;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    const fileBrowsing = this.isFileBrowsingContext();
    const effectiveStyle = fileBrowsing
      ? AppState.cardStyle
      : (AppState.cardStyle === 'list' ? 'list' : 'card');
    document.querySelectorAll('.style-btn[data-style]').forEach(button => {
      const active = button.dataset.style === effectiveStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.disabled = ['column', 'gallery'].includes(button.dataset.style) && !fileBrowsing;
    });
    const hiddenToggle = document.getElementById('toggle-hidden-files');
    if (hiddenToggle) {
      hiddenToggle.classList.toggle('active', AppState.showHiddenFiles);
      hiddenToggle.setAttribute('aria-checked', AppState.showHiddenFiles ? 'true' : 'false');
    }
    this.directoryPerformanceController.updateMenu();
    const sortLabel = document.getElementById('sort-menu-label');
    if (sortLabel) {
      const direction = AppState.sortOrder === 'desc' ? '降序' : '升序';
      const style = effectiveStyle === 'list'
        ? '列表'
        : (effectiveStyle === 'column' ? '分栏' : (effectiveStyle === 'gallery' ? '图库' : '图标'));
      sortLabel.textContent = `${sortLabels[AppState.sortBy] || '名称'} · ${direction} · ${style}`;
    }
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
    window.gitFinder.updater.onAvailable((info) => {
      btn.classList.remove('checking');
      btn.classList.add('has-update');
      btn.textContent = `新版本 ${info?.version || ''}`.trim();
      this._showStatusMessage('发现新版本，可按提示下载更新', 'info');
    });

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

    window.gitFinder.updater.onDownloaded(() => {
      btn.classList.remove('checking');
      btn.classList.add('has-update', 'ready-install');
      btn.textContent = '重启安装';
      btn.title = '更新已下载，点击重启并安装';
    });

    window.gitFinder.updater.onError((msg) => {
      btn.classList.remove('checking', 'has-update', 'ready-install');
      btn.textContent = '检查更新';
      btn.title = '检查更新';
      this._showStatusMessage(`更新失败: ${msg}`, 'error');
    });
  },

  async _checkForUpdates() {
    const btn = document.getElementById('btn-check-update');
    if (!btn) return;
    if (btn.classList.contains('ready-install')) {
      await window.gitFinder.updater.install();
      return;
    }
    btn.classList.add('checking');
    btn.classList.remove('ready-install');
    btn.title = '检查更新';
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
    const el = document.getElementById('status-center');
    if (!el) return;
    if (this._statusMessageTimer) clearTimeout(this._statusMessageTimer);
    el.textContent = msg;
    el.className = `status-center ${type || ''}`.trim();
    this._statusMessageTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'status-center';
    }, 4000);
  },

  async loadWorkspaceTabs() {
    const saved = await window.gitFinder.config.get('workspaceTabSession');
    const seed = saved || {
      tabs: [{
        path: AppState.currentPath,
        mode: AppState.currentMode,
        history: AppState.currentPath ? [AppState.currentPath] : [],
        historyIndex: AppState.currentPath ? 0 : -1,
        searchScope: AppState.searchScope,
        searchQuery: AppState.searchQuery,
        globalSearchMode: AppState.globalSearchMode,
        globalSearchType: AppState.globalSearchType,
        contentQuery: AppState.contentQuery
      }]
    };
    const repair = await this.normalizeAndRepairWorkspaceTabs(seed);
    AppState.workspaceSession = repair.session;
    const activeTab = this.getActiveWorkspaceTab();
    if (activeTab) this.applyWorkspaceTabState(activeTab, { render: false });
    this.renderWorkspaceTabs();
    if (repair.changed) {
      await window.gitFinder.config.set('workspaceTabSession', AppState.workspaceSession);
      await window.gitFinder.config.set('lastPath', activeTab?.path || '');
    }
    if (repair.repairedTabs > 0) {
      this._showStatusMessage(`已将 ${repair.repairedTabs} 个失效标签页恢复到可用位置`, 'success');
    } else if (repair.deferredTabs > 0) {
      this._showStatusMessage(`${repair.deferredTabs} 个位置正在等待磁盘或网络重新连接`, 'warning');
    }
  },

  async refreshWorkspaceTabsFromConfig() {
    const saved = await window.gitFinder.config.get('workspaceTabSession');
    if (!saved) return;
    const repair = await this.normalizeAndRepairWorkspaceTabs(saved);
    AppState.workspaceSession = repair.session;
    this.applyWorkspaceTabState(this.getActiveWorkspaceTab(), { render: false });
    this.renderWorkspaceTabs();
    if (repair.changed) {
      await window.gitFinder.config.set('workspaceTabSession', AppState.workspaceSession);
      await window.gitFinder.config.set('lastPath', this.getActiveWorkspaceTab()?.path || '');
    }
    if (repair.repairedTabs > 0) {
      this._showStatusMessage(`已将 ${repair.repairedTabs} 个失效标签页恢复到可用位置`, 'success');
    } else if (repair.deferredTabs > 0) {
      this._showStatusMessage(`${repair.deferredTabs} 个位置正在等待磁盘或网络重新连接`, 'warning');
    }
  },

  async normalizeAndRepairWorkspaceTabs(seed) {
    const migrationNeeded = window.WorkspaceTabs.needsContentQueryMigration(seed);
    const session = window.WorkspaceTabs.normalizeSession(seed, AppState.currentPath);
    try {
      const paths = window.WorkspaceTabs.sessionPaths(session);
      const inspection = await window.gitFinder.fs.inspectWorkspaceDirectories(paths);
      const repair = window.WorkspaceTabs.repairUnavailablePaths(session, inspection);
      return { ...repair, changed: repair.changed || migrationNeeded };
    } catch (error) {
      console.warn('标签页路径校验失败，保留原会话:', error);
      return { session, changed: migrationNeeded, repairedTabs: 0, removedHistoryEntries: 0 };
    }
  },

  _directoryWatchRequestId: 0,
  _directoryWatchRefreshTimer: null,
  _directoryWatchRefreshInFlight: false,
  _directoryWatchRefreshPending: false,

  currentDirectoryWatchTarget() {
    if (!this.isDirectoryBrowsingContext() || this.isGlobalSearchActive() || !AppState.currentPath) return '';
    return this.isManagedPath(AppState.currentPath) ? AppState.currentPath : '';
  },

  async syncCurrentDirectoryWatch() {
    const targetPath = this.currentDirectoryWatchTarget();
    if (targetPath && targetPath === AppState.directoryWatchPath && AppState.directoryWatchId) return;
    const requestId = ++this._directoryWatchRequestId;
    const previousWatchId = AppState.directoryWatchId;
    AppState.directoryWatchId = null;
    AppState.directoryWatchPath = '';
    if (previousWatchId) window.gitFinder.fs.unwatchDirectory(previousWatchId).catch(() => {});
    if (!targetPath) return;

    try {
      const result = await window.gitFinder.fs.watchDirectory(targetPath);
      if (requestId !== this._directoryWatchRequestId || targetPath !== this.currentDirectoryWatchTarget()) {
        window.gitFinder.fs.unwatchDirectory(result.watchId).catch(() => {});
        return;
      }
      AppState.directoryWatchId = result.watchId;
      AppState.directoryWatchPath = result.path;
    } catch (error) {
      if (requestId !== this._directoryWatchRequestId || targetPath !== this.currentDirectoryWatchTarget()) return;
      console.warn('当前目录实时监听不可用:', error);
      this._showStatusMessage('当前目录实时更新不可用，可使用“刷新”重新读取', 'warning');
    }
  },

  stopCurrentDirectoryWatch() {
    this._directoryWatchRequestId++;
    if (this._directoryWatchRefreshTimer) clearTimeout(this._directoryWatchRefreshTimer);
    this._directoryWatchRefreshTimer = null;
    this._directoryWatchRefreshPending = false;
    const watchId = AppState.directoryWatchId;
    AppState.directoryWatchId = null;
    AppState.directoryWatchPath = '';
    if (watchId) window.gitFinder.fs.unwatchDirectory(watchId).catch(() => {});
  },

  handleDirectoryWatchEvent(payload) {
    if (!payload || payload.watchId !== AppState.directoryWatchId) return;
    const watchedPath = AppState.directoryWatchPath;
    if (payload.kind === 'error') {
      AppState.directoryWatchId = null;
      AppState.directoryWatchPath = '';
      this._showStatusMessage('当前目录实时监听已中断，正在重新检查位置', 'warning');
    }
    this.scheduleDirectoryWatchRefresh(watchedPath);
  },

  scheduleDirectoryWatchRefresh(watchedPath = AppState.directoryWatchPath, delay = 180) {
    if (!watchedPath || watchedPath !== AppState.currentPath || !this.isDirectoryBrowsingContext()) return;
    if (this._directoryWatchRefreshTimer) clearTimeout(this._directoryWatchRefreshTimer);
    this._directoryWatchRefreshTimer = setTimeout(() => {
      this._directoryWatchRefreshTimer = null;
      this.refreshCurrentDirectoryFromWatch(watchedPath);
    }, delay);
  },

  async refreshCurrentDirectoryFromWatch(watchedPath) {
    if (watchedPath !== AppState.currentPath || !this.isDirectoryBrowsingContext()) return;
    if (AppState.fileOperationBusy || AppState.transferApplying || AppState.externalImportApplying) {
      this.scheduleDirectoryWatchRefresh(watchedPath, 260);
      return;
    }
    if (this._directoryWatchRefreshInFlight) {
      this._directoryWatchRefreshPending = true;
      return;
    }

    this._directoryWatchRefreshInFlight = true;
    try {
      const inspection = await window.gitFinder.fs.inspectWorkspaceDirectories([watchedPath]);
      const entry = inspection?.directories?.find(candidate => candidate.path === watchedPath);
      const available = entry?.available === true;
      if (!available) {
        if (entry?.availability === 'root-unavailable') {
          this.unavailableLocationController.show(watchedPath, { source: 'watch' });
          return;
        }
        const repaired = await this.repairUnavailableWorkspaceLocation(watchedPath);
        if (repaired) return;
      }

      await Promise.all([
        window.gitFinder.content.invalidateIndex().catch(() => {}),
        window.gitFinder.git.clearCache().catch(() => {})
      ]);
      await this.renderContent();
      await this.renderSidebarTree();
    } catch (error) {
      console.warn('目录自动刷新失败:', error);
      this._showStatusMessage('目录自动刷新失败，可使用“刷新”重试', 'warning');
    } finally {
      this._directoryWatchRefreshInFlight = false;
      if (this._directoryWatchRefreshPending) {
        this._directoryWatchRefreshPending = false;
        this.scheduleDirectoryWatchRefresh(AppState.currentPath, 60);
      }
    }
  },

  async repairUnavailableWorkspaceLocation(locationPath) {
    if (!locationPath || locationPath !== AppState.currentPath) return false;
    this.captureActiveWorkspaceTab();
    const repair = await this.normalizeAndRepairWorkspaceTabs(AppState.workspaceSession);
    if (!repair.changed) return false;
    AppState.workspaceSession = repair.session;
    const activeTab = this.getActiveWorkspaceTab();
    this.applyWorkspaceTabState(activeTab, { render: false });
    this.renderWorkspaceTabs();
    await window.gitFinder.config.set('workspaceTabSession', AppState.workspaceSession);
    await window.gitFinder.config.set('lastPath', activeTab?.path || '');
    this._showStatusMessage(`当前位置已失效，已恢复到 ${activeTab?.title || '可用目录'}`, 'warning');
    await this.renderContent();
    await this.renderSidebarTree();
    return true;
  },

  getActiveWorkspaceTab() {
    return AppState.workspaceSession?.tabs.find(tab => tab.id === AppState.workspaceSession.activeTabId) || null;
  },

  captureActiveWorkspaceTab() {
    const tab = this.getActiveWorkspaceTab();
    if (!tab) return;
    const history = AppState.history.slice(-window.WorkspaceTabs.MAX_HISTORY);
    const dropped = Math.max(0, AppState.history.length - history.length);
    tab.path = AppState.currentPath;
    tab.title = this.contentCollectionKind() === 'file-labels'
      ? this.fileLabelCollectionTitle(AppState.contentQuery)
      : window.WorkspaceTabs.tabTitle(AppState.currentPath);
    tab.mode = AppState.currentMode;
    tab.history = history;
    tab.historyIndex = Math.max(0, AppState.historyIndex - dropped);
    tab.searchScope = AppState.searchScope;
    tab.searchQuery = AppState.searchQuery;
    tab.globalSearchMode = AppState.globalSearchMode;
    tab.globalSearchType = AppState.globalSearchType;
    tab.contentQuery = window.ContentQuery.normalize(AppState.contentQuery);
  },

  scheduleWorkspaceTabsPersist() {
    if (!AppState.workspaceSession) return;
    if (this._workspaceTabsPersistTimer) clearTimeout(this._workspaceTabsPersistTimer);
    this._workspaceTabsPersistTimer = setTimeout(() => this.persistWorkspaceTabs(), 180);
  },

  async persistWorkspaceTabs() {
    if (!AppState.workspaceSession) return;
    if (this._workspaceTabsPersistTimer) {
      clearTimeout(this._workspaceTabsPersistTimer);
      this._workspaceTabsPersistTimer = null;
    }
    this.captureActiveWorkspaceTab();
    try {
      await window.gitFinder.config.set('workspaceTabSession', AppState.workspaceSession);
    } catch (error) {
      console.warn('标签页会话保存失败:', error);
    }
  },

  renderWorkspaceTabs() {
    const container = document.getElementById('workspace-tabs');
    const session = AppState.workspaceSession;
    if (!container || !session) return;
    const onlyOne = session.tabs.length === 1;
    container.innerHTML = session.tabs.map(tab => {
      const active = tab.id === session.activeTabId;
      const collectionKind = window.ContentQuery.collectionKind(tab.contentQuery);
      const icon = tab.mode === 'tasks'
        ? '✓'
        : (tab.mode === 'dashboard' ? '▦' : (collectionKind === 'projects'
          ? '◆'
          : (collectionKind === 'repositories' ? '⑂' : (collectionKind === 'project-repositories'
            ? '◆⑂'
            : (collectionKind === 'file-labels' ? '●' : '📁')))));
      const title = tab.mode === 'tasks'
        ? '开发任务'
        : (collectionKind === 'projects'
          ? '所有项目'
          : (collectionKind === 'repositories'
            ? '所有仓库'
            : (collectionKind === 'project-repositories'
              ? '项目 + Git'
              : (collectionKind === 'file-labels' ? this.fileLabelCollectionTitle(tab.contentQuery) : tab.title))));
      const tabHelp = tab.mode === 'tasks'
        ? '开发任务 · Local Project Manager 权威任务工作台'
        : (collectionKind === 'projects'
          ? '所有受管位置 · 项目筛选'
          : (collectionKind === 'repositories'
            ? '所有受管位置 · Git 仓库筛选'
            : (collectionKind === 'project-repositories'
              ? '所有受管位置 · 项目 + Git 仓库筛选'
              : (collectionKind === 'file-labels' ? '所有受管位置 · 文件标签' : (tab.path || title)))));
      return `
        <div class="workspace-tab ${active ? 'active' : ''}" data-tab-id="${this.escapeHtml(tab.id)}" role="tab" tabindex="${active ? '0' : '-1'}" aria-selected="${active ? 'true' : 'false'}" aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" draggable="true" title="${this.escapeHtml(tabHelp)}">
          <span class="workspace-tab-icon" aria-hidden="true">${icon}</span>
          <span class="workspace-tab-title">${this.escapeHtml(title)}</span>
          <button class="workspace-tab-close" type="button" data-close-tab="${this.escapeHtml(tab.id)}" title="关闭标签页 (⌘W)" aria-label="关闭 ${this.escapeHtml(title)}" ${onlyOne ? 'disabled' : ''}>×</button>
        </div>`;
    }).join('');

    container.querySelectorAll('.workspace-tab').forEach(element => {
      const tabId = element.dataset.tabId;
      element.addEventListener('click', event => {
        if (!event.target.closest('.workspace-tab-close')) this.activateWorkspaceTab(tabId);
      });
      element.addEventListener('keydown', event => {
        if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          this.moveWorkspaceTab(tabId, direction);
          return;
        }
        if (event.key === 'Enter' || event.code === 'Space') {
          event.preventDefault();
          this.activateWorkspaceTab(tabId);
        }
      });
      element.addEventListener('auxclick', event => {
        if (event.button === 1) this.closeWorkspaceTab(tabId);
      });
    });
    container.querySelectorAll('.workspace-tab-close').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        this.closeWorkspaceTab(button.dataset.closeTab);
      });
    });
    container.querySelector('.workspace-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  setupWorkspaceTabDrag() {
    const container = document.getElementById('workspace-tabs');
    if (!container || this._workspaceTabDragBound) return;
    this._workspaceTabDragBound = true;

    container.addEventListener('dragstart', event => {
      const tabElement = event.target.closest('.workspace-tab[data-tab-id]');
      if (!tabElement || event.target.closest('.workspace-tab-close')) {
        event.preventDefault();
        return;
      }
      const tabId = tabElement.dataset.tabId;
      if (!AppState.workspaceSession?.tabs.some(tab => tab.id === tabId)) {
        event.preventDefault();
        return;
      }
      this.captureActiveWorkspaceTab();
      AppState.workspaceTabDrag = { tabId, dropped: false };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-gitfinder-workspace-tab', tabId);
      requestAnimationFrame(() => {
        container.classList.add('workspace-tabs-reordering');
        tabElement.classList.add('workspace-tab-dragging');
        tabElement.setAttribute('aria-grabbed', 'true');
      });
    });

    container.addEventListener('dragover', event => {
      const drag = AppState.workspaceTabDrag;
      if (!drag) return;
      const source = container.querySelector(`.workspace-tab[data-tab-id="${this.cssEscape(drag.tabId)}"]`);
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';

      const bounds = container.getBoundingClientRect();
      const edgeSize = Math.min(44, bounds.width * 0.16);
      if (event.clientX < bounds.left + edgeSize) container.scrollLeft -= 14;
      else if (event.clientX > bounds.right - edgeSize) container.scrollLeft += 14;

      const target = event.target.closest('.workspace-tab[data-tab-id]');
      if (!target || target === source) return;
      const targetBounds = target.getBoundingClientRect();
      if (event.clientX < targetBounds.left + targetBounds.width / 2) target.before(source);
      else target.after(source);
    });

    container.addEventListener('drop', event => {
      const drag = AppState.workspaceTabDrag;
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      drag.dropped = true;
      const orderedIds = [...container.querySelectorAll('.workspace-tab[data-tab-id]')].map(tab => tab.dataset.tabId);
      this.commitWorkspaceTabOrder(orderedIds, drag.tabId);
    });

    container.addEventListener('dragend', () => {
      const drag = AppState.workspaceTabDrag;
      if (!drag) return;
      if (!drag.dropped) this.renderWorkspaceTabs();
      this.clearWorkspaceTabDrag();
    });
  },

  clearWorkspaceTabDrag() {
    document.getElementById('workspace-tabs')?.classList.remove('workspace-tabs-reordering');
    document.querySelectorAll('.workspace-tab-dragging').forEach(element => {
      element.classList.remove('workspace-tab-dragging');
      element.removeAttribute('aria-grabbed');
    });
    AppState.workspaceTabDrag = null;
  },

  commitWorkspaceTabOrder(orderedIds, focusTabId) {
    const session = AppState.workspaceSession;
    if (!session) return;
    const next = window.WorkspaceTabs.reorderTabs(session, orderedIds);
    AppState.workspaceSession = next;
    this.renderWorkspaceTabs();
    this.clearWorkspaceTabDrag();
    this.scheduleWorkspaceTabsPersist();
    requestAnimationFrame(() => {
      document.querySelector(`.workspace-tab[data-tab-id="${this.cssEscape(focusTabId)}"]`)?.focus();
    });
    if (next !== session) this._showStatusMessage('已调整标签页顺序', 'success');
  },

  moveWorkspaceTab(tabId, direction) {
    const session = AppState.workspaceSession;
    if (!session) return;
    const currentIndex = session.tabs.findIndex(tab => tab.id === tabId);
    if (currentIndex < 0) return;
    const next = window.WorkspaceTabs.moveTab(session, tabId, currentIndex + direction);
    if (next === session) return;
    AppState.workspaceSession = next;
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
    requestAnimationFrame(() => {
      document.querySelector(`.workspace-tab[data-tab-id="${this.cssEscape(tabId)}"]`)?.focus();
    });
    this._showStatusMessage('已调整标签页顺序', 'success');
  },

  applyWorkspaceTabState(tab, { render = true } = {}) {
    if (!tab) return;
    this.stopGlobalIndexStatusPolling();
    this.closeQuickLook();
    AppState.selectedPaths.clear();
    AppState.selectionAnchorPath = null;
    AppState.currentPath = tab.path || '';
    AppState.currentMode = tab.mode || 'tree';
    AppState.contentQuery = window.ContentQuery.normalize(tab.contentQuery);
    this.applyDirectoryViewPreference(AppState.currentPath, AppState.currentMode);
    AppState.history = Array.isArray(tab.history) ? [...tab.history] : (tab.path ? [tab.path] : []);
    AppState.historyIndex = Math.max(0, Math.min(Number(tab.historyIndex) || 0, Math.max(0, AppState.history.length - 1)));
    AppState.searchScope = tab.searchScope === 'global' ? 'global' : 'current';
    AppState.searchQuery = String(tab.searchQuery || '');
    AppState.globalSearchMode = tab.globalSearchMode === 'content' ? 'content' : 'metadata';
    AppState.globalSearchType = tab.globalSearchType || 'all';
    if (AppState.globalSearchMode === 'content') AppState.globalSearchType = 'file';
    AppState.globalSearchResults = [];
    AppState.globalSearchMeta = null;
    AppState.globalSearchLoading = false;
    AppState.globalSearchRequestId = `tab-${tab.id}-${Date.now()}`;
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = AppState.searchQuery;
    this.updateSearchScopeUI();
    this.updateModeUI();
    this.updateBreadcrumbs();
    this.updateNavButtons();
    this.syncFileSelectionUI();
    this.updateFileActionBar();
    if (!render) return;
    if (this.isGlobalSearchActive()) this.performGlobalSearch();
    else this.renderContent();
    this._syncTreeToCurrentPath();
  },

  async activateWorkspaceTab(tabId) {
    const session = AppState.workspaceSession;
    if (!session || session.activeTabId === tabId) return;
    this.captureActiveWorkspaceTab();
    const tab = session.tabs.find(item => item.id === tabId);
    if (!tab) return;
    session.activeTabId = tabId;
    this.applyWorkspaceTabState(tab);
    this.renderWorkspaceTabs();
    await this.persistWorkspaceTabs();
  },

  createWorkspaceTab() {
    const session = AppState.workspaceSession;
    if (!session) return;
    this.captureActiveWorkspaceTab();
    const next = window.WorkspaceTabs.addTab(session, {
      path: AppState.currentPath,
      mode: AppState.currentMode,
      history: AppState.currentPath ? [AppState.currentPath] : [],
      historyIndex: AppState.currentPath ? 0 : -1,
      searchScope: 'current',
      searchQuery: '',
      globalSearchMode: 'metadata',
      globalSearchType: 'all',
      contentQuery: window.ContentQuery.queryForPreset('current-all')
    });
    if (next === session) {
      this._showStatusMessage(`最多打开 ${window.WorkspaceTabs.MAX_TABS} 个标签页`, 'info');
      return;
    }
    AppState.workspaceSession = next;
    this.applyWorkspaceTabState(this.getActiveWorkspaceTab());
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
  },

  closeWorkspaceTab(tabId = AppState.workspaceSession?.activeTabId) {
    const session = AppState.workspaceSession;
    if (!session || !tabId) return;
    this.captureActiveWorkspaceTab();
    const next = window.WorkspaceTabs.closeTab(session, tabId);
    if (next === session) return;
    const activeChanged = next.activeTabId !== session.activeTabId;
    AppState.workspaceSession = next;
    if (activeChanged) this.applyWorkspaceTabState(this.getActiveWorkspaceTab());
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
  },

  restoreClosedWorkspaceTab() {
    const session = AppState.workspaceSession;
    if (!session?.closedTabs?.length) {
      this._showStatusMessage('没有最近关闭的标签页', 'info');
      return;
    }
    this.captureActiveWorkspaceTab();
    AppState.workspaceSession = window.WorkspaceTabs.restoreClosedTab(session);
    this.applyWorkspaceTabState(this.getActiveWorkspaceTab());
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
  },

  cycleWorkspaceTab(direction = 1) {
    const session = AppState.workspaceSession;
    if (!session || session.tabs.length < 2) return;
    const currentIndex = session.tabs.findIndex(tab => tab.id === session.activeTabId);
    const nextIndex = (currentIndex + direction + session.tabs.length) % session.tabs.length;
    this.activateWorkspaceTab(session.tabs[nextIndex].id);
  },

  isGlobalSearchActive() {
    return AppState.currentMode === 'tree'
      && window.ContentQuery.isCurrent(AppState.contentQuery)
      && AppState.searchScope === 'global'
      && Boolean(AppState.searchQuery.trim());
  },

  isDirectoryBrowsingContext() {
    return AppState.currentMode === 'tree' && window.ContentQuery.isCurrent(AppState.contentQuery);
  },

  isFileBrowsingContext() {
    return this.isDirectoryBrowsingContext() || this.contentCollectionKind() === 'file-labels';
  },

  isDirectoryLoadBlocked() {
    return window.DirectoryLoadState.status(AppState) !== 'idle';
  },

  isContentCollection() {
    return AppState.currentMode === 'tree' && window.ContentQuery.isCollection(AppState.contentQuery);
  },

  contentCollectionKind() {
    return AppState.currentMode === 'tree' ? window.ContentQuery.collectionKind(AppState.contentQuery) : '';
  },

  fileLabelCollectionLabels(query = AppState.contentQuery) {
    const ids = new Set(window.ContentQuery.normalize(query).fileLabelIds);
    return (AppState.fileLabels?.labels || []).filter(label => ids.has(label.id));
  },

  fileLabelCollectionTitle(query = AppState.contentQuery) {
    const names = this.fileLabelCollectionLabels(query).map(label => label.name);
    return names.length ? `标签：${names.join(' + ')}` : '文件标签';
  },

  updateSearchScopeUI() {
    const button = document.getElementById('search-scope-btn');
    const input = document.getElementById('search-input');
    const tasksMode = AppState.currentMode === 'tasks';
    const collectionKind = this.contentCollectionKind();
    const collectionMode = Boolean(collectionKind);
    const global = AppState.searchScope === 'global';
    if (button) {
      button.textContent = tasksMode ? '任务' : (collectionMode ? '所有位置' : (global ? '全局' : '当前'));
      button.setAttribute('aria-pressed', global ? 'true' : 'false');
      button.disabled = tasksMode || collectionMode;
      button.title = tasksMode
        ? '开发任务仅在当前投影中搜索'
        : (collectionMode ? '此筛选预设固定覆盖所有受管位置' : (global ? '切换到当前视图筛选' : '切换到所有受管目录搜索'));
    }
    if (input) {
      if (tasksMode) input.placeholder = '搜索任务、项目、负责人…';
      else if (collectionKind === 'projects') input.placeholder = '筛选所有项目…';
      else if (collectionKind === 'repositories') input.placeholder = '筛选所有 Git 仓库…';
      else if (collectionKind === 'project-repositories') input.placeholder = '筛选所有项目中的根 Git 仓库…';
      else if (collectionKind === 'file-labels') input.placeholder = '筛选带标签的文件与文件夹…';
      else if (global) {
        input.placeholder = AppState.globalSearchMode === 'content'
          ? '搜索文件内容（至少 3 个字符）…'
          : '搜索所有受管目录…';
      } else input.placeholder = '搜索当前视图…';
    }
  },

  async toggleSearchScope() {
    if (AppState.currentMode === 'tasks' || this.isContentCollection()) return;
    const leavingGlobalSearch = AppState.searchScope === 'global';
    AppState.searchScope = AppState.searchScope === 'global' ? 'current' : 'global';
    if (leavingGlobalSearch) {
      this.stopGlobalIndexStatusPolling();
      await Promise.all([
        window.gitFinder.content.cancelIndexBuild(),
        window.gitFinder.content.cancelSearch()
      ]);
    }
    AppState.globalSearchRequestId = `cancel-${Date.now()}`;
    AppState.globalSearchLoading = false;
    AppState.globalSearchResults = [];
    AppState.globalSearchMeta = null;
    this.clearFileSelection();
    this.updateSearchScopeUI();
    this.updateModeUI();
    this.captureActiveWorkspaceTab();
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
    await window.gitFinder.config.set('searchScope', AppState.searchScope);
    if (AppState.searchScope === 'global' && AppState.searchQuery.trim()) {
      await this.performGlobalSearch();
    } else {
      await this.renderContent();
    }
  },

  async performGlobalSearch(forceRefresh = false) {
    if (AppState.currentMode !== 'tree' || this.isContentCollection() || AppState.searchScope !== 'global') return;
    const query = AppState.searchQuery.trim();
    const requestId = `global-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    AppState.globalSearchRequestId = requestId;
    AppState.globalSearchResults = [];
    AppState.globalSearchMeta = null;
    const minimumQueryLength = AppState.globalSearchMode === 'content' ? 3 : 2;
    if (query.length < minimumQueryLength) {
      AppState.globalSearchLoading = false;
      AppState.globalIndexStatus = {
        ...(AppState.globalIndexStatus || {}),
        contentSearch: { phase: 'idle', candidateFiles: 0, plannedFiles: 0, scannedFiles: 0, bytesRead: 0 }
      };
      this.updateModeUI();
      await this.renderContent();
      return;
    }

    AppState.globalSearchLoading = true;
    AppState.globalIndexStatus = {
      ...(AppState.globalIndexStatus || {}),
      phase: 'building',
      building: true,
      incremental: Boolean(AppState.globalIndexStatus?.ready),
      indexedCount: 0,
      processedDirectories: 0,
      discoveredDirectories: 0,
      reusedDirectories: 0,
      contentSearch: { phase: 'idle', candidateFiles: 0, plannedFiles: 0, scannedFiles: 0, bytesRead: 0 }
    };
    this.updateModeUI();
    this.renderGlobalSearchView();
    this.startGlobalIndexStatusPolling(requestId);
    try {
      const result = await window.gitFinder.content.search(query, {
        requestId,
        mode: AppState.globalSearchMode,
        type: AppState.globalSearchType,
        limit: 300,
        forceRefresh
      });
      if (AppState.globalSearchRequestId !== requestId || result.cancelled) return;
      AppState.globalSearchResults = result.items || [];
      AppState.globalSearchMeta = result;
    } catch (error) {
      if (AppState.globalSearchRequestId !== requestId) return;
      AppState.globalSearchMeta = { error: error?.message || String(error), totalMatches: 0, indexedCount: 0 };
    } finally {
      if (AppState.globalSearchRequestId === requestId) {
        this.stopGlobalIndexStatusPolling();
        try {
          AppState.globalIndexStatus = await window.gitFinder.content.getIndexStatus();
        } catch (_) {}
        AppState.globalSearchLoading = false;
        this.renderGlobalSearchView();
      }
    }
  },

  startGlobalIndexStatusPolling(requestId) {
    this.stopGlobalIndexStatusPolling();
    const poll = async () => {
      if (AppState.globalSearchRequestId !== requestId || !AppState.globalSearchLoading) return;
      try {
        AppState.globalIndexStatus = await window.gitFinder.content.getIndexStatus();
        this.updateGlobalIndexStatusUI();
      } catch (_) {}
      if (AppState.globalSearchRequestId === requestId && AppState.globalSearchLoading) {
        AppState.globalIndexPollTimer = setTimeout(poll, 180);
      }
    };
    poll();
  },

  stopGlobalIndexStatusPolling() {
    if (AppState.globalIndexPollTimer) clearTimeout(AppState.globalIndexPollTimer);
    AppState.globalIndexPollTimer = null;
  },

  getGlobalIndexPresentation() {
    const status = AppState.globalIndexStatus || {};
    const meta = AppState.globalSearchMeta || {};
    const contentSearch = status.contentSearch || {};
    if (contentSearch.phase === 'scanning') {
      const scanned = Number(contentSearch.scannedFiles || 0);
      const planned = Number(contentSearch.plannedFiles || contentSearch.candidateFiles || 0);
      const bytes = this.formatFileSize(Number(contentSearch.bytesRead || 0));
      return {
        text: `正在读取文件内容 · 已检查 ${scanned}/${planned} 个文本文件 · ${bytes}`,
        progress: planned ? Math.min(100, Math.round((scanned / planned) * 100)) : 0,
        building: false,
        busy: true,
        showProgress: true,
        cancellable: true,
        tone: 'working'
      };
    }
    if (AppState.globalSearchMode === 'content' && contentSearch.phase === 'cancelled') {
      return { text: '文件内容搜索已取消，未保存任何内容', progress: 0, building: false, tone: 'stale' };
    }
    if (AppState.globalSearchMode === 'content' && contentSearch.phase === 'error') {
      return { text: `文件内容搜索失败：${contentSearch.error || '未知错误'}`, progress: 0, building: false, tone: 'error' };
    }
    if (AppState.globalSearchMode === 'content' && contentSearch.phase === 'ready') {
      const scanned = Number(meta.contentScannedFiles ?? contentSearch.scannedFiles ?? 0);
      const bytes = this.formatFileSize(Number(meta.contentBytesRead ?? contentSearch.bytesRead ?? 0));
      const bounded = meta.contentFileLimitReached || meta.contentByteLimitReached ? ' · 已达本次扫描上限' : '';
      return {
        text: `本机内容扫描 · ${scanned} 个文本文件 · ${bytes} · 内容未保存${bounded}`,
        progress: 100,
        building: false,
        tone: bounded ? 'stale' : 'ready'
      };
    }
    if (status.phase === 'building') {
      const processed = Number(status.processedDirectories || 0);
      const discovered = Number(status.discoveredDirectories || 0);
      const reused = Number(status.reusedDirectories || 0);
      const mode = status.incremental ? '正在增量更新' : '正在建立索引';
      const detail = discovered
        ? `已检查 ${processed}/${discovered} 个目录 · ${Number(status.indexedCount || 0)} 项`
        : `已索引 ${Number(status.indexedCount || 0)} 项`;
      return {
        text: `${mode} · ${detail}${reused ? ` · 复用 ${reused} 个` : ''}`,
        progress: discovered ? Math.min(100, Math.round((processed / discovered) * 100)) : 0,
        building: true,
        busy: true,
        showProgress: true,
        cancellable: true,
        tone: 'working'
      };
    }
    if (AppState.globalSearchLoading) {
      return {
        text: '正在载入本机索引…',
        progress: 0,
        building: false,
        busy: true,
        showProgress: false,
        cancellable: false,
        tone: 'working'
      };
    }
    if (status.phase === 'stale') {
      return { text: '本机索引待更新', progress: 0, building: false, tone: 'stale' };
    }
    if (status.phase === 'cancelled') {
      return { text: '索引更新已取消，可随时继续', progress: 0, building: false, tone: 'stale' };
    }
    if (status.phase === 'error') {
      return { text: `索引更新失败：${status.error || '未知错误'}`, progress: 0, building: false, tone: 'error' };
    }
    const builtAt = status.builtAt || meta.builtAt;
    const indexedCount = Number(status.indexedCount || meta.indexedCount || 0);
    if (status.ready || builtAt) {
      const time = this.formatItemDate(builtAt);
      const source = meta.indexSource === 'disk' ? '已从磁盘载入' : '本机索引';
      const persistenceWarning = status.persistenceError ? ' · 仅本次会话' : '';
      return {
        text: `${source}${time ? ` · 更新于 ${time}` : ''} · ${indexedCount} 项${persistenceWarning}`,
        progress: 100,
        building: false,
        tone: status.persistenceError ? 'stale' : 'ready'
      };
    }
    return { text: '尚未建立本机索引', progress: 0, building: false, tone: 'idle' };
  },

  updateGlobalIndexStatusUI() {
    const presentation = this.getGlobalIndexPresentation();
    const statusElement = document.getElementById('global-index-status-text');
    const progressElement = document.getElementById('global-index-progress');
    const progressBar = document.getElementById('global-index-progress-bar');
    const refreshButton = document.getElementById('global-index-refresh');
    const cancelButton = document.getElementById('global-index-cancel');
    if (statusElement) {
      statusElement.textContent = presentation.text;
      statusElement.dataset.tone = presentation.tone;
    }
    if (progressElement) {
      progressElement.hidden = !presentation.showProgress;
      progressElement.setAttribute('aria-valuenow', String(presentation.progress));
    }
    if (progressBar) progressBar.style.width = `${presentation.progress}%`;
    if (refreshButton) refreshButton.hidden = presentation.busy;
    if (cancelButton) cancelButton.hidden = !presentation.cancellable;
  },

  async cancelGlobalIndexBuild() {
    const requestId = AppState.globalSearchRequestId;
    const [indexResult, contentResult] = await Promise.all([
      window.gitFinder.content.cancelIndexBuild(),
      window.gitFinder.content.cancelSearch()
    ]);
    if ((!indexResult.cancelled && !contentResult.cancelled) || AppState.globalSearchRequestId !== requestId) return;
    AppState.globalSearchRequestId = `cancel-${Date.now()}`;
    AppState.globalSearchLoading = false;
    try { AppState.globalIndexStatus = await window.gitFinder.content.getIndexStatus(); } catch (_) {}
    AppState.globalSearchMeta = {
      cancelled: true,
      totalMatches: 0,
      indexedCount: AppState.globalIndexStatus?.indexedCount || 0,
      contentSearch: AppState.globalSearchMode === 'content'
    };
    this.stopGlobalIndexStatusPolling();
    this.renderGlobalSearchView();
  },

  clearSearchQuery() {
    AppState.searchQuery = '';
    this.stopGlobalIndexStatusPolling();
    window.gitFinder.content.cancelIndexBuild().catch(() => {});
    window.gitFinder.content.cancelSearch().catch(() => {});
    AppState.globalSearchRequestId = `cancel-${Date.now()}`;
    AppState.globalSearchLoading = false;
    AppState.globalSearchResults = [];
    AppState.globalSearchMeta = null;
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    this.captureActiveWorkspaceTab();
    this.scheduleWorkspaceTabsPersist();
    this.updateFilterBar();
    this.updateModeUI();
    this.renderContent();
  },

  renderGlobalSearchView() {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    if (!contentArea) return;
    if (emptyState) emptyState.style.display = 'none';
    const query = AppState.searchQuery.trim();
    const meta = AppState.globalSearchMeta || {};
    const results = AppState.globalSearchResults || [];
    AppState.items = results;
    AppState.visibleItems = results;
    const visiblePaths = new Set(results.map(item => item.path));
    AppState.selectedPaths = new Set([...AppState.selectedPaths].filter(itemPath => visiblePaths.has(itemPath)));
    this.reconcileFileKeyboardFocus(results);

    const contentMode = AppState.globalSearchMode === 'content';
    const minimumQueryLength = contentMode ? 3 : 2;
    const modeOptions = [['metadata', '名称与路径'], ['content', '文件内容']];
    const typeOptions = [
      ['all', '全部'], ['repository', '仓库'], ['directory', '文件夹'], ['file', '文件']
    ];
    let body;
    if (query.length < minimumQueryLength) {
      body = `<div class="quick-look-empty"><div style="font-size:34px;opacity:.5;">⌕</div><div>输入至少 ${minimumQueryLength} 个字符，${contentMode ? '搜索受管目录中的白名单文本文件' : '搜索所有受管开发目录'}</div></div>`;
    } else if (AppState.globalSearchLoading) {
      body = `<div class="quick-look-empty"><div class="loading-spinner"></div><div>${contentMode ? '正在本机读取符合条件的文本文件…' : '正在建立或查询本地索引…'}</div></div>`;
    } else if (meta.error) {
      body = `<div class="quick-look-empty"><div style="font-size:34px;opacity:.5;">⚠</div><div>${this.escapeHtml(meta.error)}</div></div>`;
    } else if (!results.length) {
      body = `<div class="quick-look-empty"><div style="font-size:34px;opacity:.5;">⌕</div><div>没有找到“${this.escapeHtml(query)}”</div><div style="font-size:11px;">${contentMode ? '本次只检查受限大小的白名单文本，可切回名称与路径搜索' : '尝试缩短关键词或切换类型'}</div></div>`;
    } else {
      body = `<div class="repo-list global-search-results" role="listbox" aria-label="全局搜索结果" aria-multiselectable="true">${results.map(item => this.getGlobalSearchItemHtml(item)).join('')}</div>`;
    }

    const countText = AppState.globalSearchLoading
      ? '正在搜索'
      : `${Number(meta.totalMatches || 0)} 个匹配${meta.totalMatches > results.length ? `，显示前 ${results.length} 个` : ''}`;
    const indexText = contentMode
      ? (meta.contentScannedFiles !== undefined ? `已检查 ${Number(meta.contentScannedFiles)} 个文本文件` : '受管目录白名单文本')
      : (meta.indexedCount ? `已索引 ${meta.indexedCount} 项` : '所有受管开发目录');
    const indexPresentation = this.getGlobalIndexPresentation();
    contentArea.innerHTML = `
      <div class="global-search-view">
        <div class="global-search-header">
          <div class="global-search-heading">
            <div class="global-search-title">${contentMode ? '全局内容搜索' : '全局搜索'}${query ? `：“${this.escapeHtml(query)}”` : ''}</div>
            <div class="global-search-subtitle">${countText} · ${indexText}${meta.truncated ? ' · 索引达到上限' : ''}</div>
            ${contentMode ? '<div class="global-search-privacy">仅在本次查询中读取文本；单文件最多 512 KB，本次最多 2,500 个文件 / 64 MB；文件内容不写入索引。</div>' : ''}
            <div class="global-index-status-row">
              <span id="global-index-status-text" class="global-index-status-text" data-tone="${indexPresentation.tone}">${this.escapeHtml(indexPresentation.text)}</span>
              <span id="global-index-progress" class="global-index-progress" role="progressbar" aria-label="索引构建进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${indexPresentation.progress}" ${indexPresentation.showProgress ? '' : 'hidden'}>
                <span id="global-index-progress-bar" style="width:${indexPresentation.progress}%"></span>
              </span>
              <button id="global-index-refresh" class="global-index-action" type="button" ${indexPresentation.busy ? 'hidden' : ''}>更新索引</button>
              <button id="global-index-cancel" class="global-index-action" type="button" ${indexPresentation.cancellable ? '' : 'hidden'}>取消</button>
            </div>
          </div>
          <div class="global-search-controls">
            <div class="global-search-modes" role="group" aria-label="搜索范围">
              ${modeOptions.map(([value, label]) => `<button class="global-search-mode ${AppState.globalSearchMode === value ? 'active' : ''}" data-search-mode="${value}" type="button" aria-pressed="${AppState.globalSearchMode === value}">${label}</button>`).join('')}
            </div>
            <div class="global-search-filters" role="group" aria-label="搜索结果类型">
              ${typeOptions.map(([value, label]) => {
                const disabled = contentMode && value !== 'file';
                return `<button class="global-search-filter ${AppState.globalSearchType === value ? 'active' : ''}" data-search-type="${value}" type="button" ${disabled ? 'disabled' : ''}>${label}</button>`;
              }).join('')}
            </div>
          </div>
        </div>
        ${body}
      </div>
    `;
    contentArea.querySelectorAll('.global-search-mode').forEach(button => {
      button.addEventListener('click', async () => {
        const nextMode = button.dataset.searchMode === 'content' ? 'content' : 'metadata';
        if (AppState.globalSearchMode === nextMode) return;
        await window.gitFinder.content.cancelSearch();
        AppState.globalSearchMode = nextMode;
        if (nextMode === 'content') AppState.globalSearchType = 'file';
        this.updateSearchScopeUI();
        this.captureActiveWorkspaceTab();
        this.scheduleWorkspaceTabsPersist();
        this.clearFileSelection();
        this.performGlobalSearch();
      });
    });
    contentArea.querySelectorAll('.global-search-filter').forEach(button => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        if (AppState.globalSearchType === button.dataset.searchType) return;
        AppState.globalSearchType = button.dataset.searchType;
        this.captureActiveWorkspaceTab();
        this.scheduleWorkspaceTabsPersist();
        this.clearFileSelection();
        this.performGlobalSearch();
      });
    });
    document.getElementById('global-index-refresh')?.addEventListener('click', () => this.performGlobalSearch(true));
    document.getElementById('global-index-cancel')?.addEventListener('click', () => this.cancelGlobalIndexBuild());
    this.bindCardEvents(contentArea);
    this.syncFileSelectionUI();
    this.updateFileActionBar();
    this.updateStatusBar();
  },

  getGlobalSearchItemHtml(item) {
    const typeLabel = item.isGitRepo ? 'Git 仓库' : (item.type === 'directory' ? '文件夹' : (item.type === 'symlink' ? '符号链接' : this.formatFileSize(item.size)));
    const metadata = window.FileBrowser.repositoryMetadataPresentation(item, 3);
    const metadataHtml = metadata.chips.length
      ? `<span class="global-search-metadata" title="${this.escapeHtml(metadata.title)}">
          ${metadata.chips.map(chip => `<span class="global-search-metadata-chip metadata-${chip.kind}" style="--metadata-color:${this.safeColor(chip.color)}"><span class="global-search-metadata-dot" aria-hidden="true"></span>${this.escapeHtml(chip.label)}</span>`).join('')}
          ${metadata.hiddenCount ? `<span class="global-search-metadata-more">+${metadata.hiddenCount}</span>` : ''}
        </span>`
      : '';
    const contentMatch = item.contentMatch && typeof item.contentMatch === 'object' ? item.contentMatch : null;
    const contentMatchHtml = contentMatch
      ? `<span class="global-search-snippet" title="${this.escapeHtml(contentMatch.snippet || '')}"><span class="global-search-line">第 ${Math.max(1, Number(contentMatch.line) || 1)} 行</span>${this.escapeHtml(contentMatch.snippet || '')}</span>`
      : '';
    const focused = item.path === AppState.fileKeyboardFocusPath;
    return `
      <div class="repo-list-item status-${item.isGitRepo ? 'clean' : 'none'} ${contentMatch ? 'content-match' : ''}" data-path="${this.escapeHtml(item.path)}" data-type="${this.escapeHtml(item.type)}" data-is-git="${item.isGitRepo === true}" role="option" aria-selected="false" aria-label="${this.escapeHtml(this.getFileItemAriaLabel(item))}" tabindex="${focused ? '0' : '-1'}">
        <span class="list-status-dot">${item.isGitRepo ? '<span class="status-indicator status-clean"></span>' : ''}</span>
        ${this.getItemKindIconHtml(item, 'list-repo-icon')}
        <span class="list-repo-name">${this.escapeHtml(item.name)}</span>
        <span class="global-search-location">
          <span class="global-search-path" title="${this.escapeHtml(item.path)}">${this.escapeHtml(item.relativePath || item.path)}</span>
          ${contentMatchHtml}
          ${metadataHtml}
        </span>
        <span class="global-search-root" title="${this.escapeHtml(item.rootPath || '')}">${this.escapeHtml(item.rootName || '')}</span>
        <span class="list-repo-branch">${this.escapeHtml(typeLabel)}</span>
        <span class="list-repo-status">${this.escapeHtml(this.formatItemDate(item.modifiedTime))}</span>
      </div>
    `;
  },

  // 应用侧栏 section 排列顺序
  applySidebarSectionOrder() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const order = AppState.sidebarSectionOrder;
    if (!order || !Array.isArray(order) || order.length === 0) return;
    const defaultSections = Array.from(sidebar.querySelectorAll('.sidebar-section[data-section-id]'));
    const sections = new Map(defaultSections.map(el => [el.dataset.sectionId, el]));
    const resolvedOrder = order.filter((id, index) => sections.has(id) && order.indexOf(id) === index);
    for (const section of defaultSections) {
      const id = section.dataset.sectionId;
      if (resolvedOrder.includes(id)) continue;
      if (id === 'projects') {
        const favoritesIndex = resolvedOrder.indexOf('favorites');
        const locationsIndex = resolvedOrder.indexOf('locations');
        const insertAt = favoritesIndex >= 0 ? favoritesIndex + 1 : (locationsIndex >= 0 ? locationsIndex : resolvedOrder.length);
        resolvedOrder.splice(insertAt, 0, id);
      } else if (id === 'smart-collections') {
        const locationsIndex = resolvedOrder.indexOf('locations');
        const tagsIndex = resolvedOrder.indexOf('tags');
        const insertAt = locationsIndex >= 0 ? locationsIndex + 1 : (tagsIndex >= 0 ? tagsIndex : resolvedOrder.length);
        resolvedOrder.splice(insertAt, 0, id);
      } else if (id === 'file-labels') {
        const smartCollectionsIndex = resolvedOrder.indexOf('smart-collections');
        const locationsIndex = resolvedOrder.indexOf('locations');
        const tagsIndex = resolvedOrder.indexOf('tags');
        const insertAt = smartCollectionsIndex >= 0
          ? smartCollectionsIndex + 1
          : (locationsIndex >= 0 ? locationsIndex + 1 : (tagsIndex >= 0 ? tagsIndex : resolvedOrder.length));
        resolvedOrder.splice(insertAt, 0, id);
      } else {
        resolvedOrder.push(id);
      }
    }
    resolvedOrder.forEach(id => {
      const el = sections.get(id);
      if (el) sidebar.appendChild(el);
    });
    if (resolvedOrder.join('\0') !== order.join('\0')) {
      AppState.sidebarSectionOrder = resolvedOrder;
      window.gitFinder.config.set('sidebarSectionOrder', resolvedOrder).catch(() => null);
    }
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

    const applyConstrainedWidths = () => {
      if (!sidebar || !detailPanel) return;
      const preferred = this._preferredColumnWidths || {
        sidebarWidth: sidebar.offsetWidth,
        detailWidth: detailPanel.offsetWidth
      };
      const constrained = window.FileBrowser.constrainPanelWidths(
        document.querySelector('.main-container')?.clientWidth || window.innerWidth,
        preferred.sidebarWidth,
        preferred.detailWidth
      );
      sidebar.style.width = `${constrained.sidebarWidth}px`;
      detailPanel.style.width = `${constrained.detailWidth}px`;
    };
    this._applyConstrainedColumnWidths = applyConstrainedWidths;
    window.addEventListener('resize', applyConstrainedWidths);

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
        this._preferredColumnWidths = {
          sidebarWidth: sidebar.offsetWidth,
          detailWidth: detailPanel.offsetWidth,
          ...(side === 'left' ? { sidebarWidth: newW } : { detailWidth: newW })
        };
        applyConstrainedWidths();
      });

      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // 保存宽度
        this._preferredColumnWidths = {
          sidebarWidth: sidebar.offsetWidth,
          detailWidth: detailPanel.offsetWidth
        };
        window.gitFinder.config.set('sidebarWidth', sidebar.offsetWidth);
        window.gitFinder.config.set('detailPanelWidth', detailPanel.offsetWidth);
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
    this._preferredColumnWidths = {
      sidebarWidth: sidebarW || document.getElementById('sidebar').offsetWidth,
      detailWidth: detailW || document.getElementById('detail-panel').offsetWidth
    };
    this._applyConstrainedColumnWidths?.();
  },

  async loadSidebarData() {
    this.loadFavorites();
    await this.initSidebarTree();
  },

  async loadProjectShortcuts() {
    return this.projectShortcutsController.load();
  },

  async loadLocalProjects(forceRefresh = false) {
    return this.projectShortcutsController.loadLocalProjects(forceRefresh);
  },

  async refreshProjectShortcuts(forceRefresh = false) {
    return this.projectShortcutsController.refresh(forceRefresh);
  },

  async recordProjectVisit(directoryPath) {
    return this.projectShortcutsController.recordVisit(directoryPath);
  },

  async toggleProjectShortcutPinned(projectId) {
    return this.projectShortcutsController.togglePinned(projectId);
  },

  async openProjectShortcut(projectId) {
    return this.projectShortcutsController.open(projectId);
  },

  renderProjectShortcuts() {
    return this.projectShortcutsController.render();
  },

  // ============ 侧边栏目录树(多根目录,访达式浏览器) ============

  _treeRoots: [],
  _treeExpandedPaths: new Set(),
  _treeRootsLoaded: false,

  async initSidebarTree() {
    return this.sidebarTreeController.init();
  },

  async loadTreeRoots() {
    return this.sidebarTreeController.loadRoots();
  },

  async addTreeRootDialog() {
    return this.sidebarTreeController.addRootDialog();
  },

  async addTreeRoot(dirPath, name, grantToken, { navigate = true } = {}) {
    return this.sidebarTreeController.addRoot(dirPath, name, grantToken, { navigate });
  },

  async removeTreeRoot(dirPath) {
    return this.sidebarTreeController.removeRoot(dirPath);
  },

  async renderSidebarTree() {
    return this.sidebarTreeController.render();
  },

  async _renderTreeNode(path, name, _icon, isRoot, depth, item = {}) {
    return this.sidebarTreeController.renderNode(path, name, isRoot, depth, item);
  },

  _bindTreeEvents(container) {
    return this.sidebarTreeController.bind(container);
  },

  _syncTreeSelection() {
    return this.sidebarTreeController.syncSelection();
  },

  async _syncTreeToCurrentPath() {
    return this.sidebarTreeController.syncToCurrentPath();
  },

  favoritePathKey(candidatePath) {
    const normalized = String(candidatePath || '').replace(/[\\/]+$/, '');
    return window.gitFinder.platform === 'win32' ? normalized.toLowerCase() : normalized;
  },

  isFavoritePath(candidatePath) {
    const key = this.favoritePathKey(candidatePath);
    return Boolean(key) && AppState.favorites.some(favorite => this.favoritePathKey(favorite.path) === key);
  },

  selectedFavoriteDirectory({ fallbackCurrent = false } = {}) {
    const items = this.getSelectedFileItems();
    if (items.length === 1 && items[0].type === 'directory') return items[0].path;
    if (AppState.selectedRepo?.path) return AppState.selectedRepo.path;
    if (fallbackCurrent && this.isDirectoryBrowsingContext() && AppState.currentPath) return AppState.currentPath;
    return '';
  },

  async addCurrentFavorite() {
    const directoryPath = this.selectedFavoriteDirectory({ fallbackCurrent: true });
    if (!directoryPath) {
      this._showStatusMessage('请先选择一个文件夹，或进入要收藏的目录', 'warning');
      return;
    }
    if (this.isFavoritePath(directoryPath)) {
      this._showStatusMessage('该文件夹已经在收藏夹中', 'info');
      return;
    }
    try {
      const name = directoryPath.split(/[\\/]/).filter(Boolean).at(-1) || directoryPath;
      await window.gitFinder.config.addFavorite({ type: 'directory', path: directoryPath, name });
      await this.loadFavorites();
      this.updateFileActionBar();
      if (AppState.selectedRepo) {
        this.updateDetailPanel();
      } else if (this.isFileBrowsingContext()) {
        this.showFileSelectionDetail(this.getSelectedFileItems());
      }
      this._showStatusMessage(`已将 ${name} 添加到收藏夹`, 'success');
    } catch (error) {
      this._showStatusMessage(error?.message || String(error), 'error');
    }
  },

  async toggleFavoritePath(directoryPath) {
    if (!directoryPath) return;
    try {
      const result = await window.gitFinder.config.toggleFavoriteDirectory(directoryPath);
      await this.loadFavorites();
      this.updateFileActionBar();
      if (AppState.selectedRepo) {
        this.updateDetailPanel();
      } else if (this.isFileBrowsingContext()) {
        this.showFileSelectionDetail(this.getSelectedFileItems());
      }
      const name = result?.favorite?.name || directoryPath.split(/[\\/]/).filter(Boolean).at(-1) || directoryPath;
      this._showStatusMessage(result?.favorited ? `已将 ${name} 添加到收藏夹` : `已从收藏夹移除 ${name}`, 'success');
    } catch (error) {
      this._showStatusMessage(error?.message || String(error), 'error');
    }
  },

  toggleSelectedFavorite() {
    const directoryPath = this.selectedFavoriteDirectory();
    if (directoryPath) this.toggleFavoritePath(directoryPath);
  },

  async openFavoriteLocation(item) {
    if (!item?.path) return;
    if (item.available === false) {
      this._showStatusMessage('该快捷位置尚未授权，请先在“位置”中添加目录', 'warning');
      return;
    }
    if (!item.isQuick) {
      const validation = await window.gitFinder.fs.resolveFavoriteDirectory(item.path);
      if (!validation?.ok) {
        this._showStatusMessage(validation?.message || '收藏位置当前不可用', 'error');
        return;
      }
      item = { ...item, path: validation.path };
    }
    if (AppState.currentMode !== 'tree') {
      AppState.currentMode = 'tree';
      this.updateModeUI();
    }
    this.navigateTo(item.path);
  },

  async loadFavorites() {
    try {
      const [favorites, quickLocs, hiddenQuickLocs] = await Promise.all([
        window.gitFinder.config.getFavorites(),
        window.gitFinder.fs.getQuickLocations(),
        window.gitFinder.config.get('hiddenQuickLocations')
      ]);
      const container = document.getElementById('favorites-list');
      if (!container) return;
      const hiddenSet = new Set(hiddenQuickLocs || []);
      const pathKey = value => this.favoritePathKey(value);
      const quickKeys = new Set((quickLocs || []).map(location => pathKey(location.path)));
      const favList = (Array.isArray(favorites) ? favorites : [])
        .filter(favorite => favorite?.path && ['dir', 'directory', 'repo', undefined].includes(favorite.type));
      AppState.favorites = favList;

      const quickInspection = (quickLocs || []).length
        ? await window.gitFinder.fs.inspectWorkspaceDirectories((quickLocs || []).map(location => location.path))
        : { directories: [] };
      const quickInfo = new Map((quickInspection.directories || []).map(entry => [pathKey(entry.path), entry]));

      const favoriteInspection = favList.length
        ? await window.gitFinder.fs.getFavoriteDirectoryInfos(favList.map(favorite => favorite.path))
        : { directories: [] };
      const favoriteInfo = new Map((favoriteInspection.directories || []).map(entry => [pathKey(entry.path), entry]));
      const allItems = [];

      for (const location of quickLocs || []) {
        if (hiddenSet.has(location.path)) continue;
        allItems.push({
          id: location.path,
          type: 'directory',
          path: location.path,
          name: location.name,
          isQuick: true,
          available: quickInfo.get(pathKey(location.path))?.available === true,
          canRemove: true
        });
      }

      for (const favorite of favList) {
        if (quickKeys.has(pathKey(favorite.path))) continue;
        const inspection = favoriteInfo.get(pathKey(favorite.path));
        allItems.push({
          ...inspection?.info,
          id: favorite.id || favorite.path,
          type: 'directory',
          path: favorite.path,
          name: favorite.name || favorite.path.split(/[\\/]/).filter(Boolean).at(-1) || '收藏',
          isQuick: false,
          available: inspection?.available === true,
          canRemove: true
        });
      }

      if (!allItems.length) {
        container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#86868b;">暂无收藏</div>';
        this.updateFileActionBar();
        return;
      }

      container.innerHTML = allItems.map(item => {
        const active = pathKey(item.path) === pathKey(AppState.currentPath);
        const icon = item.isQuick
          ? '<span class="sidebar-icon" aria-hidden="true">📍</span>'
          : this.getItemKindIconHtml(item, 'sidebar-kind-icon');
        const unavailable = !item.available;
        return `
          <div class="sidebar-item ${active ? 'active' : ''} ${unavailable ? 'is-unavailable' : ''}" data-id="${this.escapeHtml(item.id)}" data-type="${this.escapeHtml(item.type)}" data-path="${this.escapeHtml(item.path)}" title="${this.escapeHtml(unavailable ? `${item.isQuick ? '尚未授权' : '位置不可用'} · ${item.path}` : item.path)}" aria-disabled="${unavailable}">
            ${icon}
            <span class="sidebar-item-name">${this.escapeHtml(item.name)}</span>
            ${item.canRemove ? `<button class="sidebar-item-remove" data-id="${this.escapeHtml(item.id)}" title="移除收藏" aria-label="从收藏夹移除 ${this.escapeHtml(item.name)}">×</button>` : ''}
          </div>`;
      }).join('');

      container.querySelectorAll('.sidebar-item[data-id]').forEach(element => {
        element.addEventListener('click', event => {
          if (event.target.closest('.sidebar-item-remove')) return;
          const item = allItems.find(candidate => candidate.id === element.dataset.id);
          if (item) this.openFavoriteLocation(item).catch(error => this._showStatusMessage(error?.message || String(error), 'error'));
        });
      });

      container.querySelectorAll('.sidebar-item-remove').forEach(button => {
        button.addEventListener('click', async event => {
          event.stopPropagation();
          const item = allItems.find(candidate => candidate.id === button.dataset.id);
          if (item?.isQuick) {
            if (confirm(`从收藏夹移除 "${item.name}" ?`)) {
              const hidden = await window.gitFinder.config.get('hiddenQuickLocations') || [];
              if (!hidden.includes(item.path)) {
                hidden.push(item.path);
                await window.gitFinder.config.set('hiddenQuickLocations', hidden);
              }
            } else {
              return;
            }
          } else {
            await window.gitFinder.config.removeFavorite(button.dataset.id);
          }
          await this.loadFavorites();
          this.updateFileActionBar();
          if (AppState.selectedRepo) {
            this.updateDetailPanel();
          } else if (this.isFileBrowsingContext()) {
            this.showFileSelectionDetail(this.getSelectedFileItems());
          }
        });
      });
      this.updateFileActionBar();
    } catch (error) {
      console.error('loadFavorites error:', error);
      const container = document.getElementById('favorites-list');
      if (container) container.innerHTML = '<div style="padding:4px 16px;font-size:11px;color:#FF3B30;">加载失败</div>';
    }
  },

  async loadGroups() {
    AppState.groups = await window.gitFinder.groups.get();
    this.renderSidebarGroups();
  },

  renderSidebarGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    let groups = AppState.groups.groups || [];
    const collectionKind = this.contentCollectionKind();
    const categoryDisabled = AppState.currentMode === 'tasks'
      || AppState.currentMode === 'settings'
      || this.isFileBrowsingContext()
      || ['projects', 'project-repositories'].includes(collectionKind);
    container.classList.toggle('category-list-disabled', categoryDisabled);
    this.ensureCategoryDisableGuard(container);
    const selectedCategory = this.activeRepositoryCategory();

    // 按 groupOrder 排序(若有保存的顺序)
    if (AppState.groupOrder && Array.isArray(AppState.groupOrder)) {
      const orderMap = new Map(AppState.groupOrder.map((id, idx) => [id, idx]));
      groups = [...groups].sort((a, b) => {
        const ia = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
        const ib = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
        return ia - ib;
      });
    }

    // 分类中可能留有已移动或已归档的旧路径,统计时只计算当前扫描结果。
    const metrics = RepoMetrics.calculateRepoGroupMetrics(AppState.allRepos, groups);
    const allRepoCount = metrics.allCount;
    const ungroupedCount = metrics.ungroupedCount;

    let html = `
      <div class="sidebar-item category-item ${selectedCategory === 'all' ? 'active' : ''}" data-category="all" role="menuitemradio" aria-checked="${selectedCategory === 'all'}" tabindex="-1">
        <span class="group-color-dot" style="background:#86868b"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">全部仓库</span>
        <span class="badge">${allRepoCount}</span>
      </div>
    `;

    for (const group of groups) {
      const active = selectedCategory === group.id ? 'active' : '';
      const groupId = this.escapeHtml(group.id);
      const groupName = this.escapeHtml(group.name);
      const groupColor = this.safeColor(group.color);
      html += `
        <div class="sidebar-item category-item category-draggable ${active}" data-category="${groupId}" draggable="true" role="menuitemradio" aria-checked="${selectedCategory === group.id}" tabindex="-1" title="${groupName}（可拖拽排序）">
          <span class="category-drag-handle" title="拖拽排序">⋮⋮</span>
          <span class="group-color-dot" style="background:${groupColor}"></span>
          <span class="sidebar-item-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="双击重命名">${groupName}</span>
          <span class="badge">${metrics.groupCounts.get(group.id) || 0}</span>
          <span class="sidebar-item-remove" data-group-id="${groupId}" title="删除分类">×</span>
        </div>
      `;
    }

    const ungroupedActive = selectedCategory === 'ungrouped' ? 'active' : '';
    html += `
      <div class="sidebar-item category-item ${ungroupedActive}" data-category="ungrouped" role="menuitemradio" aria-checked="${selectedCategory === 'ungrouped'}" tabindex="-1">
        <span class="group-color-dot" style="background:#C7C7CC"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">未分类</span>
        <span class="badge">${ungroupedCount}</span>
      </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('keydown', event => {
        if (event.target.closest('input, textarea')) return;
        const items = [...container.querySelectorAll('.category-item')];
        const index = items.indexOf(item);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          items[(index + direction + items.length) % items.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      });
      item.addEventListener('click', (e) => {
        // 点击拖拽手柄不触发选中
        if (e.target.classList.contains('category-drag-handle')) return;
        // 点击删除按钮不触发选中
        if (e.target.classList.contains('sidebar-item-remove')) return;
        if (this.isFileBrowsingContext()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const category = item.dataset.category;
        this.setActiveRepositoryCategory(category);
        const dropdown = document.getElementById('category-filter-dropdown');
        if (dropdown) dropdown.hidden = true;
        document.getElementById('category-filter-btn')?.setAttribute('aria-expanded', 'false');
        this.updateModeUI();
        this.renderSidebarGroups();
        this.updateFilterBar();
        this.renderContent();
      });

      // 双击名称重命名(仅对有 data-category 且非 all/ungrouped 的项)
      const nameSpan = item.querySelector('.sidebar-item-name');
      if (nameSpan) {
        const groupId = item.dataset.category;
        if (groupId && groupId !== 'all' && groupId !== 'ungrouped') {
          nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const group = (AppState.groups.groups || []).find(g => g.id === groupId);
            if (!group) return;
            this._startInlineEdit(nameSpan, group.name,
              async (newName) => {
                newName = newName.trim();
                if (!newName || newName === group.name) { this.renderSidebarGroups(); return; }
                await window.gitFinder.groups.update(groupId, { name: newName });
                AppState.groups = await window.gitFinder.groups.get();
                this.renderSidebarGroups();
                this.updateFilterBar();
                if (AppState.selectedRepo) {
                  AppState.selectedRepo.groups = this._findRepoGroups(AppState.selectedRepo.path);
                  this.updateDetailPanel();
                }
                this.renderContent();
              },
              () => this.renderSidebarGroups()
            );
          });
        }
      }
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
        if (this.contentCollectionKind() === 'repositories'
            && window.ContentQuery.normalize(AppState.contentQuery).repositoryCategory === groupId) {
          this.setActiveRepositoryCategory('all');
        }
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

  ensureCategoryDisableGuard(container) {
    if (!container || container.dataset.disableGuardAttached === '1') return;
    const blockOutsideRepositoryContext = (event) => {
      const repositoryContext = AppState.currentMode === 'dashboard' || this.contentCollectionKind() === 'repositories';
      if (repositoryContext) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    ['click', 'dblclick', 'mousedown', 'dragstart'].forEach(type => {
      container.addEventListener(type, blockOutsideRepositoryContext, true);
    });
    container.dataset.disableGuardAttached = '1';
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

  // 内联编辑:把 span 替换成 input,回车保存,Esc 取消
  _startInlineEdit(span, oldText, onSave, onCancel) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldText;
    input.style.cssText = 'flex:1;font-size:12px;border:1px solid var(--accent);border-radius:3px;padding:1px 4px;background:var(--bg-primary);color:var(--text-primary);min-width:0;';
    span.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) {
        onSave(input.value);
      } else if (onCancel) {
        onCancel();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  },

  renderSidebarTags() {
    const container = document.getElementById('tags-filter-list');
    const section = document.getElementById('tags-sidebar-section');
    const tags = AppState.tags.tags;

    if (tags.length === 0) {
      // 没有标签时隐藏标题,保留添加按钮
      const title = section?.querySelector('.sidebar-title');
      if (title) title.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    // 有标签时显示标题
    const title = section?.querySelector('.sidebar-title');
    if (title) title.style.display = '';

    container.innerHTML = tags.map(tag => {
      const count = Object.values(AppState.tags.repoTags || {}).filter(ids => ids.includes(tag.id)).length;
      const selected = AppState.selectedTags.includes(tag.id);
      const tagId = this.escapeHtml(tag.id);
      const tagColor = this.safeColor(tag.color);
      return `
        <div class="sidebar-tag-item ${selected ? 'selected' : ''}" data-tag-id="${tagId}">
          <span class="sidebar-tag-dot" style="background:${tagColor}"></span>
          <span class="sidebar-item-name" style="flex:1;" title="双击重命名">${this.escapeHtml(tag.name)}</span>
          <span class="sidebar-tag-count">${count}</span>
          <span class="sidebar-item-remove" data-tag-id="${tagId}" title="删除标签">×</span>
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

      // 双击名称重命名
      const nameSpan = item.querySelector('.sidebar-item-name');
      if (nameSpan) {
        nameSpan.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const tagId = item.dataset.tagId;
          const tag = (AppState.tags.tags || []).find(t => t.id === tagId);
          if (!tag) return;
          this._startInlineEdit(nameSpan, tag.name,
            async (newName) => {
              newName = newName.trim();
              if (!newName || newName === tag.name) { this.renderSidebarTags(); return; }
              await window.gitFinder.tags.update(tagId, { name: newName });
              AppState.tags = await window.gitFinder.tags.get();
              this.renderSidebarTags();
              this.renderContent();
            },
            () => this.renderSidebarTags()
          );
        });
      }
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

  activeRepositoryCategory() {
    const candidate = this.contentCollectionKind() === 'repositories'
      ? window.ContentQuery.normalize(AppState.contentQuery).repositoryCategory
      : AppState.selectedCategory;
    if (candidate === 'all' || candidate === 'ungrouped') return candidate;
    return (AppState.groups?.groups || []).some(group => group.id === candidate) ? candidate : 'all';
  },

  setActiveRepositoryCategory(category) {
    const candidate = String(category || 'all');
    const valid = candidate === 'all'
      || candidate === 'ungrouped'
      || (AppState.groups?.groups || []).some(group => group.id === candidate);
    const normalized = valid ? candidate : 'all';
    if (this.contentCollectionKind() === 'repositories') {
      AppState.contentQuery = window.ContentQuery.normalize({
        ...AppState.contentQuery,
        repositoryCategory: normalized
      });
      this.captureActiveWorkspaceTab();
      this.renderWorkspaceTabs();
      this.scheduleWorkspaceTabsPersist();
      return;
    }
    AppState.selectedCategory = normalized;
  },

  activeRepositoryStatusFilters() {
    if (this.contentCollectionKind() === 'repositories') {
      return [...window.ContentQuery.normalize(AppState.contentQuery).gitStatuses];
    }
    return [...AppState.selectedStatuses];
  },

  setActiveRepositoryStatusFilters(statuses) {
    const normalized = [...new Set((Array.isArray(statuses) ? statuses : [])
      .filter(status => window.ContentQuery.VALID_GIT_STATUSES.includes(status)))];
    if (this.contentCollectionKind() === 'repositories') {
      AppState.contentQuery = window.ContentQuery.normalize({
        ...AppState.contentQuery,
        gitStatuses: normalized
      });
      this.captureActiveWorkspaceTab();
      this.renderWorkspaceTabs();
      this.scheduleWorkspaceTabsPersist();
      return;
    }
    AppState.selectedStatuses = normalized;
  },

  // 更新筛选栏:勾选状态 + 当前筛选摘要
  updateFilterBar() {
    this.renderSidebarGroups();
    // 同步勾选状态
    const tagCheck = document.getElementById('filter-tag-check');
    const statusCheck = document.getElementById('filter-status-check');
    const nameCheck = document.getElementById('filter-name-check');
    const readmeCheck = document.getElementById('filter-readme-check');
    if (tagCheck) tagCheck.checked = AppState.filterEnabled.tag;
    const repositoryCollection = this.contentCollectionKind() === 'repositories';
    const activeStatuses = this.activeRepositoryStatusFilters();
    if (statusCheck) {
      statusCheck.checked = repositoryCollection ? true : AppState.filterEnabled.status;
      statusCheck.disabled = repositoryCollection;
      statusCheck.title = repositoryCollection ? '仓库状态条件按当前标签页保存' : '';
    }
    if (nameCheck) nameCheck.checked = AppState.filterEnabled.name;
    if (readmeCheck) readmeCheck.checked = AppState.filterEnabled.readme;

    const activeCategory = this.activeRepositoryCategory();
    const activeGroup = (AppState.groups?.groups || []).find(group => group.id === activeCategory);
    const categoryLabel = activeCategory === 'ungrouped'
      ? '未分类'
      : (activeGroup?.name || '全部');
    const categoryButtonLabel = document.getElementById('category-filter-label');
    if (categoryButtonLabel) categoryButtonLabel.textContent = `分类：${categoryLabel}`;

    // 同步状态筛选下拉勾选
    document.querySelectorAll('#status-filter-dropdown input[type="checkbox"]').forEach(cb => {
      cb.checked = activeStatuses.includes(cb.value);
    });

    // 渲染筛选摘要
    const summary = document.getElementById('filter-summary');
    if (!summary) return;

    const parts = [];

    // 分类摘要
    {
      const category = activeCategory;
      let catLabel = '全部';
      if (category === 'ungrouped') {
        catLabel = '未分类';
      } else if (category !== 'all') {
        const g = (AppState.groups.groups || []).find(g => g.id === category);
        catLabel = g ? g.name : '全部';
      }
      if (category !== 'all') {
        parts.push(`<span class="filter-chip">分类: ${this.escapeHtml(catLabel)}</span>`);
      }
    }

    // 标签摘要
    if (AppState.filterEnabled.tag && AppState.selectedTags.length > 0) {
      const selectedTagObjs = AppState.tags.tags.filter(t => AppState.selectedTags.includes(t.id));
      const tagChips = selectedTagObjs.map(tag => {
        const color = this.safeColor(tag.color);
        return `
          <span class="filter-chip" style="background:${color}20;color:${color};">
            ${this.escapeHtml(tag.name)}
            <span class="filter-chip-remove" data-remove-tag="${this.escapeHtml(tag.id)}">×</span>
          </span>
        `;
      }).join('');
      parts.push(`<span class="filter-chip-group">标签: ${tagChips}</span>`);
    }

    // 状态摘要
    if ((repositoryCollection || AppState.filterEnabled.status) && activeStatuses.length > 0) {
      const statusLabels = {
        clean: '已同步',
        dirty: '未提交',
        ahead: '未推送',
        behind: '未拉取',
        'no-remote': '未添加远程仓库'
      };
      const statusChips = activeStatuses.map(s => `
        <span class="filter-chip" data-status="${s}">
          ${statusLabels[s] || s}
          <span class="filter-chip-remove" data-remove-status="${s}">×</span>
        </span>
      `).join('');
      parts.push(`<span class="filter-chip-group">状态: ${statusChips}</span>`);
    }

    // 名称摘要
    if (AppState.searchScope === 'current' && AppState.filterEnabled.name && AppState.searchQuery) {
      parts.push(`<span class="filter-chip">名称: "${this.escapeHtml(AppState.searchQuery)}"</span>`);
    }

    // README 摘要
    if (AppState.searchScope === 'current' && AppState.filterEnabled.readme && AppState.searchQuery) {
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
          this.setActiveRepositoryStatusFilters(this.activeRepositoryStatusFilters().filter(status => status !== statusVal));
        }
        this.updateFilterBar();
        this.renderContent();
      });
    });
    this.smartCollectionsController?.render();
  },

  async loadTheme() {
    try {
      // 加载外观模式(默认 light)和配色方案(默认 github)和提醒色(默认 classic)
      const savedMode = await window.gitFinder.config.get('themeMode') || 'light';
      const savedScheme = await window.gitFinder.config.get('themeScheme') || 'github';
      const savedReminder = await window.gitFinder.config.get('themeReminder') || 'classic';
      const savedSemanticColors = await window.gitFinder.config.get('semanticColorProfile').catch(() => null);

      AppState.themeMode = savedMode;
      AppState.themeScheme = savedScheme;
      AppState.themeReminder = savedReminder;
      AppState.semanticColorProfile = window.SemanticColors.normalizeProfile(savedSemanticColors);

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
    AppState.semanticColorProfile = window.SemanticColors.applyToElement(
      document.documentElement,
      AppState.semanticColorProfile
    );
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
      if (data && Array.isArray(data.repos)) {
        AppState.allRepos = data.repos.map(r => ({
          name: r.name,
          path: r.path,
          type: 'directory',
          isGitRepo: true,
          readme: null
        }));
        AppState.reposLastScan = data.lastScanAt || 0;
        AppState.enrichedRepos = [];
        AppState.repoEnrichmentComplete = false;
      }
    } catch (e) {
      console.log('Failed to load persisted repos:', e);
    }
  },

  async scanManagedRepositories() {
    return this.repositoryRootScanner.scan(
      this._treeRoots || [],
      AppState.allRepos,
      { depth: AppState.scanDepth }
    );
  },

  async reconcileRepositoryIndex() {
    const roots = this._treeRoots || [];
    if (!roots.length || this._repositoryReconcilePromise) return this._repositoryReconcilePromise;

    this._repositoryReconcilePromise = (async () => {
      const scan = await this.scanManagedRepositories();
      const repos = scan.repos;

      const previousPaths = AppState.allRepos.map(repo => repo.path).sort().join('\n');
      const nextPaths = repos.map(repo => repo.path).sort().join('\n');
      if (scan.complete) {
        AppState.reposLastScan = Date.now();
        await window.gitFinder.repos.set(repos, AppState.reposLastScan);
      }
      if (previousPaths === nextPaths) return repos;

      AppState.allRepos = repos;
      AppState.enrichedRepos = [];
      AppState.repoEnrichmentComplete = false;
      AppState.groups = await window.gitFinder.groups.get();
      this.renderSidebarGroups();
      if (this.contentCollectionKind() === 'repositories') await this.renderGridView(false);
      if (AppState.currentMode === 'dashboard') await this.openDashboard(false);
      this.updateStatusBar();
      return repos;
    })();

    try {
      return await this._repositoryReconcilePromise;
    } finally {
      this._repositoryReconcilePromise = null;
    }
  },

  switchView(view) {
    if (!['tree', 'dashboard', 'tasks', 'relationships'].includes(view)) return;
    this.closeQuickLook();
    this.clearFileSelection();
    AppState.currentMode = view;
    this.applyDirectoryViewPreference(AppState.currentPath, view);
    this.captureActiveWorkspaceTab();
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
    this.updateModeUI();
    this.updateBreadcrumbs();
    this.renderContent();
  },

  applyCurrentContentPreset(preset) {
    const query = window.ContentQuery.queryForPreset(preset);
    if (!query || query.scope !== 'current') return;
    if (AppState.currentMode === 'tree' && window.ContentQuery.equals(AppState.contentQuery, query)) return;
    this.setContentQuery(query);
  },

  toggleCurrentContentAttribute(attribute) {
    if (!['project', 'repository'].includes(attribute)) return;
    this.setContentQuery(window.ContentQuery.toggleCurrentAttribute(AppState.contentQuery, attribute));
  },

  openFileLabelCollection(labelId) {
    const label = (AppState.fileLabels?.labels || []).find(item => item.id === labelId);
    if (!label) {
      this._showStatusMessage('该文件标签已不存在', 'warning');
      return;
    }
    AppState.searchQuery = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    this.setContentQuery(window.ContentQuery.queryForFileLabels([label.id]));
  },

  setContentQuery(query) {
    this.closeQuickLook();
    this.clearFileSelection();
    AppState.currentMode = 'tree';
    AppState.contentQuery = window.ContentQuery.normalize(query);
    AppState.searchScope = 'current';
    AppState.globalSearchLoading = false;
    AppState.globalSearchResults = [];
    AppState.globalSearchMeta = null;
    this.captureActiveWorkspaceTab();
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
    this.updateModeUI();
    this.updateBreadcrumbs();
    this.renderContent();
  },

  applyContentPreset(preset) {
    const query = window.ContentQuery.queryForPreset(preset);
    if (!query || query.scope !== 'all') return;
    this.setContentQuery(query);
  },

  switchMode(mode) {
    if (mode === 'tree') this.applyCurrentContentPreset('current-all');
    else this.switchView(mode);
  },

  updateModeUI() {
    this.updateToolbarMenuState();
    document.querySelectorAll('.sidebar-item[data-mode]').forEach(item => {
      item.classList.toggle('active', item.dataset.mode === AppState.currentMode);
    });

    const tasksMode = AppState.currentMode === 'tasks';
    const relationshipsMode = AppState.currentMode === 'relationships';
    const collectionKind = this.contentCollectionKind();
    const projectsMode = ['projects', 'project-repositories'].includes(collectionKind);
    const collectionMode = Boolean(collectionKind);
    const settingsMode = AppState.currentMode === 'settings';
    const repositoryMetadataContext = window.ContentQuery.showsRepositoryMetadata(
      AppState.contentQuery,
      AppState.currentMode
    );
    const tagsSection = document.getElementById('tags-sidebar-section');
    if (tagsSection) tagsSection.style.display = repositoryMetadataContext ? '' : 'none';
    this.fileLabelController?.renderSidebar();
    const categoryFilter = document.getElementById('repository-category-filter');
    if (categoryFilter) categoryFilter.style.display = repositoryMetadataContext ? '' : 'none';
    document.querySelector('.main-container')?.classList.toggle('tasks-mode', tasksMode);
    document.querySelector('.main-container')?.classList.toggle('relationships-mode', relationshipsMode);
    document.querySelector('.main-container')?.classList.toggle('settings-mode', settingsMode);
    document.getElementById('content-scroll')?.classList.toggle('tasks-content-scroll', tasksMode);
    document.getElementById('btn-settings')?.classList.toggle('active', settingsMode);
    const toolbarCenter = document.querySelector('.toolbar-center');
    if (toolbarCenter) toolbarCenter.style.display = settingsMode || relationshipsMode ? 'none' : '';
    this.updateSearchScopeUI();
    this.updateNavButtons();

    const sortBar = document.getElementById('sort-bar');
    const filterBar = document.getElementById('filter-bar');
    const fileActionBar = document.getElementById('file-action-bar');
    const directoryTypeFilter = document.getElementById('directory-type-filter');
    const directoryTypeDivider = document.getElementById('directory-type-divider');
    const directorySortMenuHost = document.getElementById('directory-sort-menu-host');
    const showDirectoryTypeFilter = AppState.currentMode === 'tree' && !this.isGlobalSearchActive();
    const showDirectorySortMenu = !projectsMode;
    if (directoryTypeFilter) directoryTypeFilter.style.display = showDirectoryTypeFilter ? 'inline-flex' : 'none';
    if (directoryTypeDivider) directoryTypeDivider.style.display = showDirectoryTypeFilter && showDirectorySortMenu ? '' : 'none';
    if (directorySortMenuHost) directorySortMenuHost.style.display = showDirectorySortMenu ? '' : 'none';
    this.updateDirectoryTypeFilterUI();
    if (tasksMode || settingsMode || relationshipsMode) {
      sortBar.style.display = 'none';
      if (fileActionBar) fileActionBar.style.display = 'none';
      if (filterBar) filterBar.style.display = 'none';
    } else if (collectionMode) {
      sortBar.style.display = 'flex';
      if (fileActionBar) fileActionBar.style.display = collectionKind === 'file-labels' ? 'flex' : 'none';
      if (filterBar) filterBar.style.display = collectionKind === 'repositories' ? 'flex' : 'none';
    } else if (this.isGlobalSearchActive()) {
      sortBar.style.display = 'none';
      if (fileActionBar) fileActionBar.style.display = 'flex';
      if (filterBar) filterBar.style.display = 'none';
    } else if (AppState.currentMode === 'tree') {
      // 当前目录浏览展示内容筛选、排序与文件操作。
      sortBar.style.display = 'flex';
      if (fileActionBar) fileActionBar.style.display = 'flex';
      if (filterBar) filterBar.style.display = 'none';
    } else if (AppState.currentMode === 'dashboard') {
      sortBar.style.display = 'none';
      if (fileActionBar) fileActionBar.style.display = 'none';
      if (filterBar) filterBar.style.display = 'flex';
    } else {
      // 所有仓库预设保留仓库排序与分类筛选。
      sortBar.style.display = 'flex';
      if (fileActionBar) fileActionBar.style.display = 'none';
      if (filterBar) filterBar.style.display = 'flex';
    }
    this.updateFilterBar();
    this.smartCollectionsController?.updateControls();
  },

  updateDirectoryTypeFilterUI(items = AppState.items) {
    if (typeof window.FileBrowser === 'undefined' || typeof window.ContentQuery === 'undefined') return;
    const query = window.ContentQuery.normalize(AppState.contentQuery);
    const counts = window.FileBrowser.countDirectoryItems(items);
    const currentDirectoryMode = AppState.currentMode === 'tree' && query.scope === 'current';
    const fileLabelCollectionMode = AppState.currentMode === 'tree'
      && window.ContentQuery.collectionKind(query) === 'file-labels';
    const fileContentMode = currentDirectoryMode || fileLabelCollectionMode;
    const directoryLoadStatus = currentDirectoryMode
      ? window.DirectoryLoadState.status(AppState)
      : 'idle';
    const directoryBlocked = directoryLoadStatus !== 'idle';
    const directoryFilterTrigger = document.getElementById('directory-filter-menu-trigger');
    if (directoryFilterTrigger) {
      directoryFilterTrigger.disabled = directoryBlocked;
      directoryFilterTrigger.setAttribute('aria-busy', directoryLoadStatus === 'loading' ? 'true' : 'false');
      directoryFilterTrigger.title = directoryLoadStatus === 'loading'
        ? '正在载入当前目录内容'
        : (directoryLoadStatus === 'error' ? '当前目录无法载入' : '筛选当前目录内容');
    }
    const scopeHeading = document.getElementById('directory-filter-scope-heading');
    if (scopeHeading) scopeHeading.textContent = fileLabelCollectionMode ? '标签集合' : '当前目录';
    document.querySelectorAll('.directory-base-btn').forEach(button => {
      const type = button.dataset.contentBase;
      const active = fileContentMode && type === query.baseType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.disabled = !fileContentMode || directoryBlocked;
      const label = button.querySelector('span:last-child');
      const labels = { all: '全部', directory: '文件夹', file: '文件' };
      if (label) label.textContent = directoryBlocked
        ? labels[type]
        : `${labels[type]} ${counts[type] || 0}`;
    });
    document.querySelectorAll('.directory-attribute-btn').forEach(button => {
      const attribute = button.dataset.contentAttribute;
      const active = currentDirectoryMode && (attribute === 'project' ? query.projectOnly : query.repositoryOnly);
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.disabled = !currentDirectoryMode || directoryBlocked;
      const label = button.querySelector('span:last-child');
      if (label) label.textContent = directoryBlocked
        ? (attribute === 'project' ? '项目' : 'Git 仓库')
        : (attribute === 'project'
            ? `项目 ${counts.project || 0}`
            : `Git 仓库 ${counts.repository || 0}`);
    });
    const projectCountQuery = window.ContentQuery.normalize({
      ...window.ContentQuery.queryForPreset('all-projects'),
      lifecycles: query.lifecycles,
      modifiedWithinDays: query.modifiedWithinDays,
      modifiedFrom: query.modifiedFrom,
      modifiedTo: query.modifiedTo
    });
    const projectCount = AppState.localProjects.filter(project => window.ContentQuery.matchesAttributes({
      type: 'directory',
      isProject: true,
      isGitRepo: project.rootIsGitRepo === true,
      modifiedTime: project.modifiedTime,
      project
    }, projectCountQuery)).length;
    const repositoryCandidates = AppState.enrichedRepos.length ? AppState.enrichedRepos : AppState.allRepos;
    const allRepositoryCount = repositoryCandidates.length;
    const repositoryCountQuery = window.ContentQuery.normalize({ ...query, repositoryCategory: 'all' });
    const repositoryCount = window.ContentQuery.collectionKind(query) === 'repositories'
      ? repositoryCandidates.filter(repo => window.ContentQuery.matchesAttributes({
        ...repo,
        type: 'directory',
        isGitRepo: true
      }, repositoryCountQuery)).length
      : allRepositoryCount;
    document.querySelectorAll('.content-preset-btn').forEach(button => {
      const preset = button.dataset.contentPreset;
      const kind = window.ContentQuery.collectionKind(query);
      const active = AppState.currentMode === 'tree' && (
        (preset === 'all-projects' && kind === 'projects')
        || (preset === 'all-repositories' && kind === 'repositories')
      );
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      const label = button.querySelector('span:last-child');
      if (label) label.textContent = preset === 'all-projects'
        ? `所有项目 ${projectCount}`
        : `所有 Git 仓库 ${allRepositoryCount}`;
    });
    const triggerLabel = document.getElementById('directory-filter-label');
    const advancedCount = Math.max(0, window.ContentQuery.advancedFilterCount(query) - Number(fileLabelCollectionMode));
    const advancedSuffix = advancedCount ? ` · ${advancedCount} 条件` : '';
    if (triggerLabel) {
      const collectionKind = window.ContentQuery.collectionKind(query);
      if (directoryLoadStatus === 'loading') triggerLabel.textContent = '当前目录 · 正在载入…';
      else if (directoryLoadStatus === 'error') triggerLabel.textContent = '当前目录 · 无法载入';
      else if (collectionKind === 'file-labels') {
        const names = this.fileLabelCollectionLabels(query).map(label => label.name).join(' + ') || '文件标签';
        const count = items.filter(item => window.ContentQuery.matchesAttributes(item, query)).length;
        triggerLabel.textContent = `所有位置 · ${names} ${count}${advancedSuffix}`;
      }
      else if (collectionKind === 'projects') triggerLabel.textContent = `所有位置 · 项目 ${projectCount}${advancedSuffix}`;
      else if (collectionKind === 'repositories') triggerLabel.textContent = `所有位置 · Git 仓库 ${repositoryCount}${advancedSuffix}`;
      else if (collectionKind === 'project-repositories') {
        const count = AppState.localProjects.filter(project => project.rootIsGitRepo === true && window.ContentQuery.matchesAttributes({
          type: 'directory',
          isProject: true,
          isGitRepo: true,
          modifiedTime: project.modifiedTime,
          project
        }, query)).length;
        triggerLabel.textContent = `所有位置 · 项目 + Git 仓库 ${count}${advancedSuffix}`;
      }
      else {
        const count = window.ContentQuery.countItems(items, query);
        const label = query.projectOnly && query.repositoryOnly
          ? '项目 + Git 仓库'
          : (query.projectOnly ? '项目' : (query.repositoryOnly ? 'Git 仓库' : ({ all: '全部', directory: '文件夹', file: '文件' })[query.baseType]));
        triggerLabel.textContent = `当前目录 · ${label} ${count}${advancedSuffix}`;
      }
    }
    const moreSummary = document.getElementById('content-filter-more-summary');
    if (moreSummary) moreSummary.textContent = advancedCount ? `${advancedCount} 条件` : '未设置';
  },

  async openFolderDialog() {
    const selection = await window.gitFinder.fs.selectFolder();
    if (selection?.path) {
      // 将选择的文件夹添加为目录树根目录(内容管理器:不断添加新内容)
      await this.addTreeRoot(selection.path, undefined, selection.grantToken);
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
      try {
        await this.addTreeRoot(scanPath, undefined, AppState.scanDirectoryGrantToken, { navigate: false });
      } catch (error) {
        alert(error?.message || '请使用“选择…”重新确认扫描目录');
        return;
      }
    }
    AppState.scanDirectoryGrantToken = '';

    // 关闭弹窗
    document.getElementById('scan-modal').style.display = 'none';

    // 切换到“所有受管位置 · Git 仓库”预设并强制重新扫描
    AppState.currentMode = 'tree';
    AppState.contentQuery = window.ContentQuery.queryForPreset('all-repositories');
    AppState.searchScope = 'current';
    AppState.selectedCategory = 'all';
    this.captureActiveWorkspaceTab();
    this.renderWorkspaceTabs();
    this.scheduleWorkspaceTabsPersist();
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

  _goToFolderBusy: false,
  _goToFolderRestoreFocus: null,

  getGoToFolderSuggestions() {
    const suggestions = [];
    const seen = new Set();
    const add = (directoryPath, source) => {
      const value = String(directoryPath || '');
      if (!value || !this.isManagedPath(value)) return;
      const key = window.gitFinder.platform === 'win32' ? value.toLowerCase() : value;
      if (seen.has(key)) return;
      seen.add(key);
      const name = value.split(/[\\/]/).filter(Boolean).at(-1) || value;
      suggestions.push({ path: value, name, source });
    };

    add(AppState.currentPath, '当前');
    [...(AppState.history || [])].reverse().forEach(directoryPath => add(directoryPath, '历史'));
    (AppState.workspaceSession?.tabs || []).forEach(tab => add(tab.path, '标签页'));
    (this._treeRoots || []).forEach(root => add(root.path, '位置'));
    return suggestions.slice(0, 8);
  },

  openGoToFolderDialog() {
    const modal = document.getElementById('go-to-folder-modal');
    const input = document.getElementById('go-to-folder-input');
    const recent = document.getElementById('go-to-folder-recent');
    if (!modal || !input || !recent) return;
    const otherModalVisible = [...document.querySelectorAll('.modal-overlay')]
      .some(overlay => overlay !== modal && getComputedStyle(overlay).display !== 'none');
    if (otherModalVisible) return;

    this.closeToolbarMenus();
    this.closeQuickLook();
    this._goToFolderRestoreFocus = document.activeElement;
    this._goToFolderBusy = false;
    this.setGoToFolderFeedback('');
    const suggestions = this.getGoToFolderSuggestions();
    const defaultPath = this.isManagedPath(AppState.currentPath)
      ? AppState.currentPath
      : (suggestions[0]?.path || this._treeRoots?.[0]?.path || '');
    input.value = defaultPath;
    recent.innerHTML = suggestions.length
      ? `<div class="go-to-folder-recent-title">当前位置与最近位置</div>${suggestions.map(item => `
          <button class="go-to-folder-suggestion" data-go-to-path="${this.escapeHtml(item.path)}" type="button" title="${this.escapeHtml(item.path)}">
            <span class="go-to-folder-suggestion-name">${this.escapeHtml(item.name)} <small>${this.escapeHtml(item.source)}</small></span>
            <span class="go-to-folder-suggestion-path">${this.escapeHtml(item.path)}</span>
          </button>`).join('')}`
      : '';
    modal.inert = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  },

  closeGoToFolderDialog({ restoreFocus = true } = {}) {
    const modal = document.getElementById('go-to-folder-modal');
    const submit = document.getElementById('go-to-folder-submit-btn');
    const activeElement = document.activeElement;
    const modalOwnsFocus = modal
      && activeElement instanceof HTMLElement
      && modal.contains(activeElement);
    const restoreTarget = restoreFocus && this._goToFolderRestoreFocus instanceof HTMLElement
      ? this._goToFolderRestoreFocus
      : (document.querySelector('.workspace-tab.active') || document.getElementById('btn-go-to-folder'));
    if (modalOwnsFocus) {
      if (restoreTarget instanceof HTMLElement && !restoreTarget.hasAttribute('disabled')) {
        restoreTarget.focus();
      }
      if (modal.contains(document.activeElement) && activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
    }
    if (modal) {
      modal.inert = true;
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }
    this._goToFolderBusy = false;
    if (submit) {
      submit.disabled = false;
      submit.textContent = '前往';
    }
    this._goToFolderRestoreFocus = null;
  },

  setGoToFolderFeedback(message) {
    const feedback = document.getElementById('go-to-folder-feedback');
    const input = document.getElementById('go-to-folder-input');
    if (feedback) feedback.textContent = message || '';
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  },

  async submitGoToFolderDialog() {
    if (this._goToFolderBusy) return;
    const input = document.getElementById('go-to-folder-input');
    const submit = document.getElementById('go-to-folder-submit-btn');
    if (!input || !submit) return;
    this._goToFolderBusy = true;
    submit.disabled = true;
    submit.textContent = '正在检查…';
    this.setGoToFolderFeedback('');
    try {
      const result = await window.gitFinder.fs.resolveWorkspaceDirectory(input.value);
      if (!result?.ok) {
        this.setGoToFolderFeedback(result?.message || '无法进入该文件夹');
        input.focus();
        return;
      }

      this.closeGoToFolderDialog({ restoreFocus: false });
      this.stopGlobalIndexStatusPolling();
      window.gitFinder.content.cancelIndexBuild().catch(() => {});
      window.gitFinder.content.cancelSearch().catch(() => {});
      AppState.globalSearchRequestId = `cancel-${Date.now()}`;
      AppState.globalSearchLoading = false;
      AppState.globalSearchResults = [];
      AppState.globalSearchMeta = null;
      AppState.searchScope = 'current';
      AppState.searchQuery = '';
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';
      window.gitFinder.config.set('searchScope', 'current').catch(() => {});
      AppState.currentMode = 'tree';
      this.updateSearchScopeUI();
      this.updateModeUI();
      this.updateFilterBar();
      this.navigateTo(result.path);
      const locationName = result.path.split(/[\\/]/).filter(Boolean).at(-1) || result.path;
      this._showStatusMessage(`已前往 ${locationName}`, 'success');
    } catch (error) {
      this.setGoToFolderFeedback(error?.message || '检查文件夹失败');
      input.focus();
    } finally {
      this._goToFolderBusy = false;
      if (getComputedStyle(document.getElementById('go-to-folder-modal')).display !== 'none') {
        submit.disabled = false;
        submit.textContent = '前往';
      }
    }
  },

  navigateTo(path, replace = false) {
    return this.directoryNavigationController.navigateTo(path, replace);
  },

  goBack() {
    return this.directoryNavigationController.goBack();
  },

  goForward() {
    return this.directoryNavigationController.goForward();
  },

  goUp() {
    return this.directoryNavigationController.goUp();
  },

  getParentPath(path) {
    return this.directoryNavigationController.getParentPath(path);
  },

  updateBreadcrumbs() {
    return this.directoryNavigationController.updateBreadcrumbs();
  },

  updateNavButtons() {
    return this.directoryNavigationController.updateNavButtons();
  },

  cancelDirectoryItemRendering(reason = 'view-changed') {
    this.directoryPerformanceController.cancel();
    this.directoryBatchRenderer?.cancel(reason);
    this.directoryVirtualizer?.destroy();
    this.directoryVirtualizer = null;
    AppState.directoryRenderProgress = null;
    window.DirectoryLoadState.cancel(AppState);
    const contentArea = document.getElementById('content-area');
    contentArea?.classList.remove('directory-progress-active');
    contentArea?.classList.remove('directory-load-active');
    contentArea?.removeAttribute('aria-busy');
    contentArea?.querySelector('[data-directory-render-progress]')?.remove();
  },

  createDirectoryRenderContext(requestId) {
    return {
      requestId,
      path: AppState.currentPath,
      mode: AppState.currentMode,
      style: AppState.cardStyle
    };
  },

  isDirectoryRenderContextCurrent(context) {
    return Boolean(context)
      && context.requestId === AppState.directoryRenderRequestId
      && context.path === AppState.currentPath
      && context.mode === AppState.currentMode
      && context.style === AppState.cardStyle;
  },

  beginDirectoryLoad(context, contentArea) {
    window.DirectoryLoadState.begin(AppState, context);
    contentArea.classList.add('directory-load-active');
    contentArea.setAttribute('aria-busy', 'true');
    contentArea.innerHTML = `
      <section class="directory-load-state" role="status" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span>
        <strong>正在载入当前文件夹…</strong>
        <span>正在读取目录内容与开发项目状态</span>
      </section>`;
    this.closeToolbarMenus();
    this.updateDirectoryTypeFilterUI();
    this.updateFileActionBar();
    this.updateStatusBar();
  },

  finishDirectoryLoad(context, items) {
    if (!window.DirectoryLoadState.finish(AppState, context)) return false;
    const contentArea = document.getElementById('content-area');
    contentArea?.classList.remove('directory-load-active');
    contentArea?.removeAttribute('aria-busy');
    this.updateDirectoryTypeFilterUI(items);
    this.updateFileActionBar();
    return true;
  },

  failDirectoryLoad(context) {
    if (!window.DirectoryLoadState.fail(AppState, context)) return false;
    const contentArea = document.getElementById('content-area');
    contentArea?.classList.remove('directory-load-active');
    contentArea?.removeAttribute('aria-busy');
    this.updateDirectoryTypeFilterUI([]);
    this.updateFileActionBar();
    return true;
  },

  showDirectoryRenderProgress(container, context, total) {
    const label = window.ProgressiveDirectoryRender.progressLabel(0, total);
    AppState.directoryRenderProgress = { ...context, rendered: 0, total };
    container.classList.add('directory-progress-active');
    container.setAttribute('aria-busy', 'true');
    container.insertAdjacentHTML('afterbegin', `
      <div class="directory-render-progress" data-directory-render-progress data-request-id="${context.requestId}">
        <span class="directory-render-progress-copy">${this.escapeHtml(label)}</span>
        <progress max="${total}" value="0" aria-label="目录项目显示进度"></progress>
      </div>`);
    this.updateStatusBar();
  },

  updateDirectoryRenderProgress(container, context, rendered, total) {
    if (!this.isDirectoryRenderContextCurrent(context)) return;
    AppState.directoryRenderProgress = { ...context, rendered, total };
    const progressRoot = container.querySelector(`[data-directory-render-progress][data-request-id="${context.requestId}"]`);
    if (progressRoot) {
      const copy = progressRoot.querySelector('.directory-render-progress-copy');
      const progress = progressRoot.querySelector('progress');
      if (copy) copy.textContent = window.ProgressiveDirectoryRender.progressLabel(rendered, total);
      if (progress) progress.value = rendered;
    }
    this.updateStatusBar();
  },

  finishDirectoryRenderProgress(container, context, total, announce = false) {
    if (AppState.directoryRenderProgress?.requestId !== context.requestId) return;
    AppState.directoryRenderProgress = null;
    container.classList.remove('directory-progress-active');
    container.removeAttribute('aria-busy');
    container.querySelector(`[data-directory-render-progress][data-request-id="${context.requestId}"]`)?.remove();
    this.updateStatusBar();
    if (announce && this.isDirectoryRenderContextCurrent(context)) {
      this._showStatusMessage(window.ProgressiveDirectoryRender.progressLabel(total, total), 'success');
    }
  },

  appendDirectoryItemElements(target, items, renderItem, afterBind) {
    if (!target || !items.length) return [];
    const template = document.createElement('template');
    template.innerHTML = items.map(renderItem).join('');
    const elements = [...template.content.children];
    target.appendChild(template.content);
    this.bindCardElements(elements);
    elements.forEach(element => this.syncFileItemElement(element));
    if (typeof afterBind === 'function') afterBind(elements);
    return elements;
  },

  async renderDirectoryItemsProgressively(items, container, context, onBatch, options = {}) {
    const progressive = window.ProgressiveDirectoryRender.shouldRenderProgressively(items.length, options);
    let firstBatch = true;
    if (progressive) {
      const initialCount = window.ProgressiveDirectoryRender.normalizeOptions(options).initialBatch;
      if (!items.slice(0, initialCount).some(item => item.path === AppState.fileKeyboardFocusPath)) {
        AppState.fileKeyboardFocusPath = items[0]?.path || null;
      }
      this.showDirectoryRenderProgress(container, context, items.length);
    }
    this.directoryBatchRenderer ||= new window.ProgressiveDirectoryRender.BatchRenderer();
    return this.directoryBatchRenderer.render(items.length, {
      isCurrent: () => this.isDirectoryRenderContextCurrent(context),
      onBatch: range => {
        onBatch(items.slice(range.from, range.to), range);
        if (firstBatch) {
          firstBatch = false;
          this.directoryPerformanceController.markFirstDom(context, container);
        }
      },
      onProgress: progress => {
        if (progressive) this.updateDirectoryRenderProgress(container, context, progress.rendered, progress.total);
      },
      onComplete: progress => {
        if (progressive) this.finishDirectoryRenderProgress(container, context, progress.total, true);
      },
      onCancel: progress => {
        if (progressive) this.finishDirectoryRenderProgress(container, context, progress.total, false);
      },
      onError: () => {
        if (progressive) this.finishDirectoryRenderProgress(container, context, items.length, false);
      }
    }, options);
  },

  async renderContent() {
    this.cancelDirectoryItemRendering('view-changed');
    AppState.galleryPreviewRequestId += 1;
    const renderRequestId = ++AppState.directoryRenderRequestId;
    const renderContext = this.createDirectoryRenderContext(renderRequestId);
    this.syncCurrentDirectoryWatch();
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    if (AppState.currentMode !== 'relationships') this.relationshipBoardController?.close();
    const treeStyle = this.isFileBrowsingContext() && !this.isGlobalSearchActive()
      ? AppState.cardStyle
      : '';
    contentArea.classList.toggle('column-view-active', treeStyle === 'column');
    contentArea.classList.toggle('gallery-view-active', treeStyle === 'gallery');
    if (treeStyle !== 'gallery') {
      AppState.galleryPreviewRequestId += 1;
      this.galleryThumbnailLoader?.disconnect();
    }

    if (AppState.currentMode === 'settings') {
      AppState.fileDisplayOrder = [];
      await this.renderSettingsView();
      return;
    }

    if (AppState.currentMode === 'relationships') {
      AppState.fileDisplayOrder = [];
      emptyState.style.display = 'none';
      await this.relationshipBoardController.open(contentArea);
      return;
    }

    if (this.isGlobalSearchActive()) {
      AppState.fileDisplayOrder = [];
      this.renderGlobalSearchView();
      return;
    }

    if (AppState.currentMode === 'dashboard') {
      AppState.fileDisplayOrder = [];
      await this.openDashboard();
      return;
    }

    if (AppState.currentMode === 'tasks') {
      AppState.fileDisplayOrder = [];
      await this.renderProjectTasks();
      return;
    }

    const collectionKind = this.contentCollectionKind();
    if (collectionKind === 'projects' || collectionKind === 'project-repositories') {
      AppState.fileDisplayOrder = [];
      await this.renderProjectsView();
      return;
    }

    if (collectionKind === 'repositories') {
      AppState.fileDisplayOrder = [];
      await this.renderGridView();
      return;
    }

    if (collectionKind === 'file-labels') {
      await this.renderFileLabelCollectionView(renderContext);
      return;
    }

    if (!AppState.currentPath) {
      AppState.fileDisplayOrder = [];
      this.showEmptyState();
      return;
    }

    emptyState.style.display = 'none';
    this.beginDirectoryLoad(renderContext, contentArea);

    try {
      if (this.isFileBrowsingContext()) {
        await this.renderTreeView(renderContext);
      }
    } catch (e) {
      if (renderRequestId !== AppState.directoryRenderRequestId) return;
      this.failDirectoryLoad(renderContext);
      console.error('renderContent error:', e);
      try {
        const inspection = await window.gitFinder.fs.inspectWorkspaceDirectories([AppState.currentPath]);
        if (this.unavailableLocationController.showFromInspection(AppState.currentPath, inspection, { source: 'read' })) return;
      } catch (_) {}
      contentArea.innerHTML = `
        <div style="text-align:center;padding:40px;color:#FF3B30;">
          <div style="font-size:14px;margin-bottom:8px;">加载失败</div>
          <div style="font-size:12px;color:#86868b;margin-bottom:16px;">${this.escapeHtml(e?.message || String(e))}</div>
          <button class="btn btn-primary" data-app-action="open-folder">选择其他文件夹</button>
        </div>`;
    }
  },

  async renderTreeView(context) {
    const contentArea = document.getElementById('content-area');
    this.directoryPerformanceController.begin(context);
    let items = await window.gitFinder.fs.listDirectory(context.path, {
      showHidden: AppState.showHiddenFiles,
      recursive: false
    });
    if (!this.isDirectoryRenderContextCurrent(context)) return;
    await this.fileLabelController.enrichItems(items);
    if (!this.isDirectoryRenderContextCurrent(context)) return;
    this.directoryPerformanceController.markRead(context, items.length);
    this.unavailableLocationController.clear();

    AppState.items = items;
    if (!this.finishDirectoryLoad(context, items)) return;
    items = window.ContentQuery.filterItems(items, AppState.contentQuery);

    // 名称筛选(目录树只按名称/路径过滤,README 在此模式不适用)
    if (AppState.searchScope === 'current' && AppState.filterEnabled.name && AppState.searchQuery) {
      const q = AppState.searchQuery;
      items = items.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q)
      );
    }

    AppState.visibleItems = items;
    this.directoryPerformanceController.markVisible(context, items.length);
    contentArea.classList.toggle('column-view-active', AppState.cardStyle === 'column');
    contentArea.classList.toggle('gallery-view-active', AppState.cardStyle === 'gallery');
    const visiblePaths = new Set(items.map(item => item.path));
    AppState.selectedPaths = new Set([...AppState.selectedPaths].filter(itemPath => visiblePaths.has(itemPath)));
    this.reconcileFileKeyboardFocus(items);

    // 无结果显示空白
    if (!items.length) {
      AppState.fileDisplayOrder = [];
      AppState.fileKeyboardFocusPath = null;
      const filteredByType = !window.ContentQuery.isDefaultCurrent(AppState.contentQuery);
      contentArea.innerHTML = filteredByType
        ? '<div class="directory-filter-empty"><div>当前目录没有符合内容筛选的项目</div><button class="btn" id="directory-filter-reset" type="button">清除内容筛选</button></div>'
        : '<div class="directory-filter-empty"><div>此目录为空或没有匹配内容</div></div>';
      contentArea.querySelector('#directory-filter-reset')?.addEventListener('click', () => {
        AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
        this.captureActiveWorkspaceTab();
        this.scheduleWorkspaceTabsPersist();
        this.renderContent();
      });
      this.updateFileActionBar();
      this.showFileSelectionDetail([]);
      this.directoryPerformanceController.setStrategy(context, items, AppState.cardStyle, 'empty');
      this.directoryPerformanceController.markFirstDom(context, contentArea);
      this.directoryPerformanceController.complete(context, contentArea);
      this.updateStatusBar();
      return;
    }

    this.directoryPerformanceController.setStrategy(context, items, AppState.cardStyle);

    if (AppState.cardStyle === 'column') {
      await this.renderColumnView(items, contentArea, context);
    } else if (AppState.cardStyle === 'gallery') {
      await this.renderGalleryView(items, contentArea, context);
    } else if (AppState.cardStyle === 'list') {
      await this.renderListView(items, contentArea, context);
    } else {
      await this.renderCardView(items, contentArea, context);
    }
    if (!this.isDirectoryRenderContextCurrent(context)) return;
    this.syncFileSelectionUI();
    this.updateFileActionBar();
    this.showFileSelectionDetail(this.getSelectedFileItems());
    this.directoryPerformanceController.complete(context, contentArea);
    this.updateStatusBar();
  },

  async renderFileLabelCollectionView(context) {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    const query = window.ContentQuery.normalize(AppState.contentQuery);
    emptyState.style.display = 'none';
    contentArea.innerHTML = '<div class="file-label-collection-loading"><div class="loading-spinner"></div><span>正在读取文件标签…</span></div>';
    try {
      const result = await window.gitFinder.fileLabels.getCollection(query.fileLabelIds);
      if (!this.isDirectoryRenderContextCurrent(context) || this.contentCollectionKind() !== 'file-labels') return;
      AppState.fileLabelCollectionMeta = result;
      AppState.items = Array.isArray(result.items) ? result.items : [];
      this.updateDirectoryTypeFilterUI(AppState.items);
      let items = AppState.items.filter(item => window.ContentQuery.matchesAttributes(item, query));
      if (AppState.searchScope === 'current' && AppState.filterEnabled.name && AppState.searchQuery) {
        const needle = AppState.searchQuery;
        items = items.filter(item => String(item.name || '').toLowerCase().includes(needle)
          || String(item.path || '').toLowerCase().includes(needle));
      }
      AppState.visibleItems = items;
      const visiblePaths = new Set(items.map(item => item.path));
      AppState.selectedPaths = new Set([...AppState.selectedPaths].filter(itemPath => visiblePaths.has(itemPath)));
      this.reconcileFileKeyboardFocus(items);

      if (!items.length) {
        AppState.fileDisplayOrder = [];
        AppState.fileKeyboardFocusPath = null;
        const assignedCount = Number(result.totalAssigned || 0);
        contentArea.innerHTML = `<div class="file-label-collection-empty">
          <span class="file-label-collection-empty-dot" aria-hidden="true"></span>
          <strong>${assignedCount ? '没有符合当前内容条件的项目' : '这个标签还没有项目'}</strong>
          <span>${assignedCount ? '可清除文件类型、扩展名、大小或时间条件。' : '在任意目录中选择文件或文件夹，然后通过“操作 → 标签…”分配。'}</span>
          <button class="btn" data-app-action="manage-file-labels" type="button">管理标签…</button>
        </div>`;
      } else if (AppState.cardStyle === 'column') {
        this.renderFileLabelColumnView(items, contentArea);
      } else if (AppState.cardStyle === 'gallery') {
        await this.renderGalleryView(items, contentArea);
      } else if (AppState.cardStyle === 'list') {
        await this.renderListView(items, contentArea);
      } else {
        await this.renderCardView(items, contentArea);
      }
      if (!this.isDirectoryRenderContextCurrent(context)) return;
      const hiddenCount = Number(result.unavailableCount || 0);
      const truncatedCount = Number(result.truncatedCount || 0);
      if (hiddenCount || truncatedCount) {
        contentArea.insertAdjacentHTML('afterbegin', `<div class="file-label-collection-notice" role="status">
          ${hiddenCount ? `${hiddenCount} 个已标记项目当前不可用` : ''}${hiddenCount && truncatedCount ? ' · ' : ''}${truncatedCount ? `${truncatedCount} 个项目超过本次显示上限` : ''}
        </div>`);
      }
      this.syncFileSelectionUI();
      this.updateFileActionBar();
      this.showFileSelectionDetail(this.getSelectedFileItems());
      this.updateStatusBar();
    } catch (error) {
      if (!this.isDirectoryRenderContextCurrent(context)) return;
      AppState.fileLabelCollectionMeta = null;
      AppState.items = [];
      AppState.visibleItems = [];
      AppState.fileDisplayOrder = [];
      contentArea.innerHTML = `<div class="file-label-collection-empty is-error">
        <strong>文件标签集合加载失败</strong>
        <span>${this.escapeHtml(error?.message || String(error))}</span>
        <button class="btn" data-app-action="manage-file-labels" type="button">管理标签…</button>
      </div>`;
      this.updateFileActionBar();
      this.updateStatusBar();
    }
  },

  renderFileLabelColumnView(items, container) {
    const directories = this.sortRepos(items.filter(item => item.type === 'directory'));
    const files = this.sortRepos(items.filter(item => item.type === 'file'));
    const orderedItems = [...directories, ...files];
    AppState.fileDisplayOrder = orderedItems.map(item => item.path);
    const heading = this.fileLabelCollectionTitle().replace(/^标签：/u, '') || '文件标签';
    container.innerHTML = `<div class="finder-column-browser file-label-column-browser" role="group" aria-label="文件标签集合" style="--finder-column-width:${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)}px">
      <section class="finder-column finder-column-current">
        <header class="finder-column-header">${this.escapeHtml(heading)}</header>
        <div class="finder-column-list" role="listbox" aria-label="带标签的文件与文件夹" aria-multiselectable="true">
          ${orderedItems.map(item => this._getColumnItemHtml(item, { current: true, trail: false })).join('')}
        </div>
        <div class="finder-column-resizer" role="separator" aria-orientation="vertical" aria-label="调整分栏宽度" aria-valuemin="${window.DirectoryViewPreferences.MIN_COLUMN_WIDTH}" aria-valuemax="${window.DirectoryViewPreferences.MAX_COLUMN_WIDTH}" aria-valuenow="${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)}" aria-valuetext="${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)} 像素" tabindex="0" title="拖动调整；方向键微调；Shift 加速；双击恢复默认"></div>
      </section>
    </div>`;
    const browser = container.querySelector('.finder-column-browser');
    if (browser) this.bindColumnViewSizing(browser);
    this.bindCardEvents(container);
  },

  async renderGridView(forceRefresh = false) {
    const contentArea = document.getElementById('content-area');

    const roots = this._treeRoots || [];
    if (roots.length === 0) {
      contentArea.innerHTML = `
        <div style="text-align:center;padding:60px;color:#86868b;">
          <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">📂</div>
          <div style="font-size:14px;margin-bottom:6px;">尚未添加任何目录</div>
          <div style="font-size:12px;margin-bottom:16px;">添加目录后，可使用“所有 Git 仓库”筛选聚合查看受管位置</div>
          <button class="btn btn-primary" data-app-action="add-root">+ 添加目录</button>
        </div>`;
      this.updateDirectoryTypeFilterUI();
      this.updateStatusBar();
      return;
    }

    const now = Date.now();
    const needsRescan = forceRefresh || !AppState.allRepos.length;

    if (needsRescan) {
      const scan = await this.scanManagedRepositories();
      const repos = scan.repos;
      AppState.allRepos = repos;
      if (scan.complete) AppState.reposLastScan = now;
      AppState.enrichedRepos = [];
      AppState.repoEnrichmentComplete = false;
      if (scan.complete) {
        try {
          await window.gitFinder.repos.set(repos, now);
        } catch (e) {
          console.log('Failed to persist repos:', e);
        }
      } else if (scan.unavailableRoots.length) {
        this._showStatusMessage(`${scan.unavailableRoots.length} 个受管位置暂不可用，已保留其仓库记录`, 'warning');
      }
      // 重新扫描后更新侧边栏分类计数
      this.renderSidebarGroups();
      this.updateDirectoryTypeFilterUI();
    }

    if (!AppState.allRepos.length) {
      contentArea.innerHTML = `
        <div style="text-align:center;padding:60px;color:#86868b;">
          <div style="font-size:48px;margin-bottom:12px;opacity:0.4;">📂</div>
          <div style="font-size:14px;margin-bottom:6px;">已添加的目录下未找到 Git 仓库</div>
          <div style="font-size:12px;margin-bottom:16px;">尝试添加包含 Git 仓库的目录，或返回当前目录浏览</div>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn btn-primary" data-app-action="add-root">+ 添加目录</button>
            <button class="btn" data-app-action="tree-mode">返回当前目录</button>
          </div>
        </div>`;
      this.updateDirectoryTypeFilterUI();
      this.updateStatusBar();
      return;
    }

    let displayRepos = this._prepareDisplayRepos();

    if (!displayRepos.length) {
      contentArea.innerHTML = '';
      this.updateDirectoryTypeFilterUI();
      this.updateStatusBar();
      return;
    }

    this._renderGridContent(displayRepos, contentArea);

    if (!AppState.repoEnrichmentComplete || forceRefresh) {
      await this._enrichReposAsync(forceRefresh);
    }

    this.updateDirectoryTypeFilterUI();
    this.updateStatusBar();
  },

  async renderProjectsView(forceRefresh = false) {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';
    if (AppState.localProjectsLoading) return;
    AppState.localProjectsLoading = true;
    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#86868b;"><div class="loading-spinner" style="margin:0 auto 10px;"></div>正在识别本地项目与内部仓库…</div>';
    try {
      await this.refreshProjectShortcuts(forceRefresh);
      this.updateDirectoryTypeFilterUI();
      const query = AppState.searchScope === 'current' ? AppState.searchQuery.trim().toLowerCase() : '';
      const projects = AppState.localProjects.filter(project => {
        if (this.contentCollectionKind() === 'project-repositories' && project.rootIsGitRepo !== true) return false;
        if (!window.ContentQuery.matchesAttributes({
          type: 'directory',
          isProject: true,
          isGitRepo: project.rootIsGitRepo === true,
          modifiedTime: project.modifiedTime,
          project
        }, AppState.contentQuery)) return false;
        if (!query) return true;
        const repositoryText = (project.repositories || []).map(repo => repo.relativePath).join(' ');
        return `${project.name} ${project.description} ${project.path} ${project.lifecycle} ${repositoryText}`.toLowerCase().includes(query);
      });
      if (!projects.length) {
        const emptyActions = query
          ? '<button class="btn" data-app-action="refresh-local-projects" type="button">重新扫描</button>'
          : `<div class="local-project-empty-actions">
              <button class="btn btn-primary" data-app-action="choose-local-project" type="button">选择文件夹并设为项目…</button>
              <button class="btn" data-app-action="open-settings" type="button">打开应用设置</button>
            </div>`;
        contentArea.innerHTML = `
          <div class="local-project-empty">
            <div class="empty-icon">📁</div>
            <strong>${query ? '没有匹配的项目' : '尚未设置本地项目'}</strong>
            <span>${query ? '清除搜索条件后重试。' : '选择一个文件夹建立项目身份；也可以在目录页的“操作”菜单中设置。Git 仓库不会自动成为项目。'}</span>
            ${emptyActions}
          </div>`;
        this.updateDirectoryTypeFilterUI();
        this.updateStatusBar();
        return;
      }
      contentArea.innerHTML = `<div class="local-project-grid">${projects.map(project => {
        const projectItem = { isProject: true, project };
        const lifecycle = window.FileBrowser.projectLifecycleLabel(projectItem);
        const repositories = (project.repositories || []).slice(0, 6);
        const repositoryRows = repositories.length
          ? repositories.map(repo => `<li title="${this.escapeHtml(repo.path)}"><span class="local-project-repo-mark">⑂</span><span>${this.escapeHtml(repo.relativePath)}</span></li>`).join('')
          : '<li class="local-project-no-repo">尚未发现 Git 仓库</li>';
        const hiddenCount = Math.max(0, Number(project.repositoryCount || 0) - repositories.length);
        return `
          <article class="local-project-card"${this.getProjectSemanticStyle(projectItem)} data-project-path="${this.escapeHtml(project.path)}">
            <header>
              ${this.getItemKindIconHtml({ type: 'directory', isProject: true, isGitRepo: project.rootIsGitRepo, project }, 'local-project-icon')}
              <div><h3>${this.escapeHtml(project.name)}</h3><div class="local-project-path">${this.escapeHtml(project.path)}</div></div>
              ${this.getProjectLifecycleBadgeHtml(projectItem, lifecycle)}
            </header>
            <p>${this.escapeHtml(project.description || '暂无项目简介')}</p>
            <div class="local-project-repo-heading"><span>内部仓库</span><strong>${Number(project.repositoryCount || 0)}</strong></div>
            <ul class="local-project-repositories">${repositoryRows}${hiddenCount ? `<li>另有 ${hiddenCount} 个仓库…</li>` : ''}</ul>
            <footer>
              <button class="btn btn-small" data-app-action="edit-local-project" type="button">项目设置</button>
              <button class="btn btn-small" data-app-action="show-relationship-resource" data-relationship-kind="project" data-relationship-ref="${this.escapeHtml(project.projectId)}" data-relationship-path="${this.escapeHtml(project.path)}" type="button">关系白板</button>
              <button class="btn btn-small btn-primary" data-app-action="open-local-project" type="button">打开项目</button>
            </footer>
          </article>`;
      }).join('')}</div>`;
      this.updateDirectoryTypeFilterUI();
      this.updateStatusBar();
    } catch (error) {
      contentArea.innerHTML = `<div class="local-project-empty"><strong>项目扫描失败</strong><span>${this.escapeHtml(error?.message || String(error))}</span><button class="btn" data-app-action="refresh-local-projects" type="button">重试</button></div>`;
    } finally {
      AppState.localProjectsLoading = false;
    }
  },

  async chooseLocalProjectDirectory() {
    const selection = await window.gitFinder.fs.selectFolder();
    if (!selection?.path) return;
    await this.addTreeRoot(selection.path, undefined, selection.grantToken, { navigate: false });
    await this.openLocalProjectDialog(selection.path);
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

    // 平铺展示：所有仓库一个网格，分类只作为筛选条件，不再形成侧栏导航分区。
    if (AppState.cardStyle === 'list') {
      this.renderListView(filtered, contentArea);
    } else {
      contentArea.innerHTML = this.getCardsHtml(filtered);
      this.bindCardEvents(contentArea);
    }
  },

  async openDashboard(forceRefresh = false) {
    const contentArea = document.getElementById('content-area');
    const emptyState = document.getElementById('empty-state');
    const filterBar = document.getElementById('filter-bar');
    const sortBar = document.getElementById('sort-bar');
    AppState.currentMode = 'dashboard';
    this.updateModeUI();
    if (emptyState) emptyState.style.display = 'none';
    if (filterBar) filterBar.style.display = 'flex';
    if (sortBar) sortBar.style.display = 'none';
    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#86868b;"><div class="loading-spinner" style="margin:0 auto 10px;"></div>加载仪表板...</div>';
    if (!AppState.allRepos.length || forceRefresh) {
      await this.ensureDashboardRepos(forceRefresh);
    }
    const displayRepos = this._prepareDisplayRepos();
    await this.renderDashboardContent(displayRepos, contentArea);
    this.updateStatusBar();
  },

  async ensureDashboardRepos(forceRefresh = false) {
    const roots = this._treeRoots || [];
    if (!forceRefresh && AppState.allRepos.length) return;
    if (!roots.length) return;
    const scan = await this.scanManagedRepositories();
    AppState.allRepos = scan.repos;
    if (scan.complete) AppState.reposLastScan = Date.now();
    AppState.enrichedRepos = [];
    AppState.repoEnrichmentComplete = false;
    if (scan.complete) {
      try {
        await window.gitFinder.repos.set(scan.repos, AppState.reposLastScan);
      } catch (e) {}
    } else if (scan.unavailableRoots.length) {
      this._showStatusMessage(`${scan.unavailableRoots.length} 个受管位置暂不可用，已保留其仓库记录`, 'warning');
    }
  },

  async renderDashboardContent(displayRepos, contentArea) {
    const filtered = this._filterByCategory(displayRepos);

    if (!filtered.length) {
      contentArea.innerHTML = `
        <div style="text-align:center;padding:60px;color:#86868b;">
          <div style="font-size:14px;margin-bottom:6px;">没有可显示的项目</div>
          <div style="font-size:12px;">请先添加目录并扫描仓库,或调整筛选条件</div>
        </div>`;
      return;
    }

    const stats = await this.collectDashboardStats(filtered);
    const scopeLabel = this.getSelectedCategoryLabel();
    contentArea.innerHTML = `
      <div class="project-dashboard">
        <div class="project-dashboard-header">
          <div>
            <div class="project-dashboard-title">项目仪表板</div>
            <div class="project-dashboard-subtitle">统计范围：${this.escapeHtml(scopeLabel)} · 进度追踪、延期、阻塞和里程碑情况</div>
          </div>
          <div class="project-dashboard-actions">
            ${stats.missingControlProjects.length ? `<button class="btn btn-tiny" id="dashboard-init-missing-btn" type="button">初始化缺失控制文件</button>` : ''}
            <div class="project-dashboard-count">${stats.total} 个项目</div>
          </div>
        </div>
        <div class="dashboard-kpi-grid">
          ${this.getDashboardKpiHtml('控制文件覆盖率', `${stats.initializedPercent}%`, `${stats.initialized}/${stats.total} 个项目已初始化`, stats.initializedPercent)}
          ${this.getDashboardKpiHtml('进度追踪覆盖率', `${stats.trackedPercent}%`, `${stats.tracked}/${stats.total} 个项目有进度记录`, stats.trackedPercent)}
          ${this.getDashboardKpiHtml('延期项目', `${stats.delayed}`, `截止日期早于今天且未完成`, stats.delayedPercent, stats.delayed > 0 ? 'warn' : '')}
          ${this.getDashboardKpiHtml('阻塞项目', `${stats.blocked}`, `进度记录中包含阻塞项`, stats.blockedPercent, stats.blocked > 0 ? 'warn' : '')}
          ${this.getDashboardKpiHtml('停滞项目', `${stats.stalled}`, `14 天内没有进度更新`, stats.stalledPercent, stats.stalled > 0 ? 'warn' : '')}
        </div>
        <div class="dashboard-section-grid">
          <div class="dashboard-panel">
            <div class="dashboard-panel-title">项目健康度</div>
            <div class="dashboard-health-list">
              ${this.getDashboardHealthRow('未初始化控制文件', stats.missingControlProjects.length, stats.total)}
              ${this.getDashboardHealthRow('没有进度记录', stats.untrackedProjects.length, stats.total)}
              ${this.getDashboardHealthRow('停滞项目', stats.stalledProjects.length, stats.total)}
              ${this.getDashboardHealthRow('延期项目', stats.delayedProjects.length, stats.total)}
              ${this.getDashboardHealthRow('阻塞项目', stats.blockedProjects.length, stats.total)}
            </div>
          </div>
          <div class="dashboard-panel">
            <div class="dashboard-panel-title">近期里程碑</div>
            ${this.getDashboardMilestonesHtml(stats.upcomingMilestones)}
          </div>
        </div>
        <div class="dashboard-panel">
          <div class="dashboard-panel-title">需要关注</div>
          ${this.getDashboardAttentionHtml(stats)}
        </div>
      </div>
    `;
    AppState.dashboardStats = stats;
    this.bindDashboardEvents(contentArea);
  },

  async collectDashboardStats(repos) {
    const savedSelections = await window.gitFinder.config.get('projectControlSelections');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const staleBefore = new Date(today);
    staleBefore.setDate(staleBefore.getDate() - 14);
    const projectStats = await Promise.all(repos.map(async repo => {
      try {
        const files = await window.gitFinder.fs.listProjectControlFiles(repo.path);
        const control = await this.loadProjectControl(repo.path, files, savedSelections?.[repo.path]);
        const model = this.buildProjectControlModel(control);
        const missingFiles = this.getMissingProjectControlFiles(control);
        const summary = this.getProjectSummary(model);
        const dueDates = [...model.goals, ...model.progress, ...model.milestones]
          .map(item => this.parseProjectDate(item.end || item.endDate || item.due || item.deadline || item.date || item.截止日期 || item.截止))
          .filter(Boolean);
        const delayed = [...model.goals, ...model.progress, ...model.milestones].some(item => {
          const status = item.status || item.状态 || '';
          if (this.isDoneStatus(status)) return false;
          const due = this.parseProjectDate(item.end || item.endDate || item.due || item.deadline || item.截止日期 || item.截止);
          return due && due.getTime() < today.getTime();
        });
        const milestones = model.milestones.map(item => {
          const date = this.parseProjectDate(item.date || item.日期 || item.end || item.deadline || item.截止);
          const title = item.title || item.milestone || item.里程碑 || item.name || '未命名里程碑';
          return { repo, title, date, status: item.status || item.状态 || '' };
        }).filter(item => item.date && item.date.getTime() >= today.getTime());
        const progressDates = model.progress
          .map(item => this.parseProjectDate(item.date || item.日期 || item.updated || item.updateDate || item['更新日期'] || item['记录日期']))
          .filter(Boolean)
          .sort((a, b) => b - a);
        const lastProgressDate = progressDates[0] || null;
        const stalled = model.progress.length > 0 &&
          summary.progressDone < summary.progressTotal &&
          (!lastProgressDate || lastProgressDate.getTime() < staleBefore.getTime());
        return {
          repo,
          control,
          summary,
          initialized: missingFiles.length === 0,
          tracked: model.progress.length > 0,
          delayed,
          blocked: summary.blockedCount > 0,
          stalled,
          lastProgressDate,
          dueDates,
          milestones
        };
      } catch (error) {
        return {
          repo,
          error,
          initialized: false,
          tracked: false,
          delayed: false,
          blocked: false,
          stalled: false,
          lastProgressDate: null,
          dueDates: [],
          milestones: []
        };
      }
    }));

    const total = projectStats.length;
    const initializedProjects = projectStats.filter(item => item.initialized);
    const trackedProjects = projectStats.filter(item => item.tracked);
    const delayedProjects = projectStats.filter(item => item.delayed);
    const blockedProjects = projectStats.filter(item => item.blocked);
    const stalledProjects = projectStats.filter(item => item.stalled);
    const missingControlProjects = projectStats.filter(item => !item.initialized);
    const untrackedProjects = projectStats.filter(item => !item.tracked);
    const upcomingMilestones = projectStats
      .flatMap(item => item.milestones)
      .sort((a, b) => a.date - b.date)
      .slice(0, 8);

    return {
      total,
      initialized: initializedProjects.length,
      tracked: trackedProjects.length,
      delayed: delayedProjects.length,
      blocked: blockedProjects.length,
      stalled: stalledProjects.length,
      initializedPercent: this.percent(initializedProjects.length, total),
      trackedPercent: this.percent(trackedProjects.length, total),
      delayedPercent: this.percent(delayedProjects.length, total),
      blockedPercent: this.percent(blockedProjects.length, total),
      stalledPercent: this.percent(stalledProjects.length, total),
      projectStats,
      missingControlProjects,
      untrackedProjects,
      delayedProjects,
      blockedProjects,
      stalledProjects,
      upcomingMilestones
    };
  },

  percent(value, total) {
    if (!total) return 0;
    return Math.round((value / total) * 100);
  },

  getSelectedCategoryLabel() {
    const category = this.activeRepositoryCategory();
    if (category === 'all') return '全部仓库';
    if (category === 'ungrouped') return '未分类仓库';
    const group = (AppState.groups?.groups || []).find(item => item.id === category);
    return group ? `${group.name} 分类` : '全部仓库';
  },

  getDashboardKpiHtml(label, value, subtext, percent, tone = '') {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    return `
      <div class="dashboard-kpi ${tone}">
        <div class="dashboard-kpi-label">${this.escapeHtml(label)}</div>
        <div class="dashboard-kpi-value">${this.escapeHtml(value)}</div>
        <div class="dashboard-kpi-subtext">${this.escapeHtml(subtext)}</div>
        <div class="dashboard-bar"><span style="width:${safePercent}%"></span></div>
      </div>
    `;
  },

  getDashboardHealthRow(label, value, total) {
    const percent = this.percent(value, total);
    return `
      <div class="dashboard-health-row">
        <span>${this.escapeHtml(label)}</span>
        <strong>${value}</strong>
        <div class="dashboard-bar"><span style="width:${percent}%"></span></div>
      </div>
    `;
  },

  getDashboardMilestonesHtml(items) {
    if (!items.length) return '<div class="dashboard-empty">暂无未来里程碑</div>';
    return `
      <div class="dashboard-list">
        ${items.map(item => `
          <div class="dashboard-list-item">
            <span class="dashboard-list-date">${this.escapeHtml(this.formatDateShort(item.date))}</span>
            <span class="dashboard-list-main">${this.escapeHtml(item.title)}</span>
            <span class="dashboard-list-sub">${this.escapeHtml(item.repo.name)}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  getDashboardAttentionHtml(stats) {
    const items = [
      ...stats.delayedProjects.map(item => ({ type: '延期', repo: item.repo, detail: '存在已过截止日期的未完成事项' })),
      ...stats.blockedProjects.map(item => ({ type: '阻塞', repo: item.repo, detail: '进度记录中包含阻塞项' })),
      ...stats.stalledProjects.map(item => ({ type: '停滞', repo: item.repo, detail: item.lastProgressDate ? `上次进度：${this.formatDateShort(item.lastProgressDate)}` : '没有可识别的进度日期' })),
      ...stats.missingControlProjects.slice(0, 8).map(item => ({ type: '未初始化', repo: item.repo, detail: '缺少目标、进度或里程碑控制文件' })),
      ...stats.untrackedProjects.slice(0, 8).map(item => ({ type: '未追踪', repo: item.repo, detail: '暂无进度记录' }))
    ];
    if (!items.length) return '<div class="dashboard-empty">暂无需要关注的项目</div>';
    return `
      <div class="dashboard-attention-list">
        ${items.slice(0, 16).map(item => `
          <div class="dashboard-attention-item" data-path="${this.escapeHtml(item.repo.path)}">
            <span class="dashboard-attention-type">${this.escapeHtml(item.type)}</span>
            <span class="dashboard-attention-name">${this.escapeHtml(item.repo.name)}</span>
            <span class="dashboard-attention-detail">${this.escapeHtml(item.detail)}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  bindDashboardEvents(container) {
    container.querySelectorAll('.dashboard-attention-item[data-path]').forEach(item => {
      item.addEventListener('click', () => this.selectRepo(item.dataset.path));
    });
    container.querySelector('#dashboard-init-missing-btn')?.addEventListener('click', () => this.initializeDashboardMissingControlFiles(container));
  },

  async initializeDashboardMissingControlFiles(container) {
    const stats = AppState.dashboardStats;
    const targets = stats?.missingControlProjects || [];
    if (!targets.length) return;
    if (!confirm(`将为 ${targets.length} 个项目补齐缺失的控制文件。\n已有控制文件不会被覆盖。是否继续？`)) return;

    const button = container.querySelector('#dashboard-init-missing-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '初始化中...';
    }

    let createdCount = 0;
    let failedCount = 0;
    for (const item of targets) {
      try {
        const created = await this.initializeProjectControlFiles(item.repo.path, item.control);
        createdCount += created.length;
      } catch (error) {
        failedCount += 1;
      }
    }

    await this.renderDashboardContent(this._prepareDisplayRepos(), document.getElementById('content-area'));
    this._showStatusMessage(`已创建 ${createdCount} 个控制文件${failedCount ? `，${failedCount} 个项目失败` : ''}`);
  },

  getProjectCardShell(repo) {
    const status = repo.gitStatus || {};
    const overallStatus = status.overallStatus || 'clean';
    const branch = status.branch || '';
    const path = this.escapeHtml(repo.path);
    return `
      <div class="project-card status-${overallStatus}" data-path="${path}">
        <div class="project-card-head">
          <div class="project-card-title">
            <span class="status-indicator status-${overallStatus}"></span>
            <span>${this.escapeHtml(repo.name)}</span>
          </div>
          <span class="project-branch">${this.escapeHtml(branch || 'main')}</span>
        </div>
        <div class="project-card-path" title="${path}">${path}</div>
        <div class="project-card-loading">
          <div class="loading-spinner small"></div>
          <span>读取项目控制文件...</span>
        </div>
      </div>
    `;
  },

  bindProjectCardEvents(container) {
    container.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (event) => {
        const initButton = event.target.closest('.project-control-init-btn');
        if (initButton) {
          event.stopPropagation();
          this.initializeProjectCardControlFiles(card.dataset.path);
          return;
        }
        this.selectRepo(card.dataset.path);
      });
    });
  },

  async loadProjectCards(repos) {
    const savedSelections = await window.gitFinder.config.get('projectControlSelections');
    await Promise.all(repos.map(async repo => {
      const card = document.querySelector(`.project-card[data-path="${this.cssEscape(repo.path)}"]`);
      if (!card) return;
      try {
        const files = await window.gitFinder.fs.listProjectControlFiles(repo.path);
        const control = await this.loadProjectControl(repo.path, files, savedSelections?.[repo.path]);
        card.innerHTML = this.getProjectCardContent(repo, control);
      } catch (error) {
        card.classList.add('unavailable');
        card.innerHTML = this.getProjectCardUnavailableContent(repo, error);
      }
    }));
  },

  getProjectCardUnavailableContent(repo, error) {
    const message = this.isMissingProjectPathError(error)
      ? '项目目录不存在，可能已移动或删除'
      : '控制文件暂时无法读取';
    return `
      <div class="project-card-head">
        <div class="project-card-title">
          <span class="status-indicator status-none"></span>
          <span>${this.escapeHtml(repo.name)}</span>
        </div>
        <span class="project-branch">${this.escapeHtml(repo.gitStatus?.branch || 'main')}</span>
      </div>
      <div class="project-card-path" title="${this.escapeHtml(repo.path)}">${this.escapeHtml(repo.path)}</div>
      <div class="project-card-unavailable">
        <div class="project-mini-label">状态</div>
        <div>${this.escapeHtml(message)}</div>
      </div>
    `;
  },

  isMissingProjectPathError(error) {
    const message = String(error?.message || error || '');
    return /项目目录不存在|no such file|ENOENT|not found/i.test(message);
  },

  getProjectCardContent(repo, control) {
    const model = this.buildProjectControlModel(control);
    const summary = this.getProjectSummary(model);
    const missingFiles = this.getMissingProjectControlFiles(control).length;
    return `
      <div class="project-card-head">
        <div class="project-card-title">
          <span class="status-indicator status-${repo.gitStatus?.overallStatus || 'clean'}"></span>
          <span>${this.escapeHtml(repo.name)}</span>
        </div>
        <span class="project-branch">${this.escapeHtml(repo.gitStatus?.branch || 'main')}</span>
      </div>
      <div class="project-card-path" title="${this.escapeHtml(repo.path)}">${this.escapeHtml(repo.path)}</div>
      <div class="project-goal-box">
        <div class="project-mini-label">目标</div>
        <div class="project-goal-text">${this.escapeHtml(summary.goalText)}</div>
      </div>
      <div class="project-stat-row">
        <div class="project-stat"><span>${summary.progressDone}/${summary.progressTotal}</span><em>进度</em></div>
        <div class="project-stat"><span>${summary.milestoneDone}/${summary.milestoneTotal}</span><em>里程碑</em></div>
        <div class="project-stat ${summary.blockedCount > 0 ? 'warn' : ''}"><span>${summary.blockedCount}</span><em>阻塞</em></div>
      </div>
      ${this.renderProjectGantt(model)}
      <div class="project-card-files">
        <span>${this.escapeHtml(control.selections.goalsFile)}</span>
        <span>${this.escapeHtml(control.selections.progressFile)}</span>
        <span>${this.escapeHtml(control.selections.milestoneFile)}</span>
      </div>
      ${missingFiles > 0 ? `
        <button class="project-control-init-btn" type="button">初始化控制文件</button>
      ` : ''}
    `;
  },

  buildProjectControlModel(control) {
    return {
      goals: this.parseProjectRows(control?.goals),
      progress: this.parseProjectRows(control?.progress),
      milestones: this.parseProjectRows(control?.milestone)
    };
  },

  getProjectSummary(model) {
    const goal = model.goals[0] || {};
    const goalText = goal.title || goal.objective || goal.goal || goal.name || goal.description || '未填写项目目标';
    const progressTotal = model.progress.length;
    const progressDone = model.progress.filter(item => this.isDoneStatus(item.status)).length;
    const milestoneTotal = model.milestones.length;
    const milestoneDone = model.milestones.filter(item => this.isDoneStatus(item.status)).length;
    const blockedCount = model.progress.filter(item => /阻塞|blocked|block/i.test(item.status || item.blocker || item.blockers || '')).length;
    return { goalText, progressTotal, progressDone, milestoneTotal, milestoneDone, blockedCount };
  },

  renderProjectGantt(model) {
    const rows = [...model.progress, ...model.milestones].map((item, index) => {
      const start = this.parseProjectDate(item.start || item.startDate || item.date || item.日期 || item['开始']);
      const end = this.parseProjectDate(item.end || item.endDate || item.due || item.deadline || item.date || item.日期 || item['结束'] || item['截止']);
      const title = item.title || item.phase || item.stage || item.milestone || item.name || item.阶段 || item.里程碑 || `节点 ${index + 1}`;
      return { ...item, start, end, title };
    }).filter(item => item.start || item.end).slice(0, 8);

    if (!rows.length) {
      return '<div class="project-gantt-empty">暂无可绘制的日期节点</div>';
    }

    const times = rows.flatMap(item => [item.start, item.end]).filter(Boolean).map(date => date.getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const span = Math.max(max - min, 86400000);
    const today = Date.now();
    const todayLeft = today >= min && today <= max ? ((today - min) / span) * 100 : null;

    return `
      <div class="project-gantt">
        <div class="project-gantt-scale">
          <span>${this.formatDateShort(new Date(min))}</span>
          <span>${this.formatDateShort(new Date(max))}</span>
        </div>
        <div class="project-gantt-track">
          ${todayLeft === null ? '' : `<span class="project-gantt-today" style="left:${todayLeft}%"></span>`}
          ${rows.map(item => {
            const start = (item.start || item.end).getTime();
            const end = (item.end || item.start).getTime();
            const left = Math.max(0, ((Math.min(start, end) - min) / span) * 100);
            const width = Math.max(3, (Math.abs(end - start) / span) * 100);
            const done = this.isDoneStatus(item.status);
            return `
              <div class="project-gantt-row">
                <span class="project-gantt-label" title="${this.escapeHtml(item.title)}">${this.escapeHtml(item.title)}</span>
                <span class="project-gantt-line">
                  <span class="project-gantt-bar ${done ? 'done' : ''}" style="left:${left}%;width:${width}%"></span>
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
  },

  // 按选中分类过滤仓库
  _filterByCategory(repos) {
    const category = this.activeRepositoryCategory();
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

  async _enrichReposAsync(forceRefresh = false) {
    if (this._repoEnrichmentPromise && !forceRefresh) return this._repoEnrichmentPromise;
    const run = this._runRepoEnrichment(forceRefresh);
    this._repoEnrichmentPromise = run;
    try {
      return await run;
    } finally {
      if (this._repoEnrichmentPromise === run) this._repoEnrichmentPromise = null;
    }
  },

  async _runRepoEnrichment(forceRefresh = false) {
    const previousRequestId = AppState.repoEnrichmentRequestId;
    if (previousRequestId && !AppState.repoEnrichmentProgress?.done) {
      await window.gitFinder.git.cancelBatchStatus(previousRequestId).catch(() => null);
    }

    const requestId = `git-status-${Date.now().toString(36)}-${(this._repoEnrichmentSequence = (this._repoEnrichmentSequence || 0) + 1)}`;
    const state = window.RepoStatusBatch.createState(AppState.allRepos, requestId, AppState.enrichedRepos);
    for (const repo of AppState.allRepos) {
      window.RepoStatusBatch.applyMetadata(state, requestId, repo.path, { groups: this._findRepoGroups(repo.path) });
    }
    this._repoEnrichmentState = state;
    AppState.repoEnrichmentRequestId = requestId;
    AppState.repoEnrichmentProgress = state.progress;
    AppState.repoEnrichmentCancelling = false;
    AppState.repoEnrichmentComplete = false;
    AppState.enrichedRepos = state.items;
    this.renderRepoStatusWork(state.progress, requestId);

    const repoPaths = AppState.allRepos.map(repo => repo.path);
    const statusPromise = window.gitFinder.git.batchStatus(repoPaths, {
      requestId,
      concurrency: 6,
      autoFetch: false,
      forceRefresh,
      includeSummary: true
    });

    let nextMetadataIndex = 0;
    const metadataWorker = async () => {
      while (
        nextMetadataIndex < AppState.allRepos.length &&
        AppState.repoEnrichmentRequestId === requestId &&
        !AppState.repoEnrichmentCancelling
      ) {
        const repo = AppState.allRepos[nextMetadataIndex++];
        const [tags, readme] = await Promise.all([
          window.gitFinder.tags.getRepoTags(repo.path).catch(() => []),
          window.gitFinder.fs.getReadmePreview(repo.path).catch(() => null)
        ]);
        if (AppState.repoEnrichmentRequestId !== requestId || AppState.repoEnrichmentCancelling) return;
        const groups = this._findRepoGroups(repo.path);
        if (!window.RepoStatusBatch.applyMetadata(state, requestId, repo.path, { tags, readme, groups })) continue;
        const item = state.items[state.indexByPath.get(repo.path)];
        this._updateRepoCard(repo.path, item.gitStatus, item.tags, item.readme, item.groups);
      }
    };
    const metadataPromise = Promise.all(Array.from(
      { length: Math.min(6, AppState.allRepos.length) },
      () => metadataWorker()
    ));

    const [statusOutcome] = await Promise.allSettled([statusPromise, metadataPromise]);
    if (AppState.repoEnrichmentRequestId !== requestId) return null;

    if (statusOutcome.status === 'rejected') {
      AppState.repoEnrichmentComplete = false;
      AppState.repoEnrichmentProgress = { ...state.progress, done: true };
      this.hideRepoStatusWork(requestId);
      this._showStatusMessage(`Git 状态读取失败：${statusOutcome.reason?.message || statusOutcome.reason}`, 'error');
      return null;
    }

    const summary = statusOutcome.value;
    window.RepoStatusBatch.applyResults(state, requestId, summary.results);
    state.progress = {
      completed: summary.completed,
      total: summary.total,
      running: 0,
      cancelled: summary.cancelled,
      done: true
    };
    AppState.repoEnrichmentProgress = state.progress;
    AppState.repoEnrichmentCancelling = false;
    AppState.repoEnrichmentComplete = !summary.cancelled && summary.completed === summary.total;
    AppState.enrichedRepos = state.items;
    this.renderRepoStatusWork(state.progress, requestId);

    if (this.contentCollectionKind() === 'repositories') {
      const hasFilter = window.ContentQuery.normalize(AppState.contentQuery).gitStatuses.length > 0 ||
                        (AppState.filterEnabled.tag && AppState.selectedTags.length > 0) ||
                        (AppState.searchScope === 'current' && AppState.searchQuery && (AppState.filterEnabled.name || AppState.filterEnabled.readme));
      const statusSensitiveSort = ['status', 'branch'].includes(AppState.sortBy);
      if (hasFilter || statusSensitiveSort) {
        const contentArea = document.getElementById('content-area');
        if (contentArea) this._renderGridContent(this._prepareDisplayRepos(), contentArea);
      }
    }
    this.updateStatusBar();
    return summary;
  },

  handleRepoStatusBatchProgress(progress) {
    const state = this._repoEnrichmentState;
    if (!state || progress?.requestId !== AppState.repoEnrichmentRequestId) return;
    if (!window.RepoStatusBatch.applyProgress(state, progress)) return;
    AppState.repoEnrichmentProgress = {
      ...state.progress,
      cancelling: AppState.repoEnrichmentCancelling || (state.progress.cancelled && !state.progress.done)
    };
    if (progress.latest?.path) {
      const index = state.indexByPath.get(progress.latest.path);
      const item = index === undefined ? null : state.items[index];
      if (item) this._updateRepoCard(item.path, item.gitStatus, item.tags, item.readme, item.groups);
    }
    this.renderRepoStatusWork(AppState.repoEnrichmentProgress, progress.requestId);
  },

  async cancelRepoStatusBatch() {
    const requestId = AppState.repoEnrichmentRequestId;
    if (!requestId || AppState.repoEnrichmentProgress?.done || AppState.repoEnrichmentCancelling) return;
    AppState.repoEnrichmentCancelling = true;
    AppState.repoEnrichmentProgress = { ...AppState.repoEnrichmentProgress, cancelling: true };
    this.renderRepoStatusWork(AppState.repoEnrichmentProgress, requestId);
    await window.gitFinder.git.cancelBatchStatus(requestId).catch(error => {
      AppState.repoEnrichmentCancelling = false;
      this._showStatusMessage(`取消失败：${error.message || error}`, 'error');
    });
  },

  renderRepoStatusWork(progress, requestId) {
    const container = document.getElementById('repo-status-work');
    const text = document.getElementById('repo-status-work-text');
    const cancel = document.getElementById('repo-status-cancel');
    if (!container || !text || !cancel || !progress) return;
    if (this._repoStatusHideTimer) clearTimeout(this._repoStatusHideTimer);
    container.hidden = false;
    container.dataset.requestId = requestId;
    container.className = `status-work${progress.done ? ' done' : ''}${progress.cancelled && progress.done ? ' cancelled' : ''}`;
    text.textContent = window.RepoStatusBatch.formatProgress(progress);
    cancel.hidden = progress.done === true;
    cancel.disabled = progress.cancelling === true;
    if (progress.done) {
      this._repoStatusHideTimer = setTimeout(() => {
        if (container.dataset.requestId === requestId) container.hidden = true;
      }, progress.cancelled ? 2600 : 1600);
    }
  },

  hideRepoStatusWork(requestId) {
    const container = document.getElementById('repo-status-work');
    if (container?.dataset.requestId === requestId) container.hidden = true;
  },

  _updateRepoCard(path, status, tags, readme, groups) {
    const card = document.querySelector(`[data-path="${this.cssEscape(path)}"]`);
    if (!card) return;

    const overallStatus = status.overallStatus || 'clean';
    card.className = card.className.replace(/status-\w+/g, '') + ` status-${overallStatus}`;

    const statusIndicator = card.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.className = `status-indicator status-${overallStatus}`;
    }

    const branchBadge = card.querySelector('.repo-branch-badge');
    if (branchBadge) {
      const indicator = document.createElement('span');
      indicator.className = `status-indicator status-${overallStatus}`;
      branchBadge.replaceChildren(indicator, document.createTextNode(status.branch || 'main'));
    }

    if (readme && readme.description) {
      const readmeEl = card.querySelector('.repo-readme');
      if (readmeEl) readmeEl.textContent = readme.description;
    }

    this._updateRepoCardGroups(card, groups || []);
  },

  _updateRepoCardGroups(card, groups) {
    const listGroups = card.querySelector('.list-repo-groups');
    if (listGroups) listGroups.remove();
    if (card.classList.contains('repo-list-item')) {
      if (!groups.length) return;
      const groupEl = document.createElement('span');
      groupEl.className = 'list-repo-groups';
      groupEl.innerHTML = groups.map(g => `<span class="group-dot" style="background:${this.safeColor(g.color)}" title="${this.escapeHtml(g.name)}"></span>`).join('');
      card.appendChild(groupEl);
      return;
    }

    const existing = card.querySelector('.repo-meta');
    if (existing) existing.remove();
    if (!groups.length) return;

    const readmeEl = card.querySelector('.repo-readme');
    if (!readmeEl) return;
    const meta = document.createElement('div');
    meta.className = 'repo-meta';
    meta.innerHTML = `
      <div class="repo-meta-row">
        <span class="repo-meta-label">组:</span>
        ${groups.map(g => {
          const color = this.safeColor(g.color);
          return `<span class="repo-meta-chip" style="background:${color}20;color:${color};border:1px solid ${color}40;">📁 ${this.escapeHtml(g.name)}</span>`;
        }).join('')}
      </div>
    `;
    readmeEl.before(meta);
  },

  _syncRepoGroupsInState(repoPath, groups) {
    const update = (repo) => repo.path === repoPath ? { ...repo, groups } : repo;
    AppState.allRepos = AppState.allRepos.map(update);
    AppState.enrichedRepos = AppState.enrichedRepos.map(update);
    if (AppState.selectedRepo?.path === repoPath) {
      AppState.selectedRepo.groups = groups;
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
    // 有搜索词就执行过滤:未勾选任何搜索维度时结果为空(无维度可匹配)
    if (AppState.searchScope === 'current' && AppState.searchQuery) {
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

    // 全部仓库将 Git 状态保存在当前标签页 contentQuery；仪表盘仍使用自己的临时筛选。
    const repositoryCollection = this.contentCollectionKind() === 'repositories';
    if (repositoryCollection) {
      const repositoryQuery = window.ContentQuery.normalize({
        ...AppState.contentQuery,
        repositoryCategory: 'all'
      });
      filtered = filtered.filter(repo => window.ContentQuery.matchesAttributes({
        ...repo,
        type: 'directory',
        isGitRepo: true
      }, repositoryQuery));
    }
    const selected = repositoryCollection
      ? []
      : (AppState.filterEnabled.status ? AppState.selectedStatuses : []);
    if (selected.length > 0) {
      const hasNoRemote = selected.includes('no-remote');
      const otherStatuses = selected.filter(s => s !== 'no-remote');
      filtered = filtered.filter(r => {
        const overall = (r.gitStatus && r.gitStatus.overallStatus) || 'clean';
        // 先检查 no-remote(如果选了),必须是未添加远程
        if (hasNoRemote) {
          const hasRemote = !!(r.gitStatus && r.gitStatus.hasRemote);
          if (hasRemote) return false;
        }
        // 再检查其他状态(OR)
        if (otherStatuses.length > 0) {
          return otherStatuses.includes(overall);
        }
        // 只选了 no-remote
        return true;
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

  async renderCardView(items, container, context = null) {
    const dirs = items.filter(i => i.type === 'directory');
    const files = items.filter(i => i.type === 'file');

    const sortedDirs = this.sortRepos(dirs);
    const sortedFiles = this.sortRepos(files);
    const orderedItems = [...sortedDirs, ...sortedFiles];
    AppState.fileDisplayOrder = orderedItems.map(item => item.path);

    if (!context) {
      container.innerHTML = this.getCardsHtml(orderedItems);
      this.bindCardEvents(container);
      return;
    }

    let html = '';

    if (sortedDirs.length > 0) {
      html += `<div class="section-divider"><span>文件夹 (${sortedDirs.length})</span></div>`;
      html += '<div class="repo-grid" data-progressive-directory-target="directories" role="listbox" aria-label="文件夹" aria-multiselectable="true"></div>';
    }

    if (sortedFiles.length > 0) {
      html += `<div style="height:16px;"></div>`;
      html += `<div class="section-divider"><span>文件 (${sortedFiles.length})</span></div>`;
      html += '<div class="repo-grid" data-progressive-directory-target="files" role="listbox" aria-label="文件" aria-multiselectable="true"></div>';
    }

    if (items.length === 0) {
      html = '<div style="text-align:center;padding:60px;color:#86868b;">此目录为空</div>';
    }

    container.innerHTML = html;
    if (window.VirtualDirectoryWindow.canVirtualizeCardItems(orderedItems)) {
      container.innerHTML = `
        <div class="section-divider"><span>目录项目 (${orderedItems.length})</span></div>
        <div class="virtual-directory-card-viewport">
          <div class="repo-grid virtual-directory-card-window" data-virtual-directory-window role="listbox" aria-label="目录项目，虚拟显示，共 ${orderedItems.length} 项" aria-multiselectable="true"></div>
        </div>`;
      const scrollElement = document.getElementById('content-scroll');
      const viewportElement = container.querySelector('.virtual-directory-card-viewport');
      const windowElement = container.querySelector('[data-virtual-directory-window]');
      const itemsPerRowProvider = () => {
        const columns = window.VirtualDirectoryWindow.gridColumnCount(
          viewportElement.clientWidth || scrollElement.clientWidth
        );
        windowElement.style.setProperty('--virtual-card-columns', String(columns));
        return columns;
      };
      this.directoryVirtualizer = new window.VirtualDirectoryWindow.Controller({
        total: orderedItems.length,
        scrollElement,
        viewportElement,
        windowElement,
        rowHeight: window.VirtualDirectoryWindow.DEFAULT_CARD_ROW_HEIGHT,
        overscan: 2,
        itemsPerRowProvider,
        renderRange: range => {
          const focusedPath = document.activeElement?.closest?.('#content-area .repo-card')?.dataset.path || '';
          windowElement.replaceChildren();
          const elements = this.appendDirectoryItemElements(
            windowElement,
            orderedItems.slice(range.start, range.end),
            item => this.getCardHtml(item)
          );
          elements.forEach((element, offset) => {
            element.setAttribute('aria-posinset', String(range.start + offset + 1));
            element.setAttribute('aria-setsize', String(orderedItems.length));
          });
          if (focusedPath) {
            elements.find(element => element.dataset.path === focusedPath)?.focus({ preventScroll: true });
          }
        }
      });
      this.directoryVirtualizer.mount();
      this.directoryPerformanceController.markFirstDom(context, container);
      return;
    }
    const directoryTarget = container.querySelector('[data-progressive-directory-target="directories"]');
    const fileTarget = container.querySelector('[data-progressive-directory-target="files"]');
    await this.renderDirectoryItemsProgressively(orderedItems, container, context, batch => {
      this.appendDirectoryItemElements(
        directoryTarget,
        batch.filter(item => item.type === 'directory'),
        item => this.getCardHtml(item)
      );
      this.appendDirectoryItemElements(
        fileTarget,
        batch.filter(item => item.type === 'file'),
        item => this.getCardHtml(item)
      );
    });
  },

  getCardsHtml(items, label = '目录项目') {
    return `<div class="repo-grid" role="listbox" aria-label="${this.escapeHtml(label)}" aria-multiselectable="true">${items.map(item => this.getCardHtml(item)).join('')}</div>`;
  },

  getProjectColor(item) {
    return window.FileBrowser.projectColor(item, AppState.semanticColorProfile?.colors?.project);
  },

  getProjectSemanticStyle(item) {
    const color = this.getProjectColor(item);
    return color ? ` style="--project-folder-color:${color}"` : '';
  },

  getProjectLifecycleBadgeHtml(item, label = window.FileBrowser.projectLifecycleLabel(item)) {
    if (!label) return '';
    const lifecycle = window.FileBrowser.projectLifecycleKey(item);
    return `<span class="project-lifecycle-badge" data-lifecycle="${this.escapeHtml(lifecycle)}">${this.escapeHtml(label)}</span>`;
  },

  getItemKindIconHtml(item, className = '') {
    const kind = window.FileBrowser.itemVisualKind(item);
    const safeClassName = String(className || '').replace(/[^a-zA-Z0-9_-]/g, '');
    let glyph = '';

    if (kind === 'directory' || kind === 'project') {
      glyph = '<svg viewBox="0 0 24 20" focusable="false"><path d="M2.25 4.25c0-1.1.9-2 2-2h4.2c.6 0 1.17.27 1.55.74l1.23 1.51h8.52c1.1 0 2 .9 2 2v9.25c0 1.1-.9 2-2 2H4.25c-1.1 0-2-.9-2-2V4.25Z"/></svg>';
    } else if (kind === 'symlink') {
      glyph = '<svg viewBox="0 0 24 24" focusable="false"><path d="M9.5 14.5 14.5 9"/><path d="M7.1 16.9 5.7 18.3a3.54 3.54 0 0 1-5-5l3.6-3.6a3.54 3.54 0 0 1 5 0"/><path d="m16.9 7.1 1.4-1.4a3.54 3.54 0 0 1 5 5l-3.6 3.6a3.54 3.54 0 0 1-5 0"/></svg>';
    } else {
      glyph = '<svg viewBox="0 0 20 22" focusable="false"><path d="M4 1.75h7l5 5v13.5H4V1.75Z"/><path d="M11 1.75v5h5"/></svg>';
    }

    const repositoryBadge = item?.isGitRepo === true
      ? `<span class="file-kind-git-badge">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="M3 2.2v5.2c0 1.4 1.1 2.5 2.5 2.5h2.2M3 4.6h1.8c1.4 0 2.5-1.1 2.5-2.5"/>
            <circle cx="3" cy="2.1" r="1"/><circle cx="7.4" cy="2.1" r="1"/><circle cx="8.7" cy="9.9" r="1"/>
          </svg>
        </span>`
      : '';

    const projectColor = this.getProjectColor(item);
    const projectStyle = projectColor ? ` style="--project-folder-color:${projectColor}"` : '';
    return `<span class="${safeClassName} file-kind-icon file-kind-${kind}"${projectStyle} aria-hidden="true">${glyph}${repositoryBadge}</span>`;
  },

  getCardHtml(item) {
    const status = item.gitStatus || {};
    const rawStatus = status.overallStatus || (item.isGitRepo ? 'clean' : 'none');
    const overallStatus = ['clean', 'dirty', 'ahead', 'behind', 'none'].includes(rawStatus) ? rawStatus : 'none';
    const readme = item.readme || {};
    const tags = item.tags || [];
    const groups = item.groups || [];
    const itemPath = this.escapeHtml(item.path);
    const projectStyle = this.getProjectSemanticStyle(item);
    const projectLifecycle = window.FileBrowser.projectLifecycleLabel(item);
    const focused = item.path === AppState.fileKeyboardFocusPath;

    return `
      <div class="repo-card status-${overallStatus} ${item.isHidden ? 'is-hidden' : ''}"${projectStyle} data-path="${itemPath}" data-type="${this.escapeHtml(item.type)}" data-is-git="${item.isGitRepo === true}" data-is-project="${item.isProject === true}" role="option" aria-selected="false" aria-label="${this.escapeHtml(this.getFileItemAriaLabel(item))}" tabindex="${focused ? '0' : '-1'}">
        <div class="repo-card-header">
          <div class="repo-name">
            ${this.getItemKindIconHtml(item, 'repo-icon')}
            ${this.escapeHtml(item.name)}
          </div>
          ${item.isGitRepo ? `<div class="repo-branch-badge">
            <span class="status-indicator status-${overallStatus}"></span>
            ${this.escapeHtml(status.branch || 'main')}
          </div>` : ''}
        </div>
        <div class="repo-path">${itemPath}</div>
        ${projectLifecycle ? `<div>${this.getProjectLifecycleBadgeHtml(item, projectLifecycle)}</div>` : ''}
        ${this.getFileLabelDotsHtml(item, { named: true })}
        ${tags.length > 0 ? `
          <div class="repo-tags">
            ${tags.map(t => {
              const color = this.safeColor(t.color);
              return `<span class="repo-tag" style="background:${color}20;color:${color};border:1px solid ${color}40;">${this.escapeHtml(t.name)}</span>`;
            }).join('')}
          </div>
        ` : ''}
        ${groups.length > 0 ? `
          <div class="repo-meta">
            <div class="repo-meta-row">
              <span class="repo-meta-label">组:</span>
              ${groups.map(g => {
                const color = this.safeColor(g.color);
                return `<span class="repo-meta-chip" style="background:${color}20;color:${color};border:1px solid ${color}40;">📁 ${this.escapeHtml(g.name)}</span>`;
              }).join('')}
            </div>
          </div>
        ` : ''}
        <div class="repo-readme">
          ${this.escapeHtml(readme.description || (item.isGitRepo ? '暂无描述' : this.getFileItemSummary(item)))}
        </div>
        ${item.isGitRepo && status.lastCommit ? `
          <div class="repo-last-commit">
            <span class="commit-hash">${this.escapeHtml(status.lastCommit.hash)}</span>
            <span class="commit-message">${this.escapeHtml(status.lastCommit.message)}</span>
          </div>
        ` : ''}
      </div>
    `;
  },

  async renderListView(items, container, context = null) {
    const directories = this.sortRepos(items.filter(item => item.type === 'directory'));
    const files = this.sortRepos(items.filter(item => item.type === 'file'));
    const orderedItems = [...directories, ...files];
    AppState.fileDisplayOrder = orderedItems.map(item => item.path);
    if (!context) {
      container.innerHTML = this._getListHtml(orderedItems);
      this.bindCardEvents(container);
      return;
    }
    if (window.VirtualDirectoryWindow.shouldVirtualize(orderedItems.length)) {
      container.innerHTML = `<div class="repo-list virtual-directory-list" role="listbox" aria-label="目录项目，虚拟显示，共 ${orderedItems.length} 项" aria-multiselectable="true">
        <div class="repo-list-header" aria-hidden="true">
          <span></span><span></span><span>名称</span><span>类型</span><span>修改时间</span><span>大小</span><span>Git 状态</span>
        </div>
        <div class="virtual-directory-viewport">
          <div class="virtual-directory-window" data-virtual-directory-window></div>
        </div>
      </div>`;
      const scrollElement = document.getElementById('content-scroll');
      const viewportElement = container.querySelector('.virtual-directory-viewport');
      const windowElement = container.querySelector('[data-virtual-directory-window]');
      this.directoryVirtualizer = new window.VirtualDirectoryWindow.Controller({
        total: orderedItems.length,
        scrollElement,
        viewportElement,
        windowElement,
        renderRange: range => {
          const focusedPath = document.activeElement?.closest?.('#content-area .repo-list-item')?.dataset.path || '';
          windowElement.replaceChildren();
          const elements = this.appendDirectoryItemElements(
            windowElement,
            orderedItems.slice(range.start, range.end),
            item => this._getListItemHtml(item)
          );
          elements.forEach((element, offset) => {
            element.setAttribute('aria-posinset', String(range.start + offset + 1));
            element.setAttribute('aria-setsize', String(orderedItems.length));
          });
          if (focusedPath) {
            elements.find(element => element.dataset.path === focusedPath)?.focus({ preventScroll: true });
          }
        }
      });
      this.directoryVirtualizer.mount();
      this.directoryPerformanceController.markFirstDom(context, container);
      return;
    }
    container.innerHTML = `<div class="repo-list" data-progressive-directory-target="list" role="listbox" aria-label="目录项目" aria-multiselectable="true">
      <div class="repo-list-header" aria-hidden="true">
        <span></span><span></span><span>名称</span><span>类型</span><span>修改时间</span><span>大小</span><span>Git 状态</span>
      </div>
    </div>`;
    const target = container.querySelector('[data-progressive-directory-target="list"]');
    await this.renderDirectoryItemsProgressively(orderedItems, container, context, batch => {
      this.appendDirectoryItemElements(target, batch, item => this._getListItemHtml(item));
    });
  },

  updateRenderedColumnWidth(browser, width) {
    const normalized = window.DirectoryViewPreferences.normalizeColumnWidth(width);
    browser.style.setProperty('--finder-column-width', `${normalized}px`);
    browser.querySelectorAll('.finder-column-resizer').forEach(handle => {
      handle.setAttribute('aria-valuenow', String(normalized));
      handle.setAttribute('aria-valuetext', `${normalized} 像素`);
    });
    return normalized;
  },

  commitColumnViewWidth(width) {
    AppState.columnViewWidth = window.DirectoryViewPreferences.normalizeColumnWidth(width);
    this.persistCurrentDirectoryViewPreference();
    return AppState.columnViewWidth;
  },

  bindColumnViewSizing(browser) {
    const handles = browser.querySelectorAll('.finder-column-resizer');
    for (const handle of handles) {
      let drag = null;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: AppState.columnViewWidth
        };
        handle.setPointerCapture?.(event.pointerId);
        browser.classList.add('is-resizing');
      });
      handle.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        this.updateRenderedColumnWidth(browser, window.DirectoryViewPreferences.columnWidthFromDrag(
          drag.startWidth,
          drag.startX,
          event.clientX
        ));
      });
      const finishDrag = (event, cancelled = false) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const width = cancelled
          ? drag.startWidth
          : window.DirectoryViewPreferences.columnWidthFromDrag(drag.startWidth, drag.startX, event.clientX);
        this.updateRenderedColumnWidth(browser, width);
        if (!cancelled) this.commitColumnViewWidth(width);
        drag = null;
        browser.classList.remove('is-resizing');
      };
      handle.addEventListener('pointerup', event => finishDrag(event));
      handle.addEventListener('pointercancel', event => finishDrag(event, true));
      handle.addEventListener('click', event => event.stopPropagation());
      handle.addEventListener('keydown', event => {
        const width = window.DirectoryViewPreferences.columnWidthFromKey(
          AppState.columnViewWidth,
          event.key,
          { shiftKey: event.shiftKey }
        );
        if (width === null) return;
        event.preventDefault();
        this.updateRenderedColumnWidth(browser, width);
        this.commitColumnViewWidth(width);
      });
      handle.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        const width = window.DirectoryViewPreferences.DEFAULT_COLUMN_WIDTH;
        this.updateRenderedColumnWidth(browser, width);
        this.commitColumnViewWidth(width);
      });
    }
  },

  async renderColumnView(items, container, context) {
    const columnPaths = window.FileBrowser.columnDirectoryPaths(
      this._treeRoots || [],
      AppState.currentPath,
      window.gitFinder.platform,
      6
    );
    const columns = await Promise.all(columnPaths.map(async (directoryPath, index) => {
      const current = index === columnPaths.length - 1;
      const source = current
        ? items
        : await window.gitFinder.fs.listDirectory(directoryPath, {
            showHidden: AppState.showHiddenFiles,
            recursive: false
          }).catch(() => []);
      const directories = this.sortRepos(source.filter(item => item.type === 'directory'));
      const files = this.sortRepos(source.filter(item => item.type === 'file'));
      return {
        path: directoryPath,
        current,
        trailPath: columnPaths[index + 1] || '',
        items: [...directories, ...files]
      };
    }));
    if (!this.isDirectoryRenderContextCurrent(context)) return;
    const currentItems = columns.find(column => column.current)?.items || [];
    AppState.fileDisplayOrder = currentItems.map(item => item.path);

    container.innerHTML = `
      <div class="finder-column-browser" role="group" aria-label="分栏目录浏览" style="--finder-column-width:${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)}px">
        ${columns.map(column => `
          <section class="finder-column ${column.current ? 'finder-column-current' : 'finder-column-ancestor'}" data-column-path="${this.escapeHtml(column.path)}">
            <header class="finder-column-header" title="${this.escapeHtml(column.path)}">${this.escapeHtml(column.path.split(/[\\/]/).filter(Boolean).at(-1) || column.path)}</header>
            <div class="finder-column-list"${column.current ? ' data-progressive-directory-target="column"' : ''} role="listbox" aria-label="${this.escapeHtml(column.path)}">
              ${column.current
                ? ''
                : (column.items.length
                ? column.items.map(item => this._getColumnItemHtml(item, {
                    current: column.current,
                    trail: item.path === column.trailPath
                  })).join('')
                : '<div class="finder-column-empty">此目录为空</div>')}
            </div>
            <div class="finder-column-resizer" role="separator" aria-orientation="vertical" aria-label="调整分栏宽度" aria-valuemin="${window.DirectoryViewPreferences.MIN_COLUMN_WIDTH}" aria-valuemax="${window.DirectoryViewPreferences.MAX_COLUMN_WIDTH}" aria-valuenow="${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)}" aria-valuetext="${window.DirectoryViewPreferences.normalizeColumnWidth(AppState.columnViewWidth)} 像素" tabindex="0" title="拖动调整；方向键微调；Shift 加速；双击恢复默认"></div>
          </section>`).join('')}
      </div>`;

    const browser = container.querySelector('.finder-column-browser');
    if (browser) this.bindColumnViewSizing(browser);
    container.querySelectorAll('.finder-column-nav-item').forEach(element => {
      const activate = () => {
        const itemPath = element.dataset.path;
        if (element.dataset.type === 'directory' && itemPath !== AppState.currentPath) this.navigateTo(itemPath);
      };
      element.addEventListener('click', activate);
      element.addEventListener('dblclick', () => {
        if (element.dataset.type === 'file') window.gitFinder.fs.openFile(element.dataset.path);
      });
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === 'ArrowRight') {
          event.preventDefault();
          if (element.dataset.type === 'directory') activate();
          else if (event.key === 'Enter') window.gitFinder.fs.openFile(element.dataset.path);
        }
      });
    });
    requestAnimationFrame(() => {
      if (browser) browser.scrollLeft = browser.scrollWidth;
    });
    const currentTarget = container.querySelector('[data-progressive-directory-target="column"]');
    await this.renderDirectoryItemsProgressively(currentItems, container, context, batch => {
      this.appendDirectoryItemElements(
        currentTarget,
        batch,
        item => this._getColumnItemHtml(item, { current: true, trail: false })
      );
    });
  },

  async renderGalleryView(items, container, context = null) {
    const directories = this.sortRepos(items.filter(item => item.type === 'directory'));
    const files = this.sortRepos(items.filter(item => item.type === 'file'));
    const orderedItems = [...directories, ...files];
    AppState.fileDisplayOrder = orderedItems.map(item => item.path);
    const previewItem = window.GalleryView.pickPreviewItem(
      orderedItems,
      AppState.selectedPaths,
      AppState.fileKeyboardFocusPath
    );

    const galleryIdentity = context
      ? AppState.currentPath
      : `file-labels:${window.ContentQuery.normalize(AppState.contentQuery).fileLabelIds.join(',')}`;
    container.innerHTML = `
      <div class="finder-gallery-browser" data-gallery-directory="${this.escapeHtml(galleryIdentity)}">
        <section class="finder-gallery-preview" role="region" aria-label="图库预览">
          <header class="finder-gallery-preview-header">
            <span class="finder-gallery-preview-icon" id="finder-gallery-preview-icon" aria-hidden="true"></span>
            <span class="finder-gallery-preview-copy">
              <strong id="finder-gallery-preview-title">选择一个项目</strong>
              <small id="finder-gallery-preview-detail"></small>
            </span>
          </header>
          <div class="finder-gallery-preview-body" id="finder-gallery-preview-body" aria-live="polite"></div>
        </section>
        <div class="finder-gallery-filmstrip" aria-label="当前目录项目">
          <div class="finder-gallery-strip" data-progressive-directory-target="gallery" role="listbox" aria-multiselectable="true"></div>
        </div>
      </div>`;

    if (previewItem) this.renderGalleryPreview(previewItem);
    const target = container.querySelector('[data-progressive-directory-target="gallery"]');
    const bindPreview = elements => {
      elements.forEach(element => {
        element.addEventListener('click', () => {
          const item = AppState.visibleItems.find(candidate => candidate.path === element.dataset.path);
          if (item) this.renderGalleryPreview(item);
        });
      });
    };
    if (context) {
      await this.renderDirectoryItemsProgressively(orderedItems, container, context, batch => {
        this.appendDirectoryItemElements(target, batch, item => this._getGalleryItemHtml(item), bindPreview);
      });
      if (!this.isDirectoryRenderContextCurrent(context)) return;
    } else {
      const elements = this.appendDirectoryItemElements(target, orderedItems, item => this._getGalleryItemHtml(item));
      bindPreview(elements);
    }
    this.galleryThumbnailLoader ||= new window.GalleryThumbnails.Loader(
      filePath => window.gitFinder.content.getThumbnail(filePath),
      { maxConcurrent: 4, cacheLimit: 128 }
    );
    const directoryPath = galleryIdentity;
    this.galleryThumbnailLoader.observe(container, orderedItems, {
      isCurrent: () => this.isFileBrowsingContext()
        && AppState.cardStyle === 'gallery'
        && (context ? AppState.currentPath === directoryPath : this.contentCollectionKind() === 'file-labels')
        && container.querySelector('.finder-gallery-browser')?.dataset.galleryDirectory === directoryPath
    });
  },

  _getGalleryItemHtml(item) {
    const status = item.gitStatus || {};
    const rawStatus = status.overallStatus || (item.isGitRepo ? 'clean' : 'none');
    const overallStatus = ['clean', 'dirty', 'ahead', 'behind', 'none'].includes(rawStatus) ? rawStatus : 'none';
    const projectStyle = this.getProjectSemanticStyle(item);
    const lifecycle = window.FileBrowser.projectLifecycleLabel(item);
    const metadata = lifecycle
      || (item.isGitRepo ? (status.branch || 'Git') : '')
      || (item.type === 'file' ? this.formatFileSize(item.size) : '文件夹');
    const focused = item.path === AppState.fileKeyboardFocusPath;
    const thumbnailState = window.GalleryThumbnails.isThumbnailCandidate(item) ? 'idle' : 'not-applicable';
    return `
      <div class="repo-card finder-gallery-item status-${overallStatus} ${item.isHidden ? 'is-hidden' : ''}"${projectStyle} data-path="${this.escapeHtml(item.path)}" data-type="${this.escapeHtml(item.type)}" data-is-git="${item.isGitRepo === true}" data-is-project="${item.isProject === true}" role="option" aria-selected="false" aria-label="${this.escapeHtml(this.getFileItemAriaLabel(item))}" tabindex="${focused ? '0' : '-1'}">
        <span class="finder-gallery-item-visual" data-thumbnail-state="${thumbnailState}">
          ${this.getItemKindIconHtml(item, 'finder-gallery-item-icon')}
        </span>
        <span class="finder-gallery-item-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</span>
        ${this.getFileLabelDotsHtml(item)}
        <span class="finder-gallery-item-meta">${this.escapeHtml(metadata)}</span>
      </div>`;
  },

  renderGalleryPresentation(presentation) {
    const icon = document.getElementById('finder-gallery-preview-icon');
    const title = document.getElementById('finder-gallery-preview-title');
    const detail = document.getElementById('finder-gallery-preview-detail');
    const body = document.getElementById('finder-gallery-preview-body');
    if (!body || !presentation) return;
    if (icon) icon.textContent = presentation.icon || '';
    if (title) title.textContent = presentation.title || '预览';
    if (detail) detail.textContent = presentation.detail || '';
    body.dataset.previewKind = presentation.kind || 'unsupported';
    body.setAttribute('aria-busy', presentation.kind === 'loading' ? 'true' : 'false');
    body.innerHTML = presentation.html || '';
  },

  async renderGalleryPreview(item) {
    if (!item || !this.isFileBrowsingContext() || AppState.cardStyle !== 'gallery') return;
    const requestId = ++AppState.galleryPreviewRequestId;
    const directoryPath = this.contentCollectionKind() === 'file-labels'
      ? `file-labels:${window.ContentQuery.normalize(AppState.contentQuery).fileLabelIds.join(',')}`
      : AppState.currentPath;
    const formatters = {
      formatFileSize: value => this.formatFileSize(value),
      formatItemDate: value => this.formatItemDate(value)
    };
    this.renderGalleryPresentation(window.GalleryView.renderLoading(item, formatters));
    try {
      const preview = await window.gitFinder.content.getPreview(item.path);
      const browser = document.querySelector('#content-area .finder-gallery-browser');
      const currentRequest = window.GalleryView.isPreviewRequestCurrent(
        { requestId, directoryPath },
        {
          requestId: AppState.galleryPreviewRequestId,
          directoryPath: this.contentCollectionKind() === 'file-labels'
            ? `file-labels:${window.ContentQuery.normalize(AppState.contentQuery).fileLabelIds.join(',')}`
            : AppState.currentPath,
          mode: AppState.currentMode,
          style: AppState.cardStyle
        }
      );
      if (!currentRequest
          || browser?.dataset.galleryDirectory !== directoryPath) return;
      this.renderGalleryPresentation(window.GalleryView.renderPreview(preview, formatters));
    } catch (error) {
      if (!window.GalleryView.isPreviewRequestCurrent(
        { requestId, directoryPath },
        {
          requestId: AppState.galleryPreviewRequestId,
          directoryPath: this.contentCollectionKind() === 'file-labels'
            ? `file-labels:${window.ContentQuery.normalize(AppState.contentQuery).fileLabelIds.join(',')}`
            : AppState.currentPath,
          mode: AppState.currentMode,
          style: AppState.cardStyle
        }
      )) return;
      this.renderGalleryPresentation(window.GalleryView.renderError(error?.message || String(error)));
    }
  },

  _getColumnItemHtml(item, { current = false, trail = false } = {}) {
    const lifecycle = window.FileBrowser.projectLifecycleLabel(item);
    const gitStatus = item.isGitRepo ? (item.gitStatus?.branch || 'Git') : '';
    const className = current ? 'repo-list-item finder-column-item' : 'finder-column-nav-item';
    const projectStyle = this.getProjectSemanticStyle(item);
    const focused = current && item.path === AppState.fileKeyboardFocusPath;
    return `
      <div class="${className} ${trail ? 'is-trail' : ''} ${item.isHidden ? 'is-hidden' : ''}"${projectStyle} data-path="${this.escapeHtml(item.path)}" data-type="${this.escapeHtml(item.type)}" data-is-git="${item.isGitRepo === true}" data-is-project="${item.isProject === true}" role="option" aria-selected="false" aria-label="${this.escapeHtml(this.getFileItemAriaLabel(item))}" tabindex="${focused || !current ? '0' : '-1'}">
        ${this.getItemKindIconHtml(item, 'finder-column-icon')}
        <span class="finder-column-name">${this.escapeHtml(item.name)}${this.getFileLabelDotsHtml(item)}</span>
        <span class="finder-column-meta">${this.escapeHtml(lifecycle || gitStatus || (item.type === 'file' ? this.formatFileSize(item.size) : ''))}</span>
        ${item.type === 'directory' ? '<span class="finder-column-chevron" aria-hidden="true">›</span>' : ''}
      </div>`;
  },

  _getListHtml(items) {
    const dirs = items.filter(i => i.type === 'directory');
    const files = items.filter(i => i.type === 'file');

    let html = `<div class="repo-list" role="listbox" aria-label="目录项目" aria-multiselectable="true">
      <div class="repo-list-header" aria-hidden="true">
        <span></span><span></span><span>名称</span><span>类型</span><span>修改时间</span><span>大小</span><span>Git 状态</span>
      </div>`;

    for (const item of [...this.sortRepos(dirs), ...this.sortRepos(files)]) {
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
    const rawStatus = status.overallStatus || (item.isGitRepo ? 'clean' : 'none');
    const overallStatus = ['clean', 'dirty', 'ahead', 'behind', 'none'].includes(rawStatus) ? rawStatus : 'none';
    const projectStyle = this.getProjectSemanticStyle(item);
    const lifecycle = window.FileBrowser.projectLifecycleLabel(item);
    const typeLabel = item.type === 'file'
      ? '文件'
      : (item.isProject ? `项目文件夹${lifecycle ? ` · ${lifecycle}` : ''}` : '文件夹');
    const gitLabel = item.isGitRepo
      ? `${status.branch || 'Git'}${(status.modified || 0) > 0 ? ` · ${status.modified} 项修改` : ''}${(status.ahead || 0) > 0 ? ` · ↑${status.ahead}` : ''}${(status.behind || 0) > 0 ? ` · ↓${status.behind}` : ''}`
      : '—';
    const focused = item.path === AppState.fileKeyboardFocusPath;
    return `
      <div class="repo-list-item status-${overallStatus} ${item.isHidden ? 'is-hidden' : ''}"${projectStyle} data-path="${this.escapeHtml(item.path)}" data-type="${this.escapeHtml(item.type)}" data-is-git="${item.isGitRepo === true}" data-is-project="${item.isProject === true}" role="option" aria-selected="false" aria-label="${this.escapeHtml(this.getFileItemAriaLabel(item))}" tabindex="${focused ? '0' : '-1'}">
        <span class="list-status-dot">${item.isGitRepo ? `<span class="status-indicator status-${overallStatus}" title="${overallStatus}"></span>` : ''}</span>
        ${this.getItemKindIconHtml(item, 'list-repo-icon')}
        <span class="list-repo-name">${this.escapeHtml(item.name)}${this.getFileLabelDotsHtml(item)}</span>
        <span class="list-item-type">${this.escapeHtml(typeLabel)}</span>
        <span class="list-item-modified">${this.escapeHtml(this.formatItemDate(item.modifiedTime))}</span>
        <span class="list-item-size">${item.type === 'file' ? this.escapeHtml(this.formatFileSize(item.size)) : '—'}</span>
        <span class="list-item-git" title="${this.escapeHtml(gitLabel)}">${this.escapeHtml(gitLabel)}</span>
      </div>
    `;
  },

  getListHtml(items) {
    return this._getListHtml(items);
  },

  formatFileSize(size) {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },

  formatItemDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  },

  getFileItemSummary(item) {
    const parts = [];
    if (item.type === 'file') parts.push(this.formatFileSize(item.size));
    const date = this.formatItemDate(item.modifiedTime);
    if (date) parts.push(`修改于 ${date}`);
    return parts.join(' · ');
  },

  getFileLabelDotsHtml(item, { named = false } = {}) {
    const labels = Array.isArray(item?.fileLabels) ? item.fileLabels : [];
    if (!labels.length) return '';
    const content = labels.map(label => {
      const color = this.safeColor(label.color);
      const name = this.escapeHtml(label.name || '标签');
      return named
        ? `<span class="file-label-chip" style="--file-label-color:${color}"><span class="file-label-dot"></span>${name}</span>`
        : `<span class="file-label-dot" style="--file-label-color:${color}" title="${name}"></span>`;
    }).join('');
    return `<span class="file-label-dots" aria-label="文件标签：${this.escapeHtml(labels.map(label => label.name).join('、'))}">${content}</span>`;
  },

  getFileItemAriaLabel(item) {
    const lifecycle = window.FileBrowser.projectLifecycleLabel(item);
    const type = item.type === 'file'
      ? '文件'
      : (item.isProject ? `项目文件夹${lifecycle ? `，${lifecycle}` : ''}` : '文件夹');
    const parts = [item.name || item.path || '未命名', type];
    if (item.isGitRepo) {
      const status = item.gitStatus || {};
      parts.push(`Git 仓库，分支 ${status.branch || '未知'}`);
      if ((status.modified || 0) > 0) parts.push(`${status.modified} 项修改`);
      if ((status.ahead || 0) > 0) parts.push(`${status.ahead} 个未推送提交`);
      if ((status.behind || 0) > 0) parts.push(`${status.behind} 个待拉取提交`);
    }
    if (Array.isArray(item.fileLabels) && item.fileLabels.length) {
      parts.push(`文件标签 ${item.fileLabels.map(label => label.name).join('、')}`);
    }
    return parts.join('，');
  },

  reconcileFileKeyboardFocus(items = AppState.visibleItems) {
    return this.directorySelectionController.reconcileFileKeyboardFocus(items);
  },

  bindCardEvents(container) {
    return this.directorySelectionController.bindCardEvents(container);
  },

  bindCardElements(elements) {
    return this.directorySelectionController.bindCardElements(elements);
  },

  bindFileDragSource(element) {
    if (!this.isFileBrowsingContext()) return;
    element.setAttribute('draggable', 'true');
    element.addEventListener('dragstart', event => {
      if (event.target.closest('button, input, textarea, select')) {
        event.preventDefault();
        return;
      }
      const itemPath = element.dataset.path;
      if (!AppState.selectedPaths.has(itemPath)) {
        AppState.selectedPaths = new Set([itemPath]);
        AppState.selectionAnchorPath = itemPath;
        this.syncFileSelectionUI();
        this.showFileSelectionDetail(this.getSelectedFileItems());
      }
      const paths = [...AppState.selectedPaths];
      if (!paths.length) {
        event.preventDefault();
        return;
      }
      const initialMode = window.FileBrowser.internalDragMode(event, window.gitFinder.platform);
      AppState.fileDrag = { paths, sourcePath: itemPath, mode: initialMode };
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('application/x-gitfinder-paths', JSON.stringify(paths));
      event.dataTransfer.setData('text/plain', paths.join('\n'));
      requestAnimationFrame(() => {
        document.body.classList.add('file-drag-active');
        document.querySelectorAll('#content-area .repo-card, #content-area .repo-list-item').forEach(candidate => {
          candidate.classList.toggle('file-drag-source', AppState.selectedPaths.has(candidate.dataset.path));
        });
        this.updateInternalDragFeedback(null, paths.length, initialMode);
      });
      this._showStatusMessage(`正在${initialMode === 'copy' ? '复制' : '移动'} ${paths.length} 项；${window.FileBrowser.internalDragModifierHint(window.gitFinder.platform)}`, 'info');
    });
    element.addEventListener('dragend', () => this.clearFileDragState());
  },

  setupFileDragAndDrop() {
    document.addEventListener('dragover', event => {
      const internalPaths = AppState.fileDrag?.paths || [];
      const external = window.FileBrowser.isExternalFileDrag(event.dataTransfer);
      if (!internalPaths.length && !external) return;
      const mode = external ? 'copy' : window.FileBrowser.internalDragMode(event, window.gitFinder.platform);
      if (AppState.fileDrag) AppState.fileDrag.mode = mode;
      const target = this.resolveFileDropTarget(event.target, internalPaths, mode);
      this.clearFileDropTarget();
      event.preventDefault();
      event.dataTransfer.dropEffect = target ? mode : 'none';
      if (target) {
        target.element.classList.add('file-drop-target', 'drop-target');
        target.element.classList.toggle('file-drop-copy-target', !external && mode === 'copy');
        this._fileDropTarget = target;
      }
      if (external) {
        const count = event.dataTransfer?.items?.length || event.dataTransfer?.files?.length || 0;
        this.updateExternalDragFeedback(target, count);
      } else {
        this.updateInternalDragFeedback(target, internalPaths.length, mode, { activeTargetCheck: true });
      }
    });

    document.addEventListener('drop', async event => {
      const external = window.FileBrowser.isExternalFileDrag(event.dataTransfer);
      if (external) {
        event.preventDefault();
        const target = this.resolveFileDropTarget(event.target, [], 'copy') || this._fileDropTarget;
        const files = Array.from(event.dataTransfer?.files || []);
        this.clearExternalDragState();
        if (!target) {
          this._showStatusMessage('请把文件释放到受管目录、文件夹、位置或标签页', 'error');
          return;
        }
        if (files.length > 100) {
          this._showStatusMessage('一次最多导入 100 项，请减少选择后重试', 'error');
          return;
        }
        const sourcePaths = window.FileBrowser.uniqueDroppedPaths(files.map(file => {
          try {
            return window.gitFinder.fs.getPathForFile(file);
          } catch (_) {
            return '';
          }
        }));
        if (!sourcePaths.length) {
          this._showStatusMessage('无法读取拖入项目的本机路径', 'error');
          return;
        }
        await this.openExternalImportPreview(sourcePaths, target.path);
        return;
      }

      if (!AppState.fileDrag?.paths?.length) return;
      const paths = [...AppState.fileDrag.paths];
      const mode = window.FileBrowser.internalDragMode(event, window.gitFinder.platform);
      const directTarget = this.resolveFileDropTarget(event.target, paths, mode);
      const fallbackTarget = this._fileDropTarget
        && window.FileBrowser.canDropPathsToDirectory(paths, this._fileDropTarget.path, mode, window.gitFinder.platform)
        ? this._fileDropTarget
        : null;
      const target = directTarget || fallbackTarget;
      event.preventDefault();
      this.clearFileDragState();
      if (!target) {
        this._showStatusMessage('此位置不能接收文件', 'error');
        return;
      }
      await this.openTransferReview(paths, target.path, mode);
    });

    document.addEventListener('dragleave', event => {
      if (!event.relatedTarget) {
        if (AppState.fileDrag) {
          this.clearFileDropTarget();
          this.resetFileDragFeedbackBanner();
        }
        if (document.body.classList.contains('external-file-drag-active')) this.clearExternalDragState();
      }
    });
  },

  updateExternalDragFeedback(target, count = 0) {
    const banner = document.getElementById('external-import-banner');
    const text = document.getElementById('external-import-banner-text');
    if (!banner || !text) return;
    const setText = message => {
      if (text.textContent !== message) text.textContent = message;
    };
    document.body.classList.add('external-file-drag-active');
    document.body.classList.remove('file-drag-copy');
    banner.style.display = 'flex';
    banner.classList.toggle('invalid', !target);
    banner.classList.remove('internal-copy', 'internal-move');
    const icon = banner.querySelector('.external-import-banner-icon');
    if (icon) icon.textContent = '＋';
    if (!target) {
      setText('此位置不能导入；请移到受管目录');
      return;
    }
    const label = target.path.split(/[\\/]/).filter(Boolean).at(-1) || target.path;
    const countLabel = count > 0 ? `${count} 项` : '文件';
    setText(`释放后预览复制 ${countLabel}到“${label}”`);
  },

  updateInternalDragFeedback(target, count = 0, mode = 'move', { activeTargetCheck = false } = {}) {
    const banner = document.getElementById('external-import-banner');
    const text = document.getElementById('external-import-banner-text');
    if (!banner || !text) return;
    const setText = message => {
      if (text.textContent !== message) text.textContent = message;
    };
    const copy = mode === 'copy';
    const action = copy ? '复制' : '移动';
    const countLabel = count > 0 ? `${count} 项` : '所选项目';
    document.body.classList.toggle('file-drag-copy', copy);
    banner.style.display = 'flex';
    banner.classList.toggle('invalid', activeTargetCheck && !target);
    banner.classList.toggle('internal-copy', copy);
    banner.classList.toggle('internal-move', !copy);
    const icon = banner.querySelector('.external-import-banner-icon');
    if (icon) icon.textContent = copy ? '＋' : '→';
    if (activeTargetCheck && !target) {
      setText(`此位置不能${action}；请选择文件夹、位置或标签页`);
      return;
    }
    if (!target) {
      setText(`拖到文件夹、位置或标签页以${action} ${countLabel}；${window.FileBrowser.internalDragModifierHint(window.gitFinder.platform)}`);
      return;
    }
    const label = target.path.split(/[\\/]/).filter(Boolean).at(-1) || target.path;
    setText(`释放后预览${action} ${countLabel}到“${label}”`);
  },

  clearExternalDragState() {
    this.clearFileDropTarget();
    document.body.classList.remove('external-file-drag-active');
    this.resetFileDragFeedbackBanner();
  },

  resolveFileDropTarget(eventTarget, sourcePaths, mode = 'move') {
    if (!(eventTarget instanceof Element)) return null;
    let element = null;
    let targetPath = '';

    const fileItem = eventTarget.closest('.repo-card[data-type="directory"], .repo-list-item[data-type="directory"]');
    const treeNode = eventTarget.closest('.tree-node[data-path]');
    const favorite = eventTarget.closest('#favorites-list .sidebar-item[data-path]');
    const tabElement = eventTarget.closest('.workspace-tab[data-tab-id]');
    if (fileItem) {
      element = fileItem;
      targetPath = fileItem.dataset.path;
    } else if (treeNode) {
      element = treeNode;
      targetPath = treeNode.dataset.path;
    } else if (favorite) {
      element = favorite;
      targetPath = favorite.dataset.path;
    } else if (tabElement) {
      const tab = AppState.workspaceSession?.tabs.find(item => item.id === tabElement.dataset.tabId);
      element = tabElement;
      targetPath = tab?.path || '';
    } else if (eventTarget.closest('#content-scroll') && this.isDirectoryBrowsingContext() && !this.isGlobalSearchActive()) {
      element = document.getElementById('content-scroll');
      targetPath = AppState.currentPath;
    }

    if (!element || !targetPath || !this.isManagedPath(targetPath)) return null;
    const canDrop = sourcePaths.length === 0
      || window.FileBrowser.canDropPathsToDirectory(sourcePaths, targetPath, mode, window.gitFinder.platform);
    return canDrop ? { element, path: targetPath } : null;
  },

  isManagedPath(candidatePath) {
    const normalize = value => {
      const normalized = String(value || '').replace(/[\\/]+$/, '');
      return window.gitFinder.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    const candidate = normalize(candidatePath);
    return (this._treeRoots || []).some(root => {
      const rootPath = normalize(root.path);
      return candidate === rootPath || candidate.startsWith(`${rootPath}/`) || candidate.startsWith(`${rootPath}\\`);
    });
  },

  clearFileDropTarget() {
    document.querySelectorAll('.file-drop-target, .drop-target').forEach(element => {
      element.classList.remove('file-drop-target', 'drop-target', 'file-drop-copy-target');
    });
    this._fileDropTarget = null;
  },

  clearFileDragState() {
    this.clearFileDropTarget();
    document.body.classList.remove('file-drag-active');
    document.body.classList.remove('file-drag-copy');
    document.querySelectorAll('.file-drag-source').forEach(element => element.classList.remove('file-drag-source'));
    AppState.fileDrag = null;
    this.resetFileDragFeedbackBanner();
  },

  resetFileDragFeedbackBanner() {
    const banner = document.getElementById('external-import-banner');
    document.body.classList.remove('file-drag-copy');
    if (!banner) return;
    banner.style.display = 'none';
    banner.classList.remove('invalid', 'internal-copy', 'internal-move');
  },

  transferProgressHtml(preview, status) {
    return this.fileTransferController.transferProgressHtml(preview, status);
  },

  transferPlanHtml(preview, options = {}) {
    return this.fileTransferController.transferPlanHtml(preview, options);
  },

  async executeTransferWithProgress(preview, applyAction, onStatus) {
    return this.fileTransferController.executeTransferWithProgress(preview, applyAction, onStatus);
  },

  async openTransferReview(sourcePaths, destinationDirectory, mode, context = {}) {
    return this.fileTransferController.openTransferReview(sourcePaths, destinationDirectory, mode, context);
  },

  async changeTransferConflictPolicy(conflictPolicy) {
    return this.fileTransferController.changeTransferConflictPolicy(conflictPolicy);
  },

  setTransferStructureRiskAcknowledged(acknowledged) {
    return this.fileTransferController.setStructureRiskAcknowledged(acknowledged);
  },

  renderTransferReview() {
    return this.fileTransferController.renderTransferReview();
  },

  async applyReviewedTransfer() {
    return this.fileTransferController.applyReviewedTransfer();
  },

  async handleTransferReviewCancel() {
    return this.fileTransferController.handleTransferReviewCancel();
  },

  closeTransferReview() {
    return this.fileTransferController.closeTransferReview();
  },

  async openExternalImportPreview(sourcePaths, destinationDirectory) {
    return this.fileTransferController.openExternalImportPreview(sourcePaths, destinationDirectory);
  },

  renderExternalImportPreview() {
    return this.fileTransferController.renderExternalImportPreview();
  },

  async applyExternalImport() {
    return this.fileTransferController.applyExternalImport();
  },

  closeExternalImportModal() {
    return this.fileTransferController.closeExternalImportModal();
  },

  async handleExternalImportCancel() {
    return this.fileTransferController.handleExternalImportCancel();
  },

  setupFileContextMenu() {
    if (this._fileContextMenuBound) return;
    this._fileContextMenuBound = true;
    const menu = document.getElementById('file-context-menu');
    if (!menu) return;
    const close = () => {
      menu.hidden = true;
      menu.removeAttribute('style');
    };
    document.addEventListener('contextmenu', event => {
      const element = event.target.closest('#content-area .repo-card, #content-area .repo-list-item');
      if (!element || !this.isFileBrowsingContext()) {
        close();
        return;
      }
      event.preventDefault();
      const itemPath = element.dataset.path;
      if (!AppState.selectedPaths.has(itemPath)) {
        AppState.selectedPaths = new Set([itemPath]);
        AppState.selectionAnchorPath = itemPath;
        this.syncFileSelectionUI();
        this.showFileSelectionDetail(this.getSelectedFileItems());
        this.updateFileActionBar();
      }
      const items = this.getSelectedFileItems();
      const singleDirectory = items.length === 1 && items[0].type === 'directory';
      const projectLabel = document.getElementById('file-context-project-label');
      const favoriteLabel = document.getElementById('file-context-favorite-label');
      if (projectLabel) projectLabel.textContent = singleDirectory && items[0].isProject ? '项目设置…' : '设为项目…';
      if (favoriteLabel) favoriteLabel.textContent = singleDirectory && this.isFavoritePath(items[0].path) ? '从收藏夹移除' : '添加到收藏夹';
      const renameLabel = menu.querySelector('[data-context-action="rename"] span');
      if (renameLabel) renameLabel.textContent = items.length > 1 ? `重命名 ${items.length} 个项目…` : '重命名';
      menu.querySelector('[data-context-action="open"]').disabled = items.length !== 1;
      menu.querySelector('[data-context-action="preview"]').disabled = items.length !== 1;
      menu.querySelector('[data-context-action="get-info"]').disabled = items.length !== 1;
      menu.querySelector('[data-context-action="duplicate"]').disabled = items.length === 0 || !this.isDirectoryBrowsingContext();
      menu.querySelector('[data-context-action="rename"]').disabled = items.length === 0;
      menu.querySelector('[data-context-action="open-editor"]').disabled = items.length !== 1;
      menu.querySelector('[data-context-action="labels"]').disabled = items.length === 0;
      menu.querySelector('[data-context-action="favorite"]').disabled = !singleDirectory;
      menu.querySelector('[data-context-action="project"]').disabled = !singleDirectory;
      menu.hidden = false;
      const width = menu.offsetWidth || 220;
      const height = menu.offsetHeight || 320;
      menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
      requestAnimationFrame(() => menu.querySelector('.finder-menu-item:not(:disabled)')?.focus());
    });
    menu.addEventListener('click', event => {
      const action = event.target.closest('[data-context-action]')?.dataset.contextAction;
      if (!action) return;
      close();
      if (action === 'open') this.openSelectedFileItem();
      if (action === 'preview') this.toggleQuickLook();
      if (action === 'get-info') this.openSelectedFileInfo();
      if (action === 'copy') this.copySelectedItems();
      if (action === 'copy-path') this.copySelectedPathnames();
      if (action === 'cut') this.cutSelectedItems();
      if (action === 'duplicate') this.duplicateSelectedItems();
      if (action === 'rename') this.renameSelectedItem();
      if (action === 'move') this.moveSelectedItems();
      if (action === 'open-editor') this.openSelectedInEditor();
      if (action === 'labels') this.openSelectedFileLabels();
      if (action === 'favorite') this.toggleSelectedFavorite();
      if (action === 'project') this.openSelectedProjectSettings();
      if (action === 'trash') this.trashSelectedItems();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#file-context-menu')) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) close();
    });
    window.addEventListener('blur', close);
  },

  async openLocalProjectDialog(directoryPath) {
    const projectPath = String(directoryPath || '');
    if (!projectPath || AppState.fileOperationBusy) return;
    const modal = document.getElementById('local-project-modal');
    if (!modal) return;
    const feedback = document.getElementById('local-project-feedback');
    feedback.textContent = '正在读取项目身份…';
    modal.style.display = 'flex';
    try {
      const identity = await window.gitFinder.localProjects.describe(projectPath);
      const fallbackName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '未命名项目';
      const project = identity.project || {
        name: fallbackName,
        description: '',
        color: 'blue',
        lifecycle: 'active',
        repositories: { excluded: [] }
      };
      AppState.projectDialog = { path: projectPath, existing: identity.isProject };
      document.getElementById('local-project-title').textContent = identity.isProject ? '项目设置' : '设为项目';
      document.getElementById('local-project-path').textContent = projectPath;
      document.getElementById('local-project-name').value = project.name || fallbackName;
      document.getElementById('local-project-description').value = project.description || '';
      document.getElementById('local-project-color').value = project.color || 'blue';
      document.getElementById('local-project-lifecycle').value = project.lifecycle || 'active';
      document.getElementById('local-project-excluded').value = (project.repositories?.excluded || []).join('\n');
      document.getElementById('local-project-save-btn').textContent = identity.isProject ? '保存设置' : '创建项目';
      feedback.textContent = identity.isProject
        ? `项目 ID：${project.projectId}`
        : '尚未写入；不会初始化或修改 Git';
      requestAnimationFrame(() => document.getElementById('local-project-name')?.focus());
    } catch (error) {
      AppState.projectDialog = null;
      feedback.textContent = error?.message || String(error);
    }
  },

  closeLocalProjectDialog() {
    document.getElementById('local-project-modal').style.display = 'none';
    AppState.projectDialog = null;
  },

  async saveLocalProjectDialog() {
    const dialogState = AppState.projectDialog;
    if (!dialogState) return;
    const saveButton = document.getElementById('local-project-save-btn');
    const feedback = document.getElementById('local-project-feedback');
    const values = {
      name: document.getElementById('local-project-name').value,
      description: document.getElementById('local-project-description').value,
      color: document.getElementById('local-project-color').value,
      lifecycle: document.getElementById('local-project-lifecycle').value,
      excludedRepositories: document.getElementById('local-project-excluded').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    };
    saveButton.disabled = true;
    feedback.textContent = '正在保存便携项目清单…';
    try {
      const result = dialogState.existing
        ? await window.gitFinder.localProjects.update(dialogState.path, values)
        : (await window.gitFinder.localProjects.initialize(dialogState.path, values)).project;
      await window.gitFinder.content.invalidateIndex();
      AppState.localProjects = [];
      await this.refreshProjectShortcuts(true);
      this.closeLocalProjectDialog();
      if (['projects', 'project-repositories'].includes(this.contentCollectionKind())) await this.renderProjectsView(false);
      else await this.renderContent();
      this._showStatusMessage(`已保存项目“${result.name}”；未执行任何 Git 写操作`, 'success');
    } catch (error) {
      feedback.textContent = error?.message || String(error);
    } finally {
      saveButton.disabled = false;
    }
  },

  openSelectedProjectSettings() {
    const items = this.getSelectedFileItems();
    if (items.length !== 1 || items[0].type !== 'directory') return;
    this.openLocalProjectDialog(items[0].path);
  },

  openSelectedFileLabels() {
    return this.fileLabelController.open(this.getSelectedFileItems());
  },

  openLocalProject(projectPath) {
    if (!projectPath) return;
    AppState.currentMode = 'tree';
    AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
    AppState.searchScope = 'current';
    this.updateModeUI();
    this.navigateTo(projectPath);
  },

  async showResourceInRelationshipBoard(options = {}) {
    const kind = String(options.kind || '');
    const resourcePath = String(options.path || '');
    let refId = String(options.refId || '');
    if (!['project', 'repository'].includes(kind)) return false;
    try {
      if (kind === 'project' && !refId && resourcePath) {
        const identity = await window.gitFinder.localProjects.describe(resourcePath);
        refId = identity?.isProject ? String(identity.project?.projectId || '') : '';
      }
      if (kind === 'repository' && !refId && resourcePath) {
        const registry = await window.gitFinder.repos.getRegistry();
        const entry = (registry?.repos || []).find(candidate => (
          candidate.archived !== true
          && window.DirectoryNavigation.pathsEqual(candidate.path, resourcePath, window.gitFinder.platform)
        ));
        refId = String(entry?.id || '');
      }
      if (!refId) {
        this._showStatusMessage('无法解析此项目或仓库的稳定身份，请重新扫描后再试', 'warning');
        return false;
      }
      await this.switchView('relationships');
      return this.relationshipBoardController.revealResource(kind, refId);
    } catch (error) {
      this._showStatusMessage(`无法在关系白板中显示：${error?.message || String(error)}`, 'error');
      return false;
    }
  },

  handleVirtualizedListKeyboardNavigation(event) {
    return this.directorySelectionController.handleVirtualizedListKeyboardNavigation(event);
  },

  handleFileKeyboardNavigation(event) {
    return this.directorySelectionController.handleFileKeyboardNavigation(event);
  },

  handleFileSelectionClick(event, element) {
    return this.directorySelectionController.handleFileSelectionClick(event, element);
  },

  syncFileSelectionUI() {
    return this.directorySelectionController.syncFileSelectionUI();
  },

  syncFileItemElement(element) {
    return this.directorySelectionController.syncFileItemElement(element);
  },

  clearFileSelection() {
    return this.directorySelectionController.clearFileSelection();
  },

  showFileSelectionDetail(items) {
    return this.fileSelectionDetailController.show(items);
  },

  getSelectedFileItems() {
    const byPath = new Map(AppState.visibleItems.map(item => [item.path, item]));
    return [...AppState.selectedPaths].map(itemPath => byPath.get(itemPath)).filter(Boolean);
  },

  updateFileActionBar() {
    return this.fileActionBarController.update();
  },

  async loadFileOperationHistory() {
    return this.fileOperationController.loadHistory();
  },

  async loadConfigTransactionRecoveryStatus() {
    try {
      const recovery = await window.gitFinder.config.getTransactionRecoveryStatus();
      if (recovery?.needsReview) {
        this._showStatusMessage(`配置事务恢复失败：${recovery.error || '请保留现场并检查配置文件'}`, 'error');
      } else if (recovery?.recovered) {
        const action = recovery.action === 'rolled-back' ? '回滚' : '完成';
        this._showStatusMessage(`已安全${action}中断的配置同步`, 'success');
      }
    } catch (error) {
      console.warn('配置事务恢复状态读取失败:', error);
    }
  },

  openFileOperationDialog(options) {
    return this.fileOperationDialogController.open(options);
  },

  submitFileOperationDialog() {
    return this.fileOperationDialogController.submit();
  },

  closeFileOperationDialog(value) {
    return this.fileOperationDialogController.close(value);
  },

  copySelectedItems() {
    return this.fileOperationController.copySelectedItems();
  },

  copySelectedPathnames() {
    return this.fileOperationController.copySelectedPathnames();
  },

  cutSelectedItems() {
    return this.fileOperationController.cutSelectedItems();
  },

  async pasteFileClipboard({ move = false } = {}) {
    return this.fileOperationController.pasteFileClipboard({ move });
  },

  async duplicateSelectedItems() {
    return this.fileOperationController.duplicateSelectedItems();
  },

  async createDirectoryFromToolbar() {
    if (!this.isDirectoryBrowsingContext() || !AppState.currentPath || AppState.fileOperationBusy || this.isDirectoryLoadBlocked()) return;
    const name = await this.openFileOperationDialog({
      title: '新建文件夹',
      value: '未命名文件夹',
      confirmLabel: '创建',
      hint: `位置：${AppState.currentPath}`,
      returnFocusId: 'file-create-menu-trigger'
    });
    if (!name) return;
    let operation = null;
    const success = await this.runFileOperation(
      async () => {
        operation = await window.gitFinder.fileOps.createDirectory(AppState.currentPath, name);
        return operation;
      },
      `已创建“${name}”，可按 ⌘Z 撤销`
    );
    if (success) await this.revealCreatedFileOperation(operation, 'directory');
  },

  async createFileFromToolbar() {
    if (!this.isDirectoryBrowsingContext() || !AppState.currentPath || AppState.fileOperationBusy || this.isDirectoryLoadBlocked()) return;
    const name = await this.openFileOperationDialog({
      title: '新建文件',
      value: '未命名.txt',
      confirmLabel: '创建',
      hint: `创建空白文件 · 位置：${AppState.currentPath}`,
      selectBaseName: true,
      returnFocusId: 'file-create-menu-trigger'
    });
    if (!name) return;
    let operation = null;
    const success = await this.runFileOperation(
      async () => {
        operation = await window.gitFinder.fileOps.createFile(AppState.currentPath, name);
        return operation;
      },
      `已创建“${name}”，文件保持为空时可按 ⌘Z 撤销`
    );
    const target = operation?.items?.[0]?.target;
    if (!success || !target) return;
    await this.revealCreatedFileOperation(operation, 'file');
  },

  ensureFileItemVisible(itemPath) {
    return this.directorySelectionController.ensureFileItemVisible(itemPath);
  },

  async revealCreatedFileOperation(operation, directoryType) {
    const target = operation?.items?.[0]?.target;
    if (!target) return;
    if (!AppState.visibleItems.some(item => item.path === target)) {
      AppState.contentQuery = window.ContentQuery.fromLegacy('tree', directoryType);
      this.captureActiveWorkspaceTab();
      await this.persistWorkspaceTabs();
      await this.renderContent();
    }
    AppState.selectedPaths = new Set([target]);
    AppState.selectionAnchorPath = target;
    AppState.fileKeyboardFocusPath = target;
    this.ensureFileItemVisible(target);
    this.syncFileSelectionUI();
    this.updateFileActionBar();
    this.showFileSelectionDetail(this.getSelectedFileItems());
    const element = document.querySelector(`[data-path="${this.cssEscape(target)}"]`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  },

  async renameSelectedItem() {
    const items = this.getSelectedFileItems();
    if (!items.length || AppState.fileOperationBusy || this.isDirectoryLoadBlocked()) return;
    if (items.length > 1) {
      this.batchRenameController.open(items);
      return;
    }
    const item = items[0];
    const nextName = await this.openFileOperationDialog({
      title: '重命名',
      value: item.name,
      confirmLabel: '重命名',
      hint: item.path,
      selectBaseName: item.type === 'file',
      returnFocusId: 'file-actions-menu-trigger'
    });
    if (!nextName || nextName === item.name) return;
    let operation = null;
    const success = await this.runFileOperation(
      async () => {
        operation = await window.gitFinder.fileOps.rename(item.path, nextName);
        return operation;
      },
      `已重命名为“${nextName}”，可按 ⌘Z 撤销`
    );
    if (success) await this.revealCreatedFileOperation(operation, item.type);
  },

  async moveSelectedItems() {
    const paths = [...AppState.selectedPaths];
    if (!paths.length || AppState.fileOperationBusy || this.isDirectoryLoadBlocked()) return;
    const selection = await window.gitFinder.fs.selectFolder();
    if (!selection?.path) return;
    await this.openTransferReview(paths, selection.path, 'move');
  },

  async trashSelectedItems() {
    const items = this.getSelectedFileItems();
    if (!items.length || AppState.fileOperationBusy || this.isDirectoryLoadBlocked()) return;
    const paths = items.map(item => item.path);
    const affectedRepositories = AppState.allRepos.filter(repo => paths.some(itemPath => (
      repo.path === itemPath || repo.path.startsWith(`${itemPath}/`) || repo.path.startsWith(`${itemPath}\\`)
    )));
    const trashName = window.gitFinder.platform === 'win32' ? '回收站' : '废纸篓';
    const recoveryNote = window.gitFinder.platform === 'win32'
      ? '可以在 Windows 回收站中手动恢复。'
      : '此操作可在 GitFinder 中撤销。';
    if (affectedRepositories.length && !confirm(`所选内容包含 ${affectedRepositories.length} 个 Git 仓库。确定移入${trashName}吗？${recoveryNote}`)) return;
    await this.runFileOperation(
      () => window.gitFinder.fileOps.trash(paths),
      operation => operation?.undoable
        ? `已将 ${paths.length} 项移入${trashName}，可撤销`
        : `已将 ${paths.length} 项移入 Windows 回收站；如需恢复请打开回收站`
    );
  },

  async undoLastFileOperation() {
    return this.fileOperationController.undoLastFileOperation();
  },

  async redoLastFileOperation() {
    return this.fileOperationController.redoLastFileOperation();
  },

  async revealFileOperationHistoryLocation(itemPath) {
    const parentPath = this.getParentPath(itemPath);
    if (!parentPath) {
      this._showStatusMessage('无法确定该操作的受管目录', 'error');
      return false;
    }
    if (AppState.currentMode !== 'tree' || !window.ContentQuery.isCurrent(AppState.contentQuery)) {
      AppState.currentMode = 'tree';
      AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
      AppState.searchScope = 'current';
      AppState.globalSearchLoading = false;
      AppState.globalSearchResults = [];
      AppState.globalSearchMeta = null;
      this.captureActiveWorkspaceTab();
      this.renderWorkspaceTabs();
      this.scheduleWorkspaceTabsPersist();
      this.updateModeUI();
    }
    this.navigateTo(parentPath);
    await this.renderContent();
    const item = AppState.visibleItems.find(candidate => candidate.path === itemPath);
    if (!item) {
      this._showStatusMessage('已打开操作所在目录；该项目当前不在原位置', 'info');
      return true;
    }
    AppState.selectedPaths = new Set([itemPath]);
    AppState.selectionAnchorPath = itemPath;
    AppState.fileKeyboardFocusPath = itemPath;
    this.ensureFileItemVisible(itemPath);
    this.syncFileSelectionUI();
    this.updateFileActionBar();
    this.showFileSelectionDetail([item]);
    document.querySelector(`[data-path="${this.cssEscape(itemPath)}"]`)?.scrollIntoView({ block: 'nearest' });
    this._showStatusMessage(`已定位“${item.name}”`, 'success');
    return true;
  },

  async runFileOperation(action, successMessage) {
    return this.fileOperationController.run(action, successMessage);
  },

  getEditActionContext() {
    return this.fileOperationController.getEditActionContext();
  },

  handleEditAction(action, { source = 'keyboard' } = {}) {
    return this.fileOperationController.handleEditAction(action, { source });
  },

  selectAllVisibleFiles() {
    return this.directorySelectionController.selectAllVisibleFiles();
  },

  handleFileKeyboardShortcut(event) {
    if (event.defaultPrevented) return;

    const modalVisible = document.getElementById('file-operation-modal')?.style.display !== 'none';
    const goToFolderVisible = document.getElementById('go-to-folder-modal')?.style.display !== 'none';
    const externalImportVisible = document.getElementById('external-import-modal')?.style.display !== 'none';
    const transferReviewVisible = document.getElementById('transfer-review-modal')?.style.display !== 'none';
    const target = event.target;
    const primaryKey = event.metaKey || (window.gitFinder.platform !== 'darwin' && event.ctrlKey);
    const typing = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target?.isContentEditable;
    if (externalImportVisible) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.handleExternalImportCancel();
      }
      return;
    }
    if (transferReviewVisible) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.handleTransferReviewCancel();
      }
      return;
    }
    if (goToFolderVisible) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeGoToFolderDialog();
      }
      return;
    }
    if (modalVisible) return;

    const otherModalVisible = [...document.querySelectorAll('.modal-overlay')]
      .some(overlay => getComputedStyle(overlay).display !== 'none');
    if (otherModalVisible) return;

    const goToFolderShortcut = window.gitFinder.platform === 'darwin'
      ? event.metaKey && event.shiftKey && event.key.toLowerCase() === 'g'
      : event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'l';
    if (goToFolderShortcut) {
      event.preventDefault();
      this.openGoToFolderDialog();
      return;
    }

    if (primaryKey && event.key === ',') {
      event.preventDefault();
      this.openSettingsPage();
      return;
    }

    if (primaryKey && event.shiftKey && (event.code === 'Period' || event.key === '.' || event.key === '>')) {
      event.preventDefault();
      this.toggleHiddenFiles();
      return;
    }

    if (primaryKey && event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      this.restoreClosedWorkspaceTab();
      return;
    }
    if (primaryKey && !event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      this.createWorkspaceTab();
      return;
    }
    if (primaryKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      this.closeWorkspaceTab();
      return;
    }
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      this.cycleWorkspaceTab(event.shiftKey ? -1 : 1);
      return;
    }

    if (primaryKey && event.key === '[') {
      event.preventDefault();
      this.goBack();
      return;
    }
    if (primaryKey && event.key === ']') {
      event.preventDefault();
      this.goForward();
      return;
    }
    if (primaryKey && event.key === 'ArrowUp') {
      event.preventDefault();
      this.goUp();
      return;
    }

    if (primaryKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (AppState.searchScope !== 'global') {
        AppState.searchScope = 'global';
        this.updateSearchScopeUI();
        this.updateModeUI();
        window.gitFinder.config.set('searchScope', 'global');
      }
      const searchInput = document.getElementById('search-input');
      searchInput?.focus();
      searchInput?.select();
      if (AppState.searchQuery.trim()) this.performGlobalSearch();
      return;
    }

    if (this.quickLookController?.isOpen() && (event.key === 'Escape' || event.code === 'Space')) {
      event.preventDefault();
      this.closeQuickLook();
      return;
    }

    const editAction = window.EditActionRouter.shortcutAction(event, window.gitFinder.platform);
    if (editAction) {
      if (this.handleEditAction(editAction, { source: 'keyboard' })) event.preventDefault();
      return;
    }

    if (typing) {
      if (target?.id === 'search-input' && event.key === 'Escape') {
        event.preventDefault();
        if (AppState.searchQuery) this.clearSearchQuery();
        else target.blur();
      }
      return;
    }
    if (!this.isFileBrowsingContext()) return;

    const copyPathnamesShortcut = window.gitFinder.platform === 'darwin'
      ? event.metaKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c'
      : event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'c';
    if (copyPathnamesShortcut) {
      event.preventDefault();
      this.copySelectedPathnames();
      return;
    }

    const fileInfoShortcut = window.gitFinder.platform === 'darwin'
      ? event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'i'
      : event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Enter';
    if (fileInfoShortcut) {
      event.preventDefault();
      this.openSelectedFileInfo();
      return;
    }

    if (primaryKey && !event.shiftKey && !event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      this.setDirectoryViewStyle({ 1: 'card', 2: 'list', 3: 'column', 4: 'gallery' }[event.key]);
      return;
    }

    if (this.isDirectoryLoadBlocked()) return;

    if (!event.metaKey && !event.ctrlKey && !event.altKey
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        && this.handleFileKeyboardNavigation(event)) {
      event.preventDefault();
      return;
    }

    if (primaryKey && event.altKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.pasteFileClipboard({ move: true });
      return;
    }
    if (primaryKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicateSelectedItems();
      return;
    }

    if (event.code === 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (AppState.selectedPaths.size === 1) {
        event.preventDefault();
        this.toggleQuickLook();
      }
      return;
    }

    if (primaryKey && event.shiftKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.createDirectoryFromToolbar();
      return;
    }
    if ((window.gitFinder.platform === 'darwin' && event.metaKey && (event.key === 'Backspace' || event.key === 'Delete'))
        || (window.gitFinder.platform !== 'darwin' && event.key === 'Delete' && !event.shiftKey)) {
      event.preventDefault();
      this.trashSelectedItems();
      return;
    }
    if (primaryKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      this.openSelectedFileItem();
      return;
    }
    if (window.gitFinder.platform !== 'darwin' && event.key === 'Enter'
        && AppState.selectedPaths.size === 1) {
      event.preventDefault();
      this.openSelectedFileItem();
      return;
    }
    if (((window.gitFinder.platform === 'darwin' && event.key === 'Enter')
        || (window.gitFinder.platform !== 'darwin' && event.key === 'F2'))
        && AppState.selectedPaths.size >= 1) {
      event.preventDefault();
      this.renameSelectedItem();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (AppState.selectedPaths.size) {
        this.clearFileSelection();
        this.updateStatusBar();
      } else if (this.isGlobalSearchActive()) {
        this.clearSearchQuery();
      }
    }
  },

  openSelectedFileItem() {
    const items = this.getSelectedFileItems();
    if (items.length !== 1) return;
    this.activateFileItem(items[0]);
  },

  openSelectedFileInfo() {
    const items = this.getSelectedFileItems();
    if (items.length !== 1) return;
    this.fileInfoController?.open(items[0]);
  },

  activateFileItem(item) {
    if (!item?.path) return;
    if (item.type === 'directory') {
      if (this.isGlobalSearchActive() || this.isContentCollection()) {
        AppState.contentQuery = window.ContentQuery.queryForPreset('current-all');
        AppState.searchScope = 'current';
        AppState.searchQuery = '';
        AppState.globalSearchResults = [];
        AppState.globalSearchMeta = null;
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        this.updateSearchScopeUI();
        window.gitFinder.config.set('searchScope', 'current');
      }
      AppState.currentMode = 'tree';
      this.updateModeUI();
      this.navigateTo(item.path);
      return;
    }
    window.gitFinder.fs.openFile(item.path);
  },

  toggleQuickLook() {
    this.fileInfoController?.close({ restoreFocus: false });
    this.quickLookController?.toggle(this.getSelectedFileItems());
  },

  async openQuickLook(item) {
    this.fileInfoController?.close({ restoreFocus: false });
    return this.quickLookController?.open(item);
  },

  closeQuickLook() {
    this.quickLookController?.close();
  },

  selectRepo(repoPath) {
    return this.repositoryDetailController.select(repoPath);
  },

  cancelRepoSelection() {
    return this.repositoryDetailController.cancel();
  },

  showDetailError(title, path, message) {
    return this.repositoryDetailController.showError(title, path, message);
  },

  // 更新详情面板区域可见性
  updateDetailSections() {
    return this.repositoryDetailController.updateSections();
  },

  // 应用保存的区域排列顺序
  applyDetailSectionOrder() {
    return this.repositoryDetailController.applySectionOrder();
  },

  // 保存区域排列顺序到配置
  saveDetailSectionOrder() {
    return this.repositoryDetailController.saveSectionOrder();
  },

  // 设置详情区域拖拽排序
  setupDetailSectionDrag() {
    return this.repositoryDetailController.setupSectionDrag();
  },

  updateDetailPanel() {
    return this.repositoryDetailController.render();
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

  async loadMarkdownDocuments(repoPath, files, savedFileName) {
    const defaultFile = savedFileName || files.find(file => /^readme\.md$/i.test(file.fileName))?.fileName || files[0]?.fileName || 'PROJECT_NOTES.md';
    const current = await window.gitFinder.fs.readMarkdownDocument(repoPath, defaultFile);
    return { files, selectedFile: defaultFile, current };
  },

  renderMarkdownDocuments() {
    const repo = AppState.selectedRepo;
    const docs = repo?.projectDocs;
    if (!docs) return;

    const select = document.getElementById('document-file-select');
    const options = [...(docs.files || [])];
    if (!options.some(item => item.fileName === docs.selectedFile)) {
      options.push({ fileName: docs.selectedFile, format: 'md' });
    }
    select.innerHTML = options.map(item =>
      `<option value="${this.escapeHtml(item.fileName)}">${this.escapeHtml(item.fileName)}</option>`
    ).join('');
    select.value = docs.selectedFile;

    const current = docs.current;
    if (!current.exists && !current.content) {
      current.content = this.getMarkdownDocumentTemplate(repo.name);
    }
    document.getElementById('document-textarea').value = current.content || '';
    document.getElementById('document-new-name').value = docs.selectedFile === 'PROJECT_NOTES.md' ? '' : docs.selectedFile;
    this.renderMarkdownDocumentPreview(current.content || '');
    this.switchDocumentMode(AppState.documentMode || 'preview');
    this.updateDocumentSaveStatus(current.exists ? '已加载' : '保存后创建');
  },

  async selectMarkdownDocument(fileName) {
    const repo = AppState.selectedRepo;
    if (!repo?.projectDocs || !fileName) return;
    const file = await window.gitFinder.fs.readMarkdownDocument(repo.path, fileName);
    repo.projectDocs.current = file;
    repo.projectDocs.selectedFile = fileName;
    await this.persistMarkdownDocumentSelection();
    this.renderMarkdownDocuments();
  },

  async persistMarkdownDocumentSelection() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectDocs) return;
    const all = await window.gitFinder.config.get('markdownDocumentSelections') || {};
    all[repo.path] = repo.projectDocs.selectedFile;
    await window.gitFinder.config.set('markdownDocumentSelections', all);
  },

  async createMarkdownDocument() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectDocs) return;
    const input = document.getElementById('document-new-name');
    let fileName = (input.value || '').trim() || 'PROJECT_NOTES.md';
    if (!/\.md$/i.test(fileName)) fileName += '.md';
    if (fileName.includes('/') || fileName.includes('\\')) {
      this.updateDocumentSaveStatus('文件名不能包含路径');
      return;
    }
    try {
      const saved = await window.gitFinder.fs.saveMarkdownDocument(repo.path, fileName, this.getMarkdownDocumentTemplate(repo.name));
      repo.projectDocs.files = await window.gitFinder.fs.listMarkdownDocuments(repo.path);
      repo.projectDocs.selectedFile = fileName;
      repo.projectDocs.current = { ...saved, dirty: false };
      await this.persistMarkdownDocumentSelection();
      this.renderMarkdownDocuments();
      this.updateDocumentSaveStatus('文档已创建');
    } catch (error) {
      this.updateDocumentSaveStatus(`创建失败：${error.message || error}`);
    }
  },

  async saveMarkdownDocument() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectDocs?.current) return;
    const button = document.getElementById('document-save-btn');
    button.disabled = true;
    this.updateDocumentSaveStatus('保存中...');
    try {
      const current = repo.projectDocs.current;
      const saved = await window.gitFinder.fs.saveMarkdownDocument(repo.path, current.fileName, current.content || '');
      repo.projectDocs.current = { ...saved, dirty: false };
      repo.projectDocs.files = await window.gitFinder.fs.listMarkdownDocuments(repo.path);
      await this.persistMarkdownDocumentSelection();
      this.renderMarkdownDocuments();
      this.updateDocumentSaveStatus('已保存');
    } catch (error) {
      this.updateDocumentSaveStatus(`保存失败：${error.message || error}`);
    } finally {
      button.disabled = false;
    }
  },

  switchDocumentMode(mode) {
    AppState.documentMode = mode === 'edit' ? 'edit' : 'preview';
    document.querySelectorAll('.document-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.documentMode === AppState.documentMode);
    });
    const preview = document.getElementById('document-preview');
    const textarea = document.getElementById('document-textarea');
    if (preview) preview.style.display = AppState.documentMode === 'preview' ? '' : 'none';
    if (textarea) textarea.style.display = AppState.documentMode === 'edit' ? '' : 'none';
  },

  renderMarkdownDocumentPreview(content) {
    const preview = document.getElementById('document-preview');
    if (!preview) return;
    preview.innerHTML = this.renderMarkdown(content || '');
  },

  renderMarkdown(content) {
    const lines = String(content || '').split(/\r?\n/);
    let html = '';
    let inCode = false;
    let inList = false;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${paragraph.map(line => this.escapeInlineMarkdown(line)).join(' ')}</p>`;
      paragraph = [];
    };
    const closeList = () => {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
    };

    for (const line of lines) {
      if (/^```/.test(line.trim())) {
        flushParagraph();
        closeList();
        if (inCode) {
          html += '</code></pre>';
        } else {
          html += '<pre><code>';
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        html += `${this.escapeHtml(line)}\n`;
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html += `<h${level}>${this.escapeInlineMarkdown(heading[2])}</h${level}>`;
        continue;
      }
      const list = line.match(/^\s*[-*]\s+(.+)$/);
      if (list) {
        flushParagraph();
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${this.escapeInlineMarkdown(list[1])}</li>`;
        continue;
      }
      paragraph.push(line.trim());
    }
    flushParagraph();
    closeList();
    if (inCode) html += '</code></pre>';
    return html || '<div class="document-empty">暂无内容</div>';
  },

  escapeInlineMarkdown(value) {
    return this.escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '<span class="markdown-link" title="Quick Look 中不打开外部链接">$1</span>');
  },

  getMarkdownDocumentTemplate(projectName) {
    const today = new Date().toISOString().slice(0, 10);
    return `# ${projectName || '项目文档'}\n\n## 摘要\n\n\n## 记录\n\n- ${today}：\n`;
  },

  updateDocumentSaveStatus(message) {
    const status = document.getElementById('document-save-status');
    if (status) status.textContent = message;
  },

  getProjectControlTemplate(slot, format = 'csv') {
    const today = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      if (slot === 'goals') {
        return `目标,优先级,状态,开始日期,截止日期,负责人,备注\n项目目标,高,进行中,${today},,,\n`;
      }
      if (slot === 'milestone') {
        return `日期,里程碑,状态,交付物,备注\n${today},项目启动,进行中,,\n`;
      }
      return `日期,阶段,状态,已完成,下一步,阻塞项\n${today},启动,进行中,,,\n`;
    }
    if (slot === 'goals') {
      return `# 项目目标\n\n## 总目标\n\n- 状态：进行中\n- 开始日期：${today}\n- 截止日期：\n- 负责人：\n- 备注：\n`;
    }
    if (slot === 'milestone') {
      return `# 项目里程碑\n\n## ${today}\n\n- 状态：进行中\n- 交付物：\n- 备注：\n`;
    }
    return `# 项目进度\n\n## 当前阶段\n\n- 状态：进行中\n- 已完成：\n- 下一步：\n- 阻塞项：无\n`;
  },

  async loadProjectControl(repoPath, files, saved = {}) {
    const findFile = pattern => files.find(file => pattern.test(file.fileName))?.fileName;
    const selections = {
      goalsFile: saved?.goalsFile || findFile(/goals?|目标/i) || 'PROJECT_GOALS.csv',
      progressFile: saved?.progressFile || findFile(/progress|进度/i) || 'PROJECT_PROGRESS.csv',
      milestoneFile: saved?.milestoneFile || findFile(/milestone|里程碑/i) || 'PROJECT_MILESTONES.csv'
    };
    const [goals, progress, milestone] = await Promise.all([
      window.gitFinder.fs.readProjectControlFile(repoPath, selections.goalsFile),
      window.gitFinder.fs.readProjectControlFile(repoPath, selections.progressFile),
      window.gitFinder.fs.readProjectControlFile(repoPath, selections.milestoneFile)
    ]);
    return { files, selections, goals, progress, milestone };
  },

  renderProjectProgress() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    this.switchControlSlot(AppState.controlSlot);
  },

  switchControlSlot(slot) {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl || !repo.projectControl[slot]) return;
    AppState.controlSlot = slot;
    document.querySelectorAll('.progress-format-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.controlSlot === slot);
    });

    const control = repo.projectControl;
    const file = control[slot];
    const selectionKey = this.getControlSelectionKey(slot);
    const selectedName = control.selections[selectionKey];
    const select = document.getElementById('progress-file-select');
    const options = [...control.files];
    if (!options.some(item => item.fileName === selectedName)) {
      options.push({ fileName: selectedName, format: file.format });
    }
    select.innerHTML = options.map(item =>
      `<option value="${this.escapeHtml(item.fileName)}">${this.escapeHtml(item.fileName)}</option>`
    ).join('');
    select.value = selectedName;

    if (!file.exists && !file.content) {
      file.content = this.getProjectControlTemplate(slot, file.format);
    }
    document.getElementById('progress-file-name').textContent = selectedName;
    document.getElementById('progress-editor').value = file.content || '';
    const preview = document.getElementById('progress-preview');
    preview.style.display = file.format === 'csv' ? '' : 'none';
    const addRowBtn = document.getElementById('control-add-row-btn');
    if (addRowBtn) addRowBtn.style.display = file.format === 'csv' ? '' : 'none';
    if (file.format === 'csv') this.renderProjectControlPreview(file.content || '');
    this.updateProgressSaveStatus(file.exists ? '已加载' : '保存后创建');
  },

  async selectProjectControlFile(fileName) {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl || !fileName) return;
    const slot = AppState.controlSlot;
    const selectionKey = this.getControlSelectionKey(slot);
    const file = await window.gitFinder.fs.readProjectControlFile(repo.path, fileName);
    repo.projectControl[slot] = file;
    repo.projectControl.selections[selectionKey] = fileName;
    await this.persistProjectControlSelections();
    this.switchControlSlot(slot);
  },

  async persistProjectControlSelections() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    const all = await window.gitFinder.config.get('projectControlSelections') || {};
    all[repo.path] = { ...repo.projectControl.selections };
    await window.gitFinder.config.set('projectControlSelections', all);
  },

  getProjectControlDefinitions() {
    return [
      { slot: 'goals', key: 'goalsFile', fileName: 'PROJECT_GOALS.csv' },
      { slot: 'progress', key: 'progressFile', fileName: 'PROJECT_PROGRESS.csv' },
      { slot: 'milestone', key: 'milestoneFile', fileName: 'PROJECT_MILESTONES.csv' }
    ];
  },

  getMissingProjectControlFiles(control) {
    if (!control) return this.getProjectControlDefinitions();
    return this.getProjectControlDefinitions().filter(def => {
      const fileName = control.selections?.[def.key] || def.fileName;
      const file = control[def.slot];
      return !file?.exists && !(control.files || []).some(item => item.fileName === fileName);
    });
  },

  async initializeProjectControlFiles(repoPath, control = null) {
    const files = control?.files || await window.gitFinder.fs.listProjectControlFiles(repoPath);
    const existingNames = new Set(files.map(file => file.fileName));
    const definitions = this.getProjectControlDefinitions();
    const created = [];

    for (const def of definitions) {
      const selectedName = control?.selections?.[def.key] || def.fileName;
      if (existingNames.has(selectedName)) continue;
      await window.gitFinder.fs.saveProjectControlFile(
        repoPath,
        selectedName,
        this.getProjectControlTemplate(def.slot, 'csv')
      );
      existingNames.add(selectedName);
      created.push(selectedName);
    }

    return created;
  },

  async initializeSelectedProjectControlFiles() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    this.updateProgressSaveStatus('初始化中...');
    try {
      const created = await this.initializeProjectControlFiles(repo.path, repo.projectControl);
      const files = await window.gitFinder.fs.listProjectControlFiles(repo.path);
      repo.projectControl = await this.loadProjectControl(repo.path, files, repo.projectControl.selections);
      await this.persistProjectControlSelections();
      this.switchControlSlot(AppState.controlSlot);
      this.updateProgressSaveStatus(created.length ? `已创建 ${created.length} 个控制文件` : '控制文件已存在');
    } catch (error) {
      this.updateProgressSaveStatus(`初始化失败：${error.message || error}`);
    }
  },

  async initializeProjectCardControlFiles(repoPath) {
    const card = document.querySelector(`.project-card[data-path="${this.cssEscape(repoPath)}"]`);
    if (!card) return;
    const button = card.querySelector('.project-control-init-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '初始化中...';
    }
    try {
      const savedSelections = await window.gitFinder.config.get('projectControlSelections');
      const files = await window.gitFinder.fs.listProjectControlFiles(repoPath);
      const control = await this.loadProjectControl(repoPath, files, savedSelections?.[repoPath]);
      await this.initializeProjectControlFiles(repoPath, control);
      const nextFiles = await window.gitFinder.fs.listProjectControlFiles(repoPath);
      const nextControl = await this.loadProjectControl(repoPath, nextFiles, control.selections);
      const repo = (AppState.enrichedRepos.length ? AppState.enrichedRepos : AppState.allRepos).find(item => item.path === repoPath) || { path: repoPath, name: repoPath.split(/[\\/]/).pop() };
      card.classList.remove('unavailable');
      card.innerHTML = this.getProjectCardContent(repo, nextControl);
    } catch (error) {
      card.classList.add('unavailable');
      const repo = (AppState.enrichedRepos.length ? AppState.enrichedRepos : AppState.allRepos).find(item => item.path === repoPath) || { path: repoPath, name: repoPath.split(/[\\/]/).pop() };
      card.innerHTML = this.getProjectCardUnavailableContent(repo, error);
    }
  },

  async createProjectControlCsv() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    const slot = AppState.controlSlot;
    const fileName = this.getDefaultControlFileName(slot);
    const existing = repo.projectControl.files.find(file => file.fileName === fileName);
    if (!existing) {
      await window.gitFinder.fs.saveProjectControlFile(
        repo.path,
        fileName,
        this.getProjectControlTemplate(slot, 'csv')
      );
      repo.projectControl.files = await window.gitFinder.fs.listProjectControlFiles(repo.path);
    }
    await this.selectProjectControlFile(fileName);
    this.updateProgressSaveStatus(existing ? '已选择现有文件' : 'CSV 已创建');
  },

  parseCsv(content) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (char === '"') {
        if (quoted && content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && content[i + 1] === '\n') i++;
        row.push(field);
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    return rows;
  },

  serializeCsv(rows) {
    return rows.map(row => row.map(value => {
      const text = String(value || '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\n') + '\n';
  },

  renderProjectControlPreview(content) {
    const preview = document.getElementById('progress-preview');
    const rows = this.parseCsv(content);
    if (rows.length === 0) {
      preview.innerHTML = '<div class="progress-empty">暂无记录</div>';
      return;
    }

    const [headers, ...items] = rows;
    preview.innerHTML = `
      <div class="milestone-table-wrap">
        <table class="milestone-table structured-control-table">
          <thead><tr>${headers.map(value => `<th>${this.escapeHtml(value)}</th>`).join('')}</tr></thead>
          <tbody>${items.map((row, rowIndex) => `
            <tr>${headers.map((_, index) => `
              <td>
                <input class="control-cell-input" data-row="${rowIndex}" data-col="${index}" value="${this.escapeHtml(row[index] || '')}">
              </td>
            `).join('')}</tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
    preview.querySelectorAll('.control-cell-input').forEach(input => {
      input.addEventListener('input', () => this.updateProjectControlFromStructuredTable());
    });
  },

  updateProjectControlFromStructuredTable() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    const slot = AppState.controlSlot;
    const file = repo.projectControl[slot];
    if (!file || file.format !== 'csv') return;

    const rows = this.parseCsv(file.content || '');
    if (!rows.length) return;
    const headers = rows[0];
    const body = [];
    document.querySelectorAll('#progress-preview tbody tr').forEach(tr => {
      const row = [];
      tr.querySelectorAll('.control-cell-input').forEach(input => {
        row[Number(input.dataset.col)] = input.value;
      });
      while (row.length < headers.length) row.push('');
      body.push(row);
    });
    file.content = this.serializeCsv([headers, ...body]);
    file.dirty = true;
    document.getElementById('progress-editor').value = file.content;
    this.updateProgressSaveStatus('未保存');
  },

  addProjectControlRow() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    const slot = AppState.controlSlot;
    const file = repo.projectControl[slot];
    if (!file || file.format !== 'csv') return;
    const rows = this.parseCsv(file.content || this.getProjectControlTemplate(slot, 'csv'));
    if (!rows.length) return;
    const emptyRow = rows[0].map(() => '');
    rows.push(emptyRow);
    file.content = this.serializeCsv(rows);
    file.dirty = true;
    document.getElementById('progress-editor').value = file.content;
    this.renderProjectControlPreview(file.content);
    this.updateProgressSaveStatus('未保存');
  },

  async saveProjectControlFile() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    const slot = AppState.controlSlot;
    const file = repo.projectControl[slot];
    const button = document.getElementById('progress-save-btn');
    button.disabled = true;
    this.updateProgressSaveStatus('保存中...');
    try {
      const saved = await window.gitFinder.fs.saveProjectControlFile(repo.path, file.fileName, file.content || '');
      repo.projectControl[slot] = { ...saved, dirty: false };
      repo.projectControl.files = await window.gitFinder.fs.listProjectControlFiles(repo.path);
      await this.persistProjectControlSelections();
      this.updateProgressSaveStatus('已保存');
    } catch (error) {
      this.updateProgressSaveStatus(`保存失败：${error.message || error}`);
    } finally {
      button.disabled = false;
    }
  },

  async syncProjectControlAgentRules() {
    const repo = AppState.selectedRepo;
    if (!repo?.projectControl) return;
    this.updateProgressSaveStatus('正在同步 AI 规则...');
    try {
      await window.gitFinder.fs.syncProjectControlAgentRules(repo.path, repo.projectControl.selections);
      this.updateProgressSaveStatus('AGENTS.md 已更新');
    } catch (error) {
      this.updateProgressSaveStatus(`规则同步失败：${error.message || error}`);
    }
  },

  updateProgressSaveStatus(message) {
    const status = document.getElementById('progress-save-status');
    if (status) status.textContent = message;
  },

  getControlSelectionKey(slot) {
    if (slot === 'goals') return 'goalsFile';
    if (slot === 'milestone') return 'milestoneFile';
    return 'progressFile';
  },

  getDefaultControlFileName(slot) {
    if (slot === 'goals') return 'PROJECT_GOALS.csv';
    if (slot === 'milestone') return 'PROJECT_MILESTONES.csv';
    return 'PROJECT_PROGRESS.csv';
  },

  normalizeProjectHeader(value) {
    const text = String(value || '').trim().toLowerCase();
    const map = {
      '目标': 'title',
      '项目目标': 'title',
      '名称': 'name',
      '任务': 'title',
      '阶段': 'phase',
      '里程碑': 'milestone',
      '状态': 'status',
      '日期': 'date',
      '开始': 'start',
      '开始日期': 'start',
      '结束': 'end',
      '截止': 'end',
      '截止日期': 'end',
      '完成日期': 'end',
      '阻塞项': 'blocker',
      '阻塞': 'blocker',
      '备注': 'description',
      '说明': 'description',
      '已完成': 'done',
      '下一步': 'next'
    };
    return map[text] || text.replace(/\s+/g, '');
  },

  parseProjectRows(file) {
    if (!file?.content) return [];
    if (file.format === 'csv') {
      const rows = this.parseCsv(file.content);
      if (rows.length < 2) return [];
      const headers = rows[0].map(header => this.normalizeProjectHeader(header));
      return rows.slice(1).map(row => {
        const item = {};
        headers.forEach((header, index) => {
          item[header] = (row[index] || '').trim();
        });
        return item;
      }).filter(item => Object.values(item).some(Boolean));
    }
    const sections = [];
    let current = null;
    for (const rawLine of file.content.split(/\r?\n/)) {
      const line = rawLine.trim();
      const heading = line.match(/^#{1,3}\s+(.+)/);
      if (heading) {
        current = { title: heading[1].trim() };
        sections.push(current);
        continue;
      }
      const pair = line.match(/^[-*]\s*([^：:]+)[：:]\s*(.*)$/);
      if (pair && current) {
        current[this.normalizeProjectHeader(pair[1])] = pair[2].trim();
      }
    }
    return sections;
  },

  parseProjectDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  },

  formatDateShort(date) {
    if (!date) return '';
    return `${date.getMonth() + 1}/${date.getDate()}`;
  },

  isDoneStatus(status) {
    return /完成|已完成|done|closed|complete/i.test(status || '');
  },

  cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  },

  escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  },

  safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#86868b';
  },

  updateStatusBar() {
    const left = document.getElementById('status-left');
    const right = document.getElementById('status-right');

    let leftText = '';
    let rightText = '';

    if (AppState.currentMode === 'settings') {
      leftText = '应用设置';
      rightText = '本机偏好 · 不写入项目配置';
    } else if (AppState.currentMode === 'relationships') {
      const summary = AppState.relationshipSummary;
      leftText = summary ? `关系白板：${summary.boardName}` : '关系白板';
      rightText = summary
        ? `${summary.nodeCount} 个节点 · ${summary.relationshipCount} 条关系 · 仅本机配置`
        : '关系事实与画布布局分离 · 不执行部署';
    } else if (this.isGlobalSearchActive()) {
      const meta = AppState.globalSearchMeta || {};
      leftText = `全局搜索：${AppState.searchQuery.trim()}`;
      rightText = AppState.globalSearchLoading
        ? '正在搜索…'
        : `${Number(meta.totalMatches || 0)} 个匹配 · 已索引 ${Number(meta.indexedCount || 0)} 项`;
    } else if (AppState.currentMode === 'tasks') {
      leftText = `开发任务：${AppState.taskPortfolio?.projects?.length || 0} 个项目`;
      if (AppState.taskViewMode === 'timeline') {
        const timeline = AppState.taskPortfolio?.timeline || [];
        const visible = this.getFilteredProjectTimeline ? this.getFilteredProjectTimeline() : timeline;
        const tests = visible.filter(event => (
          Array.isArray(event.categories) ? event.categories : [event.category]
        ).includes('test')).length;
        rightText = `${visible.length} 条历史 · 测试相关 ${tests} · LPM 权威只读`;
      } else if (AppState.taskViewMode === 'milestones') {
        const milestones = AppState.taskPortfolio?.milestones || [];
        const visible = this.getFilteredProjectMilestones ? this.getFilteredProjectMilestones() : milestones;
        const overdue = visible.filter(milestone => milestone.overdue).length;
        const waiting = visible.filter(milestone => milestone.status === '所有自动检查通过，待人工验收').length;
        rightText = `${visible.length} 个里程碑 · 逾期 ${overdue} · 待人工验收 ${waiting} · LPM 权威写回`;
      } else if (AppState.taskViewMode === 'relations') {
        const tasks = AppState.taskPortfolio?.tasks || [];
        const dependencies = AppState.taskPortfolio?.dependencies || [];
        const visible = this.getFilteredProjectRelationTasks ? this.getFilteredProjectRelationTasks() : [];
        const metrics = window.ProjectTaskRelations.metrics(tasks, dependencies, AppState.taskFilters.projectId);
        rightText = `${visible.length} 个关系任务 · ${metrics.dependencyCount} 条依赖 · ${metrics.pendingAcceptanceCount} 个待验收 · LPM 权威只读`;
      } else {
        const tasks = AppState.taskPortfolio?.tasks || [];
        const visible = this.getFilteredProjectTasks ? this.getFilteredProjectTasks() : tasks;
        const blocked = visible.filter(task => task.status === '阻塞').length;
        const overdue = visible.filter(task => task.overdue).length;
        rightText = `${visible.length} 个任务 · 逾期 ${overdue} · 阻塞 ${blocked} · LPM 权威写回`;
      }
    } else if (AppState.currentMode === 'dashboard') {
      const stats = AppState.dashboardStats;
      leftText = `项目仪表板：${this.getSelectedCategoryLabel()}`;
      rightText = stats ? `${stats.total} 个项目 · 延期 ${stats.delayed} · 阻塞 ${stats.blocked} · 停滞 ${stats.stalled}` : '';
    } else if (this.contentCollectionKind() === 'file-labels') {
      const meta = AppState.fileLabelCollectionMeta || {};
      const selectedCount = AppState.selectedPaths.size;
      leftText = `所有位置 · ${this.fileLabelCollectionTitle().replace(/^标签：/u, '文件标签：')}`;
      rightText = `${AppState.visibleItems.length} / ${Number(meta.totalAssigned || 0)} 项`
        + (selectedCount ? ` · 已选择 ${selectedCount}` : '')
        + (Number(meta.unavailableCount || 0) ? ` · ${Number(meta.unavailableCount)} 个不可用` : '')
        + (Number(meta.truncatedCount || 0) ? ` · ${Number(meta.truncatedCount)} 个未显示` : '');
    } else if (['projects', 'project-repositories'].includes(this.contentCollectionKind())) {
      const visibleProjects = this.contentCollectionKind() === 'project-repositories'
        ? AppState.localProjects.filter(project => project.rootIsGitRepo === true)
        : AppState.localProjects;
      const totalRepositories = AppState.localProjects.reduce((total, project) => total + Number(project.repositoryCount || 0), 0);
      leftText = `所有位置 · ${visibleProjects.length} 个本地项目`;
      rightText = `${totalRepositories} 个内部仓库 · 项目身份与 Git 属性独立`;
    } else if (this.contentCollectionKind() === 'repositories') {
      const statusRepos = AppState.enrichedRepos.length ? AppState.enrichedRepos : AppState.allRepos;
      const total = statusRepos.length;
      const dirty = statusRepos.filter(r => r.gitStatus?.overallStatus === 'dirty').length;
      const ahead = statusRepos.filter(r => r.gitStatus?.overallStatus === 'ahead').length;
      leftText = `所有位置 · ${total} 个仓库`;
      rightText = `需关注: ${dirty + ahead}`;
    } else if (AppState.currentPath) {
      leftText = AppState.currentPath;
      const selectedCount = AppState.selectedPaths.size;
      const visibleCount = AppState.visibleItems.length;
      const progress = AppState.directoryRenderProgress;
      const directoryLoadStatus = window.DirectoryLoadState.status(AppState);
      if (directoryLoadStatus === 'loading') {
        rightText = '正在载入当前文件夹…';
      } else if (directoryLoadStatus === 'error') {
        rightText = '当前文件夹无法载入';
      } else if (progress
          && progress.requestId === AppState.directoryRenderRequestId
          && progress.path === AppState.currentPath) {
        const progressText = window.ProgressiveDirectoryRender.progressLabel(progress.rendered, progress.total);
        rightText = selectedCount ? `${progressText} · 已选择 ${selectedCount}` : progressText;
      } else {
        rightText = selectedCount ? `已选择 ${selectedCount} / ${visibleCount} 项` : `${visibleCount} 项`;
      }
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
