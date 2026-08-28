(function exposeVirtualDirectoryWindow(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VirtualDirectoryWindow = api;
})(typeof window !== 'undefined' ? window : globalThis, function createVirtualDirectoryWindowApi(root) {
  const DEFAULT_THRESHOLD = 1000;
  const DEFAULT_ROW_HEIGHT = 40;
  const DEFAULT_OVERSCAN = 10;
  const DEFAULT_CARD_MIN_WIDTH = 280;
  const DEFAULT_CARD_HEIGHT = 120;
  const DEFAULT_GRID_GAP = 12;
  const DEFAULT_CARD_ROW_HEIGHT = DEFAULT_CARD_HEIGHT + DEFAULT_GRID_GAP;

  function normalizeInteger(value, fallback, minimum = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return Math.max(minimum, Math.trunc(Number(fallback) || 0));
    return Math.max(minimum, Math.trunc(number));
  }

  function normalizeOptions(options = {}) {
    return {
      threshold: normalizeInteger(options.threshold, DEFAULT_THRESHOLD, 1),
      rowHeight: normalizeInteger(options.rowHeight, DEFAULT_ROW_HEIGHT, 1),
      overscan: normalizeInteger(options.overscan, DEFAULT_OVERSCAN, 0),
      itemsPerRow: normalizeInteger(options.itemsPerRow, 1, 1)
    };
  }

  function shouldVirtualize(total, options = {}) {
    return normalizeInteger(total, 0) > normalizeOptions(options).threshold;
  }

  function canVirtualizeCardItems(items, options = {}) {
    if (!Array.isArray(items) || !shouldVirtualize(items.length, options)) return false;
    return items.every(item => (
      item
      && ['file', 'directory'].includes(item.type)
      && item.isGitRepo !== true
      && item.isProject !== true
      && !item.localProject
      && !item.project
      && !(Array.isArray(item.tags) && item.tags.length)
      && !(Array.isArray(item.groups) && item.groups.length)
      && !item.readme?.description
      && !item.gitStatus?.lastCommit
    ));
  }

  function gridColumnCount(containerWidth, options = {}) {
    const width = Math.max(0, Number(containerWidth) || 0);
    const minimumItemWidth = Math.max(1, Number(options.minimumItemWidth) || DEFAULT_CARD_MIN_WIDTH);
    const gap = Math.max(0, Number(options.gap) || DEFAULT_GRID_GAP);
    return Math.max(1, Math.floor((width + gap) / (minimumItemWidth + gap)));
  }

  function calculateWindow(total, scrollTop, viewportHeight, options = {}) {
    const count = normalizeInteger(total, 0);
    const height = Math.max(1, Number(viewportHeight) || 0);
    const top = Math.max(0, Number(scrollTop) || 0);
    const { rowHeight, overscan, itemsPerRow } = normalizeOptions(options);
    const rowCount = Math.ceil(count / itemsPerRow);
    const firstVisible = Math.min(rowCount, Math.floor(top / rowHeight));
    const lastVisible = Math.min(rowCount, Math.ceil((top + height) / rowHeight));
    const startRow = Math.max(0, firstVisible - overscan);
    const endRow = Math.min(rowCount, lastVisible + overscan);
    const start = Math.min(count, startRow * itemsPerRow);
    const end = Math.min(count, endRow * itemsPerRow);
    return {
      start,
      end,
      offset: startRow * rowHeight,
      rendered: Math.max(0, end - start),
      totalHeight: rowCount * rowHeight
    };
  }

  function scrollTopForIndex(index, currentScrollTop, viewportHeight, total, options = {}) {
    const count = normalizeInteger(total, 0);
    if (!count) return 0;
    const { rowHeight, itemsPerRow } = normalizeOptions(options);
    const safeIndex = Math.min(count - 1, normalizeInteger(index, 0));
    const height = Math.max(rowHeight, Number(viewportHeight) || rowHeight);
    const rowCount = Math.ceil(count / itemsPerRow);
    const maxScrollTop = Math.max(0, rowCount * rowHeight - height);
    const current = Math.min(maxScrollTop, Math.max(0, Number(currentScrollTop) || 0));
    const itemTop = Math.floor(safeIndex / itemsPerRow) * rowHeight;
    const itemBottom = itemTop + rowHeight;
    if (itemTop < current) return itemTop;
    if (itemBottom > current + height) return Math.min(maxScrollTop, itemBottom - height);
    return current;
  }

  function defaultSchedule(callback) {
    if (typeof root?.requestAnimationFrame === 'function') return root.requestAnimationFrame(callback);
    return setTimeout(callback, 0);
  }

  function defaultCancelSchedule(handle) {
    if (handle === null || handle === undefined) return;
    if (typeof root?.cancelAnimationFrame === 'function') root.cancelAnimationFrame(handle);
    else clearTimeout(handle);
  }

  class Controller {
    constructor(options = {}) {
      this.total = normalizeInteger(options.total, 0);
      this.scrollElement = options.scrollElement || null;
      this.viewportElement = options.viewportElement || null;
      this.windowElement = options.windowElement || null;
      this.renderRange = typeof options.renderRange === 'function' ? options.renderRange : (() => {});
      this.options = normalizeOptions(options);
      this.itemsPerRowProvider = typeof options.itemsPerRowProvider === 'function'
        ? options.itemsPerRowProvider
        : null;
      this.schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule;
      this.cancelSchedule = typeof options.cancelSchedule === 'function'
        ? options.cancelSchedule
        : defaultCancelSchedule;
      this.currentRange = null;
      this.scheduled = null;
      this.mounted = false;
      this._handleScroll = () => this.requestRefresh();
      this._handleResize = () => this.requestRefresh(true);
    }

    mount() {
      if (this.mounted || !this.scrollElement || !this.viewportElement || !this.windowElement) return false;
      this.mounted = true;
      this._syncItemsPerRow(false);
      this._updateViewportHeight();
      this.scrollElement.addEventListener('scroll', this._handleScroll, { passive: true });
      root?.addEventListener?.('resize', this._handleResize);
      this.refresh(true);
      return true;
    }

    requestRefresh(force = false) {
      if (!this.mounted) return;
      if (force) this.currentRange = null;
      if (this.scheduled !== null) return;
      let completedSynchronously = false;
      const handle = this.schedule(() => {
        completedSynchronously = true;
        this.scheduled = null;
        this.refresh();
      });
      if (!completedSynchronously) this.scheduled = handle;
    }

    refresh(force = false) {
      if (!this.mounted) return null;
      if (this._syncItemsPerRow(true)) force = true;
      const viewportTop = this._viewportOffset();
      const relativeScrollTop = Math.max(0, (Number(this.scrollElement.scrollTop) || 0) - viewportTop);
      const range = calculateWindow(
        this.total,
        relativeScrollTop,
        this.scrollElement.clientHeight,
        this.options
      );
      const unchanged = !force
        && this.currentRange?.start === range.start
        && this.currentRange?.end === range.end;
      if (unchanged) return this.currentRange;
      this.currentRange = range;
      this.windowElement.style.transform = `translateY(${range.offset}px)`;
      this.renderRange(range);
      return range;
    }

    ensureIndex(index) {
      if (!this.mounted || !this.total) return null;
      const viewportTop = this._viewportOffset();
      const relativeScrollTop = Math.max(0, (Number(this.scrollElement.scrollTop) || 0) - viewportTop);
      const nextRelativeScrollTop = scrollTopForIndex(
        index,
        relativeScrollTop,
        this.scrollElement.clientHeight,
        this.total,
        this.options
      );
      if (nextRelativeScrollTop !== relativeScrollTop) {
        this.scrollElement.scrollTop = viewportTop + nextRelativeScrollTop;
      }
      return this.refresh(true);
    }

    containsIndex(index) {
      const safeIndex = normalizeInteger(index, -1, -1);
      return Boolean(this.currentRange)
        && safeIndex >= this.currentRange.start
        && safeIndex < this.currentRange.end;
    }

    itemsPerRow() {
      return this.options.itemsPerRow;
    }

    _syncItemsPerRow(preserveAnchor) {
      if (!this.itemsPerRowProvider) return false;
      const nextItemsPerRow = normalizeInteger(this.itemsPerRowProvider(), this.options.itemsPerRow, 1);
      if (nextItemsPerRow === this.options.itemsPerRow) return false;

      const previousItemsPerRow = this.options.itemsPerRow;
      const viewportTop = preserveAnchor ? this._viewportOffset() : 0;
      const relativeScrollTop = preserveAnchor
        ? Math.max(0, (Number(this.scrollElement.scrollTop) || 0) - viewportTop)
        : 0;
      const firstItemIndex = Math.floor(relativeScrollTop / this.options.rowHeight) * previousItemsPerRow;
      this.options = { ...this.options, itemsPerRow: nextItemsPerRow };
      this.currentRange = null;
      this._updateViewportHeight();
      if (preserveAnchor) {
        const nextRow = Math.floor(firstItemIndex / nextItemsPerRow);
        this.scrollElement.scrollTop = viewportTop + nextRow * this.options.rowHeight;
      }
      return true;
    }

    _updateViewportHeight() {
      const rowCount = Math.ceil(this.total / this.options.itemsPerRow);
      this.viewportElement.style.height = `${rowCount * this.options.rowHeight}px`;
    }

    _viewportOffset() {
      if (typeof this.viewportElement?.getBoundingClientRect === 'function'
          && typeof this.scrollElement?.getBoundingClientRect === 'function') {
        const viewportRect = this.viewportElement.getBoundingClientRect();
        const scrollRect = this.scrollElement.getBoundingClientRect();
        return Math.max(0, (Number(this.scrollElement.scrollTop) || 0) + viewportRect.top - scrollRect.top);
      }
      return Math.max(0, Number(this.viewportElement?.offsetTop) || 0);
    }

    destroy() {
      if (!this.mounted) return;
      this.mounted = false;
      this.scrollElement.removeEventListener('scroll', this._handleScroll);
      root?.removeEventListener?.('resize', this._handleResize);
      if (this.scheduled !== null) this.cancelSchedule(this.scheduled);
      this.scheduled = null;
      this.currentRange = null;
    }
  }

  return {
    DEFAULT_THRESHOLD,
    DEFAULT_ROW_HEIGHT,
    DEFAULT_OVERSCAN,
    DEFAULT_CARD_MIN_WIDTH,
    DEFAULT_CARD_HEIGHT,
    DEFAULT_GRID_GAP,
    DEFAULT_CARD_ROW_HEIGHT,
    normalizeOptions,
    shouldVirtualize,
    canVirtualizeCardItems,
    gridColumnCount,
    calculateWindow,
    scrollTopForIndex,
    Controller
  };
});
