(function exposeFileOperationController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileOperationController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileOperationControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.editActionRouter = options.editActionRouter || root?.EditActionRouter || null;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
    }

    latestUndoable() {
      return this.state.fileOperationHistory.find(operation => operation.undoable && !operation.undoneAt);
    }

    latestRedoable() {
      return [...this.state.fileOperationHistory]
        .filter(operation => operation.undoable && operation.undoneAt && operation.redoable && !operation.redoInvalidatedAt)
        .sort((left, right) => Number(right.undoneAt) - Number(left.undoneAt))[0];
    }

    latestRedoUnavailable() {
      return [...this.state.fileOperationHistory]
        .filter(operation => operation.undoable && operation.undoneAt && !operation.redoInvalidatedAt)
        .sort((left, right) => Number(right.undoneAt) - Number(left.undoneAt))[0];
    }

    directoryUnavailableMessage() {
      const status = this.state.directoryLoad?.status;
      if (status === 'loading') return '请等待当前文件夹载入完成';
      if (status === 'error') return '当前文件夹不可用，请重新载入或选择其他文件夹';
      return '';
    }

    blockUnavailableDirectory() {
      const message = this.directoryUnavailableMessage();
      if (!message) return false;
      this.app._showStatusMessage(message, 'info');
      return true;
    }

    async loadHistory() {
      try {
        const [history, recovery] = await Promise.all([
          this.bridge.fileOps.getHistory(50),
          this.bridge.fileOps.getRecoveryStatus()
        ]);
        this.state.fileOperationHistory = history;
        this.state.fileRecoveryStatus = recovery;
        if (!this.app._fileRecoveryNoticeShown && recovery?.needsReview?.length) {
          this.app._fileRecoveryNoticeShown = true;
          this.app._showStatusMessage(`发现 ${recovery.needsReview.length} 项中断传输需要检查；来源和目标均已保留`, 'error');
        } else if (!this.app._fileRecoveryNoticeShown && recovery?.completedOperationId) {
          this.app._fileRecoveryNoticeShown = true;
          this.app._showStatusMessage('已恢复完成的中断传输，并补齐配置与撤销记录', 'success');
        } else if (!this.app._fileRecoveryNoticeShown && recovery?.cleanedStagingPaths?.length) {
          this.app._fileRecoveryNoticeShown = true;
          this.app._showStatusMessage(`已安全清理 ${recovery.cleanedStagingPaths.length} 个中断传输临时项`, 'success');
        }
      } catch (error) {
        this.state.fileOperationHistory = [];
        this.state.fileRecoveryStatus = null;
        console.warn('文件操作历史加载失败:', error);
      }
      this.app.updateFileActionBar();
      this.app.fileOperationHistoryController?.render();
    }

    copySelectedItems() {
      if (this.blockUnavailableDirectory()) return;
      const items = this.app.getSelectedFileItems();
      if (!items.length || this.state.fileOperationBusy) return;
      this.state.fileClipboard = {
        operation: 'copy',
        paths: items.map(item => item.path),
        capturedAt: Date.now()
      };
      this.app.updateFileActionBar();
      const pasteShortcut = this.bridge.platform === 'darwin' ? '⌘V' : 'Ctrl+V';
      this.app._showStatusMessage(`已复制 ${items.length} 项，可在目录中按 ${pasteShortcut} 粘贴`, 'success');
    }

    async copySelectedPathnames() {
      if (this.blockUnavailableDirectory()) return false;
      const items = this.app.getSelectedFileItems();
      if (!items.length || this.state.fileOperationBusy) {
        if (!items.length) this.app._showStatusMessage('请先选择文件或文件夹', 'info');
        return false;
      }
      try {
        const result = await this.bridge.clipboard.copyPathnames(items.map(item => item.path));
        this.app._showStatusMessage(
          result.count > 1 ? `已将 ${result.count} 个路径名复制到系统剪贴板` : '已将路径名复制到系统剪贴板',
          'success'
        );
        return true;
      } catch (error) {
        this.app._showStatusMessage(error?.message || String(error), 'error');
        return false;
      }
    }

    cutSelectedItems() {
      if (this.blockUnavailableDirectory()) return;
      const items = this.app.getSelectedFileItems();
      if (!items.length || this.state.fileOperationBusy) return;
      this.state.fileClipboard = {
        operation: 'move',
        paths: items.map(item => item.path),
        capturedAt: Date.now()
      };
      this.app.updateFileActionBar();
      this.app._showStatusMessage(`已剪切 ${items.length} 项；粘贴后才会移动`, 'success');
    }

    async pasteFileClipboard({ move = false } = {}) {
      if (this.blockUnavailableDirectory()) return;
      const clipboard = this.state.fileClipboard;
      if (!clipboard?.paths?.length || this.state.fileOperationBusy) return;
      if (!this.app.isDirectoryBrowsingContext() || this.app.isGlobalSearchActive() || !this.state.currentPath) {
        this.app._showStatusMessage('请先进入一个受管目录再粘贴', 'error');
        return;
      }
      const shouldMove = move || clipboard.operation === 'move';
      await this.app.openTransferReview(
        clipboard.paths,
        this.state.currentPath,
        shouldMove ? 'move' : 'copy',
        { clearClipboardOnSuccess: shouldMove }
      );
    }

    async duplicateSelectedItems() {
      if (this.blockUnavailableDirectory()) return;
      const items = this.app.getSelectedFileItems();
      if (!items.length || this.state.fileOperationBusy || !this.app.isDirectoryBrowsingContext()) return;
      await this.app.openTransferReview(
        items.map(item => item.path),
        this.state.currentPath,
        'copy',
        { duplicate: true }
      );
    }

    async undoLastFileOperation() {
      if (this.blockUnavailableDirectory()) return;
      const operation = this.latestUndoable();
      if (!operation || this.state.fileOperationBusy) return;
      await this.run(
        () => this.bridge.fileOps.undo(operation.id),
        '已撤销上一步文件操作'
      );
    }

    async redoLastFileOperation() {
      if (this.blockUnavailableDirectory()) return;
      const operation = this.latestRedoable();
      if (!operation || this.state.fileOperationBusy) return;
      await this.run(
        () => this.bridge.fileOps.redo(operation.id),
        '已重做上一步文件操作'
      );
    }

    async run(action, successMessage) {
      if (this.blockUnavailableDirectory()) return false;
      this.app.closeQuickLook();
      this.state.fileOperationBusy = true;
      this.app.updateFileActionBar();
      try {
        await this.app.persistWorkspaceTabs();
        const result = await action();
        await this.app.refreshWorkspaceTabsFromConfig();
        await this.bridge.content.invalidateIndex();
        this.state.selectedPaths.clear();
        this.state.selectionAnchorPath = null;
        await Promise.all([
          this.app.loadPersistedRepos(),
          this.app.loadGroups(),
          this.app.loadFavorites()
        ]);
        await this.loadHistory();
        await this.app.renderSidebarTree();
        if (this.app.isGlobalSearchActive()) await this.app.performGlobalSearch(true);
        else await this.app.renderContent();
        this.app.showFileSelectionDetail([]);
        const message = typeof successMessage === 'function' ? successMessage(result) : successMessage;
        this.app._showStatusMessage(message, 'success');
        this.app.reconcileRepositoryIndex().catch(error => console.warn('文件操作后仓库核对失败:', error));
        return true;
      } catch (error) {
        this.app._showStatusMessage(error?.message || String(error), 'error');
        return false;
      } finally {
        this.state.fileOperationBusy = false;
        this.app.updateFileActionBar();
      }
    }

    getEditActionContext() {
      const target = this.document?.activeElement;
      const editable = this._isEditableTarget(target);
      const selection = this.window?.getSelection?.();
      const overlays = this.document?.querySelectorAll?.('.modal-overlay') || [];
      const blockingModal = [...overlays].some(overlay => {
        const style = this.window?.getComputedStyle?.(overlay);
        return style ? style.display !== 'none' : overlay?.style?.display !== 'none';
      });
      return {
        editable,
        hasTextSelection: Boolean(selection && !selection.isCollapsed && String(selection).length),
        quickLookOpen: this.app.quickLookController?.isOpen() === true,
        blockingModal,
        fileBrowsing: this.app.isFileBrowsingContext()
      };
    }

    handleEditAction(action, { source = 'keyboard' } = {}) {
      const decision = this.editActionRouter.route(action, this.getEditActionContext());
      if (decision.kind === 'native') {
        if (source === 'keyboard') return false;
        this.bridge.app.performNativeEdit(decision.action).catch(error => {
          console.warn('原生编辑操作失败:', error);
        });
        return true;
      }
      if (decision.kind === 'noop') return true;
      if (this.blockUnavailableDirectory()) return true;

      const selectedCount = this.state.selectedPaths.size;
      if ((decision.action === 'copy' || decision.action === 'cut') && selectedCount === 0) {
        this.app._showStatusMessage('请先选择文件或文件夹', 'info');
        return true;
      }
      if (decision.action === 'paste' && !this.state.fileClipboard?.paths?.length) {
        this.app._showStatusMessage('GitFinder 文件剪贴板为空', 'info');
        return true;
      }
      if (decision.action === 'undo' && !this.latestUndoable()) {
        this.app._showStatusMessage('没有可撤销的文件操作', 'info');
        return true;
      }
      if (decision.action === 'redo' && !this.latestRedoable()) {
        this.app._showStatusMessage(
          this.latestRedoUnavailable()?.redoUnavailableReason || '没有可重做的文件操作',
          'info'
        );
        return true;
      }

      if (decision.action === 'undo') this.undoLastFileOperation();
      if (decision.action === 'redo') this.redoLastFileOperation();
      if (decision.action === 'cut') this.cutSelectedItems();
      if (decision.action === 'copy') this.copySelectedItems();
      if (decision.action === 'paste') this.pasteFileClipboard();
      if (decision.action === 'select-all') this.selectAllVisibleFiles();
      return true;
    }

    selectAllVisibleFiles() {
      if (this.blockUnavailableDirectory()) return;
      return this.app.selectAllVisibleFiles();
    }

    _isEditableTarget(target) {
      if (!target) return false;
      const tagName = String(target.tagName || '').toLowerCase();
      return tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || target.isContentEditable === true;
    }
  }

  return { Controller };
});
