(function exposeContentQuery(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContentQuery = api;
})(typeof window !== 'undefined' ? window : globalThis, function createContentQueryApi() {
  const VERSION = 6;
  const VALID_SCOPES = new Set(['current', 'all']);
  const VALID_BASE_TYPES = new Set(['all', 'directory', 'file']);
  const VALID_LIFECYCLES = new Set([
    'inbox', 'planned', 'active', 'validation', 'deployed',
    'maintenance', 'paused', 'frozen', 'abandoned', 'archived'
  ]);
  const VALID_MODIFIED_DAYS = new Set([1, 7, 30, 90]);
  const VALID_SIZE_RANGES = new Set(['any', 'under-1mb', '1mb-100mb', 'over-100mb']);
  const VALID_GIT_STATUSES = new Set(['clean', 'dirty', 'ahead', 'behind', 'no-remote']);

  function defaultQuery() {
    return {
      version: VERSION,
      scope: 'current',
      baseType: 'all',
      projectOnly: false,
      repositoryOnly: false,
      repositoryCategory: 'all',
      lifecycles: [],
      gitStatuses: [],
      fileLabelIds: [],
      extensions: [],
      modifiedWithinDays: null,
      modifiedFrom: null,
      modifiedTo: null,
      sizeRange: 'any',
      minSizeBytes: null,
      maxSizeBytes: null
    };
  }

  function normalizeStringList(values, validator, limit = 20) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = validator(raw);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length >= limit) break;
    }
    return result.sort((left, right) => left.localeCompare(right, 'en'));
  }

  function normalizeLifecycle(value) {
    const lifecycle = String(value || '').trim();
    return VALID_LIFECYCLES.has(lifecycle) ? lifecycle : '';
  }

  function normalizeExtension(value) {
    const extension = String(value || '').trim().toLocaleLowerCase('en-US').replace(/^\.+/, '');
    return /^[\p{L}\p{N}][\p{L}\p{N}._+-]{0,31}$/u.test(extension) ? extension : '';
  }

  function normalizeGitStatus(value) {
    const status = String(value || '').trim();
    return VALID_GIT_STATUSES.has(status) ? status : '';
  }

  function normalizeFileLabelId(value) {
    const id = String(value || '').trim();
    return /^fl_[a-z0-9_-]{4,80}$/iu.test(id) ? id : '';
  }

  function normalizeRepositoryCategory(value) {
    const category = String(value || 'all').trim();
    if (category === 'all' || category === 'ungrouped') return category;
    return /^[^\u0000-\u001f\u007f]{1,128}$/u.test(category) ? category : 'all';
  }

  function normalizeDate(value) {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
      ? date
      : null;
  }

  function normalizeSizeBytes(value, { minimum = 0 } = {}) {
    if (value === null || value === undefined || value === '') return null;
    const bytes = Number(value);
    if (!Number.isSafeInteger(bytes) || bytes < minimum) return null;
    return bytes;
  }

  function queryForPreset(name) {
    const base = defaultQuery();
    const presets = {
      'current-all': base,
      'current-directories': { ...base, baseType: 'directory' },
      'current-files': { ...base, baseType: 'file' },
      'current-projects': { ...base, baseType: 'directory', projectOnly: true },
      'current-repositories': { ...base, baseType: 'directory', repositoryOnly: true },
      'current-project-repositories': {
        ...base,
        baseType: 'directory',
        projectOnly: true,
        repositoryOnly: true
      },
      'all-projects': {
        ...base,
        scope: 'all',
        baseType: 'directory',
        projectOnly: true
      },
      'all-repositories': {
        ...base,
        scope: 'all',
        baseType: 'directory',
        repositoryOnly: true
      },
      'all-project-repositories': {
        ...base,
        scope: 'all',
        baseType: 'directory',
        projectOnly: true,
        repositoryOnly: true
      }
    };
    return presets[name] ? { ...presets[name] } : null;
  }

  function queryForFileLabels(labelIds) {
    return normalize({
      ...defaultQuery(),
      scope: 'all',
      fileLabelIds: Array.isArray(labelIds) ? labelIds : []
    });
  }

  function fromLegacy(mode, directoryType = 'all') {
    if (mode === 'projects') return queryForPreset('all-projects');
    if (mode === 'grid') return queryForPreset('all-repositories');
    const presets = {
      all: 'current-all',
      directory: 'current-directories',
      file: 'current-files',
      project: 'current-projects',
      repository: 'current-repositories'
    };
    return queryForPreset(presets[directoryType] || 'current-all');
  }

  function normalize(value, legacy = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fromLegacy(legacy.mode, legacy.directoryType);
    }
    let modifiedFrom = normalizeDate(value.modifiedFrom);
    let modifiedTo = normalizeDate(value.modifiedTo);
    if (modifiedFrom && modifiedTo && modifiedFrom > modifiedTo) {
      modifiedFrom = null;
      modifiedTo = null;
    }
    let minSizeBytes = normalizeSizeBytes(value.minSizeBytes, { minimum: 1 });
    let maxSizeBytes = normalizeSizeBytes(value.maxSizeBytes);
    if (minSizeBytes !== null && maxSizeBytes !== null && minSizeBytes > maxSizeBytes) {
      minSizeBytes = null;
      maxSizeBytes = null;
    }
    const exactModified = modifiedFrom !== null || modifiedTo !== null;
    const exactSize = minSizeBytes !== null || maxSizeBytes !== null;
    const query = {
      version: VERSION,
      scope: VALID_SCOPES.has(value.scope) ? value.scope : 'current',
      baseType: VALID_BASE_TYPES.has(value.baseType) ? value.baseType : 'all',
      projectOnly: value.projectOnly === true,
      repositoryOnly: value.repositoryOnly === true,
      repositoryCategory: normalizeRepositoryCategory(value.repositoryCategory),
      lifecycles: normalizeStringList(value.lifecycles, normalizeLifecycle, VALID_LIFECYCLES.size),
      gitStatuses: normalizeStringList(value.gitStatuses, normalizeGitStatus, VALID_GIT_STATUSES.size),
      fileLabelIds: normalizeStringList(value.fileLabelIds, normalizeFileLabelId, 24),
      extensions: normalizeStringList(value.extensions, normalizeExtension, 12),
      modifiedWithinDays: VALID_MODIFIED_DAYS.has(Number(value.modifiedWithinDays))
        ? Number(value.modifiedWithinDays)
        : null,
      modifiedFrom,
      modifiedTo,
      sizeRange: VALID_SIZE_RANGES.has(value.sizeRange) ? value.sizeRange : 'any',
      minSizeBytes,
      maxSizeBytes
    };
    if (exactModified) query.modifiedWithinDays = null;
    if (exactSize) query.sizeRange = 'any';
    if (query.baseType === 'file') {
      query.projectOnly = false;
      query.repositoryOnly = false;
      query.repositoryCategory = 'all';
      query.lifecycles = [];
      query.gitStatuses = [];
    } else if (query.lifecycles.length) {
      query.projectOnly = true;
      if (query.gitStatuses.length) query.repositoryOnly = true;
      query.baseType = 'directory';
      query.extensions = [];
      query.sizeRange = 'any';
      query.minSizeBytes = null;
      query.maxSizeBytes = null;
    } else if (query.gitStatuses.length) {
      query.repositoryOnly = true;
      query.baseType = 'directory';
      query.extensions = [];
      query.sizeRange = 'any';
      query.minSizeBytes = null;
      query.maxSizeBytes = null;
    } else if (query.projectOnly || query.repositoryOnly) {
      query.baseType = 'directory';
      query.extensions = [];
      query.sizeRange = 'any';
      query.minSizeBytes = null;
      query.maxSizeBytes = null;
    } else if (query.extensions.length || query.sizeRange !== 'any'
      || query.minSizeBytes !== null || query.maxSizeBytes !== null) {
      query.baseType = 'file';
    }
    if (query.scope === 'all' && query.fileLabelIds.length) {
      query.projectOnly = false;
      query.repositoryOnly = false;
      query.repositoryCategory = 'all';
      query.lifecycles = [];
      query.gitStatuses = [];
    }
    if (query.scope === 'all' && !query.projectOnly && !query.repositoryOnly && !query.fileLabelIds.length) {
      query.scope = 'current';
    }
    if (!(query.scope === 'all' && query.repositoryOnly && !query.projectOnly)) {
      query.repositoryCategory = 'all';
    }
    return query;
  }

  function equals(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    return a.scope === b.scope
      && a.baseType === b.baseType
      && a.projectOnly === b.projectOnly
      && a.repositoryOnly === b.repositoryOnly
      && a.repositoryCategory === b.repositoryCategory
      && a.modifiedWithinDays === b.modifiedWithinDays
      && a.modifiedFrom === b.modifiedFrom
      && a.modifiedTo === b.modifiedTo
      && a.sizeRange === b.sizeRange
      && a.minSizeBytes === b.minSizeBytes
      && a.maxSizeBytes === b.maxSizeBytes
      && a.lifecycles.join('\0') === b.lifecycles.join('\0')
      && a.gitStatuses.join('\0') === b.gitStatuses.join('\0')
      && a.fileLabelIds.join('\0') === b.fileLabelIds.join('\0')
      && a.extensions.join('\0') === b.extensions.join('\0');
  }

  function isCurrent(query) {
    return normalize(query).scope === 'current';
  }

  function isCollection(query) {
    return normalize(query).scope === 'all';
  }

  function collectionKind(query) {
    const value = normalize(query);
    if (value.scope !== 'all') return '';
    if (value.fileLabelIds.length) return 'file-labels';
    if (value.projectOnly && value.repositoryOnly) return 'project-repositories';
    if (value.projectOnly) return 'projects';
    if (value.repositoryOnly) return 'repositories';
    return '';
  }

  function matchesSize(item, sizeRange, minSizeBytes, maxSizeBytes) {
    if (sizeRange === 'any' && minSizeBytes === null && maxSizeBytes === null) return true;
    if (item?.type !== 'file') return false;
    const size = Number(item?.size);
    if (!Number.isFinite(size) || size < 0) return false;
    if (minSizeBytes !== null && size < minSizeBytes) return false;
    if (maxSizeBytes !== null && size > maxSizeBytes) return false;
    if (sizeRange === 'under-1mb') return size < 1024 * 1024;
    if (sizeRange === '1mb-100mb') return size >= 1024 * 1024 && size < 100 * 1024 * 1024;
    if (sizeRange === 'over-100mb') return size >= 100 * 1024 * 1024;
    return true;
  }

  function localDateBoundary(date, dayOffset = 0) {
    if (!date) return null;
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day + dayOffset).getTime();
  }

  function matchesAttributes(item, query, now = Date.now()) {
    const value = normalize(query);
    if (value.baseType === 'directory' && item?.type !== 'directory') return false;
    if (value.baseType === 'file' && item?.type !== 'file') return false;
    if (value.projectOnly && !(item?.type === 'directory' && item?.isProject === true)) return false;
    if (value.repositoryOnly && item?.isGitRepo !== true) return false;
    if (value.repositoryCategory !== 'all') {
      const groupIds = (Array.isArray(item?.groups) ? item.groups : [])
        .map(group => String(group?.id || ''))
        .filter(Boolean);
      if (value.repositoryCategory === 'ungrouped') {
        if (groupIds.length > 0) return false;
      } else if (!groupIds.includes(value.repositoryCategory)) {
        return false;
      }
    }
    if (value.lifecycles.length && !value.lifecycles.includes(item?.project?.lifecycle)) return false;
    if (value.gitStatuses.length) {
      const hasNoRemote = value.gitStatuses.includes('no-remote');
      const overallStatuses = value.gitStatuses.filter(status => status !== 'no-remote');
      if (hasNoRemote && item?.gitStatus?.hasRemote !== false) return false;
      const overall = item?.gitStatus?.overallStatus || 'clean';
      if (overallStatuses.length && !overallStatuses.includes(overall)) return false;
    }
    if (value.fileLabelIds.length) {
      const itemLabelIds = new Set((Array.isArray(item?.fileLabels) ? item.fileLabels : []).map(label => String(label?.id || '')));
      if (!value.fileLabelIds.some(labelId => itemLabelIds.has(labelId))) return false;
    }
    if (value.extensions.length) {
      if (item?.type !== 'file') return false;
      const name = String(item?.name || '').toLocaleLowerCase('en-US');
      if (!value.extensions.some(extension => name.endsWith(`.${extension}`))) return false;
    }
    if (value.modifiedWithinDays !== null) {
      const modified = new Date(item?.modifiedTime).getTime();
      const currentTime = Number(now);
      if (!Number.isFinite(modified) || !Number.isFinite(currentTime)) return false;
      if (modified < currentTime - (value.modifiedWithinDays * 24 * 60 * 60 * 1000) || modified > currentTime + 60_000) return false;
    }
    if (value.modifiedFrom !== null || value.modifiedTo !== null) {
      const modified = new Date(item?.modifiedTime).getTime();
      if (!Number.isFinite(modified)) return false;
      const from = localDateBoundary(value.modifiedFrom);
      const toExclusive = localDateBoundary(value.modifiedTo, 1);
      if (from !== null && modified < from) return false;
      if (toExclusive !== null && modified >= toExclusive) return false;
    }
    if (!matchesSize(item, value.sizeRange, value.minSizeBytes, value.maxSizeBytes)) return false;
    return true;
  }

  function matchesItem(item, query, now = Date.now()) {
    const value = normalize(query);
    return value.scope === 'current' && matchesAttributes(item, value, now);
  }

  function filterItems(items, query, now = Date.now()) {
    return (Array.isArray(items) ? items : []).filter(item => matchesItem(item, query, now));
  }

  function countItems(items, query) {
    return filterItems(items, query).length;
  }

  function toggleCurrentAttribute(query, attribute) {
    const value = normalize(query);
    const current = value.scope === 'current' ? value : queryForPreset('current-directories');
    const next = {
      ...current,
      scope: 'current',
      baseType: 'directory'
    };
    if (attribute === 'project') {
      next.projectOnly = !current.projectOnly;
      if (!next.projectOnly) next.lifecycles = [];
    }
    if (attribute === 'repository') {
      next.repositoryOnly = !current.repositoryOnly;
      if (!next.repositoryOnly) {
        next.gitStatuses = [];
        next.repositoryCategory = 'all';
      }
    }
    return normalize(next);
  }

  function isDefaultCurrent(query) {
    return equals(query, queryForPreset('current-all'));
  }

  function advancedFilterCount(query) {
    const value = normalize(query);
    return Number(value.lifecycles.length > 0)
      + Number(value.gitStatuses.length > 0)
      + Number(value.fileLabelIds.length > 0)
      + Number(value.extensions.length > 0)
      + Number(value.modifiedWithinDays !== null || value.modifiedFrom !== null || value.modifiedTo !== null)
      + Number(value.sizeRange !== 'any' || value.minSizeBytes !== null || value.maxSizeBytes !== null);
  }

  function clearAdvanced(query) {
    return normalize({
      ...normalize(query),
      lifecycles: [],
      gitStatuses: [],
      fileLabelIds: [],
      extensions: [],
      modifiedWithinDays: null,
      modifiedFrom: null,
      modifiedTo: null,
      sizeRange: 'any',
      minSizeBytes: null,
      maxSizeBytes: null
    });
  }

  function showsRepositoryMetadata(query, workspaceMode = 'tree') {
    return workspaceMode === 'dashboard'
      || (workspaceMode === 'tree' && collectionKind(query) === 'repositories');
  }

  return {
    VERSION,
    VALID_GIT_STATUSES: Object.freeze([...VALID_GIT_STATUSES]),
    VALID_LIFECYCLES: Object.freeze([...VALID_LIFECYCLES]),
    VALID_MODIFIED_DAYS: Object.freeze([...VALID_MODIFIED_DAYS]),
    VALID_SIZE_RANGES: Object.freeze([...VALID_SIZE_RANGES]),
    advancedFilterCount,
    clearAdvanced,
    collectionKind,
    countItems,
    defaultQuery,
    equals,
    filterItems,
    fromLegacy,
    isCollection,
    isCurrent,
    isDefaultCurrent,
    matchesAttributes,
    matchesItem,
    normalize,
    queryForPreset,
    queryForFileLabels,
    showsRepositoryMetadata,
    toggleCurrentAttribute
  };
});
