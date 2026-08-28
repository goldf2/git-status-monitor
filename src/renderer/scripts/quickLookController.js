(function exposeQuickLookController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuickLookController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createQuickLookControllerApi(root) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  class Controller {
    constructor(options = {}) {
      this.document = options.document || root?.document || null;
      this.contentApi = options.contentApi || root?.gitFinder?.content || null;
      this.fileApi = options.fileApi || root?.gitFinder?.fs || null;
      this.pagingModule = options.pagingModule || root?.QuickLookPaging || null;
      this.developerModule = options.developerModule || root?.QuickLook || null;
      this.renderMarkdown = options.renderMarkdown || (content => `<pre><code>${escapeHtml(content)}</code></pre>`);
      this.escapeHtml = options.escapeHtml || escapeHtml;
      this.formatFileSize = options.formatFileSize || (value => `${Math.max(0, Number(value) || 0)} B`);
      this.formatItemDate = options.formatItemDate || (() => '');
      this.getItemByPath = options.getItemByPath || (() => null);
      this.activateDirectory = options.activateDirectory || (() => {});
      this.pagingController = options.pagingController || new this.pagingModule.Controller();
      this.active = false;
      this.path = null;
      this.item = null;
      this.requestGeneration = 0;
      this.bound = false;
    }

    bind() {
      if (this.bound || !this.document) return;
      this.bound = true;
      this._element('quick-look-close-btn')?.addEventListener('click', () => this.close());
      this._element('quick-look-open-btn')?.addEventListener('click', () => this.openCurrentItem());
      this._element('quick-look-body')?.addEventListener('click', event => {
        const actionTarget = event.target?.closest?.('[data-quick-look-action]');
        const action = actionTarget?.dataset?.quickLookAction
          || actionTarget?.getAttribute?.('data-quick-look-action');
        if (action === 'convert-binary-plist') this.convertBinaryPlist();
      });
      this._element('quick-look-overlay')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) this.close();
      });
    }

    isOpen() {
      return this.active;
    }

    currentPath() {
      return this.path;
    }

    toggle(items = []) {
      if (this.active) {
        this.close();
        return;
      }
      if (Array.isArray(items) && items.length === 1) this.open(items[0]);
    }

    async open(item) {
      const elements = this._elements();
      if (!elements.overlay || !elements.body || !item?.path) return;

      this._releasePagingToken();
      const requestGeneration = ++this.requestGeneration;
      this.active = true;
      this.path = item.path;
      this.item = { ...item };
      elements.overlay.style.display = 'flex';
      if (elements.title) elements.title.textContent = item.name || this._basename(item.path) || item.path;
      if (elements.meta) elements.meta.textContent = item.path;
      if (elements.icon) elements.icon.textContent = item.type === 'directory' ? '📁' : '📄';
      this._showLoading('正在生成安全预览…');

      try {
        const preview = await this.contentApi.getPreview(item.path, { enablePaging: true });
        if (!this._isCurrent(requestGeneration, item.path)) {
          this._releaseToken(preview?.nextPageToken);
          return;
        }
        this.pagingController.start(preview);
        this.render(this.pagingController.currentPreview());
      } catch (error) {
        if (!this._isCurrent(requestGeneration, item.path)) return;
        this._showError(error);
      }
    }

    render(preview) {
      const elements = this._elements();
      if (!elements.body || !preview) return;
      const detail = [
        preview.kind !== 'directory' ? this.formatFileSize(preview.size) : '',
        this.formatItemDate(preview.modifiedTime),
        preview.path
      ].filter(Boolean).join(' · ');
      if (elements.title) elements.title.textContent = preview.name || '预览';
      if (elements.meta) elements.meta.textContent = detail;
      if (elements.openButton) {
        elements.openButton.textContent = preview.kind === 'directory' ? '在 GitFinder 中打开' : '使用默认应用打开';
      }

      if (preview.kind === 'image' && /^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(preview.dataUrl || '')) {
        if (elements.icon) elements.icon.textContent = '🖼️';
        elements.body.innerHTML = `<div class="quick-look-image-wrap"><img class="quick-look-image" alt="${this.escapeHtml(preview.name)}" src="${preview.dataUrl}"></div>`;
        return;
      }
      if (preview.kind === 'markdown') {
        if (elements.icon) elements.icon.textContent = '📝';
        elements.body.innerHTML = `<article class="quick-look-markdown markdown-preview">${this.renderMarkdown(preview.content || '')}</article>${this._truncatedNotice(preview)}`;
        this._refreshPagingControls();
        return;
      }
      if (preview.kind === 'code' || preview.kind === 'text') {
        const developerPreview = this.developerModule?.renderDeveloperPreview(preview);
        if (developerPreview) {
          if (elements.icon) elements.icon.textContent = developerPreview.icon;
          elements.body.innerHTML = developerPreview.html;
          this._refreshPagingControls();
          return;
        }
        if (elements.icon) elements.icon.textContent = preview.kind === 'code' ? '⌘' : '📄';
        elements.body.innerHTML = `<div class="quick-look-text"><pre><code>${this.escapeHtml(preview.content || '')}</code></pre></div>${this._truncatedNotice(preview)}`;
        this._refreshPagingControls();
        return;
      }
      if (preview.kind === 'directory') {
        if (elements.icon) elements.icon.textContent = preview.isGitRepo ? '📦' : '📁';
        const samples = (preview.samples || []).map(sample => `<div class="quick-look-sample" title="${this.escapeHtml(sample.name)}">${sample.type === 'directory' ? '📁' : '📄'} ${this.escapeHtml(sample.name)}</div>`).join('');
        elements.body.innerHTML = `
          <div class="quick-look-directory">
            ${preview.isGitRepo ? '<div class="quick-look-repository-badge">Git 仓库</div>' : ''}
            <div class="quick-look-stat-grid">
              <div class="quick-look-stat"><strong>${Number(preview.directoryCount || 0)}</strong><span>文件夹</span></div>
              <div class="quick-look-stat"><strong>${Number(preview.fileCount || 0)}</strong><span>文件</span></div>
              <div class="quick-look-stat"><strong>${Number(preview.symlinkCount || 0)}</strong><span>符号链接</span></div>
            </div>
            <div class="quick-look-samples">${samples || '<div class="quick-look-empty">此目录没有可显示的普通项目</div>'}</div>
          </div>`;
        return;
      }
      if (preview.kind === 'archive' && preview.format === 'zip') {
        if (elements.icon) elements.icon.textContent = '🗜️';
        const entryRows = (Array.isArray(preview.entries) ? preview.entries : []).map(entry => `
          <div class="quick-look-archive-entry">
            <span class="quick-look-archive-entry-name" title="${this.escapeHtml(entry.name)}">${entry.isDirectory ? '📁' : '📄'} ${this.escapeHtml(entry.name)}</span>
            <span>${entry.encrypted ? '<b class="quick-look-archive-encrypted">加密</b>' : this.escapeHtml(entry.method || '')}</span>
            <span>${entry.isDirectory ? '—' : this.formatFileSize(entry.uncompressedSize)}</span>
          </div>`).join('');
        const encryptedNotice = Number(preview.encryptedCount || 0) > 0
          ? `<div class="quick-look-archive-notice">🔒 ${Number(preview.encryptedCount)} 个加密条目；这里只读列出目录，不尝试解密或读取正文。</div>`
          : '<div class="quick-look-archive-notice">这里只读列出目录，不解压、不执行，也不读取条目正文。</div>';
        elements.body.innerHTML = `
          <div class="quick-look-archive">
            <div class="quick-look-archive-summary">
              <strong>${Number(preview.totalEntries || 0)} 个条目</strong>
              <span>${Number(preview.directoryCount || 0)} 个文件夹 · ${Number(preview.fileCount || 0)} 个文件</span>
              <span>${this.formatFileSize(preview.totalCompressedSize)} 压缩后 · ${this.formatFileSize(preview.totalUncompressedSize)} 原始大小</span>
            </div>
            ${encryptedNotice}
            <div class="quick-look-archive-list" role="table" aria-label="ZIP 内容">
              <div class="quick-look-archive-entry quick-look-archive-heading" role="row"><span>路径</span><span>方式</span><span>大小</span></div>
              ${entryRows || '<div class="quick-look-empty">此 ZIP 没有条目</div>'}
            </div>
            ${preview.truncated ? `<div class="quick-look-boundary-note">仅显示前 ${Number(preview.entries?.length || 0)} 个条目；总数为 ${Number(preview.totalEntries || 0)}。</div>` : ''}
          </div>`;
        return;
      }
      if (elements.icon) elements.icon.textContent = '🚫';
      const canConvertBinaryPlist = preview.format === 'binary-plist' && preview.canConvertBinaryPlist === true;
      elements.body.innerHTML = `
        <div class="quick-look-empty">
          <div class="quick-look-empty-symbol" aria-hidden="true">🚫</div>
          <div class="quick-look-empty-copy">${this.escapeHtml(preview.reason || '暂不支持预览此文件')}</div>
          ${canConvertBinaryPlist ? `
            <div class="quick-look-empty-actions">
              <button class="btn btn-small quick-look-primary-action" data-quick-look-action="convert-binary-plist" type="button">转换后预览</button>
            </div>
            <div class="quick-look-boundary-note">只读调用 macOS 系统 plutil，结果仅保存在内存中，不修改原文件。</div>` : ''}
        </div>`;
    }

    async convertBinaryPlist() {
      const elements = this._elements();
      if (!this.active || !this.path || !elements.body || typeof this.contentApi?.convertBinaryPlist !== 'function') return;
      const previewPath = this.path;
      this._releasePagingToken();
      const requestGeneration = ++this.requestGeneration;
      this._showLoading('正在使用系统 plutil 生成只读 XML 预览…');
      try {
        const preview = await this.contentApi.convertBinaryPlist(previewPath);
        if (!this._isCurrent(requestGeneration, previewPath)) {
          this._releaseToken(preview?.nextPageToken);
          return;
        }
        this.pagingController.start(preview);
        this.render(this.pagingController.currentPreview());
      } catch (error) {
        if (this._isCurrent(requestGeneration, previewPath)) this._showConversionError(error);
      }
    }

    async loadNextPage() {
      if (!this.active || !this.path) return;
      const previewPath = this.path;
      const requestGeneration = this.requestGeneration;
      let returnedPage = null;
      const pending = this.pagingController.loadNext(async token => {
        returnedPage = await this.contentApi.getTextPage(token);
        return returnedPage;
      });
      this._refreshPagingControls();
      try {
        const result = await pending;
        if (result.stale || !this._isCurrent(requestGeneration, previewPath)) {
          this._releaseToken(returnedPage?.nextPageToken);
          return;
        }
        this.render(result.preview);
      } catch (_) {
        if (this._isCurrent(requestGeneration, previewPath)) this.render(this.pagingController.currentPreview());
      }
    }

    async restart() {
      const elements = this._elements();
      if (!this.active || !this.path || !elements.body) return;
      const previewPath = this.path;
      this._releasePagingToken();
      const requestGeneration = ++this.requestGeneration;
      this._showLoading('正在重新读取文件开头…');
      try {
        const preview = await this.contentApi.getPreview(previewPath, { enablePaging: true });
        if (!this._isCurrent(requestGeneration, previewPath)) {
          this._releaseToken(preview?.nextPageToken);
          return;
        }
        this.pagingController.start(preview);
        this.render(this.pagingController.currentPreview());
      } catch (error) {
        if (this._isCurrent(requestGeneration, previewPath)) this._showError(error);
      }
    }

    close() {
      this.active = false;
      this.path = null;
      this.item = null;
      this.requestGeneration += 1;
      this._releasePagingToken();
      const overlay = this._element('quick-look-overlay');
      if (overlay) overlay.style.display = 'none';
    }

    openCurrentItem() {
      if (!this.path) return;
      const item = this.getItemByPath(this.path) || this.item;
      if (item?.type === 'directory') {
        this.close();
        this.activateDirectory(item);
        return;
      }
      this.fileApi?.openFile?.(this.path);
    }

    _refreshPagingControls() {
      const body = this._element('quick-look-body');
      if (!body) return;
      body.querySelector?.('.quick-look-paging')?.remove();
      const html = this.pagingModule.renderControls(this.pagingController.viewState());
      if (!html) return;
      body.insertAdjacentHTML?.('beforeend', html);
      body.querySelector?.('[data-quick-look-page="next"]')?.addEventListener('click', () => this.loadNextPage());
      body.querySelector?.('[data-quick-look-page="restart"]')?.addEventListener('click', () => this.restart());
    }

    _releasePagingToken() {
      this._releaseToken(this.pagingController.close());
    }

    _releaseToken(token) {
      if (!token) return;
      try {
        Promise.resolve(this.contentApi?.releaseTextPage?.(token)).catch(() => {});
      } catch (_) {
        // 关闭预览不应被令牌清理失败阻断；主进程仍会在 TTL 后自动失效。
      }
    }

    _isCurrent(requestGeneration, previewPath) {
      return this.active && this.path === previewPath && this.requestGeneration === requestGeneration;
    }

    _showLoading(message) {
      const body = this._element('quick-look-body');
      if (body) body.innerHTML = `<div class="quick-look-loading"><div class="loading-spinner"></div><div>${this.escapeHtml(message)}</div></div>`;
    }

    _showError(error) {
      const body = this._element('quick-look-body');
      if (body) body.innerHTML = `<div class="quick-look-empty"><div style="font-size:34px;opacity:.5;">⚠</div><div>${this.escapeHtml(error?.message || String(error))}</div></div>`;
    }

    _showConversionError(error) {
      const body = this._element('quick-look-body');
      if (!body) return;
      body.innerHTML = `
        <div class="quick-look-empty">
          <div class="quick-look-empty-symbol" aria-hidden="true">⚠</div>
          <div class="quick-look-empty-copy">${this.escapeHtml(error?.message || String(error))}</div>
          <div class="quick-look-empty-actions">
            <button class="btn btn-small quick-look-primary-action" data-quick-look-action="convert-binary-plist" type="button">重新转换</button>
          </div>
          <div class="quick-look-boundary-note">也可以使用窗口右上角的“使用默认应用打开”。</div>
        </div>`;
    }

    _truncatedNotice(preview) {
      return preview.truncated && preview.paged !== true
        ? '<div class="quick-look-truncated">文件较大，仅预览前 1 MB</div>'
        : '';
    }

    _basename(candidatePath) {
      return String(candidatePath || '').split(/[\\/]/).filter(Boolean).pop() || '';
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }

    _elements() {
      return {
        overlay: this._element('quick-look-overlay'),
        title: this._element('quick-look-title'),
        meta: this._element('quick-look-meta'),
        icon: this._element('quick-look-icon'),
        body: this._element('quick-look-body'),
        openButton: this._element('quick-look-open-btn')
      };
    }
  }

  return { Controller, escapeHtml };
});
