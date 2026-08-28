(function exposeEditActionRouter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EditActionRouter = api;
})(typeof window !== 'undefined' ? window : globalThis, function createEditActionRouterApi() {
  const ACTIONS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'select-all']);

  function normalizeAction(value) {
    const action = String(value || '').trim().toLowerCase();
    if (action === 'selectall' || action === 'select_all') return 'select-all';
    return ACTIONS.has(action) ? action : '';
  }

  function route(action, context = {}) {
    const normalized = normalizeAction(action);
    if (!normalized) return { kind: 'noop', action: '', reason: 'unsupported' };
    if (context.editable === true) return { kind: 'native', action: normalized };
    if (context.quickLookOpen === true || context.blockingModal === true) {
      return { kind: 'native', action: normalized };
    }
    if (context.hasTextSelection === true && (normalized === 'copy' || normalized === 'cut')) {
      return { kind: 'native', action: normalized };
    }
    if (context.fileBrowsing === true) {
      return { kind: 'file', action: normalized };
    }
    return { kind: 'native', action: normalized };
  }

  function shortcutAction(event = {}, platform = '') {
    const primary = event.metaKey === true || (platform !== 'darwin' && event.ctrlKey === true);
    if (!primary || event.altKey === true) return '';
    const key = String(event.key || '').toLowerCase();
    if (key === 'z') return event.shiftKey === true ? 'redo' : 'undo';
    if (platform !== 'darwin' && key === 'y' && event.shiftKey !== true) return 'redo';
    if (event.shiftKey === true) return '';
    if (key === 'x') return 'cut';
    if (key === 'c') return 'copy';
    if (key === 'v') return 'paste';
    if (key === 'a') return 'select-all';
    return '';
  }

  return {
    ACTIONS,
    normalizeAction,
    route,
    shortcutAction
  };
});
