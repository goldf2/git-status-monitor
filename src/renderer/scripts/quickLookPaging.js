(function exposeQuickLookPaging(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuickLookPaging = api;
})(typeof window !== 'undefined' ? window : globalThis, function createQuickLookPagingApi() {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function validPage(page, current) {
    return page?.kind === 'text-page'
      && page.path === current?.path
      && typeof page.content === 'string'
      && Number.isFinite(Number(page.startOffset))
      && Number.isFinite(Number(page.endOffset))
      && Number(page.startOffset) === Number(current.endOffset)
      && Number(page.endOffset) > Number(page.startOffset)
      && Number(page.totalSize) === Number(current.totalSize);
  }

  class Controller {
    constructor() {
      this.generation = 0;
      this.current = null;
      this.base = null;
      this.sequence = 0;
      this.nextPageToken = null;
      this.loading = false;
      this.error = '';
    }

    start(preview) {
      this.generation += 1;
      this.base = preview ? { ...preview } : null;
      this.current = preview ? { ...preview } : null;
      this.sequence = preview?.paged === true ? 1 : 0;
      this.nextPageToken = preview?.paged === true ? (preview.nextPageToken || null) : null;
      this.loading = false;
      this.error = '';
      return this.current;
    }

    close() {
      const unusedToken = this.nextPageToken;
      this.generation += 1;
      this.current = null;
      this.base = null;
      this.sequence = 0;
      this.nextPageToken = null;
      this.loading = false;
      this.error = '';
      return unusedToken;
    }

    currentPreview() {
      return this.current;
    }

    viewState() {
      const active = this.current?.paged === true;
      return {
        active,
        sequence: active ? this.sequence : 0,
        startOffset: active ? Number(this.current.startOffset) || 0 : 0,
        endOffset: active ? Number(this.current.endOffset) || 0 : 0,
        totalSize: active ? Number(this.current.totalSize) || 0 : 0,
        startLine: active ? Number(this.current.startLine) || 1 : 1,
        canLoadNext: active && Boolean(this.nextPageToken) && !this.loading,
        hasNext: active && Boolean(this.nextPageToken),
        loading: this.loading,
        limitReached: active && this.current.limitReached === true,
        error: this.error
      };
    }

    async loadNext(loadPage) {
      if (typeof loadPage !== 'function') throw new TypeError('loadPage 必须是函数');
      if (!this.current?.paged || !this.nextPageToken || this.loading) return { stale: false, preview: this.current };
      const generation = this.generation;
      const token = this.nextPageToken;
      this.nextPageToken = null;
      this.loading = true;
      this.error = '';
      try {
        const page = await loadPage(token);
        if (generation !== this.generation || !this.current) return { stale: true, preview: null };
        if (!validPage(page, this.current)) throw new Error('分页响应与当前预览不一致，请重新打开预览');
        this.sequence += 1;
        this.current = {
          ...this.base,
          kind: page.previewKind || this.base.kind,
          language: page.language || this.base.language,
          content: page.content,
          truncated: page.hasMore === true || page.limitReached === true,
          paged: true,
          startOffset: Number(page.startOffset),
          endOffset: Number(page.endOffset),
          totalSize: Number(page.totalSize),
          startLine: Number(page.startLine) || 1,
          nextPageToken: page.nextPageToken || null,
          limitReached: page.limitReached === true
        };
        this.nextPageToken = this.current.nextPageToken;
        return { stale: false, preview: this.current };
      } catch (error) {
        if (generation === this.generation) this.error = error?.message || String(error);
        throw error;
      } finally {
        if (generation === this.generation) this.loading = false;
      }
    }
  }

  function renderControls(state = {}) {
    if (state.active !== true) return '';
    const start = Math.max(0, Number(state.startOffset) || 0);
    const end = Math.max(start, Number(state.endOffset) || 0);
    const total = Math.max(end, Number(state.totalSize) || 0);
    const range = `${formatBytes(start)}–${formatBytes(end)} / ${formatBytes(total)}`;
    const status = state.error
      ? `<span class="quick-look-paging-error">${escapeHtml(state.error)}</span>`
      : state.limitReached
        ? '<span>已达到本次安全读取上限</span>'
        : !state.hasNext
          ? '<span>已到文件末尾</span>'
          : '<span>按需读取，不会一次载入整个文件</span>';
    return `<div class="quick-look-paging" role="group" aria-label="大型文件分段预览">
      <div class="quick-look-paging-copy">
        <strong>第 ${Math.max(1, Number(state.sequence) || 1)} 段</strong>
        <span>${range} · 从第 ${Math.max(1, Number(state.startLine) || 1)} 行开始</span>
        ${status}
      </div>
      <div class="quick-look-paging-actions">
        ${Number(state.sequence) > 1 || state.error ? `<button class="btn btn-small" data-quick-look-page="restart" type="button">${Number(state.sequence) > 1 ? '回到开头' : '重新打开'}</button>` : ''}
        ${state.hasNext ? `<button class="btn btn-small btn-primary" data-quick-look-page="next" type="button"${state.loading ? ' disabled' : ''}>${state.loading ? '正在读取…' : '加载下一段'}</button>` : ''}
      </div>
    </div>`;
  }

  return { Controller, validPage, renderControls, formatBytes };
});
