(function exposeDirectoryPerformanceController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryPerformanceController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryPerformanceControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.document = options.document || root?.document || null;
      this.performanceApi = options.performanceApi || root?.DirectoryPerformance || null;
      this.virtualWindow = options.virtualWindow || root?.VirtualDirectoryWindow || null;
      this.progressiveRender = options.progressiveRender || root?.ProgressiveDirectoryRender || null;
      this.clock = typeof options.clock === 'function'
        ? options.clock
        : () => root?.performance?.now?.() || 0;
      this.bound = false;
    }

    bind() {
      if (this.bound || !this.document) return;
      this.bound = true;
      this._element('directory-performance-diagnostics')?.addEventListener('click', () => this.open());
      this._element('directory-performance-close-btn')?.addEventListener('click', () => this.close());
      this._element('directory-performance-done-btn')?.addEventListener('click', () => this.close());
      this._element('directory-performance-modal')?.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        this.close();
      });
    }

    sampleFor(context) {
      const sample = this.state?.directoryPerformance;
      if (!sample || !context) return null;
      return sample.requestId === context.requestId && sample.path === context.path ? sample : null;
    }

    begin(context) {
      if (!this.performanceApi || !this.state) return null;
      this.performanceApi.cancel(this.state.directoryPerformance, this.clock());
      this.state.directoryPerformance = this.performanceApi.begin(context, this.clock());
      this.updateMenu();
      return this.state.directoryPerformance;
    }

    markRead(context, sourceItems) {
      const sample = this.sampleFor(context);
      if (!sample) return null;
      this.performanceApi.markRead(sample, sourceItems, this.clock());
      return sample;
    }

    markVisible(context, visibleItems) {
      const sample = this.sampleFor(context);
      if (!sample) return null;
      this.performanceApi.markVisible(sample, visibleItems, this.clock());
      return sample;
    }

    strategyFor(items, style) {
      const source = Array.isArray(items) ? items : [];
      if (style === 'list' && this.virtualWindow?.shouldVirtualize?.(source.length)) return 'virtual-list';
      if (style === 'card' && this.virtualWindow?.canVirtualizeCardItems?.(source)) return 'virtual-card';
      const prefix = this.progressiveRender?.shouldRenderProgressively?.(source.length)
        ? 'progressive'
        : 'direct';
      return `${prefix}-${style}`;
    }

    setStrategy(context, items, style, strategyOverride = '') {
      const sample = this.sampleFor(context);
      if (!sample) return null;
      this.performanceApi.setStrategy(sample, strategyOverride || this.strategyFor(items, style));
      return sample;
    }

    metrics(container) {
      return {
        domItems: container?.querySelectorAll?.('.repo-card, .repo-list-item')?.length || 0,
        itemsPerRow: this.app?.directoryVirtualizer?.itemsPerRow?.() || 1
      };
    }

    contextIsCurrent(context) {
      return typeof this.app?.isDirectoryRenderContextCurrent !== 'function'
        || this.app.isDirectoryRenderContextCurrent(context);
    }

    markFirstDom(context, container) {
      const sample = this.sampleFor(context);
      if (!sample || !this.contextIsCurrent(context)) return null;
      this.performanceApi.markFirstDom(sample, this.metrics(container), this.clock());
      this.updateMenu();
      return sample;
    }

    complete(context, container) {
      const sample = this.sampleFor(context);
      if (!sample || !this.contextIsCurrent(context)) return null;
      this.performanceApi.complete(sample, this.metrics(container), this.clock());
      this.updateMenu();
      return sample;
    }

    cancel() {
      if (!this.performanceApi || !this.state) return null;
      this.performanceApi.cancel(this.state.directoryPerformance, this.clock());
      this.updateMenu();
      return this.state.directoryPerformance;
    }

    updateMenu() {
      const button = this._element('directory-performance-diagnostics');
      if (!button || !this.performanceApi) return;
      const sample = this.performanceApi.snapshot(this.state?.directoryPerformance);
      const available = this.app?.isFileBrowsingContext?.()
        && sample?.path === this.state?.currentPath
        && sample.cancelled !== true;
      button.disabled = !available;
      const summary = button.querySelector?.('small');
      if (summary) {
        summary.textContent = available
          ? `${sample.visibleItems.toLocaleString('zh-CN')} 项 · ${this.performanceApi.strategyLabel(sample.strategy, sample.itemsPerRow)}`
          : '当前目录本次读取';
      }
    }

    open() {
      const sample = this.performanceApi?.snapshot(this.state?.directoryPerformance);
      if (!sample || sample.path !== this.state?.currentPath || sample.cancelled) return false;
      const modal = this._element('directory-performance-modal');
      const path = this._element('directory-performance-path');
      const state = this._element('directory-performance-state');
      const grid = this._element('directory-performance-grid');
      if (!modal || !path || !state || !grid) return false;
      const escapeHtml = value => this.app?.escapeHtml?.(String(value ?? '')) || String(value ?? '');
      path.textContent = sample.path;
      state.textContent = sample.completed ? '本次目录显示已完成' : '本次目录仍在显示中';
      grid.innerHTML = this.performanceApi.diagnosticRows(this.state.directoryPerformance)
        .map(row => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`)
        .join('');
      modal.removeAttribute('inert');
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      this._element('directory-performance-close-btn')?.focus();
      return true;
    }

    close() {
      const modal = this._element('directory-performance-modal');
      if (!modal || modal.style.display === 'none') return false;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('inert', '');
      this._element('sort-menu-trigger')?.focus();
      return true;
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return { Controller };
});
