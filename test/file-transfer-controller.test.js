const test = require('node:test');
const assert = require('node:assert/strict');

const FileTransfers = require('../src/renderer/scripts/fileTransfers');
const { Controller } = require('../src/renderer/scripts/fileTransferController');
const ContentQuery = require('../src/renderer/scripts/contentQuery');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createPreview(overrides = {}) {
  return {
    operationId: 'operation-1',
    previewToken: 'preview-token-1',
    operationType: 'move',
    mode: 'move',
    destination: '/workspace/destination',
    destinationName: 'destination',
    destinationVolumeName: 'Workspace',
    itemCount: 1,
    totalBytes: 1024,
    requiredBytes: 1024,
    availableBytes: 4096,
    crossVolumeCount: 0,
    conflictCount: 0,
    replaceCount: 0,
    conflictPolicy: 'keep-both',
    canApply: true,
    requiresStructureRiskAcknowledgement: false,
    items: [{
      source: '/workspace/source.txt',
      sourceName: 'source.txt',
      sourceParent: '/workspace',
      target: '/workspace/destination/source.txt',
      targetName: 'source.txt',
      type: 'file',
      transferKind: 'atomic-move',
      conflictAction: null,
      structureRisks: []
    }],
    validations: [{ passed: true, message: '目标可写' }],
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const elements = new Map();
  const elementIds = [
    'transfer-review-modal',
    'transfer-review-body',
    'transfer-review-title',
    'transfer-review-description',
    'transfer-review-apply-btn',
    'transfer-review-cancel-btn',
    'transfer-review-close-btn',
    'transfer-review-feedback',
    'external-import-modal',
    'external-import-body',
    'external-import-apply-btn',
    'external-import-cancel-btn',
    'external-import-close-btn',
    'external-import-feedback'
  ];
  for (const id of elementIds) {
    elements.set(id, {
      id,
      style: { display: 'none' },
      innerHTML: '',
      textContent: '',
      disabled: false,
      focus: () => calls.push(['focus', id])
    });
  }
  const activeTab = { focus: () => calls.push('focus-tab') };
  const document = {
    getElementById: id => elements.get(id) || null,
    querySelector: selector => selector === '.workspace-tab.active' ? activeTab : null,
    ...overrides.document
  };
  const state = {
    currentPath: '/workspace',
    visibleItems: [],
    selectedPaths: new Set(),
    selectionAnchorPath: null,
    contentQuery: ContentQuery.defaultQuery(),
    fileOperationBusy: false,
    fileClipboard: null,
    transferPreview: null,
    transferApplying: false,
    transferError: null,
    transferStatus: null,
    transferContext: null,
    externalImportPreview: null,
    externalImportApplying: false,
    externalImportError: null,
    externalImportStatus: null,
    ...overrides.state
  };
  const app = {
    escapeHtml,
    formatFileSize: value => `${Number(value) || 0} B`,
    _showStatusMessage: (message, tone) => calls.push(['status', message, tone]),
    runFileOperation: async action => {
      await action();
      return true;
    },
    updateFileActionBar: () => calls.push('update-actions'),
    captureActiveWorkspaceTab: () => calls.push('capture-tab'),
    persistWorkspaceTabs: async () => calls.push('persist-tabs'),
    updateDirectoryTypeFilterUI: () => calls.push('filter-ui'),
    renderContent: async () => calls.push('content'),
    syncFileSelectionUI: () => calls.push('selection-ui'),
    showFileSelectionDetail: () => calls.push('selection-detail'),
    getSelectedFileItems: () => [],
    cssEscape: value => value,
    ...overrides.app
  };
  const bridge = {
    fileOps: {
      previewTransfer: async () => createPreview(),
      applyTransfer: async payload => ({ payload, items: [{}], undoable: true }),
      getTransferStatus: async () => ({ state: 'completed', progress: 100 }),
      cancelTransfer: async operationId => ({ operationId, state: 'cancelled', progress: 0 }),
      previewImport: async () => createPreview({ operationType: 'import', mode: 'copy' }),
      applyImport: async payload => ({ payload, items: [{}], undoable: true })
    },
    ...overrides.bridge
  };
  const controller = new Controller({
    app,
    state,
    bridge,
    presentation: FileTransfers,
    contentQuery: ContentQuery,
    document,
    requestAnimationFrame: callback => callback(),
    setInterval: overrides.setInterval || (() => 'timer-1'),
    clearInterval: overrides.clearInterval || (() => {})
  });
  return { controller, state, app, bridge, document, elements, calls };
}

test('传输进度在应用前后轮询，并始终清理计时器', async () => {
  const statuses = [];
  const cleared = [];
  let statusRequestCount = 0;
  const { controller } = createHarness({
    bridge: {
      fileOps: {
        getTransferStatus: async () => ({ state: 'running', progress: ++statusRequestCount })
      }
    },
    clearInterval: timer => cleared.push(timer)
  });

  const result = await controller.executeTransferWithProgress(
    { operationId: 'operation-poll' },
    async () => ({ completed: true }),
    status => statuses.push(status.progress)
  );

  assert.deepEqual(result, { completed: true });
  assert.deepEqual(statuses, [1, 2, 3]);
  assert.deepEqual(cleared, ['timer-1']);
});

test('打开传输审查只生成预览，并默认使用保留两者策略', async () => {
  const preview = createPreview();
  const previewCalls = [];
  const { controller, state, elements, calls } = createHarness({
    bridge: {
      fileOps: {
        previewTransfer: async (...args) => {
          previewCalls.push(args);
          return preview;
        }
      }
    }
  });

  await controller.openTransferReview(['/workspace/source.txt'], '/workspace/destination', 'move', { clearClipboardOnSuccess: true });

  assert.deepEqual(previewCalls, [[
    ['/workspace/source.txt'],
    '/workspace/destination',
    'move',
    { conflictPolicy: 'keep-both' }
  ]]);
  assert.equal(elements.get('transfer-review-modal').style.display, 'flex');
  assert.equal(state.transferContext.clearClipboardOnSuccess, true);
  assert.equal(state.transferContext.riskAcknowledged, false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'focus' && call[1] === 'transfer-review-cancel-btn'));
});

test('改变冲突策略会重新预览，并撤销旧的结构风险确认', async () => {
  const previewCalls = [];
  const { controller, state } = createHarness({
    state: {
      transferContext: {
        sourcePaths: ['/workspace/source.txt'],
        destinationDirectory: '/workspace/destination',
        mode: 'move',
        conflictPolicy: 'keep-both',
        riskAcknowledged: true
      }
    },
    bridge: {
      fileOps: {
        previewTransfer: async (...args) => {
          previewCalls.push(args);
          return createPreview({ conflictPolicy: 'replace' });
        }
      }
    }
  });

  await controller.changeTransferConflictPolicy('replace');

  assert.equal(state.transferContext.conflictPolicy, 'replace');
  assert.equal(state.transferContext.riskAcknowledged, false);
  assert.deepEqual(previewCalls[0][3], { conflictPolicy: 'replace' });
});

test('确认移动沿用预览令牌、冲突策略和结构风险确认', async () => {
  const payloads = [];
  const preview = createPreview({
    conflictPolicy: 'replace',
    requiresStructureRiskAcknowledgement: true
  });
  const { controller, state, elements, calls } = createHarness({
    state: {
      transferPreview: preview,
      transferContext: { clearClipboardOnSuccess: true, riskAcknowledged: true },
      fileClipboard: { operation: 'move', paths: ['/workspace/source.txt'] }
    },
    bridge: {
      fileOps: {
        applyTransfer: async payload => {
          payloads.push(payload);
          return { items: [{}], undoable: true };
        },
        getTransferStatus: async () => ({ state: 'completed', progress: 100 })
      }
    }
  });

  await controller.applyReviewedTransfer();

  assert.deepEqual(payloads, [{
    operationId: 'operation-1',
    previewToken: 'preview-token-1',
    sourcePaths: ['/workspace/source.txt'],
    destinationDirectory: '/workspace/destination',
    mode: 'move',
    conflictPolicy: 'replace',
    structureRiskAcknowledged: true
  }]);
  assert.equal(state.fileClipboard, null);
  assert.equal(state.transferApplying, false);
  assert.equal(elements.get('transfer-review-modal').style.display, 'none');
  assert.ok(calls.includes('update-actions'));
});

test('只有可取消的准备阶段才会发送取消请求', async () => {
  const cancelled = [];
  const { controller, state } = createHarness({
    state: {
      transferApplying: true,
      transferPreview: createPreview(),
      transferStatus: { operationId: 'operation-cancel', state: 'running', phase: 'preparing', cancellable: true }
    },
    bridge: {
      fileOps: {
        cancelTransfer: async operationId => {
          cancelled.push(operationId);
          return { operationId, state: 'cancelled' };
        }
      }
    }
  });

  await controller.handleTransferReviewCancel();
  assert.deepEqual(cancelled, ['operation-cancel']);
  state.transferStatus = { operationId: 'operation-commit', state: 'running', phase: 'committing', cancellable: false };
  await controller.handleTransferReviewCancel();
  assert.deepEqual(cancelled, ['operation-cancel']);
});

test('外部导入确认保持来源不动并使用预览目标', async () => {
  const payloads = [];
  const preview = createPreview({ operationType: 'import', mode: 'copy', destination: '/another-destination' });
  const { controller, state, elements } = createHarness({
    state: { externalImportPreview: preview },
    bridge: {
      fileOps: {
        applyImport: async payload => {
          payloads.push(payload);
          return { items: [{}], undoable: true };
        },
        getTransferStatus: async () => ({ state: 'completed', progress: 100 })
      }
    }
  });

  await controller.applyExternalImport();

  assert.deepEqual(payloads, [{
    operationId: 'operation-1',
    previewToken: 'preview-token-1',
    sourcePaths: ['/workspace/source.txt'],
    destinationDirectory: '/another-destination'
  }]);
  assert.equal(state.externalImportApplying, false);
  assert.equal(elements.get('external-import-modal').style.display, 'none');
});

test('传输计划对路径、文件名和校验信息进行 HTML 转义', () => {
  const { controller } = createHarness();
  const preview = createPreview({
    destination: '/workspace/<destination>',
    destinationName: '<destination>',
    destinationVolumeName: '<volume>',
    items: [{
      source: '/workspace/<source>.txt',
      sourceName: '<source>.txt',
      sourceParent: '/workspace/<parent>',
      target: '/workspace/<destination>/<target>.txt',
      targetName: '<target>.txt',
      type: 'file',
      transferKind: 'copy',
      conflictAction: null,
      structureRisks: ['<risk>']
    }],
    validations: [{ passed: false, message: '<validation>' }],
    requiresStructureRiskAcknowledgement: true
  });

  const html = controller.transferPlanHtml(preview);

  assert.doesNotMatch(html, /<target>|<source>|<validation>|<destination>|<volume>|<risk>/);
  assert.match(html, /&lt;target&gt;\.txt/);
  assert.match(html, /&lt;validation&gt;/);
  assert.match(html, /&lt;risk&gt;/);
});
