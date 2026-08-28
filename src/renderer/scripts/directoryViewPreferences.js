(function exposeDirectoryViewPreferences(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryViewPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryViewPreferencesApi() {
  const MAX_ENTRIES = 500;
  const MAX_PATH_LENGTH = 4096;
  const MIN_COLUMN_WIDTH = 180;
  const MAX_COLUMN_WIDTH = 520;
  const DEFAULT_COLUMN_WIDTH = 260;
  const COLUMN_WIDTH_STEP = 16;
  const VALID_STYLES = new Set(['card', 'list', 'column', 'gallery']);
  const VALID_SORT_FIELDS = new Set(['name', 'path', 'dir', 'status', 'time', 'size', 'branch']);
  const VALID_SORT_ORDERS = new Set(['asc', 'desc']);

  function isWindowsPlatform(platform) {
    return String(platform || '').toLowerCase() === 'win32';
  }

  function normalizePathKey(value, platform = 'darwin') {
    let candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate || candidate.length > MAX_PATH_LENGTH || candidate.includes('\0')) return '';

    if (isWindowsPlatform(platform)) {
      candidate = candidate.replace(/\//g, '\\');
      if (!/^[a-z]:\\/i.test(candidate) && !/^\\\\[^\\]+\\[^\\]+/.test(candidate)) return '';
      const isDriveRoot = /^[a-z]:\\$/i.test(candidate);
      while (!isDriveRoot && candidate.length > 1 && candidate.endsWith('\\')) candidate = candidate.slice(0, -1);
      return candidate.toLocaleLowerCase('en-US');
    }

    if (!candidate.startsWith('/')) return '';
    while (candidate.length > 1 && candidate.endsWith('/')) candidate = candidate.slice(0, -1);
    return candidate;
  }

  function normalizeOptionalColumnWidth(value) {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && !value.trim())) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(numeric)));
  }

  function normalizeColumnWidth(value, fallback = DEFAULT_COLUMN_WIDTH) {
    return normalizeOptionalColumnWidth(value)
      ?? normalizeOptionalColumnWidth(fallback)
      ?? DEFAULT_COLUMN_WIDTH;
  }

  function columnWidthFromDrag(startWidth, startX, currentX) {
    const origin = Number(startX);
    const pointer = Number(currentX);
    if (!Number.isFinite(origin) || !Number.isFinite(pointer)) return normalizeColumnWidth(startWidth);
    return normalizeColumnWidth(normalizeColumnWidth(startWidth) + pointer - origin);
  }

  function columnWidthFromKey(currentWidth, key, options = {}) {
    const step = options.shiftKey ? COLUMN_WIDTH_STEP * 3 : COLUMN_WIDTH_STEP;
    if (key === 'ArrowLeft') return normalizeColumnWidth(normalizeColumnWidth(currentWidth) - step);
    if (key === 'ArrowRight') return normalizeColumnWidth(normalizeColumnWidth(currentWidth) + step);
    if (key === 'Home') return MIN_COLUMN_WIDTH;
    if (key === 'End') return MAX_COLUMN_WIDTH;
    return null;
  }

  function normalizeDefaults(value = {}) {
    const columnWidth = normalizeOptionalColumnWidth(value.columnWidth);
    return {
      style: VALID_STYLES.has(value.style) ? value.style : 'card',
      sortBy: VALID_SORT_FIELDS.has(value.sortBy) ? value.sortBy : 'name',
      sortOrder: VALID_SORT_ORDERS.has(value.sortOrder) ? value.sortOrder : 'asc',
      ...(columnWidth === null ? {} : { columnWidth })
    };
  }

  function normalizePreference(value, now = Date.now()) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return null;
    if (!VALID_STYLES.has(value.style)
        || !VALID_SORT_FIELDS.has(value.sortBy)
        || !VALID_SORT_ORDERS.has(value.sortOrder)) return null;
    const updatedAt = Number(value.updatedAt);
    const columnWidth = normalizeOptionalColumnWidth(value.columnWidth);
    return {
      style: value.style,
      sortBy: value.sortBy,
      sortOrder: value.sortOrder,
      ...(columnWidth === null ? {} : { columnWidth }),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0
        ? Math.min(Math.trunc(updatedAt), Math.trunc(now))
        : Math.trunc(now)
    };
  }

  function normalizeStore(value, options = {}) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    const platform = options.platform || 'darwin';
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const limit = Math.max(1, Math.min(Number(options.limit) || MAX_ENTRIES, MAX_ENTRIES));
    const byPath = new Map();

    for (const [rawPath, rawPreference] of Object.entries(value)) {
      const pathKey = normalizePathKey(rawPath, platform);
      const preference = normalizePreference(rawPreference, now);
      if (!pathKey || !preference) continue;
      const existing = byPath.get(pathKey);
      if (!existing || preference.updatedAt >= existing.updatedAt) byPath.set(pathKey, preference);
    }

    return Object.fromEntries(
      [...byPath.entries()]
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt || left[0].localeCompare(right[0]))
        .slice(0, limit)
    );
  }

  function preferenceForDirectory(store, directoryPath, defaults = {}, options = {}) {
    const normalizedDefaults = normalizeDefaults(defaults);
    const pathKey = normalizePathKey(directoryPath, options.platform || 'darwin');
    if (!pathKey) return normalizedDefaults;
    const preference = normalizePreference(store?.[pathKey], options.now);
    if (!preference) return normalizedDefaults;
    return {
      ...normalizedDefaults,
      style: preference.style,
      sortBy: preference.sortBy,
      sortOrder: preference.sortOrder,
      ...(preference.columnWidth === undefined ? {} : { columnWidth: preference.columnWidth })
    };
  }

  function rememberDirectory(store, directoryPath, preference, options = {}) {
    const platform = options.platform || 'darwin';
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const pathKey = normalizePathKey(directoryPath, platform);
    const normalizedPreference = normalizePreference({ ...preference, updatedAt: now }, now);
    if (!pathKey || !normalizedPreference) return normalizeStore(store, options);
    return normalizeStore({ ...normalizeStore(store, options), [pathKey]: normalizedPreference }, options);
  }

  return {
    MAX_ENTRIES,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
    DEFAULT_COLUMN_WIDTH,
    COLUMN_WIDTH_STEP,
    normalizePathKey,
    normalizeColumnWidth,
    columnWidthFromDrag,
    columnWidthFromKey,
    normalizeDefaults,
    normalizePreference,
    normalizeStore,
    preferenceForDirectory,
    rememberDirectory
  };
});
