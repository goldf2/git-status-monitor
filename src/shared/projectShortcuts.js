(function exposeProjectShortcuts(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectShortcuts = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProjectShortcutsApi() {
  const VERSION = 1;
  const MAX_PINNED = 20;
  const MAX_RECENT = 8;
  const RECENT_LIMIT_OPTIONS = Object.freeze([3, 5, 8]);
  const RECENT_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
  const PROJECT_ID_PATTERN = /^project_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function defaultStore() {
    return { version: VERSION, pinned: [], recent: [] };
  }

  function defaultPreferences() {
    return { visible: true, showRecent: true, recentLimit: MAX_RECENT };
  }

  function normalizePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultPreferences();
    const recentLimit = Number(value.recentLimit);
    return {
      visible: value.visible !== false,
      showRecent: value.showRecent !== false,
      recentLimit: RECENT_LIMIT_OPTIONS.includes(recentLimit) ? recentLimit : MAX_RECENT
    };
  }

  function cleanProjectId(value) {
    const projectId = String(value || '').trim();
    return PROJECT_ID_PATTERN.test(projectId) ? projectId : '';
  }

  function cleanName(value) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  function cleanTimestamp(value) {
    const timestamp = Number(value);
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  function normalizeEntries(values, { recent = false, limit }) {
    const entries = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const projectId = cleanProjectId(value.projectId);
      if (!projectId || seen.has(projectId)) continue;
      seen.add(projectId);
      const entry = { projectId, name: cleanName(value.name) };
      if (recent) entry.lastOpenedAt = cleanTimestamp(value.lastOpenedAt);
      entries.push(entry);
      if (entries.length >= limit) break;
    }
    return recent
      ? entries.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      : entries;
  }

  function normalizeStore(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultStore();
    return {
      version: VERSION,
      pinned: normalizeEntries(value.pinned, { limit: MAX_PINNED }),
      recent: normalizeEntries(value.recent, { recent: true, limit: MAX_RECENT })
    };
  }

  function storesEqual(left, right) {
    return JSON.stringify(normalizeStore(left)) === JSON.stringify(normalizeStore(right));
  }

  function projectSummary(project) {
    const projectId = cleanProjectId(project?.projectId);
    if (!projectId) return null;
    return { projectId, name: cleanName(project?.name) };
  }

  function mergeKnownProjects(store, projects) {
    const current = normalizeStore(store);
    const known = new Map((Array.isArray(projects) ? projects : [])
      .map(projectSummary)
      .filter(Boolean)
      .map(project => [project.projectId, project]));
    const update = entry => ({
      ...entry,
      name: known.get(entry.projectId)?.name || entry.name
    });
    return normalizeStore({
      version: VERSION,
      pinned: current.pinned.map(update),
      recent: current.recent.map(update)
    });
  }

  function touchProject(store, project, now = Date.now()) {
    const summary = projectSummary(project);
    if (!summary) return normalizeStore(store);
    const current = normalizeStore(store);
    const timestamp = cleanTimestamp(now) || Date.now();
    const previous = current.recent.find(entry => entry.projectId === summary.projectId);
    const alreadyCurrent = current.recent[0]?.projectId === summary.projectId;
    const recentEnough = previous && timestamp - previous.lastOpenedAt < RECENT_TOUCH_INTERVAL_MS;
    if (alreadyCurrent && recentEnough && previous.name === summary.name) return current;
    return normalizeStore({
      ...current,
      recent: [
        { ...summary, lastOpenedAt: timestamp },
        ...current.recent.filter(entry => entry.projectId !== summary.projectId)
      ]
    });
  }

  function setPinned(store, project, shouldPin) {
    const summary = projectSummary(project);
    if (!summary) return normalizeStore(store);
    const current = normalizeStore(store);
    const without = current.pinned.filter(entry => entry.projectId !== summary.projectId);
    return normalizeStore({
      ...current,
      pinned: shouldPin ? [...without, summary] : without
    });
  }

  function normalizeComparablePath(value, platform = '') {
    const source = String(value || '');
    const windows = platform === 'win32' || /^[A-Za-z]:[\\/]/.test(source) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(source);
    let normalized = source.replace(/[\\/]+/g, windows ? '\\' : '/');
    if (normalized.length > 1 && !/^[A-Za-z]:\\$/.test(normalized)) normalized = normalized.replace(/[\\/]+$/, '');
    return windows ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  function pathIsWithin(candidatePath, projectPath, platform = '') {
    const candidate = normalizeComparablePath(candidatePath, platform);
    const project = normalizeComparablePath(projectPath, platform);
    if (!candidate || !project) return false;
    if (candidate === project) return true;
    const separator = platform === 'win32' || project.includes('\\') ? '\\' : '/';
    return candidate.startsWith(`${project}${separator}`);
  }

  function findProjectForPath(projects, candidatePath, platform = '') {
    return (Array.isArray(projects) ? projects : [])
      .filter(project => projectSummary(project) && pathIsWithin(candidatePath, project.path, platform))
      .sort((left, right) => normalizeComparablePath(right.path, platform).length - normalizeComparablePath(left.path, platform).length)[0] || null;
  }

  function resolveDisplay(store, projects) {
    const current = normalizeStore(store);
    const projectMap = new Map((Array.isArray(projects) ? projects : [])
      .map(project => [cleanProjectId(project?.projectId), project])
      .filter(([projectId]) => Boolean(projectId)));
    const pinnedIds = new Set(current.pinned.map(entry => entry.projectId));
    const resolve = entry => ({
      ...entry,
      project: projectMap.get(entry.projectId) || null,
      available: projectMap.has(entry.projectId)
    });
    return {
      pinned: current.pinned.map(resolve),
      recent: current.recent
        .filter(entry => !pinnedIds.has(entry.projectId) && projectMap.has(entry.projectId))
        .map(resolve)
    };
  }

  return {
    VERSION,
    MAX_PINNED,
    MAX_RECENT,
    RECENT_LIMIT_OPTIONS,
    defaultPreferences,
    defaultStore,
    findProjectForPath,
    mergeKnownProjects,
    normalizePreferences,
    normalizeStore,
    pathIsWithin,
    resolveDisplay,
    setPinned,
    storesEqual,
    touchProject
  };
});
