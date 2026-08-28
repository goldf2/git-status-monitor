const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const html = read('src/renderer/index.html');
const appSource = read('src/renderer/scripts/app.js');
const controllerSource = read('src/renderer/scripts/relationshipBoardController.js');
const selectionDetailSource = read('src/renderer/scripts/fileSelectionDetailController.js');
const relationshipCss = read('src/renderer/styles/relationships.css');
const serviceSource = read('src/main/services/relationshipBoardService.js');
const importServiceSource = read('src/main/services/relationshipBoardImportService.js');
const coolifyConnectorSource = read('src/main/services/coolifyReadOnlyConnectorService.js');
const relationshipIpcSource = read('src/main/ipc/relationshipBoards.js');
const userDataVerifierSource = read('scripts/verify-relationship-user-data.js');
const preloadSource = read('preload.js');
const mainSource = read('main.js');

globalThis.RelationshipGraphModel = require('../src/shared/relationshipGraphModel');
const {
  Controller,
  NODE_WIDTH,
  NODE_HEIGHT,
  COMPACT_NODE_WIDTH,
  COMPACT_NODE_HEIGHT
} = require('../src/renderer/scripts/relationshipBoardController');

test('关系白板作为结构独立工作区接入菜单、渲染生命周期和本机 IPC', () => {
  assert.match(html, /data-view="relationships"[\s\S]*?<span>关系白板<\/span>/);
  assert.ok(html.indexOf('../shared/relationshipGraphModel.js') < html.indexOf('scripts/relationshipBoardController.js'));
  assert.ok(html.indexOf('scripts/relationshipBoardController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /\['tree', 'dashboard', 'tasks', 'relationships'\]\.includes\(view\)/);
  assert.match(appSource, /AppState\.currentMode === 'relationships'[\s\S]*?relationshipBoardController\.open\(contentArea\)/);
  assert.match(appSource, /restoreWorkspaceView\s*=\s*AppState\.currentMode !== 'tree'/);
  assert.match(preloadSource, /relationshipBoards:[\s\S]*?relationshipBoards:get[\s\S]*?relationshipBoards:save/);
  assert.match(mainSource, /registerRelationshipBoardsIPC\(\)/);
  assert.match(mainSource, /label: '关系白板',[^\n]+view:relationships/);
  assert.match(serviceSource, /function getDefaultService\(\)/);
  assert.match(serviceSource, /app\?\.getPath\?\.\('userData'\)/);
  assert.doesNotMatch(serviceSource, /const relationshipBoardService = new RelationshipBoardService\(\)/);
  assert.match(userDataVerifierSource, /Intentionally import before ready/);
  assert.match(userDataVerifierSource, /app\.getPath\('userData'\)/);
  assert.match(userDataVerifierSource, /relationshipBoardService\.save\(markerStore\)/);
  assert.match(userDataVerifierSource, /relationshipBoardImportService\.previewFromFile\(importFile\)/);
  assert.match(userDataVerifierSource, /relationshipBoardImportService\.applyImport\(preview\)/);
});

test('关系 JSON 导入只通过系统文件选择、主进程预览令牌和确认应用', () => {
  const relationshipPreloadBlock = preloadSource.match(/relationshipBoards:\s*\{[\s\S]*?\n\s*\},/)?.[0] || '';
  assert.match(controllerSource, /data-relationship-action="import-json"/);
  assert.match(controllerSource, /relationshipBoards\.previewImport\(\)/);
  assert.match(controllerSource, /relationshipBoards\.applyImport\(\{[\s\S]*?operationId:[\s\S]*?previewToken:/);
  assert.match(controllerSource, /确认前不会写入/);
  assert.match(relationshipPreloadBlock, /previewImport:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('relationshipBoards:previewImport'\)/);
  assert.match(relationshipPreloadBlock, /applyImport:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\('relationshipBoards:applyImport', request\)/);
  assert.match(relationshipIpcSource, /dialog\.showOpenDialog/);
  assert.match(relationshipIpcSource, /previewFromFile\(result\.filePaths\[0\]\)/);
  assert.match(importServiceSource, /baseRevision/);
  assert.match(importServiceSource, /sourceFingerprint/);
  assert.match(importServiceSource, /createImportBackup\(\)/);
  assert.doesNotMatch(relationshipPreloadBlock, /previewImport:\s*\([^)]*path/i);
});

test('确认 JSON 差异后控制器载入主进程结果并保留一次撤销快照', async () => {
  const initialStore = {
    schemaVersion: 1,
    activeBoardId: 'board_import001',
    entities: [{ id: 'entity_server01', type: 'server', name: 'Con01', details: {} }],
    relationships: [],
    boards: [{
      id: 'board_import001',
      name: '部署',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [{ entityId: 'entity_server01', x: 0, y: 0 }]
    }]
  };
  const importedStore = structuredClone(initialStore);
  importedStore.entities.push({
    id: 'entity_deploy01',
    type: 'deployment',
    name: 'MES production',
    details: { environment: 'production' },
    source: 'imported'
  });
  importedStore.boards[0].placements.push({ entityId: 'entity_deploy01', x: 300, y: 0 });
  let applyRequest = null;
  const notifications = [];
  const controller = new Controller({
    bridge: {
      relationshipBoards: {
        previewImport: async () => ({
          cancelled: false,
          hasChanges: true,
          fileName: 'relationships.json',
          operationId: 'relationship_import_00000000000000000000000000000000',
          previewToken: 'a'.repeat(64),
          totalChanges: 2,
          counts: { addedEntities: 1, updatedBoards: 1 },
          changes: [],
          boundary: '只合并，不删除。'
        }),
        applyImport: async request => {
          applyRequest = request;
          return {
            applied: true,
            store: RelationshipGraphModel.assertValidStore(importedStore),
            totalChanges: 2,
            backupFileName: 'relationship-boards.import-backup-test.json'
          };
        }
      }
    },
    notify: (message, type) => notifications.push({ message, type })
  });
  controller.store = RelationshipGraphModel.assertValidStore(initialStore);
  controller.root = { querySelector: () => null };
  controller._persistNow = async () => {};
  controller._openImportPreviewDialog = async () => true;
  controller.render = () => {};
  controller._setCanvasAnnouncement = () => {};

  assert.equal(await controller._importRelationshipJson(), true);

  assert.deepEqual(applyRequest, {
    operationId: 'relationship_import_00000000000000000000000000000000',
    previewToken: 'a'.repeat(64)
  });
  assert.equal(controller.store.entities.length, 2);
  assert.equal(controller.undoStack.length, 1);
  assert.match(notifications[0].message, /已合并 2 项/);
  assert.equal(notifications[0].type, 'success');
});

test('Coolify 连接只传递会话令牌，预览确认后才合并白名单化关系', async () => {
  const relationshipPreloadBlock = preloadSource.match(/relationshipBoards:\s*\{[\s\S]*?\n\s*\},/)?.[0] || '';
  assert.match(controllerSource, /data-relationship-action="connect-coolify"/);
  assert.match(controllerSource, /type="password"[\s\S]*?autocomplete="off"/);
  assert.match(controllerSource, /只含 <code>read<\/code> 权限/);
  assert.match(controllerSource, /credentials\.accessToken = ''/);
  assert.match(relationshipPreloadBlock, /previewCoolify:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\('relationshipBoards:previewCoolify', request\)/);
  assert.match(relationshipPreloadBlock, /applyCoolify:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\('relationshipBoards:applyCoolify', request\)/);
  assert.match(relationshipIpcSource, /coolifyReadOnlyConnectorService\.preview\(request\)/);
  assert.match(coolifyConnectorSource, /method:\s*'GET'/);
  assert.match(coolifyConnectorSource, /preserveSource:\s*true/);
  assert.doesNotMatch(coolifyConnectorSource, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(coolifyConnectorSource, /\/(?:deploy|restart|start|stop)(?:[/'"`])/i);

  const initialStore = {
    schemaVersion: 1,
    activeBoardId: 'board_coolify01',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_coolify01',
      name: 'Coolify',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: []
    }]
  };
  const syncedStore = structuredClone(initialStore);
  syncedStore.entities.push({
    id: 'entity_servercoolify',
    type: 'server',
    name: 'Con01',
    details: { hostLabel: 'coolify.example.com' },
    source: 'observed',
    verifiedAt: '2026-08-27T12:00:00.000Z'
  });
  syncedStore.boards[0].placements.push({ entityId: 'entity_servercoolify', x: 100, y: 100 });
  let previewRequest = null;
  let applyRequest = null;
  const notifications = [];
  const credentials = { baseUrl: 'https://coolify.example.com', accessToken: '42|temporary-token' };
  const controller = new Controller({
    bridge: {
      relationshipBoards: {
        previewCoolify: async request => {
          previewRequest = structuredClone(request);
          return {
            sourceKind: 'coolify',
            sourceLabel: 'Coolify · coolify.example.com',
            hasChanges: true,
            operationId: 'relationship_import_00000000000000000000000000000000',
            previewToken: 'b'.repeat(64),
            totalChanges: 2,
            counts: { addedEntities: 1, updatedBoards: 1 },
            changes: [],
            boundary: '只读快照'
          };
        },
        applyCoolify: async request => {
          applyRequest = request;
          return {
            applied: true,
            store: RelationshipGraphModel.assertValidStore(syncedStore),
            totalChanges: 2,
            backupFileName: 'relationship-boards.import-backup-coolify.json'
          };
        }
      }
    },
    notify: (message, type) => notifications.push({ message, type })
  });
  controller.store = RelationshipGraphModel.assertValidStore(initialStore);
  controller.root = { querySelector: () => null };
  controller._openCoolifyCredentialsDialog = async () => credentials;
  controller._openImportPreviewDialog = async () => true;
  controller._persistNow = async () => {};
  controller.render = () => {};
  controller._setCanvasAnnouncement = () => {};

  assert.equal(await controller._connectCoolify(), true);
  assert.deepEqual(previewRequest, {
    baseUrl: 'https://coolify.example.com',
    accessToken: '42|temporary-token'
  });
  assert.equal(credentials.accessToken, '');
  assert.deepEqual(applyRequest, {
    operationId: 'relationship_import_00000000000000000000000000000000',
    previewToken: 'b'.repeat(64)
  });
  assert.equal(controller.store.entities.length, 1);
  assert.equal(controller.undoStack.length, 1);
  assert.match(notifications[0].message, /Coolify 只读观测/);
  assert.equal(notifications[0].type, 'success');
});

test('白板使用稳定项目仓库身份并提供指针、键盘和降低动效交互', () => {
  assert.match(controllerSource, /refId:\s*resource\.refId/);
  assert.match(controllerSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(controllerSource, /keyboardConnectSourceId/);
  assert.match(controllerSource, /event\.key === 'Enter'/);
  assert.match(controllerSource, /undoStack/);
  assert.match(controllerSource, /redoStack/);
  assert.match(relationshipCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(controllerSource, /git\.init|git\.commit|git\.push|ssh|deploy\(/i);
});

test('反向关系使用相邻端口而不是绕到两个节点外侧', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [
        { entityId: 'entity_source01', x: 420, y: 100 },
        { entityId: 'entity_target01', x: 80, y: 180 }
      ]
    }]
  };

  const geometry = controller._edgeGeometry({ sourceId: 'entity_source01', targetId: 'entity_target01' });

  assert.match(geometry.path, new RegExp(`^M 420 ${100 + NODE_HEIGHT / 2} C`));
  assert.match(geometry.path, new RegExp(` ${80 + NODE_WIDTH} ${180 + NODE_HEIGHT / 2}$`));
  assert.equal(geometry.labelX, (420 + 80 + NODE_WIDTH) / 2);
});

test('关系线显示明确方向箭头且临时连线保持轻量反馈', () => {
  assert.match(controllerSource, /id="relationship-edge-arrow"/);
  assert.match(controllerSource, /marker-end="url\(#relationship-edge-arrow\)"/);
  assert.match(relationshipCss, /\.relationship-edge-arrow\s*\{[^}]*fill:/s);
  assert.match(relationshipCss, /\.relationship-edge-temporary\s*\{[^}]*stroke-dasharray:/s);
});

test('选择节点或关系时使用非模态详情检查器编辑受控事实字段', () => {
  assert.match(controllerSource, /class="relationship-inspector-panel"[^>]+hidden/);
  assert.match(controllerSource, /data-relationship-inspector-form/);
  assert.match(controllerSource, /name="source"/);
  assert.match(controllerSource, /name="verifiedAt"[^>]+datetime-local/);
  assert.match(controllerSource, /name="evidenceSummary"[^>]+maxlength="500"/);
  assert.match(controllerSource, /name="reviewIntervalDays"[^>]+type="number"[^>]+min="1"[^>]+max="3650"/);
  assert.match(controllerSource, /标记为刚刚验证/);
  assert.match(controllerSource, /Model\.assertValidStore\(nextStore\)/);
  assert.match(controllerSource, /不会连接服务器、执行部署或修改 Git/);
  assert.match(controllerSource, /key: 'version', label: '版本'/);
  assert.match(controllerSource, /key: 'branch', label: '分支'/);
  assert.match(controllerSource, /key: 'revision', label: '提交'/);
  assert.match(relationshipCss, /\.relationship-body\.has-inspector/);
  assert.match(relationshipCss, /@media\s*\(prefers-reduced-transparency:\s*reduce\)/);
  assert.match(relationshipCss, /@media\s*\(prefers-contrast:\s*more\)/);
});

test('部署节点用结构化版本上下文生成可扫描副标题', () => {
  const controller = new Controller({ bridge: {} });
  const subtitle = controller._entitySubtitle({
    type: 'deployment',
    details: {
      environment: 'production',
      version: 'v2.4.1',
      branch: 'release/2.4',
      revision: 'abcdef012345',
      status: 'running'
    }
  }, null, false);

  assert.equal(subtitle, 'production · v2.4.1 · release/2.4 · abcdef012345 · running');
});

test('手工部署创建入口将版本上下文写入受控详情字段', async () => {
  const controller = new Controller({ bridge: {} });
  let createdEntity = null;
  controller._openFormDialog = async options => {
    assert.deepEqual(options.fields.map(field => field.key), [
      'name',
      'environment',
      'version',
      'branch',
      'revision',
      'status'
    ]);
    return {
      name: 'MES production',
      environment: 'production',
      version: 'v2.4.1',
      branch: 'release/2.4',
      revision: 'abcdef012345',
      status: 'running'
    };
  };
  controller._addEntity = entity => { createdEntity = entity; };

  await controller._createManualEntity('deployment');

  assert.equal(createdEntity.type, 'deployment');
  assert.equal(createdEntity.name, 'MES production');
  assert.deepEqual(createdEntity.details, {
    environment: 'production',
    version: 'v2.4.1',
    branch: 'release/2.4',
    revision: 'abcdef012345',
    status: 'running'
  });
  assert.equal(createdEntity.source, 'manual');
});

test('服务器详情从关系事实派生项目、仓库和部署版本上下文', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'Alpha Project', refId: 'project_alpha01', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'Repo A', refId: 'repo_alpha001', details: {} },
      {
        id: 'entity_deploy01',
        type: 'deployment',
        name: 'Alpha production',
        details: {
          environment: 'production',
          version: 'v2.4.1',
          branch: 'main',
          revision: 'abcdef012345',
          status: 'running'
        }
      },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} }
    ],
    relationships: [
      { id: 'relationship_test0001', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0001' },
      { id: 'relationship_test0002', type: 'source_of', sourceId: 'entity_repo0001', targetId: 'entity_deploy01' },
      { id: 'relationship_test0003', type: 'runs_on', sourceId: 'entity_deploy01', targetId: 'entity_server01' }
    ],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 300, y: 0 },
        { entityId: 'entity_deploy01', x: 600, y: 0 },
        { entityId: 'entity_server01', x: 900, y: 0 }
      ]
    }]
  };

  const context = controller._serverDeploymentContext('entity_server01');
  const html = controller._serverDeploymentContextHtml('entity_server01');

  assert.equal(context.length, 1);
  assert.equal(context[0].deployment.id, 'entity_deploy01');
  assert.deepEqual(context[0].repositories.map(entity => entity.id), ['entity_repo0001']);
  assert.deepEqual(context[0].projects.map(entity => entity.id), ['entity_project1']);
  assert.equal(context[0].versionContext, 'production · v2.4.1 · main · abcdef012345 · running');
  assert.match(html, /关联部署/);
  assert.match(html, /Alpha Project/);
  assert.match(html, /Repo A/);
  assert.match(html, /production · v2\.4\.1 · main · abcdef012345 · running/);
  assert.match(html, /data-relationship-locate-entity="entity_deploy01"/);
});

test('服务器关联部署可清除摘要和筛选后定位当前白板节点', () => {
  const notifications = [];
  const controller = new Controller({
    bridge: {},
    notify: (message, type) => notifications.push({ message, type })
  });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_deploy01', type: 'deployment', name: 'Production', details: {} },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} }
    ],
    relationships: [{
      id: 'relationship_test0001',
      type: 'runs_on',
      sourceId: 'entity_deploy01',
      targetId: 'entity_server01'
    }],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: {
        mode: 'compact',
        projection: 'deployment-summary',
        query: 'server',
        entityType: 'server',
        environment: 'production',
        verification: 'verified'
      },
      placements: [
        { entityId: 'entity_deploy01', x: 600, y: 100 },
        { entityId: 'entity_server01', x: 900, y: 100 }
      ]
    }]
  };
  controller.root = {
    querySelector: selector => selector === '.relationship-canvas'
      ? { getBoundingClientRect: () => ({ width: 1000, height: 600 }) }
      : null
  };
  controller._applyViewMode = () => {};
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._updateFilterSummary = () => {};
  controller._updateSummary = () => {};
  controller._setCanvasAnnouncement = () => {};

  assert.equal(controller._focusEntityOnBoard('entity_deploy01'), true);
  assert.deepEqual(controller.store.boards[0].view, {
    mode: 'compact',
    projection: 'facts',
    query: '',
    entityType: 'all',
    environment: '',
    verification: 'all'
  });
  assert.equal(controller.selectedEntityId, 'entity_deploy01');
  assert.equal(controller.store.boards[0].viewport.x, -190);
  assert.equal(controller.store.boards[0].viewport.y, 173);
  assert.equal(notifications.length, 0);

  assert.equal(controller._focusEntityOnBoard('entity_missing1'), false);
  assert.match(notifications[0].message, /当前白板/);
  assert.equal(notifications[0].type, 'warning');
});

test('事实检查器显示自定义复核周期和默认周期说明', () => {
  const controller = new Controller({
    bridge: {},
    now: () => new Date('2026-08-28T12:00:00.000Z')
  });
  const htmlWithOverride = controller._factFieldsHtml({
    verifiedAt: '2026-08-20T12:00:00.000Z',
    reviewIntervalDays: 7
  });
  const htmlWithDefault = controller._factFieldsHtml({});

  assert.match(htmlWithOverride, /name="reviewIntervalDays"[^>]+value="7"/);
  assert.match(htmlWithOverride, /已超过 7 天复核周期/);
  assert.match(htmlWithDefault, /留空使用默认 30 天/);
});

test('白板筛选采用锚定弹层并在工具栏只保留一个入口', () => {
  assert.match(controllerSource, /class="relationship-filter-host"/);
  assert.match(controllerSource, /data-relationship-action="toggle-filter-menu"/);
  assert.match(controllerSource, /class="relationship-filter-popover" role="dialog"/);
  assert.match(controllerSource, /data-relationship-filter-form/);
  assert.match(controllerSource, /name="entityType"/);
  assert.match(controllerSource, /name="environment"/);
  assert.match(controllerSource, /name="verification"/);
  assert.match(controllerSource, /name="mode"/);
  assert.match(controllerSource, /name="projection"/);
  assert.match(relationshipCss, /\.relationship-filter-popover\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(controllerSource, /data-relationship-action="filter-(project|repository|server)"/);
});

test('部署摘要从完整事实链派生并聚合同一项目到服务器的部署', () => {
  const controller = new Controller({
    bridge: {},
    now: () => new Date('2026-08-27T12:00:00.000Z')
  });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'Alpha', refId: 'project_alpha01', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'Repo A', refId: 'repo_alpha001', details: {} },
      { id: 'entity_repo0002', type: 'repository', name: 'Repo B', refId: 'repo_alpha002', details: {} },
      { id: 'entity_deploy01', type: 'deployment', name: 'Deploy A', details: { environment: 'production', version: 'v2.4.1' } },
      { id: 'entity_deploy02', type: 'deployment', name: 'Deploy B', details: { environment: 'staging', branch: 'develop', revision: 'abcdef012345' } },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} }
    ],
    relationships: [
      { id: 'relationship_test0001', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0001' },
      { id: 'relationship_test0002', type: 'source_of', sourceId: 'entity_repo0001', targetId: 'entity_deploy01' },
      { id: 'relationship_test0003', type: 'runs_on', sourceId: 'entity_deploy01', targetId: 'entity_server01' },
      { id: 'relationship_test0004', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0002' },
      { id: 'relationship_test0005', type: 'source_of', sourceId: 'entity_repo0002', targetId: 'entity_deploy02' },
      { id: 'relationship_test0006', type: 'runs_on', sourceId: 'entity_deploy02', targetId: 'entity_server01' }
    ],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'deployment-summary', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 300, y: 0 },
        { entityId: 'entity_repo0002', x: 300, y: 160 },
        { entityId: 'entity_deploy01', x: 600, y: 0 },
        { entityId: 'entity_deploy02', x: 600, y: 160 },
        { entityId: 'entity_server01', x: 900, y: 80 }
      ]
    }]
  };

  const entityCount = controller.store.entities.length;
  const relationshipCount = controller.store.relationships.length;
  const graph = controller._filteredGraph();

  assert.deepEqual(graph.placements.map(item => item.entityId), ['entity_project1', 'entity_server01']);
  assert.equal(graph.relationships.length, 0);
  assert.equal(graph.summaryRelationships.length, 1);
  assert.equal(graph.summaryRelationships[0].sourceId, 'entity_project1');
  assert.equal(graph.summaryRelationships[0].targetId, 'entity_server01');
  assert.equal(graph.summaryRelationships[0].count, 2);
  assert.equal(graph.summaryRelationships[0].label, '部署 ×2');
  assert.match(graph.summaryRelationships[0].title, /Deploy A · production · v2\.4\.1/);
  assert.match(graph.summaryRelationships[0].title, /Deploy B · staging · develop · abcdef012345/);
  assert.equal(controller.store.entities.length, entityCount);
  assert.equal(controller.store.relationships.length, relationshipCount);

  controller.store.boards[0].view.query = 'Deploy A';
  const filtered = controller._filteredGraph();
  assert.deepEqual([...filtered.directIds], ['entity_deploy01']);
  assert.deepEqual(filtered.placements.map(item => item.entityId), [
    'entity_repo0001',
    'entity_deploy01',
    'entity_server01'
  ]);
  assert.equal(filtered.summaryRelationships.length, 0);
});

test('部署摘要不会折叠带额外端点关系的中间事实链', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'Alpha', refId: 'project_alpha01', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'Repo', refId: 'repo_alpha001', details: {} },
      { id: 'entity_deploy01', type: 'deployment', name: 'Deploy', details: {} },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} },
      { id: 'entity_endpoint1', type: 'endpoint', name: 'Public', details: {} }
    ],
    relationships: [
      { id: 'relationship_test0001', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0001' },
      { id: 'relationship_test0002', type: 'source_of', sourceId: 'entity_repo0001', targetId: 'entity_deploy01' },
      { id: 'relationship_test0003', type: 'runs_on', sourceId: 'entity_deploy01', targetId: 'entity_server01' },
      { id: 'relationship_test0004', type: 'exposes', sourceId: 'entity_deploy01', targetId: 'entity_endpoint1' }
    ],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'deployment-summary', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 300, y: 0 },
        { entityId: 'entity_deploy01', x: 600, y: 0 },
        { entityId: 'entity_server01', x: 900, y: 0 },
        { entityId: 'entity_endpoint1', x: 900, y: 180 }
      ]
    }]
  };

  const graph = controller._filteredGraph();
  assert.equal(graph.summaryRelationships.length, 0);
  assert.equal(graph.placements.length, 5);
  assert.equal(graph.relationships.length, 4);
});

test('部署摘要在界面中明确标记为不修改事实的派生显示', () => {
  assert.match(controllerSource, /部署摘要 · 派生显示，不修改关系事实/);
  assert.match(controllerSource, /class="relationship-edge relationship-edge-summary/);
  assert.match(relationshipCss, /\.relationship-edge-summary\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(relationshipCss, /\.relationship-edge-summary \.relationship-edge-line\s*\{[^}]*stroke-dasharray:/s);
});

test('框选只命中当前可见节点并使用当前节点尺寸', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_server01', type: 'server', name: 'One', details: {} },
      { id: 'entity_server02', type: 'server', name: 'Two', details: {} },
      { id: 'entity_server03', type: 'server', name: 'Three', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_server01', x: 0, y: 0 },
        { entityId: 'entity_server02', x: 300, y: 0 },
        { entityId: 'entity_server03', x: 0, y: 200 }
      ]
    }]
  };

  assert.deepEqual(controller._selectionBoxEntityIds(-10, -10, 250, 110), ['entity_server01']);
  assert.deepEqual(controller._selectionBoxEntityIds(550, 110, -10, -10), ['entity_server01', 'entity_server02']);
});

test('多选节点可成组拖动并保持相对位置', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_server01', x: 0, y: 0 },
        { entityId: 'entity_server02', x: 300, y: 40 }
      ]
    }]
  };
  controller.root = { querySelector: () => ({ style: {} }) };
  controller._clientToWorld = () => ({ x: 30, y: 25 });
  controller._updateEdges = () => {};
  controller.pointerAction = {
    type: 'node',
    pointerId: 7,
    entityId: 'entity_server01',
    entityIds: ['entity_server01', 'entity_server02'],
    origins: new Map([
      ['entity_server01', { x: 0, y: 0 }],
      ['entity_server02', { x: 300, y: 40 }]
    ]),
    pointX: 10,
    pointY: 5,
    moved: false
  };

  controller._handlePointerMove({ pointerId: 7 });

  assert.deepEqual(controller.store.boards[0].placements, [
    { entityId: 'entity_server01', x: 20, y: 20 },
    { entityId: 'entity_server02', x: 320, y: 60 }
  ]);
  assert.equal(controller.pointerAction.moved, true);
});

test('视觉分组边框包围成员并保留标题空间', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_group001', type: 'group', name: '生产链路', details: {} },
      { id: 'entity_server01', type: 'server', name: 'One', details: {} },
      { id: 'entity_server02', type: 'server', name: 'Two', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_group001', x: 20, y: 20 },
        { entityId: 'entity_server01', x: 100, y: 120, groupId: 'entity_group001' },
        { entityId: 'entity_server02', x: 420, y: 260, groupId: 'entity_group001' }
      ]
    }]
  };

  const geometry = controller._placementGeometry(controller.store.boards[0].placements[0]);

  assert.deepEqual(geometry, { x: 72, y: 66, width: 612, height: 316 });
});

test('拖动视觉分组会把当前白板中的成员一起移动', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_group001', type: 'group', name: '生产链路', details: {} },
      { id: 'entity_server01', type: 'server', name: 'One', details: {} },
      { id: 'entity_server02', type: 'server', name: 'Two', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_test0001', name: '测试', viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_group001', x: 20, y: 20 },
        { entityId: 'entity_server01', x: 100, y: 120, groupId: 'entity_group001' },
        { entityId: 'entity_server02', x: 420, y: 260, groupId: 'entity_group001' }
      ]
    }]
  };

  assert.deepEqual(controller._movingEntityIds('entity_group001'), [
    'entity_group001',
    'entity_server01',
    'entity_server02'
  ]);
});

test('所选节点可归入和移出已有视觉分组且每次只产生一个撤销点', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_group001', type: 'group', name: '生产链路', details: {} },
      { id: 'entity_server01', type: 'server', name: 'One', details: {} },
      { id: 'entity_server02', type: 'server', name: 'Two', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_test0001', name: '测试', viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_group001', x: 20, y: 20 },
        { entityId: 'entity_server01', x: 100, y: 120 },
        { entityId: 'entity_server02', x: 420, y: 260 }
      ]
    }]
  };
  controller._setEntitySelection(new Set(['entity_server01', 'entity_server02']), 'entity_server02');
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._refreshHistoryButtons = () => {};
  controller._updateSummary = () => {};

  assert.equal(controller._assignSelectionToGroup('entity_group001'), true);
  assert.equal(controller.undoStack.length, 1);
  assert.deepEqual(controller.store.boards[0].placements.slice(1).map(item => item.groupId), [
    'entity_group001',
    'entity_group001'
  ]);

  assert.equal(controller._removeSelectionFromGroups(), true);
  assert.equal(controller.undoStack.length, 2);
  assert.deepEqual(controller.store.boards[0].placements.slice(1).map(item => item.groupId), [undefined, undefined]);
});

test('删除视觉分组会安全解组但保留成员节点', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_group001', type: 'group', name: '生产链路', details: {} },
      { id: 'entity_server01', type: 'server', name: 'One', details: {} }
    ],
    relationships: [],
    boards: [{
      id: 'board_test0001', name: '测试', viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_group001', x: 20, y: 20 },
        { entityId: 'entity_server01', x: 100, y: 120, groupId: 'entity_group001' }
      ]
    }]
  };
  controller._selectOnlyEntity('entity_group001');
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._refreshHistoryButtons = () => {};
  controller._updateSummary = () => {};

  controller._deleteSelection();

  assert.deepEqual(controller.store.boards[0].placements, [{ entityId: 'entity_server01', x: 100, y: 120 }]);
  assert.deepEqual(controller.store.entities.map(entity => entity.id), ['entity_server01']);
});

test('多选节点按一次删除形成一个可撤销操作', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'Project', refId: 'project_alpha01', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'Repo', refId: 'repo_alpha001', details: {} },
      { id: 'entity_server01', type: 'server', name: 'Server', details: {} }
    ],
    relationships: [{
      id: 'relationship_test0001',
      type: 'contains',
      sourceId: 'entity_project1',
      targetId: 'entity_repo0001'
    }],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 300, y: 0 },
        { entityId: 'entity_server01', x: 600, y: 0 }
      ]
    }]
  };
  controller._setEntitySelection(new Set(['entity_project1', 'entity_repo0001']), 'entity_repo0001');
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._refreshHistoryButtons = () => {};
  controller._updateSummary = () => {};

  controller._deleteSelection();

  assert.deepEqual(controller.store.entities.map(entity => entity.id), ['entity_server01']);
  assert.equal(controller.store.relationships.length, 0);
  assert.deepEqual(controller.store.boards[0].placements.map(item => item.entityId), ['entity_server01']);
  assert.equal(controller.undoStack.length, 1);
  assert.equal(controller._entitySelectionIds().size, 0);
});

test('多选节点使用一次键盘操作同步移动', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_server01', x: 0, y: 0 },
        { entityId: 'entity_server02', x: 300, y: 40 }
      ]
    }]
  };
  controller.root = { isConnected: true, querySelector: () => null };
  controller._setEntitySelection(new Set(['entity_server01', 'entity_server02']), 'entity_server02');
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._refreshHistoryButtons = () => {};
  controller._updateSummary = () => {};
  let prevented = false;

  controller._handleKeydown({
    key: 'ArrowRight',
    shiftKey: true,
    metaKey: false,
    ctrlKey: false,
    target: { matches: () => false },
    preventDefault: () => { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.deepEqual(controller.store.boards[0].placements, [
    { entityId: 'entity_server01', x: 24, y: 0 },
    { entityId: 'entity_server02', x: 324, y: 40 }
  ]);
  assert.equal(controller.undoStack.length, 1);
});

test('筛选切换只保留仍然可见的已选节点', () => {
  const controller = new Controller({ bridge: {} });
  controller._setEntitySelection(
    new Set(['entity_server01', 'entity_server02', 'entity_server03']),
    'entity_server02'
  );

  controller._pruneEntitySelection(new Set(['entity_server02', 'entity_server04']));

  assert.deepEqual([...controller._entitySelectionIds()], ['entity_server02']);
  assert.equal(controller.selectedEntityId, 'entity_server02');

  controller._pruneEntitySelection(new Set(['entity_server04']));

  assert.equal(controller._entitySelectionIds().size, 0);
  assert.equal(controller.selectedEntityId, '');
});

test('白板多选提供修饰键、Shift 框选和不批量编辑事实的说明', () => {
  assert.match(controllerSource, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(controllerSource, /event\.shiftKey && event\.button === 0/);
  assert.match(controllerSource, /class="relationship-selection-box"/);
  assert.match(controllerSource, /事实字段必须逐个节点编辑/);
  assert.match(relationshipCss, /\.relationship-selection-box\s*\{/);
  assert.match(controllerSource, /建立视觉分组/);
  assert.match(controllerSource, /移出分组/);
  assert.match(relationshipCss, /\.relationship-group-frame\s*\{/);
});

test('内容筛选保留直接匹配节点的一跳关系上下文', () => {
  const controller = new Controller({
    bridge: {},
    now: () => new Date('2026-08-27T12:00:00.000Z')
  });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'Alpha Project', refId: 'project_alpha01', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'Repository R', refId: 'repository_r01', details: {} },
      { id: 'entity_deploy01', type: 'deployment', name: 'Production', details: { environment: 'production' }, verifiedAt: '2026-07-01T12:00:00.000Z' },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: { environment: 'production' } }
    ],
    relationships: [
      { id: 'relationship_test0001', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0001' },
      { id: 'relationship_test0002', type: 'source_of', sourceId: 'entity_repo0001', targetId: 'entity_deploy01' },
      { id: 'relationship_test0003', type: 'runs_on', sourceId: 'entity_deploy01', targetId: 'entity_server01' }
    ],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'full', query: 'alpha', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 300, y: 0 },
        { entityId: 'entity_deploy01', x: 600, y: 0 },
        { entityId: 'entity_server01', x: 900, y: 0 }
      ]
    }]
  };

  let graph = controller._filteredGraph();
  assert.deepEqual([...graph.directIds], ['entity_project1']);
  assert.deepEqual(graph.placements.map(item => item.entityId), ['entity_project1', 'entity_repo0001']);
  assert.deepEqual([...graph.contextualIds], ['entity_repo0001']);
  assert.deepEqual(graph.relationships.map(item => item.id), ['relationship_test0001']);

  controller.store.boards[0].view = {
    mode: 'full', query: '', entityType: 'all', environment: '', verification: 'stale'
  };
  graph = controller._filteredGraph();
  assert.deepEqual([...graph.directIds], ['entity_deploy01']);
  assert.deepEqual(graph.placements.map(item => item.entityId), ['entity_repo0001', 'entity_deploy01', 'entity_server01']);
  assert.deepEqual(graph.relationships.map(item => item.id), ['relationship_test0002', 'relationship_test0003']);
});

test('精简模式使用对应节点尺寸计算双向连线端点', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'compact', query: '', entityType: 'all', environment: '', verification: 'all' },
      placements: [
        { entityId: 'entity_source01', x: 420, y: 100 },
        { entityId: 'entity_target01', x: 80, y: 180 }
      ]
    }]
  };

  assert.deepEqual(controller._nodeDimensions(), { width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT });
  const geometry = controller._edgeGeometry({ sourceId: 'entity_source01', targetId: 'entity_target01' });
  assert.match(geometry.path, new RegExp(`^M 420 ${100 + COMPACT_NODE_HEIGHT / 2} C`));
  assert.match(geometry.path, new RegExp(` ${80 + COMPACT_NODE_WIDTH} ${180 + COMPACT_NODE_HEIGHT / 2}$`));
});

test('项目和仓库可按稳定身份加入当前白板并清除遮挡它的筛选', () => {
  const controller = new Controller({ bridge: {} });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [],
    relationships: [],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      view: { mode: 'compact', query: 'other', entityType: 'server', environment: '', verification: 'all' },
      placements: []
    }]
  };
  controller.resourceMap = new Map([['project:project_alpha01', {
    key: 'project:project_alpha01',
    kind: 'project',
    refId: 'project_alpha01',
    name: 'Alpha Project',
    path: '/workspace/alpha',
    secondary: '开发中'
  }]]);
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._updateFilterSummary = () => {};
  controller._updateSummary = () => {};
  controller._setCanvasAnnouncement = () => {};

  assert.equal(controller.revealResource('project', 'project_alpha01'), true);
  assert.equal(controller.store.entities.length, 1);
  assert.equal(controller.store.entities[0].refId, 'project_alpha01');
  assert.equal(controller.store.boards[0].placements.length, 1);
  assert.equal(controller.store.boards[0].view.mode, 'compact');
  assert.equal(controller.store.boards[0].view.query, '');
  assert.equal(controller.store.boards[0].view.entityType, 'all');
  assert.equal(controller.selectedEntityId, controller.store.entities[0].id);
  assert.equal(controller.undoStack.length, 1);

  assert.equal(controller.revealResource('project', 'project_alpha01'), true);
  assert.equal(controller.store.entities.length, 1);
  assert.equal(controller.store.boards[0].placements.length, 1);
  assert.equal(controller.undoStack.length, 1);
});

test('项目首页、目录详情和仓库详情均提供关系白板下钻入口', () => {
  assert.match(appSource, /data-app-action="show-relationship-resource"[^>]+data-relationship-kind="project"/);
  assert.match(selectionDetailSource, /data-detail-action="show-relationship-resource"/);
  assert.match(html, /id="detail-relationship-board"/);
  assert.match(appSource, /showResourceInRelationshipBoard\(options = \{\}\)/);
  assert.match(appSource, /localProjects\.describe\(resourcePath\)/);
  assert.match(appSource, /repos\.getRegistry\(\)/);
  assert.match(appSource, /DirectoryNavigation\.pathsEqual/);
  assert.match(appSource, /relationshipBoardController\.revealResource\(kind, refId\)/);
  assert.match(controllerSource, /revealResource\(kind, refId\)/);
});

test('人工核验可撤销并写入确定时间而不改变关系结构', () => {
  const controller = new Controller({
    bridge: {},
    now: () => new Date('2026-08-27T12:34:56.000Z')
  });
  controller.store = {
    schemaVersion: 1,
    activeBoardId: 'board_test0001',
    entities: [
      { id: 'entity_deploy01', type: 'deployment', name: 'MES', details: {} },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: {} }
    ],
    relationships: [{
      id: 'relationship_test0001',
      type: 'runs_on',
      sourceId: 'entity_deploy01',
      targetId: 'entity_server01',
      source: 'manual'
    }],
    boards: [{
      id: 'board_test0001',
      name: '测试',
      viewport: { x: 0, y: 0, zoom: 1 },
      placements: [
        { entityId: 'entity_deploy01', x: 0, y: 0 },
        { entityId: 'entity_server01', x: 320, y: 0 }
      ]
    }]
  };
  controller.selectedRelationshipId = 'relationship_test0001';
  controller._persistSoon = () => {};
  controller._renderGraph = () => {};
  controller._refreshHistoryButtons = () => {};
  controller._updateSummary = () => {};
  controller._setCanvasAnnouncement = () => {};

  assert.equal(controller._verifySelectedNow(), true);
  assert.equal(controller.store.relationships[0].verifiedAt, '2026-08-27T12:34:56.000Z');
  assert.equal(controller.store.relationships[0].source, 'manual');
  assert.equal(controller.store.relationships.length, 1);
  assert.equal(controller.undoStack.length, 1);
});
