(function exposeProgressiveDirectoryRender(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProgressiveDirectoryRender = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProgressiveDirectoryRenderApi(root) {
  const DEFAULT_THRESHOLD = 320;
  const DEFAULT_INITIAL_BATCH = 120;
  const DEFAULT_BATCH_SIZE = 180;

  function normalizeCount(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return Math.max(0, Math.trunc(Number(fallback) || 0));
    return Math.max(0, Math.trunc(number));
  }

  function normalizeOptions(options = {}) {
    return {
      threshold: Math.max(1, normalizeCount(options.threshold, DEFAULT_THRESHOLD)),
      initialBatch: Math.max(1, normalizeCount(options.initialBatch, DEFAULT_INITIAL_BATCH)),
      batchSize: Math.max(1, normalizeCount(options.batchSize, DEFAULT_BATCH_SIZE))
    };
  }

  function shouldRenderProgressively(total, options = {}) {
    return normalizeCount(total) > normalizeOptions(options).threshold;
  }

  function createBatchPlan(total, options = {}) {
    const count = normalizeCount(total);
    if (!count) return [];
    const normalized = normalizeOptions(options);
    if (count <= normalized.threshold) return [{ from: 0, to: count, initial: true }];

    const ranges = [];
    let from = 0;
    let to = Math.min(count, normalized.initialBatch);
    ranges.push({ from, to, initial: true });
    from = to;
    while (from < count) {
      to = Math.min(count, from + normalized.batchSize);
      ranges.push({ from, to, initial: false });
      from = to;
    }
    return ranges;
  }

  function progressLabel(rendered, total) {
    const safeTotal = normalizeCount(total);
    const safeRendered = Math.min(safeTotal, normalizeCount(rendered));
    return safeRendered >= safeTotal
      ? `已显示全部 ${safeTotal.toLocaleString('zh-CN')} 项`
      : `正在显示 ${safeRendered.toLocaleString('zh-CN')} / ${safeTotal.toLocaleString('zh-CN')} 项`;
  }

  function uniquePaths(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value))];
  }

  function resolveDisplayOrder(visiblePaths, rememberedPaths, renderedPaths, currentPath) {
    const visible = uniquePaths(visiblePaths);
    const visibleSet = new Set(visible);
    const remembered = uniquePaths(rememberedPaths).filter(itemPath => visibleSet.has(itemPath));
    if (remembered.length === visible.length && remembered.includes(currentPath)) return remembered;
    return uniquePaths(renderedPaths).filter(itemPath => visibleSet.has(itemPath));
  }

  function defaultSchedule(callback) {
    if (typeof root?.requestAnimationFrame === 'function') {
      return { kind: 'frame', id: root.requestAnimationFrame(callback) };
    }
    return { kind: 'timeout', id: setTimeout(callback, 0) };
  }

  function defaultCancelSchedule(handle) {
    if (!handle) return;
    if (handle.kind === 'frame' && typeof root?.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(handle.id);
      return;
    }
    clearTimeout(handle.id);
  }

  class BatchRenderer {
    constructor(options = {}) {
      this.schedule = typeof options.schedule === 'function' ? options.schedule : defaultSchedule;
      this.cancelSchedule = typeof options.cancelSchedule === 'function'
        ? options.cancelSchedule
        : defaultCancelSchedule;
      this.generation = 0;
      this.session = null;
    }

    cancel(reason = 'cancelled') {
      const session = this.session;
      if (!session) return false;
      this.session = null;
      session.cancelled = true;
      if (session.handle !== null) this.cancelSchedule(session.handle);
      session.handle = null;
      try {
        session.handlers.onCancel?.({
          generation: session.generation,
          rendered: session.rendered,
          total: session.total,
          reason
        });
      } catch (_) {}
      session.resolve({
        cancelled: true,
        generation: session.generation,
        rendered: session.rendered,
        total: session.total,
        reason
      });
      return true;
    }

    render(total, handlers = {}, options = {}) {
      this.cancel('replaced');
      const plan = createBatchPlan(total, options);
      const generation = ++this.generation;
      const count = normalizeCount(total);

      if (!plan.length) {
        handlers.onComplete?.({ generation, rendered: 0, total: 0 });
        return Promise.resolve({ cancelled: false, generation, rendered: 0, total: 0 });
      }

      return new Promise((resolve, reject) => {
        const session = {
          cancelled: false,
          generation,
          handlers,
          handle: null,
          index: 0,
          plan,
          rendered: 0,
          resolve,
          reject,
          total: count
        };
        this.session = session;

        const runNext = () => {
          session.handle = null;
          if (this.session !== session || session.cancelled) return;
          if (typeof handlers.isCurrent === 'function' && !handlers.isCurrent()) {
            this.cancel('stale');
            return;
          }

          const range = session.plan[session.index];
          try {
            handlers.onBatch?.(range, {
              generation,
              rendered: session.rendered,
              total: count
            });
            session.rendered = range.to;
            session.index += 1;
            handlers.onProgress?.({
              generation,
              rendered: session.rendered,
              total: count
            });
          } catch (error) {
            this.session = null;
            try { handlers.onError?.(error); } catch (_) {}
            reject(error);
            return;
          }

          if (session.index >= session.plan.length) {
            this.session = null;
            handlers.onComplete?.({ generation, rendered: count, total: count });
            resolve({ cancelled: false, generation, rendered: count, total: count });
            return;
          }
          session.handle = this.schedule(runNext);
        };

        runNext();
      });
    }
  }

  return {
    DEFAULT_THRESHOLD,
    DEFAULT_INITIAL_BATCH,
    DEFAULT_BATCH_SIZE,
    normalizeCount,
    normalizeOptions,
    shouldRenderProgressively,
    createBatchPlan,
    progressLabel,
    resolveDisplayOrder,
    BatchRenderer
  };
});
