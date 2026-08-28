(function exposeFileInfoController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileInfoController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileInfoControllerApi(root) {
  const FILE_KIND_LABELS = Object.freeze({
    md: 'Markdown 文档',
    txt: '纯文本文档',
    json: 'JSON 文件',
    csv: 'CSV 表格',
    js: 'JavaScript 文件',
    jsx: 'JavaScript JSX 文件',
    ts: 'TypeScript 文件',
    tsx: 'TypeScript TSX 文件',
    html: 'HTML 文档',
    css: 'CSS 样式表',
    png: 'PNG 图像',
    jpg: 'JPEG 图像',
    jpeg: 'JPEG 图像',
    gif: 'GIF 图像',
    webp: 'WebP 图像',
    svg: 'SVG 图像',
    pdf: 'PDF 文档',
    zip: 'ZIP 归档'
  });

  function basename(candidatePath) {
    return String(candidatePath || '').split(/[\\/]/).filter(Boolean).at(-1) || String(candidatePath || '');
  }

  function revealLabel(platform) {
    if (platform === 'darwin') return '在 Finder 中显示';
    if (platform === 'win32') return '在文件资源管理器中显示';
    return '在文件管理器中显示';
  }

  function kindLabel(info = {}) {
    if (info.type === 'directory') {
      const labels = [info.isProject ? '项目文件夹' : '文件夹'];
      if (info.isGitRepo) labels.push('Git 仓库');
      return labels.join(' · ');
    }
    if (info.type !== 'file') return '其他项目';
    const extension = String(info.extension || '').toLowerCase();
    return FILE_KIND_LABELS[extension] || (extension ? `${extension.toUpperCase()} 文件` : '文件');
  }

  function permissionLabel(info = {}, platform = '') {
    const permissions = [];
    if (info.readable) permissions.push('读');
    if (info.writable) permissions.push('写');
    if (info.executable) permissions.push('执行');
    const access = permissions.length ? permissions.join('、') : '无可用权限';
    return platform !== 'win32' && info.mode ? `${access} · ${info.mode}` : access;
  }

  function presentFileInfo(info = {}, options = {}) {
    const formatFileSize = options.formatFileSize || (value => `${Math.max(0, Number(value) || 0)} B`);
    const formatDate = options.formatDate || (value => String(value || '未知'));
    const platform = options.platform || '';
    const attributes = [];
    if (info.isProject) attributes.push('本地项目');
    if (info.isGitRepo) attributes.push('Git 仓库');
    if (info.isHidden) attributes.push('隐藏项目');
    if (info.isSymbolicLink) attributes.push('符号链接');
    if (!attributes.length) attributes.push('无附加属性');
    return {
      name: String(info.name || basename(info.path) || '简介'),
      path: String(info.path || ''),
      icon: info.type === 'directory' ? (info.isProject ? '▣' : '📁') : '📄',
      kindLabel: kindLabel(info),
      sizeLabel: info.type === 'directory'
        ? '正在计算文件夹大小…'
        : `${formatFileSize(info.size)} · ${new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(info.size) || 0))} 字节`,
      modifiedLabel: formatDate(info.modifiedTime),
      createdLabel: formatDate(info.createdTime),
      accessedLabel: formatDate(info.accessedTime),
      permissionLabel: permissionLabel(info, platform),
      attributesLabel: attributes.join(' · '),
      revealLabel: revealLabel(platform),
      canOpen: info.type === 'file'
    };
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.lastFocus = null;
      this.item = null;
      this.info = null;
      this.openGeneration = 0;
      this.sizeGeneration = 0;
      this.sizeRequestId = null;
      this._removeSizeProgressListener = null;
      this.bound = false;
    }

    bind() {
      if (this.bound || !this.document) return;
      this.bound = true;
      this._element('file-info-close')?.addEventListener('click', () => this.close());
      this._element('file-info-open')?.addEventListener('click', () => this.openWithDefaultApplication());
      this._element('file-info-reveal')?.addEventListener('click', () => this.revealInSystemManager());
      this._element('file-info-body')?.addEventListener('click', event => {
        const control = event.target?.closest?.('[data-file-info-size-action]');
        if (!control) return;
        const action = control.dataset.fileInfoSizeAction;
        if (action === 'cancel') this.cancelDirectorySize();
        if (action === 'retry' && this.info?.type === 'directory') this.startDirectorySize(this.info.path);
      });
      this._removeSizeProgressListener = this.bridge?.fs?.onDirectorySizeProgress?.(
        payload => this.handleDirectorySizeProgress(payload)
      ) || null;
      this.document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.isOpen()) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          this.close();
        }
      });
    }

    isOpen() {
      const panel = this._element('file-info-panel');
      return Boolean(panel && !panel.hidden);
    }

    async open(item, { preserveFocus = false } = {}) {
      const panel = this._element('file-info-panel');
      const body = this._element('file-info-body');
      if (!panel || !body || !item?.path) return;
      this._cancelDirectorySize({ silent: true, invalidate: true });
      if (!this.isOpen() && !preserveFocus) this.lastFocus = this.document.activeElement;
      this.item = { ...item };
      this.info = null;
      this.app?.closeToolbarMenus?.();
      this.app?.fileOperationHistoryController?.close?.({ restoreFocus: false });
      this.app?.closeQuickLook?.();
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      panel.setAttribute('aria-busy', 'true');
      this._setHeading({
        name: item.name || basename(item.path) || '简介',
        subtitle: item.path,
        icon: item.type === 'directory' ? '📁' : '📄'
      });
      body.innerHTML = '<div class="file-info-state"><span class="loading-spinner" aria-hidden="true"></span><span>正在读取文件简介…</span></div>';
      const openButton = this._element('file-info-open');
      const revealButton = this._element('file-info-reveal');
      if (openButton) openButton.disabled = true;
      if (revealButton) revealButton.disabled = true;
      const generation = ++this.openGeneration;
      this.window?.requestAnimationFrame?.(() => this._element('file-info-close')?.focus());
      try {
        const info = await this.bridge.fs.getFileInfo(item.path);
        if (generation !== this.openGeneration || !this.isOpen()) return;
        if (!info) throw new Error('无法读取该项目的文件信息');
        this.info = info;
        this.render(info);
      } catch (error) {
        if (generation !== this.openGeneration || !this.isOpen()) return;
        this.renderError(error);
      } finally {
        if (generation === this.openGeneration && this.isOpen()) panel.setAttribute('aria-busy', 'false');
      }
    }

    render(info) {
      const view = presentFileInfo(info, {
        platform: this.bridge.platform,
        formatFileSize: value => this.app.formatFileSize(value),
        formatDate: value => value ? this.app.formatItemDate(value) : '未知'
      });
      const escapeHtml = value => this.app.escapeHtml(String(value ?? ''));
      this._setHeading({ name: view.name, subtitle: view.kindLabel, icon: view.icon });
      const body = this._element('file-info-body');
      if (body) {
        const sizeContent = info.type === 'directory'
          ? `<div class="file-info-size-row"><span id="file-info-size-value">${escapeHtml(view.sizeLabel)}</span><button type="button" id="file-info-size-control" class="file-info-inline-action" data-file-info-size-action="cancel">停止</button></div><span class="file-info-size-detail" id="file-info-size-detail" role="status">正在扫描文件夹内容…</span>`
          : escapeHtml(view.sizeLabel);
        body.innerHTML = `
          <section class="file-info-section" aria-labelledby="file-info-general-heading">
            <h3 id="file-info-general-heading">通用</h3>
            <dl class="file-info-grid">
              <dt>类型</dt><dd>${escapeHtml(view.kindLabel)}</dd>
              <dt>大小</dt><dd>${sizeContent}</dd>
              <dt>位置</dt><dd class="file-info-path" title="${escapeHtml(view.path)}">${escapeHtml(view.path)}</dd>
            </dl>
          </section>
          <section class="file-info-section" aria-labelledby="file-info-time-heading">
            <h3 id="file-info-time-heading">日期</h3>
            <dl class="file-info-grid">
              <dt>修改</dt><dd>${escapeHtml(view.modifiedLabel)}</dd>
              <dt>创建</dt><dd>${escapeHtml(view.createdLabel)}</dd>
              <dt>访问</dt><dd>${escapeHtml(view.accessedLabel)}</dd>
            </dl>
          </section>
          <section class="file-info-section" aria-labelledby="file-info-access-heading">
            <h3 id="file-info-access-heading">访问与属性</h3>
            <dl class="file-info-grid">
              <dt>权限</dt><dd>${escapeHtml(view.permissionLabel)}</dd>
              <dt>属性</dt><dd>${escapeHtml(view.attributesLabel)}</dd>
            </dl>
          </section>`;
      }
      const openButton = this._element('file-info-open');
      const revealButton = this._element('file-info-reveal');
      if (openButton) {
        openButton.hidden = !view.canOpen;
        openButton.disabled = !view.canOpen;
      }
      if (revealButton) {
        revealButton.textContent = view.revealLabel;
        revealButton.disabled = false;
      }
      if (info.type === 'directory') this.startDirectorySize(info.path);
    }

    async startDirectorySize(directoryPath) {
      if (!directoryPath || typeof this.bridge?.fs?.calculateDirectorySize !== 'function') {
        this._updateDirectorySize({
          label: '无法计算文件夹大小',
          detail: '当前运行环境不支持文件夹大小扫描',
          controlLabel: '重试',
          controlAction: 'retry'
        });
        return;
      }
      this._cancelDirectorySize({ silent: true, invalidate: true });
      const generation = ++this.sizeGeneration;
      const requestId = this._createDirectorySizeRequestId();
      this.sizeRequestId = requestId;
      this._updateDirectorySize({
        label: '正在计算文件夹大小…',
        detail: '正在扫描文件夹内容…',
        controlLabel: '停止',
        controlAction: 'cancel',
        disabled: false
      });
      try {
        const result = await this.bridge.fs.calculateDirectorySize(directoryPath, requestId);
        if (generation !== this.sizeGeneration || requestId !== this.sizeRequestId || !this.isOpen()) return;
        const detail = this._directorySizeSummary(result);
        const formattedSize = this.app.formatFileSize(result.size);
        if (result.cancelled) {
          this._updateDirectorySize({
            label: `${formattedSize}（已停止）`,
            detail: `${detail} · 扫描未完成`,
            controlLabel: '重新计算',
            controlAction: 'retry'
          });
        } else {
          const bytes = new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(result.size) || 0));
          this._updateDirectorySize({
            label: `${formattedSize} · ${bytes} 字节`,
            detail,
            hideControl: true
          });
        }
      } catch (error) {
        if (generation !== this.sizeGeneration || requestId !== this.sizeRequestId || !this.isOpen()) return;
        this._updateDirectorySize({
          label: '无法计算文件夹大小',
          detail: error?.message || String(error),
          controlLabel: '重试',
          controlAction: 'retry'
        });
      } finally {
        if (generation === this.sizeGeneration && requestId === this.sizeRequestId) this.sizeRequestId = null;
      }
    }

    handleDirectorySizeProgress(payload = {}) {
      if (!this.isOpen() || !this.sizeRequestId || payload.requestId !== this.sizeRequestId) return;
      const scanned = Math.max(0, Number(payload.processedCount) || 0);
      this._updateDirectorySize({
        label: this.app.formatFileSize(payload.size),
        detail: `已扫描 ${new Intl.NumberFormat('zh-CN').format(scanned)} 项 · ${this._directorySizeSummary(payload)}`,
        controlLabel: '停止',
        controlAction: 'cancel',
        disabled: false
      });
    }

    cancelDirectorySize() {
      return this._cancelDirectorySize({ silent: false, invalidate: false });
    }

    _cancelDirectorySize({ silent = true, invalidate = false } = {}) {
      const requestId = this.sizeRequestId;
      if (invalidate) {
        this.sizeGeneration += 1;
        this.sizeRequestId = null;
      }
      if (!requestId || typeof this.bridge?.fs?.cancelDirectorySize !== 'function') return Promise.resolve(false);
      if (!silent) {
        this._updateDirectorySize({
          label: this._element('file-info-size-value')?.textContent || '正在计算文件夹大小…',
          detail: '正在停止扫描…',
          controlLabel: '正在停止',
          controlAction: 'cancel',
          disabled: true
        });
      }
      return this.bridge.fs.cancelDirectorySize(requestId).catch(() => false);
    }

    _createDirectorySizeRequestId() {
      const randomPart = this.window?.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      return `size_${randomPart}`;
    }

    _directorySizeSummary(result = {}) {
      const format = value => new Intl.NumberFormat('zh-CN').format(Math.max(0, Number(value) || 0));
      const parts = [
        `${format(result.fileCount)} 个文件`,
        `${format(result.directoryCount)} 个文件夹`
      ];
      if (result.symlinkCount) parts.push(`${format(result.symlinkCount)} 个符号链接`);
      if (result.skippedCount) parts.push(`${format(result.skippedCount)} 项无法读取`);
      return parts.join(' · ');
    }

    _updateDirectorySize(options = {}) {
      const value = this._element('file-info-size-value');
      const detail = this._element('file-info-size-detail');
      const control = this._element('file-info-size-control');
      if (value && options.label !== undefined) value.textContent = options.label;
      if (detail && options.detail !== undefined) detail.textContent = options.detail;
      if (control) {
        control.hidden = Boolean(options.hideControl);
        control.disabled = Boolean(options.disabled);
        if (options.controlLabel !== undefined) control.textContent = options.controlLabel;
        if (options.controlAction) control.dataset.fileInfoSizeAction = options.controlAction;
      }
    }

    renderError(error) {
      const body = this._element('file-info-body');
      const escapeHtml = value => this.app.escapeHtml(String(value ?? ''));
      if (body) body.innerHTML = `<div class="file-info-state file-info-state-error"><strong>无法显示简介</strong><span>${escapeHtml(error?.message || error)}</span></div>`;
      const openButton = this._element('file-info-open');
      const revealButton = this._element('file-info-reveal');
      if (openButton) openButton.disabled = true;
      if (revealButton) revealButton.disabled = true;
    }

    async openWithDefaultApplication() {
      if (!this.info || this.info.type !== 'file') return;
      try {
        const opened = await this.bridge.fs.openFile(this.info.path);
        this._notify(opened ? '已交给默认应用打开' : '默认应用未能打开此文件', opened ? 'success' : 'error');
      } catch (error) {
        this._notify(error?.message || String(error), 'error');
      }
    }

    async revealInSystemManager() {
      if (!this.info?.path) return;
      try {
        const revealed = await this.bridge.fs.showInFinder(this.info.path);
        this._notify(revealed ? '已在系统文件管理器中定位' : '系统文件管理器未能定位该项目', revealed ? 'success' : 'error');
      } catch (error) {
        this._notify(error?.message || String(error), 'error');
      }
    }

    close({ restoreFocus = true } = {}) {
      const panel = this._element('file-info-panel');
      if (!panel || panel.hidden) return;
      this._cancelDirectorySize({ silent: true, invalidate: true });
      this.openGeneration += 1;
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('aria-busy', 'false');
      this.item = null;
      this.info = null;
      if (restoreFocus && this.lastFocus?.isConnected !== false && typeof this.lastFocus?.focus === 'function') {
        this.lastFocus.focus();
      }
      this.lastFocus = null;
    }

    destroy() {
      this._cancelDirectorySize({ silent: true, invalidate: true });
      this._removeSizeProgressListener?.();
      this._removeSizeProgressListener = null;
    }

    _setHeading({ name, subtitle, icon }) {
      const title = this._element('file-info-title');
      const subtitleElement = this._element('file-info-subtitle');
      const iconElement = this._element('file-info-icon');
      if (title) title.textContent = name;
      if (subtitleElement) subtitleElement.textContent = subtitle;
      if (iconElement) iconElement.textContent = icon;
    }

    _notify(message, tone) {
      this.app?._showStatusMessage?.(message, tone);
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return {
    Controller,
    basename,
    kindLabel,
    permissionLabel,
    presentFileInfo,
    revealLabel
  };
});
