(function exposeDirectoryLoadState(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryLoadState = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryLoadStateApi() {
  function snapshot(context, status) {
    return {
      requestId: context.requestId,
      path: context.path,
      mode: context.mode,
      style: context.style,
      status
    };
  }

  function matches(load, context) {
    return Boolean(load && context)
      && load.requestId === context.requestId
      && load.path === context.path
      && load.mode === context.mode
      && load.style === context.style;
  }

  function isCurrent(state, load = state?.directoryLoad) {
    return Boolean(load && state)
      && load.requestId === state.directoryRenderRequestId
      && load.path === state.currentPath
      && load.mode === state.currentMode
      && load.style === state.cardStyle;
  }

  function begin(state, context) {
    state.directoryLoad = snapshot(context, 'loading');
    state.fileDisplayOrder = [];
    return state.directoryLoad;
  }

  function finish(state, context) {
    if (!matches(state.directoryLoad, context) || !isCurrent(state)) return false;
    state.directoryLoad = null;
    return true;
  }

  function fail(state, context) {
    if (!matches(state.directoryLoad, context) || !isCurrent(state)) return false;
    state.directoryLoad = snapshot(context, 'error');
    return true;
  }

  function cancel(state) {
    const changed = Boolean(state.directoryLoad);
    state.directoryLoad = null;
    return changed;
  }

  function status(state) {
    return isCurrent(state) ? state.directoryLoad.status : 'idle';
  }

  return { begin, cancel, fail, finish, isCurrent, status };
});
