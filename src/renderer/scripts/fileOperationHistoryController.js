(function exposeFileOperationHistoryController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileOperationHistoryController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileOperationHistoryControllerApi(root) {
  const TYPE_LABELS = Object.freeze({
    copy: '复制',
    move: '移动',
    import: '导入',
    rename: '重命名',
    trash: '移到废纸篓',
    'create-directory': '新建文件夹',
    'create-file': '新建文件'
  });

  function pathName(pathValue) {
    const parts = String(pathValue || '').split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || String(pathValue || '') || '未知项目';
  }

  function relativeTime(timestamp, now = Date.now()) {
    const value = Number(timestamp);
    const date = new Date(value);
    if (!Number.isFinite(value) || value <= 0 || Number.isNaN(date.getTime())) return '时间未知';
    const current = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const seconds = Math.max(0, Math.floor((current - value) / 1000));
    if (seconds < 10) return '刚刚';
    if (seconds < 60) return `${seconds} 秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function statusPresentation(operation, platform = '') {
    if (operation?.incomplete) {
      return { statusLabel: '部分完成 · 需要检查', tone: 'danger' };
    }
    if (operation?.undoneAt) {
      if (operation.redoInvalidatedAt) {
        return { statusLabel: '已撤销 · 重做已失效', tone: 'muted' };
      }
      if (operation.redoable === false) {
        return { statusLabel: '已撤销 · 不支持安全重做', tone: 'warning' };
      }
      return { statusLabel: '已撤销', tone: 'undone' };
    }
    if (operation?.recoveredAt) {
      return { statusLabel: '中断后已安全恢复', tone: 'recovered' };
    }
    if (operation?.undoable === false) {
      if (operation.systemTrash && platform === 'win32') {
        return { statusLabel: '已完成 · 请在回收站恢复', tone: 'warning' };
      }
      return { statusLabel: '已完成 · 不可撤销', tone: 'muted' };
    }
    return { statusLabel: '已完成', tone: 'complete' };
  }

  function presentOperation(operation = {}, options = {}) {
    const items = Array.isArray(operation.items) ? operation.items : [];
    const first = items[0] || {};
    const sourceName = pathName(first.source);
    const targetName = pathName(first.target);
    let title = TYPE_LABELS[operation.type] || '文件操作';
    if (operation.type === 'rename' && operation.batch) title = '批量重命名';
    if (operation.type === 'trash' && options.platform === 'win32') title = '移到回收站';

    let primaryName = '没有写入内容';
    if (operation.type === 'trash') primaryName = sourceName;
    else if (operation.type === 'create-file' || operation.type === 'create-directory') primaryName = targetName;
    else if (items.length) primaryName = sourceName === targetName ? sourceName : `${sourceName} → ${targetName}`;

    const notices = [];
    if (Number(operation.conflictCount) > 0) notices.push(`${operation.conflictCount} 个同名冲突`);
    if (Number(operation.skippedCount) > 0) notices.push(`${operation.skippedCount} 项已跳过`);
    if (Number(operation.replaceCount) > 0) notices.push(`${operation.replaceCount} 项已替换`);
    if (operation.redoUnavailableReason) notices.push(String(operation.redoUnavailableReason));

    const createdDate = new Date(Number(operation.createdAt));
    return {
      id: String(operation.id || ''),
      title,
      countLabel: `${items.length} 项`,
      timeLabel: relativeTime(operation.createdAt, options.now),
      createdAt: Number(operation.createdAt) > 0 && !Number.isNaN(createdDate.getTime()) ? createdDate.toISOString() : '',
      primaryName,
      remainingLabel: items.length > 1 ? `另有 ${items.length - 1} 项` : '',
      pathLabel: String(first.target || first.source || ''),
      noticeLabel: notices.join(' · '),
      ...statusPresentation(operation, options.platform)
    };
  }

  function operationLocation(operation = {}) {
    const first = Array.isArray(operation.items) ? operation.items[0] : null;
    if (!first) return '';
    if (operation.undoneAt) return String(first.source || first.target || '');
    if (operation.type === 'trash') return String(first.source || '');
    return String(first.target || first.source || '');
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.lastFocus = null;
      this.openGeneration = 0;
    }

    bind() {
      this.document?.getElementById('file-history')?.addEventListener('click', () => this.open());
      this.document?.getElementById('file-operation-history-close')?.addEventListener('click', () => this.close());
      this.document?.getElementById('file-operation-history-refresh')?.addEventListener('click', () => this.refresh());
      this.document?.getElementById('file-operation-history-list')?.addEventListener('click', event => this.handleListAction(event));
      this.document?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.isOpen()) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          this.close();
        }
      });
    }

    isOpen() {
      const panel = this.document?.getElementById('file-operation-history-panel');
      return Boolean(panel && !panel.hidden);
    }

    async open() {
      const panel = this.document?.getElementById('file-operation-history-panel');
      if (!panel) return;
      if (this.isOpen()) {
        await this.refresh();
        this.document.getElementById('file-operation-history-close')?.focus();
        return;
      }
      this.lastFocus = this.document.activeElement;
      this.app.closeToolbarMenus?.();
      this.app.fileInfoController?.close?.({ restoreFocus: false });
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      panel.setAttribute('aria-busy', 'true');
      const list = this.document.getElementById('file-operation-history-list');
      const summary = this.document.getElementById('file-operation-history-summary');
      if (list) list.innerHTML = '<div class="file-operation-history-empty">正在读取本机操作记录…</div>';
      if (summary) summary.textContent = '只记录 GitFinder 执行的文件操作';
      const generation = ++this.openGeneration;
      this.window.requestAnimationFrame?.(() => this.document.getElementById('file-operation-history-close')?.focus());
      await this.app.loadFileOperationHistory();
      if (generation !== this.openGeneration || !this.isOpen()) return;
      panel.setAttribute('aria-busy', 'false');
      this.render();
    }

    close({ restoreFocus = true } = {}) {
      const panel = this.document?.getElementById('file-operation-history-panel');
      if (!panel || panel.hidden) return;
      this.openGeneration += 1;
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('aria-busy', 'false');
      if (restoreFocus && this.lastFocus?.isConnected !== false && typeof this.lastFocus?.focus === 'function') this.lastFocus.focus();
      this.lastFocus = null;
    }

    async refresh() {
      if (!this.isOpen()) return;
      const panel = this.document.getElementById('file-operation-history-panel');
      panel?.setAttribute('aria-busy', 'true');
      await this.app.loadFileOperationHistory();
      panel?.setAttribute('aria-busy', 'false');
      if (this.isOpen()) this.render();
    }

    render() {
      if (!this.isOpen()) return;
      const list = this.document.getElementById('file-operation-history-list');
      const summary = this.document.getElementById('file-operation-history-summary');
      if (!list || !summary) return;
      const history = Array.isArray(this.state.fileOperationHistory) ? this.state.fileOperationHistory : [];
      const undoable = this.app.fileOperationController?.latestUndoable?.()
        || history.find(operation => operation.undoable && !operation.undoneAt);
      const redoable = this.app.fileOperationController?.latestRedoable?.()
        || [...history]
          .filter(operation => operation.undoable && operation.undoneAt && operation.redoable && !operation.redoInvalidatedAt)
          .sort((left, right) => Number(right.undoneAt) - Number(left.undoneAt))[0];
      const undoneCount = history.filter(operation => operation.undoneAt).length;
      const reviewCount = Number(this.state.fileRecoveryStatus?.needsReview?.length) || 0;
      summary.textContent = history.length
        ? `${history.length} 条最近记录 · ${undoneCount} 条已撤销${reviewCount ? ` · ${reviewCount} 项需要检查` : ''}`
        : '尚无文件操作记录';

      if (!history.length) {
        list.innerHTML = '<div class="file-operation-history-empty"><strong>尚无文件操作</strong><span>新建、复制、移动、重命名和移入废纸篓后会显示在这里。</span></div>';
        return;
      }

      const escapeHtml = value => this.app.escapeHtml(String(value ?? ''));
      const busy = this.state.fileOperationBusy === true;
      list.innerHTML = history.slice(0, 100).map(operation => {
        const view = presentOperation(operation, { platform: this.bridge.platform });
        const canUndo = !busy && operation.id === undoable?.id;
        const canRedo = !busy && operation.id === redoable?.id;
        const location = operationLocation(operation);
        const timestamp = view.createdAt
          ? `<time datetime="${escapeHtml(view.createdAt)}">${escapeHtml(view.timeLabel)}</time>`
          : `<span>${escapeHtml(view.timeLabel)}</span>`;
        return `
          <article class="file-operation-history-item" data-tone="${escapeHtml(view.tone)}" data-operation-id="${escapeHtml(view.id)}">
            <div class="file-operation-history-item-header">
              <div><strong>${escapeHtml(view.title)}</strong><span>${escapeHtml(view.countLabel)}</span></div>
              ${timestamp}
            </div>
            <div class="file-operation-history-name" title="${escapeHtml(view.pathLabel)}">${escapeHtml(view.primaryName)}</div>
            ${view.remainingLabel ? `<div class="file-operation-history-secondary">${escapeHtml(view.remainingLabel)}</div>` : ''}
            ${view.noticeLabel ? `<div class="file-operation-history-notice">${escapeHtml(view.noticeLabel)}</div>` : ''}
            <div class="file-operation-history-item-footer">
              <span class="file-operation-history-status">${escapeHtml(view.statusLabel)}</span>
              <div class="file-operation-history-actions">
                ${location ? '<button type="button" data-history-action="locate">定位</button>' : ''}
                ${canUndo ? '<button type="button" data-history-action="undo">撤销</button>' : ''}
                ${canRedo ? '<button type="button" data-history-action="redo">重做</button>' : ''}
              </div>
            </div>
          </article>`;
      }).join('');
    }

    async handleListAction(event) {
      const button = event.target.closest?.('[data-history-action]');
      const item = button?.closest?.('[data-operation-id]');
      if (!button || !item || this.state.fileOperationBusy) return;
      const operation = (this.state.fileOperationHistory || []).find(candidate => candidate.id === item.dataset.operationId);
      if (!operation) return;
      const action = button.dataset.historyAction;
      if (action === 'locate') {
        const location = operationLocation(operation);
        if (!location) return;
        this.close();
        await this.app.revealFileOperationHistoryLocation(location);
        return;
      }
      if (action === 'undo') {
        await this.app.runFileOperation(
          () => this.bridge.fileOps.undo(operation.id),
          '已撤销所选文件操作'
        );
      }
      if (action === 'redo') {
        await this.app.runFileOperation(
          () => this.bridge.fileOps.redo(operation.id),
          '已重做所选文件操作'
        );
      }
      this.render();
    }
  }

  return {
    Controller,
    operationLocation,
    pathName,
    presentOperation,
    relativeTime
  };
});
