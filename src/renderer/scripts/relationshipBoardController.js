(function exposeRelationshipBoardController(root, factory) {
  const api = factory(root?.RelationshipGraphModel);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RelationshipBoardController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRelationshipBoardController(Model) {
  const NODE_WIDTH = 236;
  const NODE_HEIGHT = 94;
  const COMPACT_NODE_WIDTH = 180;
  const COMPACT_NODE_HEIGHT = 54;
  const GRID_SIZE = 24;
  const HISTORY_LIMIT = 50;
  const TYPE_LABELS = Object.freeze({
    server: '服务器',
    deployment: '部署',
    project: '项目',
    repository: 'Git 仓库',
    endpoint: '访问端点',
    group: '分组'
  });
  const TYPE_ICONS = Object.freeze({
    server: '▰',
    deployment: '◆',
    project: '▣',
    repository: '⑂',
    endpoint: '↗',
    group: '▢'
  });
  const RELATIONSHIP_LABELS = Object.freeze({
    contains: '包含',
    source_of: '部署来源',
    runs_on: '运行于',
    exposes: '对外提供',
    depends_on: '依赖'
  });
  const FACT_SOURCE_LABELS = Object.freeze({
    manual: '人工声明',
    imported: '外部导入',
    observed: '只读观测',
    'gitfinder-registry': 'GitFinder 注册表'
  });
  const VERIFICATION_LABELS = Object.freeze({
    all: '全部状态',
    unverified: '待验证',
    verified: '已验证',
    stale: '待复核'
  });
  const DETAIL_FIELD_DEFINITIONS = Object.freeze({
    server: [
      { key: 'environment', label: '环境', maxLength: 240 },
      { key: 'hostLabel', label: '主机标签', maxLength: 240 },
      { key: 'notes', label: '备注', maxLength: 1000, multiline: true }
    ],
    deployment: [
      { key: 'environment', label: '环境', maxLength: 240 },
      { key: 'version', label: '版本', maxLength: 240 },
      { key: 'branch', label: '分支', maxLength: 240 },
      { key: 'revision', label: '提交', maxLength: 240 },
      { key: 'status', label: '声明状态', maxLength: 240 },
      { key: 'notes', label: '备注', maxLength: 1000, multiline: true }
    ],
    endpoint: [
      { key: 'urlLabel', label: '地址标签', maxLength: 240 },
      { key: 'notes', label: '备注', maxLength: 1000, multiline: true }
    ],
    group: [{ key: 'notes', label: '备注', maxLength: 1000, multiline: true }]
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function makeId(prefix) {
    const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
    return `${prefix}_${random}`;
  }

  function escapeSelectorValue(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value || ''));
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, character => `\\${character.codePointAt(0).toString(16)} `);
  }

  function activeBoard(store) {
    return store.boards.find(board => board.id === store.activeBoardId) || store.boards[0] || null;
  }

  function dateTimeLocalValue(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function localDateTimeToIso(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    const date = new Date(input);
    if (!Number.isFinite(date.getTime())) throw new Error('验证时间无效');
    return date.toISOString();
  }

  class Controller {
    constructor(options = {}) {
      if (!Model) throw new Error('RelationshipGraphModel 未加载');
      this.bridge = options.bridge;
      this.notify = options.notify || (() => {});
      this.onSummaryChanged = options.onSummaryChanged || (() => {});
      this.store = null;
      this.resources = [];
      this.resourceMap = new Map();
      this.container = null;
      this.root = null;
      this.loaded = false;
      this.loadingPromise = null;
      this.undoStack = [];
      this.redoStack = [];
      this.selectedEntityId = '';
      this.selectedEntityIds = new Set();
      this.selectedRelationshipId = '';
      this.keyboardConnectSourceId = '';
      this.pointerAction = null;
      this.suppressNextNodeClick = false;
      this.saveTimer = null;
      this.saveChain = Promise.resolve();
      this.saveState = 'saved';
      this.resourceSearch = '';
      this.importInFlight = false;
      this.now = options.now || (() => new Date());
      this._boundKeydown = event => this._handleKeydown(event);
    }

    async open(container) {
      if (!container) return;
      if (this.container === container && this.root?.isConnected) return;
      this.close({ preserveContainer: true });
      this.container = container;
      container.innerHTML = '<div class="relationship-loading"><div class="loading-spinner"></div><span>正在载入关系白板…</span></div>';
      try {
        await this._load();
        if (!this.store.boards.length) {
          const boardId = makeId('board');
          this.store.boards.push({
            id: boardId,
            name: '部署关系',
            viewport: { x: 120, y: 90, zoom: 1 },
            view: Model.defaultBoardView(),
            placements: []
          });
          this.store.activeBoardId = boardId;
          await this._persistNow();
        }
        this.render();
        document.addEventListener('keydown', this._boundKeydown, true);
      } catch (error) {
        container.innerHTML = `
          <div class="relationship-error" role="alert">
            <strong>关系白板无法载入</strong>
            <span>${escapeHtml(error?.message || String(error))}</span>
            <button class="btn" data-relationship-retry type="button">重新载入</button>
          </div>`;
        container.querySelector('[data-relationship-retry]')?.addEventListener('click', () => {
          this.loaded = false;
          this.loadingPromise = null;
          this.open(container);
        });
      }
    }

    close(options = {}) {
      document.removeEventListener('keydown', this._boundKeydown, true);
      this._cancelPointerAction(true);
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.store) this._persistNow();
      }
      this.root = null;
      if (!options.preserveContainer) this.container = null;
    }

    async _load() {
      if (this.loaded) return;
      if (this.loadingPromise) return this.loadingPromise;
      this.loadingPromise = Promise.all([
        this.bridge.relationshipBoards.get(),
        this.bridge.localProjects.list().catch(() => []),
        this.bridge.repos.getRegistry().catch(() => ({ repos: [] }))
      ]).then(([result, projects, registry]) => {
        this.store = Model.normalizeStore(result?.store).value;
        this._setResources(projects, registry?.repos || []);
        this.loaded = true;
        if (result?.recovered) {
          const suffix = result.backupPath ? '；原文件已备份' : '';
          this.notify(`关系白板已从异常配置中恢复${suffix}`, 'warning');
        }
      }).finally(() => {
        this.loadingPromise = null;
      });
      return this.loadingPromise;
    }

    _setResources(projects, repositories) {
      const resources = [];
      for (const project of Array.isArray(projects) ? projects : []) {
        if (!project?.projectId) continue;
        resources.push({
          key: `project:${project.projectId}`,
          kind: 'project',
          refId: project.projectId,
          name: project.name || '未命名项目',
          path: project.path || '',
          secondary: project.lifecycle || '项目'
        });
      }
      for (const repository of Array.isArray(repositories) ? repositories : []) {
        if (!repository?.id || repository.archived === true) continue;
        resources.push({
          key: `repository:${repository.id}`,
          kind: 'repository',
          refId: repository.id,
          name: repository.name || String(repository.path || '').split(/[\\/]/).filter(Boolean).at(-1) || '未命名仓库',
          path: repository.path || '',
          secondary: 'Git 仓库'
        });
      }
      resources.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      this.resources = resources;
      this.resourceMap = new Map(resources.map(resource => [resource.key, resource]));
    }

    revealResource(kind, refId) {
      if (!['project', 'repository'].includes(kind) || !refId || !this.store) return false;
      const resource = this.resourceMap.get(`${kind}:${refId}`);
      const board = activeBoard(this.store);
      if (!resource || !board) {
        this.notify('此项目或仓库已不在当前 GitFinder 注册表中', 'warning');
        return false;
      }

      let entity = this.store.entities.find(candidate => candidate.type === kind && candidate.refId === refId);
      let placement = entity && board.placements.find(candidate => candidate.entityId === entity.id);
      if (!placement) {
        if (!entity && this.store.entities.length >= Model.MAX_ENTITIES) {
          this.notify(`最多保存 ${Model.MAX_ENTITIES} 个关系节点`, 'warning');
          return false;
        }
        this._recordMutation();
        if (!entity) {
          entity = {
            id: makeId('entity'),
            type: kind,
            name: resource.name,
            refId,
            details: {},
            source: 'gitfinder-registry'
          };
          this.store.entities.push(entity);
        }
        const fallbackIndex = board.placements.length;
        placement = {
          entityId: entity.id,
          x: 80 + (fallbackIndex % 3) * 280,
          y: 80 + Math.floor(fallbackIndex / 3) * 140
        };
        board.placements.push(placement);
        this._refreshHistoryButtons();
      }

      if (this._hasActiveFilters(board.view)) {
        const { mode, projection } = this._boardView();
        board.view = { ...Model.defaultBoardView(), mode, projection: projection || 'facts' };
      }
      this._selectOnlyEntity(entity.id);
      this.keyboardConnectSourceId = '';
      const canvas = this.root?.querySelector('.relationship-canvas');
      const rect = canvas?.getBoundingClientRect();
      if (rect?.width && rect?.height) {
        const { width, height } = this._nodeDimensions();
        const zoom = board.viewport.zoom;
        board.viewport.x = rect.width / 2 - (placement.x + width / 2) * zoom;
        board.viewport.y = rect.height / 2 - (placement.y + height / 2) * zoom;
      }
      this._applyViewMode();
      this._persistSoon(0);
      this._renderGraph();
      this._updateFilterSummary();
      this._updateSummary();
      this._setCanvasAnnouncement(`已在白板中显示 ${resource.name}`);
      return true;
    }

    _environmentOptions(selectedValue = '') {
      const values = new Set();
      for (const entity of this.store?.entities || []) {
        const value = Model.cleanText(entity.details?.environment, 80);
        if (value) values.add(value);
      }
      if (selectedValue) values.add(selectedValue);
      const options = [...values].sort((left, right) => left.localeCompare(right, 'zh-CN'));
      return `<option value=""${selectedValue ? '' : ' selected'}>全部环境</option>` + options.map(value => (
        `<option value="${escapeHtml(value)}"${selectedValue === value ? ' selected' : ''}>${escapeHtml(value)}</option>`
      )).join('');
    }

    _boardView() {
      const board = activeBoard(this.store);
      if (!board) return Model.defaultBoardView();
      if (!board.view) board.view = Model.defaultBoardView();
      return board.view;
    }

    _nodeDimensions() {
      return this._boardView().mode === 'compact'
        ? { width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT }
        : { width: NODE_WIDTH, height: NODE_HEIGHT };
    }

    _entitySelectionIds() {
      const selected = new Set(this.selectedEntityIds || []);
      if (this.selectedEntityId) selected.add(this.selectedEntityId);
      return selected;
    }

    _selectOnlyEntity(entityId) {
      this.selectedEntityIds = entityId ? new Set([entityId]) : new Set();
      this.selectedEntityId = entityId || '';
      this.selectedRelationshipId = '';
    }

    _clearEntitySelection() {
      this.selectedEntityIds = new Set();
      this.selectedEntityId = '';
    }

    _setEntitySelection(entityIds, primaryId = '') {
      this.selectedEntityIds = new Set(entityIds || []);
      this.selectedEntityId = this.selectedEntityIds.has(primaryId)
        ? primaryId
        : (this.selectedEntityIds.values().next().value || '');
      this.selectedRelationshipId = '';
    }

    _pruneEntitySelection(visibleIds) {
      const selectedIds = this._entitySelectionIds();
      if (!selectedIds.size) return;
      this._setEntitySelection(
        [...selectedIds].filter(entityId => visibleIds.has(entityId)),
        this.selectedEntityId
      );
    }

    _hasActiveFilters(view = this._boardView()) {
      return Boolean(view.query || view.entityType !== 'all' || view.environment || view.verification !== 'all');
    }

    _activeFilterCount(view = this._boardView()) {
      return [view.query, view.entityType !== 'all', view.environment, view.verification !== 'all'].filter(Boolean).length;
    }

    _entityMatchesView(entity, view, resource) {
      if (view.entityType !== 'all' && entity.type !== view.entityType) return false;
      if (view.environment && Model.cleanText(entity.details?.environment, 80) !== view.environment) return false;
      if (view.verification !== 'all') {
        const status = Model.verificationStatus(entity, { now: this.now() });
        if (status.state !== view.verification) return false;
      }
      const query = view.query.toLocaleLowerCase('zh-CN');
      if (!query) return true;
      const details = Object.values(entity.details || {}).join(' ');
      const haystack = [
        resource?.name,
        resource?.path,
        resource?.secondary,
        entity.name,
        entity.refId,
        TYPE_LABELS[entity.type],
        details,
        entity.evidenceSummary
      ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
      return haystack.includes(query);
    }

    _summaryVerificationState(facts) {
      const states = facts.map(fact => Model.verificationStatus(fact, { now: this.now() }).state);
      if (states.includes('unverified')) return 'unverified';
      if (states.includes('stale')) return 'stale';
      return 'verified';
    }

    _deploymentSummaryProjection(graph, entitiesById) {
      if (this._boardView().projection !== 'deployment-summary') {
        return { ...graph, summaryRelationships: [] };
      }
      const contains = graph.relationships.filter(item => item.type === 'contains');
      const sourceOf = graph.relationships.filter(item => item.type === 'source_of');
      const runsOn = graph.relationships.filter(item => item.type === 'runs_on');
      const sourceByRepository = new Map();
      const runsByDeployment = new Map();
      for (const relationship of sourceOf) {
        if (!sourceByRepository.has(relationship.sourceId)) sourceByRepository.set(relationship.sourceId, []);
        sourceByRepository.get(relationship.sourceId).push(relationship);
      }
      for (const relationship of runsOn) {
        if (!runsByDeployment.has(relationship.sourceId)) runsByDeployment.set(relationship.sourceId, []);
        runsByDeployment.get(relationship.sourceId).push(relationship);
      }

      const chains = [];
      for (const projectToRepository of contains) {
        for (const repositoryToDeployment of sourceByRepository.get(projectToRepository.targetId) || []) {
          for (const deploymentToServer of runsByDeployment.get(repositoryToDeployment.targetId) || []) {
            chains.push({
              projectId: projectToRepository.sourceId,
              repositoryId: projectToRepository.targetId,
              deploymentId: repositoryToDeployment.targetId,
              serverId: deploymentToServer.targetId,
              facts: [projectToRepository, repositoryToDeployment, deploymentToServer]
            });
          }
        }
      }
      if (!chains.length) return { ...graph, summaryRelationships: [] };

      const relationshipsByEntity = new Map();
      for (const relationship of graph.relationships) {
        for (const entityId of [relationship.sourceId, relationship.targetId]) {
          if (!relationshipsByEntity.has(entityId)) relationshipsByEntity.set(entityId, []);
          relationshipsByEntity.get(entityId).push(relationship);
        }
      }
      const protectedIds = graph.filterActive ? graph.directIds : new Set();
      let deploymentIds = new Set(chains.map(chain => chain.deploymentId).filter(entityId => {
        if (protectedIds.has(entityId)) return false;
        const relationships = relationshipsByEntity.get(entityId) || [];
        return relationships.length > 0 && relationships.every(relationship => (
          (relationship.type === 'source_of' && relationship.targetId === entityId)
          || (relationship.type === 'runs_on' && relationship.sourceId === entityId)
        ));
      }));
      let repositoryIds = new Set(chains.map(chain => chain.repositoryId).filter(entityId => {
        if (protectedIds.has(entityId)) return false;
        const relationships = relationshipsByEntity.get(entityId) || [];
        return relationships.length > 0 && relationships.every(relationship => (
          (relationship.type === 'contains' && relationship.targetId === entityId)
          || (relationship.type === 'source_of' && relationship.sourceId === entityId && deploymentIds.has(relationship.targetId))
        ));
      }));

      let changed = true;
      while (changed) {
        changed = false;
        const nextDeployments = new Set([...deploymentIds].filter(entityId => (
          (relationshipsByEntity.get(entityId) || []).every(relationship => (
            relationship.type !== 'source_of' || repositoryIds.has(relationship.sourceId)
          ))
        )));
        const nextRepositories = new Set([...repositoryIds].filter(entityId => (
          (relationshipsByEntity.get(entityId) || []).every(relationship => (
            relationship.type !== 'source_of' || nextDeployments.has(relationship.targetId)
          ))
        )));
        if (nextDeployments.size !== deploymentIds.size || nextRepositories.size !== repositoryIds.size) changed = true;
        deploymentIds = nextDeployments;
        repositoryIds = nextRepositories;
      }

      const projectedChains = chains.filter(chain => (
        repositoryIds.has(chain.repositoryId) && deploymentIds.has(chain.deploymentId)
      ));
      if (!projectedChains.length) return { ...graph, summaryRelationships: [] };
      const collapsedIds = new Set([
        ...projectedChains.map(chain => chain.repositoryId),
        ...projectedChains.map(chain => chain.deploymentId)
      ]);
      const summaries = new Map();
      for (const chain of projectedChains) {
        const key = `${chain.projectId}\u0000${chain.serverId}`;
        if (!summaries.has(key)) {
          summaries.set(key, {
            id: `summary_${chain.projectId}_${chain.serverId}`,
            type: 'deployment_summary',
            sourceId: chain.projectId,
            targetId: chain.serverId,
            chains: []
          });
        }
        summaries.get(key).chains.push(chain);
      }
      const summaryRelationships = [...summaries.values()].map(summary => {
        const deployments = [...new Set(summary.chains.map(chain => chain.deploymentId))];
        const deploymentLabels = deployments.map(entityId => {
          const entity = entitiesById.get(entityId);
          return [
            entity?.name,
            entity?.details?.environment,
            entity?.details?.version,
            entity?.details?.branch,
            entity?.details?.revision
          ].filter(Boolean).join(' · ');
        }).filter(Boolean);
        const facts = summary.chains.flatMap(chain => chain.facts);
        return {
          ...summary,
          count: deployments.length,
          label: deployments.length > 1 ? `部署 ×${deployments.length}` : '部署',
          title: deploymentLabels.join('；'),
          verificationState: this._summaryVerificationState(facts)
        };
      });
      return {
        ...graph,
        placements: graph.placements.filter(placement => !collapsedIds.has(placement.entityId)),
        relationships: graph.relationships.filter(relationship => (
          !collapsedIds.has(relationship.sourceId) && !collapsedIds.has(relationship.targetId)
        )),
        summaryRelationships,
        directIds: new Set([...graph.directIds].filter(entityId => !collapsedIds.has(entityId))),
        contextualIds: new Set([...graph.contextualIds].filter(entityId => !collapsedIds.has(entityId)))
      };
    }

    _filteredGraph() {
      const board = activeBoard(this.store);
      if (!board) return { placements: [], relationships: [], summaryRelationships: [], directIds: new Set(), contextualIds: new Set(), filterActive: false };
      const view = this._boardView();
      const entitiesById = new Map(this.store.entities.map(entity => [entity.id, entity]));
      const placedIds = new Set(board.placements.map(placement => placement.entityId));
      const boardRelationships = this.store.relationships.filter(relationship => (
        placedIds.has(relationship.sourceId) && placedIds.has(relationship.targetId)
      ));
      const filterActive = this._hasActiveFilters(view);
      const directIds = new Set();
      for (const placement of board.placements) {
        const entity = entitiesById.get(placement.entityId);
        if (!entity) continue;
        const resource = entity.refId ? this.resourceMap.get(`${entity.type}:${entity.refId}`) : null;
        if (!filterActive || this._entityMatchesView(entity, view, resource)) directIds.add(entity.id);
      }
      const visibleIds = new Set(directIds);
      if (filterActive) {
        for (const relationship of boardRelationships) {
          if (directIds.has(relationship.sourceId) || directIds.has(relationship.targetId)) {
            visibleIds.add(relationship.sourceId);
            visibleIds.add(relationship.targetId);
          }
        }
      }
      const contextualIds = new Set([...visibleIds].filter(entityId => !directIds.has(entityId)));
      return this._deploymentSummaryProjection({
        placements: board.placements.filter(placement => visibleIds.has(placement.entityId)),
        relationships: boardRelationships.filter(relationship => (
          visibleIds.has(relationship.sourceId) && visibleIds.has(relationship.targetId)
        )),
        directIds,
        contextualIds,
        filterActive
      }, entitiesById);
    }

    render() {
      const board = activeBoard(this.store);
      if (!this.container || !board) return;
      if (!board.view) board.view = Model.defaultBoardView();
      const boardOptions = this.store.boards.map(candidate => (
        `<option value="${escapeHtml(candidate.id)}"${candidate.id === board.id ? ' selected' : ''}>${escapeHtml(candidate.name)}</option>`
      )).join('');
      const environmentOptions = this._environmentOptions(board.view.environment);
      const entityTypeOptions = [
        ['all', '全部类型'],
        ...Model.ENTITY_TYPES.map(type => [type, TYPE_LABELS[type]])
      ].map(([value, label]) => (
        `<option value="${value}"${board.view.entityType === value ? ' selected' : ''}>${label}</option>`
      )).join('');
      const verificationOptions = Model.VERIFICATION_FILTERS.map(value => (
        `<option value="${value}"${board.view.verification === value ? ' selected' : ''}>${VERIFICATION_LABELS[value]}</option>`
      )).join('');
      this.container.innerHTML = `
        <section class="relationship-workspace" aria-label="关系白板">
          <header class="relationship-toolbar">
            <div class="relationship-board-control">
              <label class="sr-only" for="relationship-board-select">当前白板</label>
              <select id="relationship-board-select" title="切换白板">${boardOptions}</select>
              <button class="relationship-tool-button" data-relationship-action="new-board" type="button" title="新建白板" aria-label="新建白板">＋</button>
              <button class="relationship-tool-button" data-relationship-action="rename-board" type="button" title="重命名白板" aria-label="重命名白板">✎</button>
            </div>
            <div class="relationship-toolbar-spacer"></div>
            <div class="relationship-filter-host">
              <button class="relationship-tool-button relationship-filter-trigger" data-relationship-action="toggle-filter-menu" type="button" aria-haspopup="dialog" aria-expanded="false">
                <span aria-hidden="true">⌕</span><span>筛选</span><span class="relationship-filter-count" hidden></span><span aria-hidden="true">⌄</span>
              </button>
              <div class="relationship-filter-popover" role="dialog" aria-label="筛选白板内容" hidden>
                <form data-relationship-filter-form>
                  <header><strong>筛选白板内容</strong><small>匹配结果会保留一跳关系上下文</small></header>
                  <label class="relationship-filter-search">
                    <span aria-hidden="true">⌕</span>
                    <input name="query" type="search" maxlength="120" placeholder="搜索名称、环境或说明" value="${escapeHtml(board.view.query)}" autocomplete="off">
                  </label>
                  <div class="relationship-filter-grid">
                    <label><span>节点类型</span><select name="entityType">${entityTypeOptions}</select></label>
                    <label><span>环境</span><select name="environment">${environmentOptions}</select></label>
                    <label><span>核验状态</span><select name="verification">${verificationOptions}</select></label>
                    <label><span>节点显示</span><select name="mode"><option value="full"${board.view.mode === 'full' ? ' selected' : ''}>完整</option><option value="compact"${board.view.mode === 'compact' ? ' selected' : ''}>精简</option></select></label>
                    <label><span>关系层级</span><select name="projection"><option value="facts"${board.view.projection === 'facts' ? ' selected' : ''}>完整事实</option><option value="deployment-summary"${board.view.projection === 'deployment-summary' ? ' selected' : ''}>部署摘要</option></select></label>
                  </div>
                  <footer><span class="relationship-filter-summary" role="status"></span><button type="button" data-relationship-action="clear-filters">清除筛选</button></footer>
                </form>
              </div>
            </div>
            <div class="relationship-menu-host">
              <button class="relationship-tool-button relationship-add-trigger" data-relationship-action="toggle-add-menu" type="button" aria-haspopup="menu" aria-expanded="false">
                添加节点 <span aria-hidden="true">⌄</span>
              </button>
              <div class="relationship-add-menu" role="menu" hidden>
                <button type="button" role="menuitem" data-add-node-type="server"><span>▰</span><span>服务器</span><small>不保存登录凭据</small></button>
                <button type="button" role="menuitem" data-add-node-type="deployment"><span>◆</span><span>部署</span><small>环境与状态</small></button>
                <button type="button" role="menuitem" data-add-node-type="endpoint"><span>↗</span><span>访问端点</span><small>仅显示标签</small></button>
                <button type="button" role="menuitem" data-add-node-type="group"><span>▢</span><span>分组</span><small>视觉整理</small></button>
                <div class="relationship-menu-separator" role="separator"></div>
                <button type="button" role="menuitem" data-relationship-action="connect-coolify"><span>◎</span><span>连接 Coolify…</span><small>只读发现，确认后合并</small></button>
                <button type="button" role="menuitem" data-relationship-action="import-json"><span>⇩</span><span>导入 JSON…</span><small>先预览差异再合并</small></button>
              </div>
            </div>
            <span class="relationship-toolbar-divider" aria-hidden="true"></span>
            <button class="relationship-tool-button" data-relationship-action="undo" type="button" title="撤销 (⌘Z)" ${this.undoStack.length ? '' : 'disabled'}>↶</button>
            <button class="relationship-tool-button" data-relationship-action="redo" type="button" title="重做 (⇧⌘Z)" ${this.redoStack.length ? '' : 'disabled'}>↷</button>
            <button class="relationship-tool-button" data-relationship-action="fit" type="button" title="适合内容">适合</button>
            <span class="relationship-save-state" data-state="${this.saveState}" role="status">${this._saveLabel()}</span>
          </header>
          <div class="relationship-body">
            <aside class="relationship-resource-panel" aria-label="可用项目与仓库">
              <div class="relationship-resource-heading">
                <div><strong>资源</strong><small>拖入白板</small></div>
                <span>${this.resources.length}</span>
              </div>
              <label class="relationship-resource-search">
                <span aria-hidden="true">⌕</span>
                <input type="search" placeholder="筛选项目或仓库" value="${escapeHtml(this.resourceSearch)}" aria-label="筛选项目或仓库">
              </label>
              <div class="relationship-resource-list"></div>
              <div class="relationship-boundary-note">只引用稳定身份；路径移动后自动重新解析。不会部署、连接服务器或修改 Git。</div>
            </aside>
            <div class="relationship-canvas" tabindex="0" aria-label="关系画布。拖动空白区域平移，滚轮缩放，方向键移动选中节点。">
              <div class="relationship-world">
                <svg class="relationship-edge-layer" aria-label="节点关系"></svg>
                <div class="relationship-node-layer"></div>
                <div class="relationship-selection-box" hidden></div>
              </div>
              <div class="relationship-canvas-help">拖动节点 · Shift 拖框选择 · 从右侧连接点连线 · 滚轮缩放</div>
              <div class="relationship-projection-note" hidden>部署摘要 · 派生显示，不修改关系事实</div>
            </div>
            <aside class="relationship-inspector-panel" aria-label="关系详情" hidden></aside>
          </div>
        </section>`;
      this.root = this.container.querySelector('.relationship-workspace');
      this._bindRootEvents();
      this._applyViewMode();
      this._renderResources();
      this._renderGraph();
      this._updateFilterSummary();
      this._updateSummary();
    }

    _bindRootEvents() {
      this.root.addEventListener('click', event => this._handleClick(event));
      this.root.addEventListener('change', event => this._handleChange(event));
      this.root.addEventListener('input', event => this._handleInput(event));
      this.root.addEventListener('submit', event => this._handleSubmit(event));
      this.root.addEventListener('dragstart', event => this._handleDragStart(event));
      this.root.addEventListener('dragover', event => this._handleDragOver(event));
      this.root.addEventListener('drop', event => this._handleDrop(event));
      this.root.addEventListener('pointerdown', event => this._handlePointerDown(event));
      this.root.addEventListener('pointermove', event => this._handlePointerMove(event));
      this.root.addEventListener('pointerup', event => this._handlePointerUp(event));
      this.root.addEventListener('pointercancel', () => this._cancelPointerAction(false));
      this.root.querySelector('.relationship-canvas')?.addEventListener('wheel', event => this._handleWheel(event), { passive: false });
    }

    _handleClick(event) {
      const action = event.target.closest('[data-relationship-action]')?.dataset.relationshipAction;
      if (action === 'toggle-filter-menu') {
        const popover = this.root.querySelector('.relationship-filter-popover');
        const trigger = this.root.querySelector('.relationship-filter-trigger');
        const addMenu = this.root.querySelector('.relationship-add-menu');
        const addTrigger = this.root.querySelector('.relationship-add-trigger');
        popover.hidden = !popover.hidden;
        trigger.setAttribute('aria-expanded', popover.hidden ? 'false' : 'true');
        if (!popover.hidden) {
          addMenu.hidden = true;
          addTrigger.setAttribute('aria-expanded', 'false');
          requestAnimationFrame(() => popover.querySelector('input')?.focus());
        }
        return;
      }
      if (action === 'clear-filters') {
        const board = activeBoard(this.store);
        const { mode, projection } = this._boardView();
        board.view = { ...Model.defaultBoardView(), mode, projection: projection || 'facts' };
        const form = this.root.querySelector('[data-relationship-filter-form]');
        if (form) {
          form.elements.namedItem('query').value = '';
          form.elements.namedItem('entityType').value = 'all';
          form.elements.namedItem('environment').value = '';
          form.elements.namedItem('verification').value = 'all';
        }
        this._persistSoon(0);
        this._renderGraph();
        this._updateFilterSummary();
        this._updateSummary();
        return;
      }
      if (action === 'toggle-add-menu') {
        const menu = this.root.querySelector('.relationship-add-menu');
        const trigger = this.root.querySelector('.relationship-add-trigger');
        const filterPopover = this.root.querySelector('.relationship-filter-popover');
        const filterTrigger = this.root.querySelector('.relationship-filter-trigger');
        menu.hidden = !menu.hidden;
        trigger.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
        if (!menu.hidden) {
          filterPopover.hidden = true;
          filterTrigger.setAttribute('aria-expanded', 'false');
        }
        return;
      }
      if (action === 'new-board') this._createBoard();
      if (action === 'rename-board') this._renameBoard();
      if (action === 'undo') this.undo();
      if (action === 'redo') this.redo();
      if (action === 'fit') this.fitContent();
      if (action === 'import-json') {
        this._closeAddMenu();
        this._importRelationshipJson();
        return;
      }
      if (action === 'connect-coolify') {
        this._closeAddMenu();
        this._connectCoolify();
        return;
      }
      if (action === 'close-inspector') {
        this._clearEntitySelection();
        this.selectedRelationshipId = '';
        this._updateSelectionCss();
        return;
      }
      if (action === 'verify-now') {
        this._verifySelectedNow();
        return;
      }

      const nodeType = event.target.closest('[data-add-node-type]')?.dataset.addNodeType;
      if (nodeType) {
        this.root.querySelector('.relationship-add-menu').hidden = true;
        this.root.querySelector('.relationship-add-trigger').setAttribute('aria-expanded', 'false');
        this._createManualEntity(nodeType);
        return;
      }
      const resourceKey = event.target.closest('[data-add-resource]')?.dataset.addResource;
      if (resourceKey) {
        this._addResource(this.resourceMap.get(resourceKey));
        return;
      }

      const port = event.target.closest('.relationship-port[data-direction="out"]');
      if (port && event.detail === 0) {
        this.keyboardConnectSourceId = port.closest('.relationship-node')?.dataset.entityId || '';
        this._updateSelectionCss();
        this._setCanvasAnnouncement('已选择连接起点。使用 Tab 选择目标节点并按 Enter。');
        return;
      }

      const node = event.target.closest('.relationship-node');
      if (node && !event.target.closest('.relationship-port')) {
        if (this.suppressNextNodeClick) {
          this.suppressNextNodeClick = false;
          return;
        }
        const entityId = node.dataset.entityId;
        if (this.keyboardConnectSourceId && this.keyboardConnectSourceId !== entityId) {
          this._createConnection(this.keyboardConnectSourceId, entityId);
          this.keyboardConnectSourceId = '';
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          const selected = this._entitySelectionIds();
          if (selected.has(entityId)) selected.delete(entityId); else selected.add(entityId);
          this._setEntitySelection(selected, selected.has(entityId) ? entityId : '');
        } else {
          this._selectOnlyEntity(entityId);
        }
        this._updateSelectionCss();
        this._updateSummary();
        return;
      }

      const edge = event.target.closest('[data-relationship-id]');
      if (edge) {
        this.selectedRelationshipId = edge.dataset.relationshipId;
        this._clearEntitySelection();
        this._updateSelectionCss();
        this._updateSummary();
      }

      if (!event.target.closest('.relationship-filter-host')) this._closeFilterPopover();
      if (!event.target.closest('.relationship-menu-host')) this._closeAddMenu();
    }

    _handleChange(event) {
      const filterForm = event.target.closest('[data-relationship-filter-form]');
      if (filterForm) {
        this._updateBoardViewFromForm(filterForm);
        return;
      }
      if (event.target.id !== 'relationship-board-select') return;
      if (!this.store.boards.some(board => board.id === event.target.value)) return;
      this.store.activeBoardId = event.target.value;
      this._clearEntitySelection();
      this.selectedRelationshipId = '';
      this.keyboardConnectSourceId = '';
      this._persistSoon(0);
      this.render();
    }

    _handleInput(event) {
      const filterForm = event.target.closest('[data-relationship-filter-form]');
      if (filterForm) {
        this._updateBoardViewFromForm(filterForm);
        return;
      }
      if (event.target.matches('.relationship-resource-search input')) {
        this.resourceSearch = event.target.value;
        this._renderResources();
        return;
      }
      const form = event.target.closest('[data-relationship-inspector-form]');
      if (!form) return;
      form.classList.add('is-dirty');
      const saveButton = form.querySelector('[data-inspector-save]');
      if (saveButton) saveButton.disabled = false;
      const error = form.querySelector('.relationship-inspector-error');
      if (error) error.textContent = '';
    }

    _closeFilterPopover() {
      const popover = this.root?.querySelector('.relationship-filter-popover');
      const trigger = this.root?.querySelector('.relationship-filter-trigger');
      if (popover) popover.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
    }

    _closeAddMenu() {
      const menu = this.root?.querySelector('.relationship-add-menu');
      const trigger = this.root?.querySelector('.relationship-add-trigger');
      if (menu) menu.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
    }

    _updateBoardViewFromForm(form) {
      const board = activeBoard(this.store);
      if (!board) return;
      const data = new FormData(form);
      board.view = {
        mode: String(data.get('mode') || 'full'),
        projection: String(data.get('projection') || 'facts'),
        query: Model.cleanText(data.get('query'), 120),
        entityType: String(data.get('entityType') || 'all'),
        environment: Model.cleanText(data.get('environment'), 80),
        verification: String(data.get('verification') || 'all')
      };
      const filtered = this._filteredGraph();
      const visibleIds = new Set(filtered.placements.map(item => item.entityId));
      this._pruneEntitySelection(visibleIds);
      if (this.selectedRelationshipId && !filtered.relationships.some(item => item.id === this.selectedRelationshipId)) {
        this.selectedRelationshipId = '';
      }
      this._applyViewMode();
      this._persistSoon(160);
      this._renderGraph();
      this._updateFilterSummary();
      this._updateSummary();
    }

    _handleSubmit(event) {
      const form = event.target.closest('[data-relationship-inspector-form]');
      if (!form) return;
      event.preventDefault();
      this._saveInspectorForm(form);
    }

    _handleDragStart(event) {
      const item = event.target.closest('[data-resource-key]');
      if (!item) return;
      const key = item.dataset.resourceKey;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-gitfinder-relationship-resource', key);
      event.dataTransfer.setData('text/plain', key);
    }

    _handleDragOver(event) {
      if (!event.target.closest('.relationship-canvas')) return;
      if (!event.dataTransfer.types.includes('application/x-gitfinder-relationship-resource')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }

    _handleDrop(event) {
      const canvas = event.target.closest('.relationship-canvas');
      if (!canvas) return;
      const key = event.dataTransfer.getData('application/x-gitfinder-relationship-resource');
      const resource = this.resourceMap.get(key);
      if (!resource) return;
      event.preventDefault();
      this._addResource(resource, this._clientToWorld(event.clientX, event.clientY));
    }

    _renderResources() {
      const list = this.root?.querySelector('.relationship-resource-list');
      if (!list) return;
      const query = this.resourceSearch.trim().toLocaleLowerCase('zh-CN');
      const filtered = this.resources.filter(resource => !query
        || `${resource.name} ${resource.path} ${resource.secondary}`.toLocaleLowerCase('zh-CN').includes(query));
      if (!filtered.length) {
        list.innerHTML = '<div class="relationship-resource-empty">没有匹配的项目或仓库</div>';
        return;
      }
      list.innerHTML = filtered.map(resource => `
        <article class="relationship-resource-item" draggable="true" data-resource-key="${escapeHtml(resource.key)}">
          <span class="relationship-resource-icon" data-kind="${resource.kind}">${TYPE_ICONS[resource.kind]}</span>
          <span class="relationship-resource-copy">
            <strong>${escapeHtml(resource.name)}</strong>
            <small title="${escapeHtml(resource.path)}">${escapeHtml(resource.path || resource.secondary)}</small>
          </span>
          <button type="button" data-add-resource="${escapeHtml(resource.key)}" title="添加到白板" aria-label="将 ${escapeHtml(resource.name)} 添加到白板">＋</button>
        </article>`).join('');
    }

    _renderGraph() {
      const board = activeBoard(this.store);
      const nodeLayer = this.root?.querySelector('.relationship-node-layer');
      if (!board || !nodeLayer) return;
      const graph = this._filteredGraph();
      const visibleIds = new Set(graph.placements.map(placement => placement.entityId));
      this._pruneEntitySelection(visibleIds);
      if (this.selectedRelationshipId && !graph.relationships.some(item => item.id === this.selectedRelationshipId)) {
        this.selectedRelationshipId = '';
      }
      const entitiesById = new Map(this.store.entities.map(entity => [entity.id, entity]));
      nodeLayer.innerHTML = graph.placements.map(placement => {
        const entity = entitiesById.get(placement.entityId);
        if (!entity) return '';
        const resource = entity.refId ? this.resourceMap.get(`${entity.type}:${entity.refId}`) : null;
        const stale = Boolean(entity.refId && !resource);
        const name = resource?.name || entity.name;
        const details = this._entitySubtitle(entity, resource, stale);
        const verification = Model.verificationStatus(entity, { now: this.now() });
        const hasInput = Model.RELATIONSHIP_TYPES.some(type => Object.values(Model.CONNECTIONS[type] || []).some(pair => pair[1] === entity.type));
        const hasOutput = Model.RELATIONSHIP_TYPES.some(type => Object.values(Model.CONNECTIONS[type] || []).some(pair => pair[0] === entity.type));
        return `
          <article class="relationship-node verification-${verification.state}${stale ? ' stale' : ''}${graph.contextualIds.has(entity.id) ? ' filter-context' : ''}" data-entity-id="${escapeHtml(entity.id)}" data-entity-type="${entity.type}" data-verification-state="${verification.state}" tabindex="0" role="button" aria-label="${escapeHtml(name)}，${TYPE_LABELS[entity.type]}，${verification.label}${graph.contextualIds.has(entity.id) ? '，关系上下文' : ''}" aria-pressed="false" style="transform:translate(${placement.x}px,${placement.y}px)">
            ${hasInput ? '<button class="relationship-port relationship-port-input" data-direction="in" type="button" tabindex="-1" aria-hidden="true"></button>' : ''}
            <div class="relationship-node-header">
              <span class="relationship-node-icon">${TYPE_ICONS[entity.type]}</span>
              <span class="relationship-node-title" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
              <span class="relationship-node-kind">${TYPE_LABELS[entity.type]}</span>
              <span class="relationship-node-verification" data-state="${verification.state}" title="${verification.label}" aria-label="${verification.label}"></span>
            </div>
            <div class="relationship-node-subtitle">${escapeHtml(details)}</div>
            ${hasOutput ? `<button class="relationship-port relationship-port-output" data-direction="out" type="button" aria-label="从 ${escapeHtml(name)} 开始连接" title="拖到兼容节点建立关系"></button>` : ''}
          </article>`;
      }).join('');

      const edgeLayer = this.root.querySelector('.relationship-edge-layer');
      edgeLayer.innerHTML = `
        <defs>
          <marker id="relationship-edge-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path class="relationship-edge-arrow" d="M 0 0 L 8 4 L 0 8 Z"></path>
          </marker>
      </defs>` + graph.relationships.map(relationship => {
        const geometry = this._edgeGeometry(relationship);
        if (!geometry) return '';
        const verification = Model.verificationStatus(relationship, { now: this.now() });
        return `
          <g class="relationship-edge verification-${verification.state}" data-relationship-id="${escapeHtml(relationship.id)}" data-relationship-type="${relationship.type}" data-verification-state="${verification.state}" aria-label="${RELATIONSHIP_LABELS[relationship.type]}，${verification.label}">
            <path class="relationship-edge-hit" d="${geometry.path}"></path>
            <path class="relationship-edge-line" d="${geometry.path}" marker-end="url(#relationship-edge-arrow)"></path>
            <text x="${geometry.labelX}" y="${geometry.labelY}">${RELATIONSHIP_LABELS[relationship.type]}</text>
          </g>`;
      }).join('') + graph.summaryRelationships.map(summary => {
        const geometry = this._edgeGeometry(summary);
        if (!geometry) return '';
        const verificationLabel = summary.verificationState === 'verified'
          ? '已验证'
          : (summary.verificationState === 'stale' ? '待复核' : '待验证');
        const description = summary.title || `${summary.count} 个部署事实链`;
        return `
          <g class="relationship-edge relationship-edge-summary verification-${summary.verificationState}" data-summary-id="${escapeHtml(summary.id)}" data-verification-state="${summary.verificationState}" aria-label="${escapeHtml(summary.label)}，${verificationLabel}">
            <title>${escapeHtml(description)}</title>
            <path class="relationship-edge-line" d="${geometry.path}" marker-end="url(#relationship-edge-arrow)"></path>
            <text x="${geometry.labelX}" y="${geometry.labelY}">${escapeHtml(summary.label)}</text>
          </g>`;
      }).join('');
      this._applyViewport();
      this._updateSelectionCss();
    }

    _entitySubtitle(entity, resource, stale) {
      if (stale) return '引用已失效 · 保留关系事实';
      if (resource) return resource.secondary;
      if (entity.type === 'server') return entity.details.hostLabel || entity.details.environment || '手工服务器节点';
      if (entity.type === 'deployment') {
        return [
          entity.details.environment,
          entity.details.version,
          entity.details.branch,
          entity.details.revision,
          entity.details.status
        ].filter(Boolean).join(' · ') || '手工部署节点';
      }
      if (entity.type === 'endpoint') return entity.details.urlLabel || '访问端点';
      return entity.details.notes || TYPE_LABELS[entity.type];
    }

    _entityDisplayName(entity) {
      if (!entity) return '未知节点';
      const resource = entity.refId ? this.resourceMap.get(`${entity.type}:${entity.refId}`) : null;
      return resource?.name || entity.name;
    }

    _selectedFact() {
      const selectedIds = this._entitySelectionIds();
      if (selectedIds.size === 1) {
        const value = this.store.entities.find(entity => entity.id === this.selectedEntityId);
        if (value) return { kind: 'entity', value };
      }
      if (this.selectedRelationshipId) {
        const value = this.store.relationships.find(relationship => relationship.id === this.selectedRelationshipId);
        if (value) return { kind: 'relationship', value };
      }
      return null;
    }

    _factSourceOptions(selectedSource) {
      return `<option value=""${selectedSource ? '' : ' selected'}>未注明</option>` + Model.FACT_SOURCES.map(source => (
        `<option value="${source}"${source === selectedSource ? ' selected' : ''}>${FACT_SOURCE_LABELS[source]}</option>`
      )).join('');
    }

    _verificationDescription(fact, status) {
      if (!fact.verifiedAt) return `尚未记录验证时间；当前复核周期为 ${status.maxAgeDays} 天。`;
      const date = new Date(fact.verifiedAt);
      const formatted = Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
        : '时间无效';
      if (status.state === 'stale') return `上次验证于 ${formatted}，已超过 ${status.maxAgeDays} 天复核周期。`;
      return `最近验证于 ${formatted}；按 ${status.maxAgeDays} 天周期复核。`;
    }

    _factFieldsHtml(fact) {
      const status = Model.verificationStatus(fact, { now: this.now() });
      return `
        <div class="relationship-fact-status" data-state="${status.state}">
          <span class="relationship-fact-status-dot" aria-hidden="true"></span>
          <div><strong>${status.label}</strong><small>${escapeHtml(this._verificationDescription(fact, status))}</small></div>
        </div>
        <label class="relationship-inspector-field">
          <span>事实来源</span>
          <select name="source">${this._factSourceOptions(fact.source || '')}</select>
        </label>
        <label class="relationship-inspector-field">
          <span>验证时间</span>
          <input name="verifiedAt" type="datetime-local" value="${escapeHtml(dateTimeLocalValue(fact.verifiedAt))}">
        </label>
        <label class="relationship-inspector-field">
          <span>复核周期（天）</span>
          <input name="reviewIntervalDays" type="number" min="1" max="3650" step="1" value="${escapeHtml(fact.reviewIntervalDays || '')}" placeholder="${Model.VERIFICATION_STALE_DAYS}" inputmode="numeric">
          <small>留空使用默认 ${Model.VERIFICATION_STALE_DAYS} 天；周期只影响待复核提示，不会自动连接或执行操作。</small>
        </label>
        <label class="relationship-inspector-field">
          <span>证据摘要</span>
          <textarea name="evidenceSummary" maxlength="500" rows="4" placeholder="记录核验方式或只读证据，不填写密码、令牌或密钥">${escapeHtml(fact.evidenceSummary || '')}</textarea>
        </label>`;
    }

    _entityDetailFieldsHtml(entity) {
      return (DETAIL_FIELD_DEFINITIONS[entity.type] || []).map(field => {
        const value = entity.details?.[field.key] || '';
        const control = field.multiline
          ? `<textarea name="detail-${field.key}" maxlength="${field.maxLength}" rows="3">${escapeHtml(value)}</textarea>`
          : `<input name="detail-${field.key}" value="${escapeHtml(value)}" maxlength="${field.maxLength}">`;
        return `<label class="relationship-inspector-field"><span>${field.label}</span>${control}</label>`;
      }).join('');
    }

    _renderInspector() {
      const panel = this.root?.querySelector('.relationship-inspector-panel');
      const body = this.root?.querySelector('.relationship-body');
      if (!panel || !body) return;
      const selectedIds = this._entitySelectionIds();
      if (selectedIds.size > 1) {
        const selectedEntities = this.store.entities.filter(entity => selectedIds.has(entity.id));
        panel.hidden = false;
        body.classList.add('has-inspector');
        panel.innerHTML = `
          <header class="relationship-inspector-header">
            <div><small>批量布局选择</small><h3>已选择 ${selectedEntities.length} 个节点</h3></div>
            <button type="button" data-relationship-action="close-inspector" aria-label="清除节点选择" title="清除选择">×</button>
          </header>
          <div class="relationship-multi-selection">
            <p>可以一起拖动、使用方向键移动，或按 Delete 移出当前白板。</p>
            <ul>${selectedEntities.slice(0, 8).map(entity => `<li>${escapeHtml(this._entityDisplayName(entity))}<small>${TYPE_LABELS[entity.type]}</small></li>`).join('')}${selectedEntities.length > 8 ? `<li>另有 ${selectedEntities.length - 8} 个节点…</li>` : ''}</ul>
            <p class="relationship-inspector-boundary">为避免混淆来源与核验状态，事实字段必须逐个节点编辑。</p>
          </div>`;
        return;
      }
      const selected = this._selectedFact();
      if (!selected) {
        panel.hidden = true;
        panel.innerHTML = '';
        body.classList.remove('has-inspector');
        return;
      }

      const fact = selected.value;
      let heading = '';
      let subheading = '';
      let identityHtml = '';
      let editableFields = '';
      if (selected.kind === 'entity') {
        const resource = fact.refId ? this.resourceMap.get(`${fact.type}:${fact.refId}`) : null;
        heading = this._entityDisplayName(fact);
        subheading = TYPE_LABELS[fact.type];
        identityHtml = fact.refId ? `
          <dl class="relationship-inspector-identity">
            <div><dt>稳定身份</dt><dd title="${escapeHtml(fact.refId)}">${escapeHtml(fact.refId)}</dd></div>
            <div><dt>当前解析位置</dt><dd title="${escapeHtml(resource?.path || '')}">${escapeHtml(resource?.path || '引用已失效')}</dd></div>
          </dl>` : '';
        editableFields = `${fact.refId ? '' : `
          <label class="relationship-inspector-field">
            <span>名称</span>
            <input name="name" value="${escapeHtml(fact.name)}" maxlength="160" required>
          </label>`}${this._entityDetailFieldsHtml(fact)}`;
      } else {
        const source = this.store.entities.find(entity => entity.id === fact.sourceId);
        const target = this.store.entities.find(entity => entity.id === fact.targetId);
        heading = RELATIONSHIP_LABELS[fact.type];
        subheading = `${this._entityDisplayName(source)} → ${this._entityDisplayName(target)}`;
        identityHtml = `
          <dl class="relationship-inspector-identity">
            <div><dt>起点</dt><dd>${escapeHtml(this._entityDisplayName(source))}</dd></div>
            <div><dt>终点</dt><dd>${escapeHtml(this._entityDisplayName(target))}</dd></div>
            <div><dt>关系类型</dt><dd>${escapeHtml(fact.type)}</dd></div>
          </dl>`;
      }

      panel.hidden = false;
      body.classList.add('has-inspector');
      panel.innerHTML = `
        <header class="relationship-inspector-header">
          <div><small>${escapeHtml(subheading)}</small><h3>${escapeHtml(heading)}</h3></div>
          <button type="button" data-relationship-action="close-inspector" aria-label="关闭关系详情" title="关闭详情">×</button>
        </header>
        <form class="relationship-inspector-form" data-relationship-inspector-form data-inspector-kind="${selected.kind}" data-inspector-id="${escapeHtml(fact.id)}">
          ${identityHtml}
          ${editableFields}
          <div class="relationship-inspector-section-title">事实与核验</div>
          ${this._factFieldsHtml(fact)}
          <p class="relationship-inspector-error" role="alert"></p>
          <div class="relationship-inspector-actions">
            <button class="relationship-secondary-button" type="button" data-relationship-action="verify-now">标记为刚刚验证</button>
            <button class="relationship-primary-button" type="submit" data-inspector-save disabled>保存事实</button>
          </div>
          <p class="relationship-inspector-boundary">只修改 GitFinder 本机关系事实，不会连接服务器、执行部署或修改 Git。</p>
        </form>`;
    }

    _showInspectorError(form, message) {
      const error = form?.querySelector('.relationship-inspector-error');
      if (error) error.textContent = message;
    }

    _saveInspectorForm(form) {
      const kind = form.dataset.inspectorKind;
      const id = form.dataset.inspectorId;
      const nextStore = clone(this.store);
      const target = kind === 'entity'
        ? nextStore.entities.find(entity => entity.id === id)
        : nextStore.relationships.find(relationship => relationship.id === id);
      if (!target) {
        this._showInspectorError(form, '所选事实已不存在，请重新选择。');
        return false;
      }

      try {
        const data = new FormData(form);
        if (kind === 'entity' && !target.refId && data.has('name')) {
          target.name = String(data.get('name') || '');
          const definitions = DETAIL_FIELD_DEFINITIONS[target.type] || [];
          const details = {};
          for (const field of definitions) {
            const value = String(data.get(`detail-${field.key}`) || '');
            if (value.trim()) details[field.key] = value;
          }
          target.details = details;
        }

        const source = String(data.get('source') || '');
        const verifiedAt = localDateTimeToIso(data.get('verifiedAt'));
        const reviewIntervalInput = String(data.get('reviewIntervalDays') || '').trim();
        const evidenceSummary = String(data.get('evidenceSummary') || '');
        if (source) target.source = source; else delete target.source;
        if (verifiedAt) target.verifiedAt = verifiedAt; else delete target.verifiedAt;
        if (reviewIntervalInput) {
          const reviewIntervalDays = Number(reviewIntervalInput);
          if (!Number.isInteger(reviewIntervalDays) || reviewIntervalDays < 1 || reviewIntervalDays > 3650) {
            throw new Error('复核周期必须是 1 到 3650 之间的整数天数');
          }
          target.reviewIntervalDays = reviewIntervalDays;
        } else delete target.reviewIntervalDays;
        if (evidenceSummary.trim()) target.evidenceSummary = evidenceSummary; else delete target.evidenceSummary;

        const normalized = Model.assertValidStore(nextStore);
        if (JSON.stringify(normalized) === JSON.stringify(this.store)) {
          form.classList.remove('is-dirty');
          const saveButton = form.querySelector('[data-inspector-save]');
          if (saveButton) saveButton.disabled = true;
          return true;
        }
        this._recordMutation();
        this.store = normalized;
        this._persistSoon(0);
        this._renderGraph();
        this._refreshHistoryButtons();
        this._updateSummary();
        this._setCanvasAnnouncement('关系事实已保存');
        return true;
      } catch (error) {
        this._showInspectorError(form, error?.message || String(error));
        return false;
      }
    }

    _verifySelectedNow() {
      const selected = this._selectedFact();
      if (!selected) return false;
      const nextStore = clone(this.store);
      const target = selected.kind === 'entity'
        ? nextStore.entities.find(entity => entity.id === selected.value.id)
        : nextStore.relationships.find(relationship => relationship.id === selected.value.id);
      const now = new Date(this.now());
      if (!target || !Number.isFinite(now.getTime())) {
        this.notify('无法记录当前验证时间', 'error');
        return false;
      }
      target.verifiedAt = now.toISOString();
      if (!target.source) target.source = 'manual';
      try {
        const normalized = Model.assertValidStore(nextStore);
        this._recordMutation();
        this.store = normalized;
        this._persistSoon(0);
        this._renderGraph();
        this._refreshHistoryButtons();
        this._updateSummary();
        this._setCanvasAnnouncement('已记录本次人工验证时间');
        return true;
      } catch (error) {
        this.notify(error?.message || String(error), 'error');
        return false;
      }
    }

    _edgeGeometry(relationship, overrideTarget = null) {
      const board = activeBoard(this.store);
      const source = board?.placements.find(placement => placement.entityId === relationship.sourceId);
      const target = overrideTarget || board?.placements.find(placement => placement.entityId === relationship.targetId);
      if (!source || !target) return null;
      const { width, height } = this._nodeDimensions();
      const pointerTarget = Boolean(overrideTarget);
      const targetCenterX = pointerTarget ? target.x : target.x + width / 2;
      const sourceCenterX = source.x + width / 2;
      const direction = targetCenterX >= sourceCenterX ? 1 : -1;
      const x1 = direction > 0 ? source.x + width : source.x;
      const y1 = source.y + height / 2;
      const x2 = pointerTarget ? target.x : (direction > 0 ? target.x : target.x + width);
      const y2 = pointerTarget ? target.y : target.y + height / 2;
      const bend = Math.max(28, Math.abs(x2 - x1) * 0.5);
      return {
        path: `M ${x1} ${y1} C ${x1 + direction * bend} ${y1}, ${x2 - direction * bend} ${y2}, ${x2} ${y2}`,
        labelX: (x1 + x2) / 2,
        labelY: (y1 + y2) / 2 - 8
      };
    }

    _updateEdges() {
      const placedIds = new Set(activeBoard(this.store)?.placements.map(item => item.entityId) || []);
      for (const relationship of this.store.relationships) {
        if (!placedIds.has(relationship.sourceId) || !placedIds.has(relationship.targetId)) continue;
        const geometry = this._edgeGeometry(relationship);
        const group = this.root?.querySelector(`[data-relationship-id="${escapeSelectorValue(relationship.id)}"]`);
        if (!geometry || !group) continue;
        group.querySelectorAll('path').forEach(path => path.setAttribute('d', geometry.path));
        const label = group.querySelector('text');
        label?.setAttribute('x', geometry.labelX);
        label?.setAttribute('y', geometry.labelY);
      }
      for (const summary of this._filteredGraph().summaryRelationships) {
        const geometry = this._edgeGeometry(summary);
        const group = this.root?.querySelector(`[data-summary-id="${escapeSelectorValue(summary.id)}"]`);
        if (!geometry || !group) continue;
        group.querySelectorAll('path').forEach(path => path.setAttribute('d', geometry.path));
        const label = group.querySelector('text');
        label?.setAttribute('x', geometry.labelX);
        label?.setAttribute('y', geometry.labelY);
      }
    }

    _handlePointerDown(event) {
      if (event.button !== 0 && event.button !== 1) return;
      const canvas = event.target.closest('.relationship-canvas');
      if (!canvas) return;
      const sourcePort = event.target.closest('.relationship-port[data-direction="out"]');
      if (sourcePort && event.button === 0) {
        event.preventDefault();
        const sourceId = sourcePort.closest('.relationship-node')?.dataset.entityId;
        const sourcePlacement = activeBoard(this.store)?.placements.find(item => item.entityId === sourceId);
        if (!sourcePlacement) return;
        canvas.setPointerCapture(event.pointerId);
        this.pointerAction = { type: 'connect', pointerId: event.pointerId, sourceId };
        this._renderTemporaryEdge(sourceId, this._clientToWorld(event.clientX, event.clientY));
        return;
      }
      const header = event.target.closest('.relationship-node-header');
      if (header && event.button === 0) {
        event.preventDefault();
        const node = header.closest('.relationship-node');
        const entityId = node.dataset.entityId;
        const placement = activeBoard(this.store)?.placements.find(item => item.entityId === entityId);
        if (!placement) return;
        const point = this._clientToWorld(event.clientX, event.clientY);
        canvas.setPointerCapture(event.pointerId);
        let suppressClick = false;
        if ((event.metaKey || event.ctrlKey) && !this._entitySelectionIds().has(entityId)) {
          this._setEntitySelection(new Set([...this._entitySelectionIds(), entityId]), entityId);
          suppressClick = true;
        } else if (!event.metaKey && !event.ctrlKey && !this._entitySelectionIds().has(entityId)) {
          this._selectOnlyEntity(entityId);
        }
        const selectedIds = this._entitySelectionIds();
        const movingIds = selectedIds.has(entityId) ? [...selectedIds] : [entityId];
        const origins = new Map(activeBoard(this.store).placements
          .filter(item => movingIds.includes(item.entityId))
          .map(item => [item.entityId, { x: item.x, y: item.y }]));
        this.pointerAction = {
          type: 'node',
          pointerId: event.pointerId,
          entityId,
          entityIds: movingIds,
          origins,
          pointX: point.x,
          pointY: point.y,
          before: JSON.stringify(this.store),
          suppressClick,
          moved: false
        };
        for (const movingId of movingIds) {
          this.root.querySelector(`[data-entity-id="${escapeSelectorValue(movingId)}"]`)?.classList.add('dragging');
        }
        this._updateSelectionCss();
        return;
      }
      if (!event.target.closest('.relationship-node, .relationship-edge') && event.button <= 1) {
        event.preventDefault();
        const board = activeBoard(this.store);
        canvas.setPointerCapture(event.pointerId);
        if (event.shiftKey && event.button === 0) {
          const point = this._clientToWorld(event.clientX, event.clientY);
          this.pointerAction = {
            type: 'box',
            pointerId: event.pointerId,
            startX: point.x,
            startY: point.y,
            initialSelection: this._entitySelectionIds(),
            baseSelection: event.metaKey || event.ctrlKey ? this._entitySelectionIds() : new Set(),
            moved: false
          };
          this.selectedRelationshipId = '';
          this._renderSelectionBox(point.x, point.y, point.x, point.y);
          return;
        }
        this.pointerAction = {
          type: 'pan',
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          originX: board.viewport.x,
          originY: board.viewport.y
        };
        this._clearEntitySelection();
        this.selectedRelationshipId = '';
        this.keyboardConnectSourceId = '';
        canvas.classList.add('panning');
        this._updateSelectionCss();
      }
    }

    _handlePointerMove(event) {
      const action = this.pointerAction;
      if (!action || action.pointerId !== event.pointerId) return;
      if (action.type === 'node') {
        const point = this._clientToWorld(event.clientX, event.clientY);
        const deltaX = point.x - action.pointX;
        const deltaY = point.y - action.pointY;
        action.moved = action.moved || Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;
        for (const entityId of action.entityIds) {
          const origin = action.origins.get(entityId);
          const placement = activeBoard(this.store).placements.find(item => item.entityId === entityId);
          if (!origin || !placement) continue;
          placement.x = Math.round(origin.x + deltaX);
          placement.y = Math.round(origin.y + deltaY);
          const node = this.root.querySelector(`[data-entity-id="${escapeSelectorValue(entityId)}"]`);
          if (node) node.style.transform = `translate(${placement.x}px,${placement.y}px)`;
        }
        this._updateEdges();
        return;
      }
      if (action.type === 'pan') {
        const board = activeBoard(this.store);
        board.viewport.x = action.originX + (event.clientX - action.clientX);
        board.viewport.y = action.originY + (event.clientY - action.clientY);
        this._applyViewport();
        return;
      }
      if (action.type === 'connect') {
        this._renderTemporaryEdge(action.sourceId, this._clientToWorld(event.clientX, event.clientY));
        this._highlightConnectionTarget(event.clientX, event.clientY, action.sourceId);
        return;
      }
      if (action.type === 'box') {
        const point = this._clientToWorld(event.clientX, event.clientY);
        action.moved = action.moved || Math.abs(point.x - action.startX) > 2 || Math.abs(point.y - action.startY) > 2;
        this._renderSelectionBox(action.startX, action.startY, point.x, point.y);
        const hits = this._selectionBoxEntityIds(action.startX, action.startY, point.x, point.y);
        this._setEntitySelection(new Set([...action.baseSelection, ...hits]), hits.at(-1) || '');
        this._updateSelectionCss({ renderInspector: false });
      }
    }

    _handlePointerUp(event) {
      const action = this.pointerAction;
      if (!action || action.pointerId !== event.pointerId) return;
      if (action.type === 'node') {
        for (const entityId of action.entityIds) {
          this.root.querySelector(`[data-entity-id="${escapeSelectorValue(entityId)}"]`)?.classList.remove('dragging');
        }
        if (action.moved) {
          this._pushUndoSnapshot(action.before);
          this._persistSoon(0);
          this._updateSummary();
        }
        if (action.moved || action.suppressClick) {
          this.suppressNextNodeClick = true;
          setTimeout(() => { this.suppressNextNodeClick = false; }, 0);
        }
      } else if (action.type === 'pan') {
        this.root.querySelector('.relationship-canvas')?.classList.remove('panning');
        this._persistSoon(180);
      } else if (action.type === 'connect') {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.relationship-node');
        if (target && target.dataset.entityId !== action.sourceId) {
          this._createConnection(action.sourceId, target.dataset.entityId);
        }
        this._removeTemporaryEdge();
        this.root.querySelectorAll('.connection-compatible').forEach(node => node.classList.remove('connection-compatible'));
      } else if (action.type === 'box') {
        this._hideSelectionBox();
        this._updateSelectionCss();
        this._setCanvasAnnouncement(`已选择 ${this._entitySelectionIds().size} 个节点`);
      }
      this.pointerAction = null;
    }

    _cancelPointerAction(preserveCurrent = false) {
      const action = this.pointerAction;
      if (!action) return;
      if (!preserveCurrent && action.type === 'node' && action.before) {
        this.store = JSON.parse(action.before);
        this._renderGraph();
      }
      if (!preserveCurrent && action.type === 'box') {
        this._setEntitySelection(action.initialSelection, '');
        this._updateSelectionCss();
      }
      this._removeTemporaryEdge();
      this._hideSelectionBox();
      this.root?.querySelector('.relationship-canvas')?.classList.remove('panning');
      this.root?.querySelectorAll('.dragging, .connection-compatible').forEach(element => {
        element.classList.remove('dragging', 'connection-compatible');
      });
      this.pointerAction = null;
    }

    _renderTemporaryEdge(sourceId, target) {
      const edgeLayer = this.root?.querySelector('.relationship-edge-layer');
      const source = activeBoard(this.store)?.placements.find(item => item.entityId === sourceId);
      if (!edgeLayer || !source) return;
      let path = edgeLayer.querySelector('.relationship-edge-temporary');
      if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'relationship-edge-temporary');
        edgeLayer.appendChild(path);
      }
      const geometry = this._edgeGeometry({ sourceId }, target);
      if (geometry) path.setAttribute('d', geometry.path);
    }

    _renderSelectionBox(startX, startY, endX, endY) {
      const box = this.root?.querySelector('.relationship-selection-box');
      if (!box) return;
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      box.hidden = false;
      box.style.transform = `translate(${left}px,${top}px)`;
      box.style.width = `${Math.abs(endX - startX)}px`;
      box.style.height = `${Math.abs(endY - startY)}px`;
    }

    _selectionBoxEntityIds(startX, startY, endX, endY) {
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const right = Math.max(startX, endX);
      const bottom = Math.max(startY, endY);
      const { width, height } = this._nodeDimensions();
      return this._filteredGraph().placements.filter(placement => (
        placement.x < right && placement.x + width > left
        && placement.y < bottom && placement.y + height > top
      )).map(placement => placement.entityId);
    }

    _hideSelectionBox() {
      const box = this.root?.querySelector('.relationship-selection-box');
      if (!box) return;
      box.hidden = true;
      box.removeAttribute('style');
    }

    _removeTemporaryEdge() {
      this.root?.querySelector('.relationship-edge-temporary')?.remove();
    }

    _highlightConnectionTarget(clientX, clientY, sourceId) {
      this.root?.querySelectorAll('.connection-compatible').forEach(node => node.classList.remove('connection-compatible'));
      const target = document.elementFromPoint(clientX, clientY)?.closest?.('.relationship-node');
      if (!target || target.dataset.entityId === sourceId) return;
      if (this._connectionType(sourceId, target.dataset.entityId)) target.classList.add('connection-compatible');
    }

    _connectionType(sourceId, targetId) {
      const entities = new Map(this.store.entities.map(entity => [entity.id, entity]));
      const source = entities.get(sourceId);
      const target = entities.get(targetId);
      if (!source || !target) return '';
      return Model.RELATIONSHIP_TYPES.find(type => Model.connectionAllowed(type, source.type, target.type)) || '';
    }

    _createConnection(sourceId, targetId) {
      const type = this._connectionType(sourceId, targetId);
      if (!type) {
        this.notify('这两类节点之间没有允许的关系方向', 'warning');
        return false;
      }
      if (this.store.relationships.some(item => item.type === type && item.sourceId === sourceId && item.targetId === targetId)) {
        this.notify('这条关系已经存在', 'info');
        return false;
      }
      this._recordMutation();
      this.store.relationships.push({
        id: makeId('relationship'),
        type,
        sourceId,
        targetId,
        source: 'manual'
      });
      this._clearEntitySelection();
      this.selectedRelationshipId = this.store.relationships.at(-1).id;
      this._persistSoon(0);
      this._renderGraph();
      this._refreshHistoryButtons();
      this._updateSummary();
      this._setCanvasAnnouncement(`已建立“${RELATIONSHIP_LABELS[type]}”关系`);
      return true;
    }

    _handleWheel(event) {
      event.preventDefault();
      const board = activeBoard(this.store);
      const canvas = this.root.querySelector('.relationship-canvas');
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const oldZoom = board.viewport.zoom;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = Math.min(2.5, Math.max(0.35, oldZoom * factor));
      const worldX = (mouseX - board.viewport.x) / oldZoom;
      const worldY = (mouseY - board.viewport.y) / oldZoom;
      board.viewport.zoom = nextZoom;
      board.viewport.x = mouseX - worldX * nextZoom;
      board.viewport.y = mouseY - worldY * nextZoom;
      this._applyViewport();
      this._persistSoon(220);
    }

    _applyViewport() {
      const board = activeBoard(this.store);
      const world = this.root?.querySelector('.relationship-world');
      const canvas = this.root?.querySelector('.relationship-canvas');
      if (!board || !world || !canvas) return;
      const { x, y, zoom } = board.viewport;
      world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
      canvas.style.setProperty('--relationship-grid-size', `${GRID_SIZE * zoom}px`);
      canvas.style.setProperty('--relationship-grid-x', `${x}px`);
      canvas.style.setProperty('--relationship-grid-y', `${y}px`);
    }

    _applyViewMode() {
      const compact = this._boardView().mode === 'compact';
      const deploymentSummary = this._boardView().projection === 'deployment-summary';
      this.root?.classList.toggle('compact-mode', compact);
      this.root?.classList.toggle('deployment-summary-mode', deploymentSummary);
      const note = this.root?.querySelector('.relationship-projection-note');
      if (note) note.hidden = !deploymentSummary;
    }

    _updateFilterSummary() {
      const trigger = this.root?.querySelector('.relationship-filter-trigger');
      const count = this.root?.querySelector('.relationship-filter-count');
      const summary = this.root?.querySelector('.relationship-filter-summary');
      if (!trigger || !count || !summary) return;
      const graph = this._filteredGraph();
      const activeCount = this._activeFilterCount();
      trigger.classList.toggle('is-active', activeCount > 0);
      count.hidden = activeCount === 0;
      count.textContent = activeCount ? String(activeCount) : '';
      summary.textContent = graph.filterActive
        ? `${graph.directIds.size} 个匹配 · ${graph.placements.length} 个显示`
        : `${this._boardView().projection === 'deployment-summary' ? '部署摘要' : '完整事实'} · ${graph.placements.length} 个节点`;
    }

    _clientToWorld(clientX, clientY) {
      const canvas = this.root.querySelector('.relationship-canvas');
      const rect = canvas.getBoundingClientRect();
      const viewport = activeBoard(this.store).viewport;
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom
      };
    }

    async _createBoard() {
      if (this.store.boards.length >= Model.MAX_BOARDS) {
        this.notify(`最多创建 ${Model.MAX_BOARDS} 个白板`, 'warning');
        return;
      }
      const values = await this._openFormDialog({
        title: '新建关系白板',
        submitLabel: '创建',
        fields: [{ key: 'name', label: '白板名称', value: '新白板', required: true, maxLength: 80 }]
      });
      if (!values) return;
      this._recordMutation();
      const id = makeId('board');
      this.store.boards.push({
        id,
        name: values.name,
        viewport: { x: 120, y: 90, zoom: 1 },
        view: Model.defaultBoardView(),
        placements: []
      });
      this.store.activeBoardId = id;
      this._persistSoon(0);
      this.render();
    }

    async _renameBoard() {
      const board = activeBoard(this.store);
      if (!board) return;
      const values = await this._openFormDialog({
        title: '重命名白板',
        submitLabel: '保存',
        fields: [{ key: 'name', label: '白板名称', value: board.name, required: true, maxLength: 80 }]
      });
      if (!values || values.name === board.name) return;
      this._recordMutation();
      board.name = values.name;
      this._persistSoon(0);
      this.render();
    }

    async _createManualEntity(type) {
      const labels = {
        server: ['服务器名称', '例如 Con01'],
        deployment: ['部署名称', '例如 MES 生产环境'],
        endpoint: ['端点名称', '例如 MES 公网入口'],
        group: ['分组名称', '例如 生产环境']
      };
      const fields = [{ key: 'name', label: labels[type][0], placeholder: labels[type][1], required: true, maxLength: 160 }];
      if (type === 'server') {
        fields.push({ key: 'environment', label: '环境', placeholder: 'production / staging', maxLength: 240 });
        fields.push({ key: 'hostLabel', label: '主机标签', placeholder: '仅用于识别，不填写密码或密钥', maxLength: 240 });
      }
      if (type === 'deployment') {
        fields.push({ key: 'environment', label: '环境', placeholder: 'production / staging', maxLength: 240 });
        fields.push({ key: 'version', label: '版本', placeholder: '例如 v2.4.1 或镜像标签', maxLength: 240 });
        fields.push({ key: 'branch', label: '分支', placeholder: '例如 main / release', maxLength: 240 });
        fields.push({ key: 'revision', label: '提交', placeholder: '例如 abcdef012345', maxLength: 240 });
        fields.push({ key: 'status', label: '状态', placeholder: '运行中 / 待验证', maxLength: 240 });
      }
      if (type === 'endpoint') fields.push({ key: 'urlLabel', label: '地址标签', placeholder: '例如 https://mes.example.com', maxLength: 240 });
      const values = await this._openFormDialog({ title: `添加${TYPE_LABELS[type]}`, submitLabel: '添加', fields });
      if (!values) return;
      const details = {};
      for (const field of fields.slice(1)) if (values[field.key]) details[field.key] = values[field.key];
      this._addEntity({ id: makeId('entity'), type, name: values.name, details, source: 'manual' });
    }

    _addResource(resource, point = null) {
      if (!resource) return;
      let entity = this.store.entities.find(candidate => candidate.type === resource.kind && candidate.refId === resource.refId);
      if (entity && activeBoard(this.store).placements.some(placement => placement.entityId === entity.id)) {
        this.notify('此项目或仓库已经在当前白板中', 'info');
        return;
      }
      if (!entity) {
        entity = {
          id: makeId('entity'),
          type: resource.kind,
          name: resource.name,
          refId: resource.refId,
          details: {},
          source: 'gitfinder-registry'
        };
      }
      this._addEntity(entity, point);
    }

    _addEntity(entity, point = null) {
      if (!this.store.entities.some(candidate => candidate.id === entity.id) && this.store.entities.length >= Model.MAX_ENTITIES) {
        this.notify(`最多保存 ${Model.MAX_ENTITIES} 个关系节点`, 'warning');
        return;
      }
      this._recordMutation();
      if (!this.store.entities.some(candidate => candidate.id === entity.id)) this.store.entities.push(entity);
      const board = activeBoard(this.store);
      const fallbackIndex = board.placements.length;
      const placement = point || { x: 80 + (fallbackIndex % 3) * 280, y: 80 + Math.floor(fallbackIndex / 3) * 140 };
      board.placements.push({ entityId: entity.id, x: Math.round(placement.x), y: Math.round(placement.y) });
      this._selectOnlyEntity(entity.id);
      this._persistSoon(0);
      this._renderGraph();
      this._refreshHistoryButtons();
      this._updateSummary();
    }

    _deleteSelection() {
      if (this.selectedRelationshipId) {
        const index = this.store.relationships.findIndex(item => item.id === this.selectedRelationshipId);
        if (index < 0) return;
        this._recordMutation();
        this.store.relationships.splice(index, 1);
        this.selectedRelationshipId = '';
      } else if (this._entitySelectionIds().size) {
        const board = activeBoard(this.store);
        const selectedIds = this._entitySelectionIds();
        if (!board.placements.some(item => selectedIds.has(item.entityId))) return;
        this._recordMutation();
        board.placements = board.placements.filter(item => !selectedIds.has(item.entityId));
        const orphanedIds = new Set([...selectedIds].filter(entityId => (
          !this.store.boards.some(candidate => candidate.placements.some(item => item.entityId === entityId))
        )));
        this.store.entities = this.store.entities.filter(entity => !orphanedIds.has(entity.id));
        this.store.relationships = this.store.relationships.filter(item => (
          !orphanedIds.has(item.sourceId) && !orphanedIds.has(item.targetId)
        ));
        this._clearEntitySelection();
      } else return;
      this.keyboardConnectSourceId = '';
      this._persistSoon(0);
      this._renderGraph();
      this._refreshHistoryButtons();
      this._updateSummary();
    }

    _recordMutation() {
      this._pushUndoSnapshot(JSON.stringify(this.store));
      this.redoStack = [];
    }

    _pushUndoSnapshot(snapshot) {
      if (!snapshot || this.undoStack.at(-1) === snapshot) return;
      this.undoStack.push(snapshot);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }

    undo() {
      const previous = this.undoStack.pop();
      if (!previous) return;
      this.redoStack.push(JSON.stringify(this.store));
      this.store = JSON.parse(previous);
      this._clearEntitySelection();
      this.selectedRelationshipId = '';
      this.keyboardConnectSourceId = '';
      this._persistSoon(0);
      this.render();
    }

    redo() {
      const next = this.redoStack.pop();
      if (!next) return;
      this.undoStack.push(JSON.stringify(this.store));
      this.store = JSON.parse(next);
      this._clearEntitySelection();
      this.selectedRelationshipId = '';
      this.keyboardConnectSourceId = '';
      this._persistSoon(0);
      this.render();
    }

    fitContent() {
      const board = activeBoard(this.store);
      const canvas = this.root?.querySelector('.relationship-canvas');
      if (!board || !canvas) return;
      const placements = this._filteredGraph().placements;
      const { width: nodeWidth, height: nodeHeight } = this._nodeDimensions();
      if (!placements.length) {
        board.viewport = { x: 120, y: 90, zoom: 1 };
      } else {
        const rect = canvas.getBoundingClientRect();
        const minX = Math.min(...placements.map(item => item.x));
        const minY = Math.min(...placements.map(item => item.y));
        const maxX = Math.max(...placements.map(item => item.x + nodeWidth));
        const maxY = Math.max(...placements.map(item => item.y + nodeHeight));
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        const zoom = Math.min(1.5, Math.max(0.35, Math.min((rect.width - 120) / width, (rect.height - 120) / height)));
        board.viewport.zoom = zoom;
        board.viewport.x = (rect.width - width * zoom) / 2 - minX * zoom;
        board.viewport.y = (rect.height - height * zoom) / 2 - minY * zoom;
      }
      this._applyViewport();
      this._persistSoon(160);
    }

    _handleKeydown(event) {
      if (!this.root?.isConnected) return;
      const editing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape' && !this.root.querySelector('.relationship-filter-popover')?.hidden) {
        event.preventDefault();
        this._closeFilterPopover();
        this.root.querySelector('.relationship-filter-trigger')?.focus();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z' && !editing) {
        event.preventDefault();
        if (event.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (editing) return;
      if (event.key === 'Enter' && this.keyboardConnectSourceId) {
        const targetNode = event.target?.closest?.('.relationship-node');
        if (targetNode && targetNode.dataset.entityId !== this.keyboardConnectSourceId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const created = this._createConnection(this.keyboardConnectSourceId, targetNode.dataset.entityId);
          if (created) this.keyboardConnectSourceId = '';
          return;
        }
      }
      if (event.key === 'Escape') {
        this.keyboardConnectSourceId = '';
        this._clearEntitySelection();
        this.selectedRelationshipId = '';
        this._cancelPointerAction(false);
        this._updateSelectionCss();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (this._entitySelectionIds().size || this.selectedRelationshipId)) {
        event.preventDefault();
        this._deleteSelection();
        return;
      }
      const selectedIds = this._entitySelectionIds();
      if (!selectedIds.size || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const placements = activeBoard(this.store).placements.filter(item => selectedIds.has(item.entityId));
      if (!placements.length) return;
      this._recordMutation();
      const step = event.shiftKey ? 24 : 8;
      for (const placement of placements) {
        if (event.key === 'ArrowLeft') placement.x -= step;
        if (event.key === 'ArrowRight') placement.x += step;
        if (event.key === 'ArrowUp') placement.y -= step;
        if (event.key === 'ArrowDown') placement.y += step;
      }
      this._persistSoon(80);
      this._renderGraph();
      this._refreshHistoryButtons();
      this._updateSummary();
    }

    _updateSelectionCss(options = {}) {
      const selectedIds = this._entitySelectionIds();
      this.root?.querySelectorAll('.relationship-node').forEach(node => {
        const selected = selectedIds.has(node.dataset.entityId);
        node.classList.toggle('selected', selected);
        node.setAttribute('aria-pressed', selected ? 'true' : 'false');
        node.classList.toggle('keyboard-connection-source', node.dataset.entityId === this.keyboardConnectSourceId);
      });
      this.root?.querySelectorAll('.relationship-edge').forEach(edge => {
        edge.classList.toggle('selected', edge.dataset.relationshipId === this.selectedRelationshipId);
      });
      if (options.renderInspector !== false) this._renderInspector();
    }

    _refreshHistoryButtons() {
      const undo = this.root?.querySelector('[data-relationship-action="undo"]');
      const redo = this.root?.querySelector('[data-relationship-action="redo"]');
      if (undo) undo.disabled = !this.undoStack.length;
      if (redo) redo.disabled = !this.redoStack.length;
    }

    _saveLabel() {
      if (this.saveState === 'saving') return '正在保存…';
      if (this.saveState === 'error') return '保存失败';
      return '已保存在本机';
    }

    _setSaveState(state) {
      this.saveState = state;
      const element = this.root?.querySelector('.relationship-save-state');
      if (element) {
        element.dataset.state = state;
        element.textContent = this._saveLabel();
      }
    }

    _persistSoon(delay = 100) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this._setSaveState('saving');
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this._persistNow();
      }, delay);
    }

    _persistNow() {
      if (!this.store) return Promise.resolve();
      const snapshot = clone(this.store);
      this._setSaveState('saving');
      this.saveChain = this.saveChain
        .catch(() => {})
        .then(() => this.bridge.relationshipBoards.save(snapshot))
        .then(result => {
          this._setSaveState('saved');
          return result;
        })
        .catch(error => {
          this._setSaveState('error');
          this.notify(`关系白板保存失败：${error?.message || String(error)}`, 'error');
          return null;
        });
      return this.saveChain;
    }

    _updateSummary() {
      const board = activeBoard(this.store);
      if (!board) return;
      const graph = this._filteredGraph();
      this.onSummaryChanged({
        boardName: board.name,
        nodeCount: graph.placements.length,
        relationshipCount: graph.relationships.length,
        totalNodeCount: board.placements.length,
        filterActive: graph.filterActive
      });
    }

    async _importRelationshipJson() {
      if (this.importInFlight || !this.bridge?.relationshipBoards?.previewImport) return false;
      const rootAtStart = this.root;
      this.importInFlight = true;
      try {
        await this._persistNow();
        const preview = await this.bridge.relationshipBoards.previewImport();
        if (!preview || preview.cancelled || this.root !== rootAtStart) return false;
        if (!preview.hasChanges) {
          this.notify('所选 JSON 与当前关系事实没有可合并差异', 'info');
          return false;
        }
        const confirmed = await this._openImportPreviewDialog(preview);
        if (!confirmed || this.root !== rootAtStart) return false;
        const result = await this.bridge.relationshipBoards.applyImport({
          operationId: preview.operationId,
          previewToken: preview.previewToken
        });
        const normalized = Model.assertValidStore(result.store);
        if (JSON.stringify(normalized) !== JSON.stringify(this.store)) {
          this._recordMutation();
          this.store = normalized;
        }
        this._clearEntitySelection();
        this.selectedRelationshipId = '';
        this.keyboardConnectSourceId = '';
        this._setSaveState('saved');
        this.render();
        const backup = result.backupFileName ? `；导入前备份：${result.backupFileName}` : '';
        this.notify(`已合并 ${result.totalChanges} 项关系白板差异${backup}`, 'success');
        this._setCanvasAnnouncement(`已从 ${preview.fileName} 合并 ${result.totalChanges} 项差异`);
        return true;
      } catch (error) {
        this.notify(`关系白板导入失败：${error?.message || String(error)}`, 'error');
        return false;
      } finally {
        this.importInFlight = false;
      }
    }

    async _connectCoolify() {
      if (this.importInFlight || !this.bridge?.relationshipBoards?.previewCoolify) return false;
      const rootAtStart = this.root;
      const credentials = await this._openCoolifyCredentialsDialog();
      if (!credentials || this.root !== rootAtStart) return false;
      this.importInFlight = true;
      let accessToken = credentials.accessToken;
      try {
        await this._persistNow();
        const preview = await this.bridge.relationshipBoards.previewCoolify({
          baseUrl: credentials.baseUrl,
          accessToken
        });
        accessToken = '';
        credentials.accessToken = '';
        if (!preview || preview.cancelled || this.root !== rootAtStart) return false;
        if (!preview.hasChanges) {
          this.notify('Coolify 当前快照与关系白板没有可合并差异', 'info');
          return false;
        }
        const confirmed = await this._openImportPreviewDialog(preview);
        if (!confirmed || this.root !== rootAtStart) return false;
        const result = await this.bridge.relationshipBoards.applyCoolify({
          operationId: preview.operationId,
          previewToken: preview.previewToken
        });
        const normalized = Model.assertValidStore(result.store);
        if (JSON.stringify(normalized) !== JSON.stringify(this.store)) {
          this._recordMutation();
          this.store = normalized;
        }
        this._clearEntitySelection();
        this.selectedRelationshipId = '';
        this.keyboardConnectSourceId = '';
        this._setSaveState('saved');
        this.render();
        const backup = result.backupFileName ? `；同步前备份：${result.backupFileName}` : '';
        this.notify(`已合并 ${result.totalChanges} 项 Coolify 只读观测${backup}`, 'success');
        this._setCanvasAnnouncement(`已从 ${preview.sourceLabel || 'Coolify'} 合并 ${result.totalChanges} 项观测差异`);
        return true;
      } catch (error) {
        this.notify(`Coolify 只读发现失败：${error?.message || String(error)}`, 'error');
        return false;
      } finally {
        accessToken = '';
        credentials.accessToken = '';
        this.importInFlight = false;
      }
    }

    _openCoolifyCredentialsDialog() {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'relationship-dialog-overlay';
        overlay.innerHTML = `
          <form class="relationship-dialog relationship-coolify-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-coolify-title" aria-describedby="relationship-coolify-boundary">
            <header><div><h3 id="relationship-coolify-title">连接 Coolify（只读）</h3><small>发现服务器、部署、公开域名和已匹配仓库</small></div><button type="button" data-dialog-cancel aria-label="关闭">×</button></header>
            <div class="relationship-dialog-body">
              <label class="relationship-dialog-field">
                <span>实例地址</span>
                <input name="baseUrl" type="url" placeholder="https://coolify.example.com" maxlength="2048" required autocomplete="off" spellcheck="false">
              </label>
              <label class="relationship-dialog-field">
                <span>Access Token</span>
                <input name="accessToken" type="password" placeholder="仅使用 read 权限令牌" maxlength="4096" required autocomplete="off" spellcheck="false">
              </label>
              <div class="relationship-coolify-safety">
                <strong>最小权限边界</strong>
                <span>请创建只含 <code>read</code> 权限的团队令牌，不要使用 <code>read:sensitive</code>、<code>write</code>、<code>deploy</code> 或 <code>root</code>。</span>
              </div>
              <p id="relationship-coolify-boundary">令牌仅用于本次主进程读取，响应返回后立即从界面状态丢弃；不会写入设置、关系白板或日志。读取本身不会触发部署、重启或修改。</p>
            </div>
            <footer><button class="btn" type="button" data-dialog-cancel>取消</button><button class="btn btn-primary" type="submit">读取并预览</button></footer>
          </form>`;
        const tokenInput = overlay.querySelector('[name="accessToken"]');
        const finish = value => {
          document.removeEventListener('keydown', escapeListener, true);
          if (tokenInput) tokenInput.value = '';
          overlay.remove();
          resolve(value);
        };
        const escapeListener = event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        };
        overlay.addEventListener('click', event => {
          if (event.target === overlay || event.target.closest('[data-dialog-cancel]')) finish(null);
        });
        overlay.querySelector('form').addEventListener('submit', event => {
          event.preventDefault();
          const baseUrl = String(event.currentTarget.elements.namedItem('baseUrl').value || '').trim();
          const accessToken = String(tokenInput?.value || '').trim();
          if (!baseUrl || !accessToken) return;
          finish({ baseUrl, accessToken });
        });
        document.body.appendChild(overlay);
        document.addEventListener('keydown', escapeListener, true);
        requestAnimationFrame(() => overlay.querySelector('[name="baseUrl"]')?.focus());
      });
    }

    _openImportPreviewDialog(preview) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'relationship-dialog-overlay';
        const countItems = [
          ['新增节点', preview.counts?.addedEntities || 0],
          ['更新节点', preview.counts?.updatedEntities || 0],
          ['新增关系', preview.counts?.addedRelationships || 0],
          ['更新关系', preview.counts?.updatedRelationships || 0],
          ['新增白板', preview.counts?.addedBoards || 0],
          ['补充布局', preview.counts?.updatedBoards || 0]
        ].filter(([, count]) => count > 0);
        const kindLabels = { entity: '节点', relationship: '关系', board: '白板' };
        const actionLabels = { add: '新增', update: '更新' };
        const fieldLabels = {
          name: '名称',
          details: '详情',
          source: '来源',
          verifiedAt: '验证时间',
          reviewIntervalDays: '复核周期',
          evidenceSummary: '证据摘要',
          placements: '布局节点'
        };
        const changes = Array.isArray(preview.changes) ? preview.changes : [];
        const isCoolify = preview.sourceKind === 'coolify';
        const observationLabels = {
          servers: '服务器',
          deployments: '部署资源',
          endpoints: '公开端点',
          matchedRepositories: '已匹配仓库',
          unmatchedRepositories: '未匹配仓库'
        };
        const observations = preview.observations && typeof preview.observations === 'object'
          ? Object.entries(preview.observations).filter(([, count]) => Number(count) > 0)
          : [];
        const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
        const unmatchedRepositories = Array.isArray(preview.unmatchedRepositories) ? preview.unmatchedRepositories : [];
        const sourceCaption = isCoolify
          ? escapeHtml(`${preview.sourceLabel || 'Coolify'} · 本次只读快照`)
          : `${escapeHtml(preview.fileName)} · ${Math.max(1, Math.ceil(Number(preview.fileSize || 0) / 1024))} KB`;
        const applyGuard = isCoolify
          ? '应用时若本机白板发生变化或预览过期会拒绝操作，并先创建同步前备份。'
          : '应用时若本机白板或源文件发生变化会拒绝操作，并先创建导入前备份。';
        overlay.innerHTML = `
          <form class="relationship-dialog relationship-import-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-import-title" aria-describedby="relationship-import-boundary">
            <header><div><h3 id="relationship-import-title">${isCoolify ? '确认同步 Coolify 关系' : '确认导入关系事实'}</h3><small>${sourceCaption}</small></div><button type="button" data-dialog-cancel aria-label="关闭">×</button></header>
            <div class="relationship-dialog-body">
              ${observations.length ? `<section class="relationship-import-observations" aria-label="只读观测摘要">${observations.map(([key, count]) => `<span><strong>${Number(count)}</strong>${escapeHtml(observationLabels[key] || key)}</span>`).join('')}</section>` : ''}
              <div class="relationship-import-counts">${countItems.map(([label, count]) => `<div><strong>${count}</strong><span>${label}</span></div>`).join('')}</div>
              <div class="relationship-import-change-list" aria-label="导入差异">${changes.map(change => `
                <article>
                  <span data-action="${escapeHtml(change.action)}">${escapeHtml(actionLabels[change.action] || change.action)}</span>
                  <div><strong>${escapeHtml(change.label)}</strong><small>${escapeHtml(kindLabels[change.kind] || change.kind)} · ${escapeHtml(change.detail || '')}${change.fields?.length ? ` · ${escapeHtml(change.fields.map(field => fieldLabels[field] || field).join('、'))}` : ''}</small></div>
                </article>`).join('')}${preview.truncatedChanges ? `<p>另有 ${Number(preview.truncatedChanges)} 项差异未展开显示。</p>` : ''}</div>
              ${warnings.length ? `<div class="relationship-import-warnings" role="note">${warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join('')}${unmatchedRepositories.length ? `<small>${escapeHtml(unmatchedRepositories.join('、'))}</small>` : ''}</div>` : ''}
              <p id="relationship-import-boundary" class="relationship-import-boundary">${escapeHtml(preview.boundary)} 确认前不会写入；${applyGuard}</p>
            </div>
            <footer><button class="btn" type="button" data-dialog-cancel>取消</button><button class="btn btn-primary" type="submit">确认合并 ${Number(preview.totalChanges || 0)} 项</button></footer>
          </form>`;
        const finish = value => {
          document.removeEventListener('keydown', escapeListener, true);
          overlay.remove();
          resolve(value);
        };
        const escapeListener = event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        };
        overlay.addEventListener('click', event => {
          if (event.target === overlay || event.target.closest('[data-dialog-cancel]')) finish(false);
        });
        overlay.querySelector('form').addEventListener('submit', event => {
          event.preventDefault();
          finish(true);
        });
        document.body.appendChild(overlay);
        document.addEventListener('keydown', escapeListener, true);
        requestAnimationFrame(() => overlay.querySelector('[type="submit"]')?.focus());
      });
    }

    _setCanvasAnnouncement(message) {
      const help = this.root?.querySelector('.relationship-canvas-help');
      if (help) help.textContent = message;
    }

    _openFormDialog(options) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'relationship-dialog-overlay';
        const fieldHtml = options.fields.map(field => `
          <label class="relationship-dialog-field">
            <span>${escapeHtml(field.label)}</span>
            <input name="${escapeHtml(field.key)}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}" maxlength="${field.maxLength || 240}" ${field.required ? 'required' : ''} autocomplete="off">
          </label>`).join('');
        overlay.innerHTML = `
          <form class="relationship-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-dialog-title">
            <header><h3 id="relationship-dialog-title">${escapeHtml(options.title)}</h3><button type="button" data-dialog-cancel aria-label="关闭">×</button></header>
            <div class="relationship-dialog-body">${fieldHtml}<p>这些信息仅保存在 GitFinder 本机配置中，不会执行部署或 Git 写操作。</p></div>
            <footer><button class="btn" type="button" data-dialog-cancel>取消</button><button class="btn btn-primary" type="submit">${escapeHtml(options.submitLabel || '保存')}</button></footer>
          </form>`;
        const finish = value => {
          document.removeEventListener('keydown', escapeListener, true);
          overlay.remove();
          resolve(value);
        };
        const escapeListener = event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(null);
          }
        };
        overlay.addEventListener('click', event => {
          if (event.target === overlay || event.target.closest('[data-dialog-cancel]')) finish(null);
        });
        overlay.querySelector('form').addEventListener('submit', event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const values = {};
          for (const field of options.fields) {
            const value = Model.cleanText(data.get(field.key), field.maxLength || 240);
            if (field.required && !value) return;
            values[field.key] = value;
          }
          finish(values);
        });
        document.body.appendChild(overlay);
        document.addEventListener('keydown', escapeListener, true);
        requestAnimationFrame(() => overlay.querySelector('input')?.focus());
      });
    }
  }

  return Object.freeze({
    Controller,
    TYPE_LABELS,
    RELATIONSHIP_LABELS,
    NODE_WIDTH,
    NODE_HEIGHT,
    COMPACT_NODE_WIDTH,
    COMPACT_NODE_HEIGHT
  });
});
