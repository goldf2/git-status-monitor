(function exposeUnavailableLocationController(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UnavailableLocationController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createUnavailableLocationControllerApi() {
  function inspectionEntry(locationPath, inspection = {}) {
    return (Array.isArray(inspection?.directories) ? inspection.directories : [])
      .find(entry => entry?.path === locationPath) || null;
  }

  function isReconnectable(locationPath, inspection = {}) {
    return inspectionEntry(locationPath, inspection)?.availability === 'root-unavailable';
  }

  function presentUnavailableLocation(state = {}) {
    const escapeHtml = typeof state.escapeHtml === 'function'
      ? state.escapeHtml
      : value => String(value ?? '');
    const attempt = Math.max(0, Math.trunc(Number(state.attempt) || 0));
    return {
      title: '位置暂时不可用',
      description: '外接磁盘可能已断开，或网络位置目前无法访问。重新连接后可在这里继续。',
      path: escapeHtml(state.path || ''),
      retryLabel: attempt > 0 ? '再次重试' : '重试连接',
      boundary: 'GitFinder 会保留此标签页和原路径；不会因为断开而删除、移动或修改文件。'
    };
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.bridge = options.bridge;
      this.document = options.document || globalThis.document;
      this.state = null;
      this.busy = false;
    }

    show(locationPath, options = {}) {
      const previousAttempt = this.state?.path === locationPath ? this.state.attempt : 0;
      this.state = {
        path: locationPath,
        attempt: options.attempt ?? previousAttempt,
        source: options.source || this.state?.source || 'read'
      };
      this.render();
    }

    showFromInspection(locationPath, inspection, options = {}) {
      if (!isReconnectable(locationPath, inspection)) return false;
      this.show(locationPath, options);
      return true;
    }

    clear() {
      this.state = null;
      this.busy = false;
    }

    render() {
      const contentArea = this.document?.getElementById('content-area');
      if (!contentArea || !this.state) return;
      const view = presentUnavailableLocation({
        ...this.state,
        escapeHtml: value => this.app.escapeHtml(value)
      });
      contentArea.innerHTML = `
        <section class="directory-unavailable-state" role="status" aria-live="polite" aria-busy="${this.busy ? 'true' : 'false'}">
          <div class="directory-unavailable-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" focusable="false"><path d="M5.5 13.5h14l4 5h19v21h-37z"/><path d="M5.5 18.5h37"/><path d="M30 28h8M34 24v8"/></svg>
          </div>
          <h2>${view.title}</h2>
          <p>${view.description}</p>
          <code class="directory-unavailable-path">${view.path}</code>
          <div class="directory-unavailable-actions">
            <button class="btn btn-primary" data-app-action="retry-unavailable-location" type="button"${this.busy ? ' disabled' : ''}>${this.busy ? '正在检查…' : view.retryLabel}</button>
            <button class="btn" data-app-action="choose-unavailable-location" type="button"${this.busy ? ' disabled' : ''}>选择其他位置…</button>
          </div>
          <small>${view.boundary}</small>
        </section>`;
    }

    async retry() {
      if (this.busy || !this.state?.path) return false;
      const locationPath = this.state.path;
      this.busy = true;
      this.state.attempt += 1;
      this.render();
      try {
        const inspection = await this.bridge.fs.inspectWorkspaceDirectories([locationPath]);
        const entry = inspectionEntry(locationPath, inspection);
        if (entry?.available) {
          this.clear();
          await this.app.renderSidebarTree();
          await this.app.renderContent();
          this.app._showStatusMessage('位置已重新连接', 'success');
          return true;
        }
        this.busy = false;
        if (entry?.availability === 'root-unavailable') {
          this.render();
          this.app._showStatusMessage('位置仍不可用，请检查磁盘或网络连接', 'warning');
          return false;
        }
        this.clear();
        await this.app.repairUnavailableWorkspaceLocation(locationPath);
        return false;
      } catch (error) {
        console.warn('重新检查位置失败:', error);
        this.busy = false;
        this.render();
        this.app._showStatusMessage('暂时无法检查位置，请稍后重试', 'warning');
        return false;
      }
    }
  }

  return {
    Controller,
    inspectionEntry,
    isReconnectable,
    presentUnavailableLocation
  };
});
