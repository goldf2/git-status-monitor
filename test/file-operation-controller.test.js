const test = require('node:test');
const assert = require('node:assert/strict');

const EditActionRouter = require('../src/renderer/scripts/editActionRouter');
const { Controller } = require('../src/renderer/scripts/fileOperationController');

function createHarness(overrides = {}) {
  const calls = [];
  const state = {
    currentMode: 'tree',
    currentPath: '/workspace',
    selectedPaths: new Set(['/workspace/a.txt']),
    selectionAnchorPath: '/workspace/a.txt',
    visibleItems: [{ path: '/workspace/a.txt', name: 'a.txt', type: 'file' }],
    fileOperationHistory: [],
    fileOperationBusy: false,
    directoryLoad: null,
    fileRecoveryStatus: null,
    fileClipboard: null,
    ...overrides.state
  };
  const app = {
    _fileRecoveryNoticeShown: false,
    quickLookController: { isOpen: () => false },
    getSelectedFileItems: () => state.visibleItems.filter(item => state.selectedPaths.has(item.path)),
    updateFileActionBar: () => calls.push('update-actions'),
    _showStatusMessage: (message, type) => calls.push(['status', message, type]),
    isGlobalSearchActive: () => false,
    isFileBrowsingContext: () => true,
    isDirectoryBrowsingContext: () => true,
    openTransferReview: async (...args) => calls.push(['transfer', ...args]),
    closeQuickLook: () => calls.push('close-preview'),
    persistWorkspaceTabs: async () => calls.push('persist-tabs'),
    refreshWorkspaceTabsFromConfig: async () => calls.push('refresh-tabs'),
    loadPersistedRepos: async () => calls.push('repos'),
    loadGroups: async () => calls.push('groups'),
    loadFavorites: async () => calls.push('favorites'),
    renderSidebarTree: async () => calls.push('sidebar'),
    performGlobalSearch: async () => calls.push('global-search'),
    renderContent: async () => calls.push('content'),
    showFileSelectionDetail: items => calls.push(['selection-detail', items.length]),
    reconcileRepositoryIndex: async () => calls.push('reconcile'),
    reconcileFileKeyboardFocus: () => calls.push('keyboard-focus'),
    syncFileSelectionUI: () => calls.push('selection-ui'),
    updateStatusBar: () => calls.push('status-bar'),
    ...overrides.app
  };
  const bridge = {
    platform: 'darwin',
    fileOps: {
      getHistory: async () => [],
      getRecoveryStatus: async () => null,
      undo: async id => ({ id }),
      redo: async id => ({ id })
    },
    content: { invalidateIndex: async () => calls.push('invalidate-index') },
    clipboard: {
      copyPathnames: async paths => {
        calls.push(['copy-pathnames', paths]);
        return { count: paths.length };
      }
    },
    app: { performNativeEdit: async action => calls.push(['native', action]) },
    ...overrides.bridge
  };
  const window = {
    getSelection: () => null,
    getComputedStyle: element => element.style || { display: 'none' },
    ...overrides.window
  };
  const document = {
    activeElement: null,
    querySelectorAll: () => [],
    ...overrides.document
  };
  const controller = new Controller({
    app,
    state,
    bridge,
    editActionRouter: EditActionRouter,
    window,
    document
  });
  return { controller, state, app, bridge, calls };
}

test('文件剪贴板复制和剪切保留路径，并复用统一传输审查', async () => {
  const { controller, state, calls } = createHarness();

  controller.copySelectedItems();
  assert.equal(state.fileClipboard.operation, 'copy');
  assert.deepEqual(state.fileClipboard.paths, ['/workspace/a.txt']);
  await controller.pasteFileClipboard();
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'transfer'), [
    'transfer',
    ['/workspace/a.txt'],
    '/workspace',
    'copy',
    { clearClipboardOnSuccess: false }
  ]);

  controller.cutSelectedItems();
  await controller.pasteFileClipboard();
  const transfers = calls.filter(call => Array.isArray(call) && call[0] === 'transfer');
  assert.equal(transfers[1][3], 'move');
  assert.deepEqual(transfers[1][4], { clearClipboardOnSuccess: true });
});

test('复制为路径名写入系统剪贴板但不改变应用内文件剪贴板', async () => {
  const { controller, state, calls } = createHarness();
  state.fileClipboard = { operation: 'move', paths: ['/workspace/old.txt'] };

  assert.equal(await controller.copySelectedPathnames(), true);
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'copy-pathnames'), [
    'copy-pathnames', ['/workspace/a.txt']
  ]);
  assert.deepEqual(state.fileClipboard, { operation: 'move', paths: ['/workspace/old.txt'] });
  assert.ok(calls.some(call => Array.isArray(call) && call[1] === '已将路径名复制到系统剪贴板'));
});

test('复制为路径名失败时保留选择并显示错误', async () => {
  const { controller, state, calls } = createHarness({
    bridge: {
      platform: 'darwin',
      fileOps: {
        getHistory: async () => [],
        getRecoveryStatus: async () => null,
        undo: async id => ({ id }),
        redo: async id => ({ id })
      },
      clipboard: { copyPathnames: async () => { throw new Error('系统剪贴板不可用'); } },
      content: { invalidateIndex: async () => {} },
      app: { performNativeEdit: async () => {} }
    }
  });

  assert.equal(await controller.copySelectedPathnames(), false);
  assert.equal(state.selectedPaths.size, 1);
  assert.ok(calls.some(call => Array.isArray(call) && call[1] === '系统剪贴板不可用' && call[2] === 'error'));
});

test('聚合内容筛选不会把当前路径误当成可写入目录', async () => {
  const { controller, calls } = createHarness({
    app: { isFileBrowsingContext: () => true, isDirectoryBrowsingContext: () => false }
  });
  controller.copySelectedItems();
  await controller.pasteFileClipboard();
  await controller.duplicateSelectedItems();
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'transfer'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'status' && call[2] === 'error'));
});

test('目录加载或失败期间快捷键不能对旧选择执行文件操作', async () => {
  const { controller, state, calls } = createHarness({
    state: {
      directoryLoad: { status: 'loading' },
      fileClipboard: { operation: 'move', paths: ['/workspace/old.txt'] },
      fileOperationHistory: [{ id: 'undo-1', undoable: true }]
    }
  });

  controller.copySelectedItems();
  controller.cutSelectedItems();
  assert.equal(await controller.copySelectedPathnames(), false);
  await controller.pasteFileClipboard();
  await controller.duplicateSelectedItems();
  await controller.undoLastFileOperation();

  assert.deepEqual(state.fileClipboard, { operation: 'move', paths: ['/workspace/old.txt'] });
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'transfer'), false);
  assert.equal(calls.some(call => call === 'content'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'status' && /载入/.test(call[1])));

  state.directoryLoad = { status: 'error' };
  assert.equal(await controller.run(async () => assert.fail('不应执行操作'), '不应完成'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'status' && /不可用/.test(call[1])));
});

test('撤销和重做候选保持历史与撤销时间语义', () => {
  const { controller, state } = createHarness({
    state: {
      fileOperationHistory: [
        { id: 'latest-active', undoable: true },
        { id: 'older-redo', undoable: true, undoneAt: 10, redoable: true },
        { id: 'latest-redo', undoable: true, undoneAt: 20, redoable: true },
        { id: 'invalid', undoable: true, undoneAt: 30, redoable: true, redoInvalidatedAt: 31 }
      ]
    }
  });

  assert.equal(controller.latestUndoable().id, 'latest-active');
  assert.equal(controller.latestRedoable().id, 'latest-redo');
  state.fileOperationHistory[2].redoable = false;
  state.fileOperationHistory[2].redoUnavailableReason = '跨磁盘移动需重新审查';
  assert.equal(controller.latestRedoUnavailable().redoUnavailableReason, '跨磁盘移动需重新审查');
});

test('文件操作历史恢复提示只显示一次', async () => {
  const { controller, state, app, calls } = createHarness({
    bridge: {
      platform: 'darwin',
      fileOps: {
        getHistory: async () => [{ id: 'op-1' }],
        getRecoveryStatus: async () => ({ needsReview: [{ id: 'journal-1' }] })
      },
      content: { invalidateIndex: async () => {} },
      app: { performNativeEdit: async () => {} }
    }
  });

  await controller.loadHistory();
  await controller.loadHistory();
  assert.equal(state.fileOperationHistory[0].id, 'op-1');
  assert.equal(app._fileRecoveryNoticeShown, true);
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'status').length, 1);
});

test('成功文件操作执行统一刷新链并在完成后解除忙碌状态', async () => {
  const { controller, state, calls } = createHarness();
  const success = await controller.run(async () => {
    calls.push('operation');
    return { count: 1 };
  }, result => `完成 ${result.count} 项`);

  assert.equal(success, true);
  assert.equal(state.fileOperationBusy, false);
  assert.equal(state.selectedPaths.size, 0);
  assert.equal(state.selectionAnchorPath, null);
  assert.ok(calls.indexOf('persist-tabs') < calls.indexOf('operation'));
  assert.ok(calls.indexOf('operation') < calls.indexOf('invalidate-index'));
  assert.ok(calls.includes('sidebar'));
  assert.ok(calls.includes('content'));
  assert.ok(calls.includes('reconcile'));
  assert.ok(calls.some(call => Array.isArray(call) && call[1] === '完成 1 项' && call[2] === 'success'));
});

test('失败文件操作不执行后续刷新并可靠解除忙碌状态', async () => {
  const { controller, state, calls } = createHarness();
  const success = await controller.run(async () => {
    throw new Error('目标已存在');
  }, '不应显示');

  assert.equal(success, false);
  assert.equal(state.fileOperationBusy, false);
  assert.equal(state.selectedPaths.size, 1);
  assert.equal(calls.includes('invalidate-index'), false);
  assert.ok(calls.some(call => Array.isArray(call) && call[1] === '目标已存在' && call[2] === 'error'));
});

test('编辑动作在文件浏览与原生输入之间正确路由', async () => {
  const { controller, state, calls } = createHarness();
  let copied = 0;
  let selectedAll = 0;
  controller.copySelectedItems = () => { copied += 1; };
  controller.selectAllVisibleFiles = () => { selectedAll += 1; };

  assert.equal(controller.handleEditAction('copy'), true);
  assert.equal(copied, 1);
  assert.equal(controller.handleEditAction('select-all'), true);
  assert.equal(selectedAll, 1);

  state.fileOperationHistory = [{
    id: 'cross-volume',
    undoable: true,
    undoneAt: 10,
    redoable: false,
    redoUnavailableReason: '跨磁盘移动需重新审查'
  }];
  assert.equal(controller.handleEditAction('redo'), true);
  assert.ok(calls.some(call => Array.isArray(call) && call[1] === '跨磁盘移动需重新审查'));

  controller.document.activeElement = { tagName: 'INPUT' };
  assert.equal(controller.handleEditAction('copy', { source: 'keyboard' }), false);
  assert.equal(controller.handleEditAction('copy', { source: 'menu' }), true);
  await Promise.resolve();
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'native' && call[1] === 'copy'));
});

test('文件操作全选委托给目录选择控制器', () => {
  const { controller, calls } = createHarness({
    app: {
      selectAllVisibleFiles: () => calls.push('select-all-visible')
    }
  });

  controller.selectAllVisibleFiles();
  assert.deepEqual(calls, ['select-all-visible']);
});
