(function exposeWorkspaceTabs(root, factory) {
  const contentQuery = typeof module !== 'undefined' && module.exports
    ? require('./contentQuery')
    : root?.ContentQuery;
  const api = factory(contentQuery);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorkspaceTabs = api;
})(typeof window !== 'undefined' ? window : globalThis, function createWorkspaceTabsApi(ContentQuery) {
  const MAX_TABS = 20;
  const MAX_HISTORY = 50;
  const MAX_CLOSED_TABS = 10;
  const VALID_MODES = new Set(['tree', 'dashboard', 'tasks', 'relationships']);
  const VALID_SEARCH_TYPES = new Set(['all', 'repository', 'directory', 'file']);
  const VALID_SEARCH_MODES = new Set(['metadata', 'content']);

  function defaultIdFactory() {
    return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function safeId(candidate, usedIds, idFactory) {
    let value = typeof candidate === 'string' && candidate ? candidate : idFactory();
    while (usedIds.has(value)) value = idFactory();
    usedIds.add(value);
    return value;
  }

  function tabTitle(pathValue) {
    const parts = String(pathValue || '').split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || '新标签页';
  }

  function normalizeTab(raw, fallbackPath, usedIds, idFactory) {
    const candidate = raw && typeof raw === 'object' ? raw : {};
    const pathValue = typeof candidate.path === 'string' && candidate.path ? candidate.path : fallbackPath;
    let history = Array.isArray(candidate.history)
      ? candidate.history.filter(item => typeof item === 'string' && item).slice(-MAX_HISTORY)
      : [];
    if (!history.length) history = pathValue ? [pathValue] : [];
    let historyIndex = Math.max(0, Math.min(Number(candidate.historyIndex) || 0, Math.max(0, history.length - 1)));
    if (pathValue && history[historyIndex] !== pathValue) {
      history = [...history.slice(Math.max(0, history.length - MAX_HISTORY + 1)), pathValue];
      historyIndex = history.length - 1;
    }
    const contentQuery = ContentQuery.normalize(candidate.contentQuery, {
      mode: candidate.mode,
      directoryType: candidate.directoryType
    });
    return {
      id: safeId(candidate.id, usedIds, idFactory),
      path: pathValue || '',
      title: tabTitle(pathValue),
      mode: VALID_MODES.has(candidate.mode) ? candidate.mode : 'tree',
      history,
      historyIndex,
      searchScope: candidate.searchScope === 'global' ? 'global' : 'current',
      searchQuery: String(candidate.searchQuery || '').slice(0, 500),
      globalSearchMode: VALID_SEARCH_MODES.has(candidate.globalSearchMode) ? candidate.globalSearchMode : 'metadata',
      globalSearchType: VALID_SEARCH_TYPES.has(candidate.globalSearchType) ? candidate.globalSearchType : 'all',
      contentQuery
    };
  }

  function normalizeSession(raw, fallbackPath = '', idFactory = defaultIdFactory) {
    const candidate = raw && typeof raw === 'object' ? raw : {};
    const usedIds = new Set();
    let tabs = (Array.isArray(candidate.tabs) ? candidate.tabs : [])
      .slice(0, MAX_TABS)
      .map(tab => normalizeTab(tab, fallbackPath, usedIds, idFactory));
    if (!tabs.length) tabs = [normalizeTab({ path: fallbackPath }, fallbackPath, usedIds, idFactory)];
    const activeTabId = tabs.some(tab => tab.id === candidate.activeTabId)
      ? candidate.activeTabId
      : tabs[0].id;
    const closedTabs = (Array.isArray(candidate.closedTabs) ? candidate.closedTabs : [])
      .slice(0, MAX_CLOSED_TABS)
      .map(tab => normalizeTab(tab, fallbackPath, usedIds, idFactory));
    return { version: 2, tabs, activeTabId, closedTabs };
  }

  function needsContentQueryMigration(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== 2) return true;
    if (!Array.isArray(raw.tabs) || !raw.tabs.length) return true;
    const tabs = [...(Array.isArray(raw.tabs) ? raw.tabs : []), ...(Array.isArray(raw.closedTabs) ? raw.closedTabs : [])];
    return tabs.some(tab => !tab?.contentQuery
      || tab.contentQuery.version !== ContentQuery.VERSION
      || tab.mode === 'projects'
      || tab.mode === 'grid'
      || Object.hasOwn(tab, 'directoryType'));
  }

  function addTab(session, seed = {}, idFactory = defaultIdFactory) {
    if (session.tabs.length >= MAX_TABS) return session;
    const usedIds = new Set([
      ...session.tabs.map(tab => tab.id),
      ...(session.closedTabs || []).map(tab => tab.id)
    ]);
    const tab = normalizeTab(seed, seed.path || '', usedIds, idFactory);
    const activeIndex = Math.max(0, session.tabs.findIndex(item => item.id === session.activeTabId));
    const tabs = [...session.tabs];
    tabs.splice(activeIndex + 1, 0, tab);
    return { ...session, tabs, activeTabId: tab.id };
  }

  function closeTab(session, tabId) {
    if (session.tabs.length <= 1) return session;
    const closedIndex = session.tabs.findIndex(tab => tab.id === tabId);
    if (closedIndex < 0) return session;
    const closedTab = session.tabs[closedIndex];
    const tabs = session.tabs.filter(tab => tab.id !== tabId);
    const activeTabId = session.activeTabId === tabId
      ? tabs[Math.min(closedIndex, tabs.length - 1)].id
      : session.activeTabId;
    return {
      ...session,
      tabs,
      activeTabId,
      closedTabs: [closedTab, ...(session.closedTabs || [])].slice(0, MAX_CLOSED_TABS)
    };
  }

  function restoreClosedTab(session, idFactory = defaultIdFactory) {
    if (!session.closedTabs?.length || session.tabs.length >= MAX_TABS) return session;
    const [candidate, ...closedTabs] = session.closedTabs;
    const usedIds = new Set(session.tabs.map(tab => tab.id));
    const restored = normalizeTab(candidate, candidate.path || '', usedIds, idFactory);
    const activeIndex = Math.max(0, session.tabs.findIndex(tab => tab.id === session.activeTabId));
    const tabs = [...session.tabs];
    tabs.splice(activeIndex + 1, 0, restored);
    return { ...session, tabs, activeTabId: restored.id, closedTabs };
  }

  function reorderTabs(session, orderedIds) {
    if (!session || !Array.isArray(session.tabs) || !Array.isArray(orderedIds)) return session;
    const currentIds = session.tabs.map(tab => tab.id);
    if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== currentIds.length) return session;
    const currentIdSet = new Set(currentIds);
    if (orderedIds.some(id => !currentIdSet.has(id))) return session;
    if (orderedIds.every((id, index) => id === currentIds[index])) return session;
    const byId = new Map(session.tabs.map(tab => [tab.id, tab]));
    return { ...session, tabs: orderedIds.map(id => byId.get(id)) };
  }

  function moveTab(session, tabId, targetIndex) {
    if (!session || !Array.isArray(session.tabs)) return session;
    const currentIndex = session.tabs.findIndex(tab => tab.id === tabId);
    if (currentIndex < 0) return session;
    const boundedTarget = Math.max(0, Math.min(Number(targetIndex) || 0, session.tabs.length - 1));
    if (boundedTarget === currentIndex) return session;
    const orderedIds = session.tabs.map(tab => tab.id);
    const [movedId] = orderedIds.splice(currentIndex, 1);
    orderedIds.splice(boundedTarget, 0, movedId);
    return reorderTabs(session, orderedIds);
  }

  function pathKey(pathValue, platform = '') {
    const value = String(pathValue || '');
    if (!value) return '';
    return platform === 'win32' ? value.replace(/\//g, '\\').toLowerCase() : value;
  }

  function sessionPaths(session) {
    const paths = [];
    for (const tab of [...(session?.tabs || []), ...(session?.closedTabs || [])]) {
      if (tab?.path) paths.push(tab.path);
      if (Array.isArray(tab?.history)) paths.push(...tab.history.filter(Boolean));
    }
    return [...new Set(paths)];
  }

  function repairUnavailablePaths(session, inspection = {}) {
    if (!session || !Array.isArray(session.tabs)) {
      return { session, changed: false, repairedTabs: 0, deferredTabs: 0, removedHistoryEntries: 0 };
    }

    const platform = inspection.platform || '';
    const entries = new Map((inspection.directories || []).map(entry => [pathKey(entry?.path, platform), entry]));
    const fallbackPath = (inspection.availableRoots || []).find(Boolean) || '';
    const isAvailable = value => entries.get(pathKey(value, platform))?.available === true;
    const isDeferred = value => entries.get(pathKey(value, platform))?.availability === 'root-unavailable';
    const nearestAvailable = value => entries.get(pathKey(value, platform))?.nearestAvailablePath || '';
    let repairedTabs = 0;
    let deferredTabs = 0;
    let removedHistoryEntries = 0;

    const repairTab = tab => {
      const originalHistory = Array.isArray(tab.history) ? tab.history : [];
      const originalIndex = Math.max(0, Math.min(Number(tab.historyIndex) || 0, Math.max(0, originalHistory.length - 1)));
      const deferred = isDeferred(tab.path);
      let nextPath = isAvailable(tab.path) || deferred ? tab.path : '';
      if (deferred) deferredTabs++;

      if (!nextPath && originalHistory.length) {
        for (let distance = 0; distance < originalHistory.length && !nextPath; distance++) {
          const backwardIndex = originalIndex - distance;
          const forwardIndex = originalIndex + distance;
          if (backwardIndex >= 0 && isAvailable(originalHistory[backwardIndex])) {
            nextPath = originalHistory[backwardIndex];
          } else if (distance > 0 && forwardIndex < originalHistory.length && isAvailable(originalHistory[forwardIndex])) {
            nextPath = originalHistory[forwardIndex];
          }
        }
      }

      if (!nextPath) nextPath = nearestAvailable(tab.path) || fallbackPath;

      const seen = new Set();
      const history = [];
      for (const item of originalHistory) {
        const key = pathKey(item, platform);
        if (!key || seen.has(key) || (!isAvailable(item) && !isDeferred(item))) continue;
        seen.add(key);
        history.push(item);
      }
      removedHistoryEntries += originalHistory.length - history.length;

      if (nextPath) {
        const nextKey = pathKey(nextPath, platform);
        if (!seen.has(nextKey)) history.push(nextPath);
      }
      const historyIndex = nextPath ? Math.max(0, history.findIndex(item => pathKey(item, platform) === pathKey(nextPath, platform))) : 0;
      if (pathKey(tab.path, platform) !== pathKey(nextPath, platform)) repairedTabs++;

      return {
        ...tab,
        path: nextPath,
        title: tabTitle(nextPath),
        history,
        historyIndex
      };
    };

    const tabs = session.tabs.map(repairTab);
    const closedTabs = (session.closedTabs || []).map(repairTab);
    const changed = repairedTabs > 0 || removedHistoryEntries > 0;
    return {
      session: changed ? { ...session, tabs, closedTabs } : session,
      changed,
      repairedTabs,
      deferredTabs,
      removedHistoryEntries
    };
  }

  return {
    MAX_TABS,
    MAX_HISTORY,
    MAX_CLOSED_TABS,
    needsContentQueryMigration,
    normalizeSession,
    addTab,
    closeTab,
    restoreClosedTab,
    reorderTabs,
    moveTab,
    sessionPaths,
    repairUnavailablePaths,
    tabTitle
  };
});
