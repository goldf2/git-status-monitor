(function exposeFileBrowser(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileBrowser = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileBrowserApi() {
  const DIRECTORY_TYPES = Object.freeze(['all', 'directory', 'project', 'repository', 'file']);
  const VALID_DIRECTORY_TYPES = new Set(DIRECTORY_TYPES);
  const INTERNAL_DRAG_TYPE = 'application/x-gitfinder-paths';
  const PROJECT_COLORS = Object.freeze({
    gray: '#8e8e93',
    red: '#ff3b30',
    orange: '#ff9500',
    yellow: '#ffcc00',
    green: '#34c759',
    blue: '#007aff',
    purple: '#af52de',
    pink: '#ff2d55'
  });
  const PROJECT_LIFECYCLE_LABELS = Object.freeze({
    inbox: '待整理',
    planned: '已规划',
    active: '开发中',
    validation: '验证中',
    deployed: '已部署',
    maintenance: '维护中',
    paused: '暂停',
    frozen: '已冻结',
    abandoned: '已废弃',
    archived: '归档'
  });

  function normalizeColumnPath(value, platform = 'darwin') {
    let candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate || candidate.includes('\0')) return '';
    if (String(platform).toLowerCase() === 'win32') {
      candidate = candidate.replace(/\//g, '\\');
      if (!/^[a-z]:\\/i.test(candidate) && !/^\\\\[^\\]+\\[^\\]+/.test(candidate)) return '';
      while (candidate.length > 3 && candidate.endsWith('\\')) candidate = candidate.slice(0, -1);
      return candidate;
    }
    if (!candidate.startsWith('/')) return '';
    while (candidate.length > 1 && candidate.endsWith('/')) candidate = candidate.slice(0, -1);
    return candidate;
  }

  function columnPathKey(value, platform = 'darwin') {
    const normalized = normalizeColumnPath(value, platform);
    return String(platform).toLowerCase() === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  function isColumnPathInside(rootPath, candidatePath, platform = 'darwin') {
    const rootKey = columnPathKey(rootPath, platform);
    const candidateKey = columnPathKey(candidatePath, platform);
    if (!rootKey || !candidateKey) return false;
    const separator = String(platform).toLowerCase() === 'win32' ? '\\' : '/';
    return candidateKey === rootKey || candidateKey.startsWith(rootKey.endsWith(separator) ? rootKey : `${rootKey}${separator}`);
  }

  function columnDirectoryPaths(roots, currentPath, platform = 'darwin', maxColumns = 6) {
    const current = normalizeColumnPath(currentPath, platform);
    if (!current) return [];
    const candidates = (Array.isArray(roots) ? roots : [])
      .map(root => normalizeColumnPath(typeof root === 'string' ? root : root?.path, platform))
      .filter(root => root && isColumnPathInside(root, current, platform))
      .sort((left, right) => columnPathKey(right, platform).length - columnPathKey(left, platform).length);
    const root = candidates[0];
    if (!root) return [current];

    const windows = String(platform).toLowerCase() === 'win32';
    const separator = windows ? '\\' : '/';
    const relative = current.slice(root.length).replace(/^[\\/]+/, '');
    const parts = relative.split(/[\\/]+/).filter(Boolean);
    const paths = [root];
    let cursor = root;
    for (const part of parts) {
      cursor = cursor.endsWith(separator) ? `${cursor}${part}` : `${cursor}${separator}${part}`;
      paths.push(cursor);
    }
    const limit = Math.max(2, Math.min(Number(maxColumns) || 6, 8));
    return paths.length > limit ? paths.slice(paths.length - limit) : paths;
  }

  function normalizeDirectoryType(value) {
    return VALID_DIRECTORY_TYPES.has(value) ? value : 'all';
  }

  function itemDirectoryType(item) {
    if (item?.type === 'directory') return 'directory';
    if (item?.type === 'file') return 'file';
    return 'other';
  }

  function itemVisualKind(item) {
    if (item?.type === 'directory' && item?.isProject === true) return 'project';
    if (item?.type === 'directory') return 'directory';
    if (item?.type === 'symlink') return 'symlink';
    if (item?.type === 'file') return 'file';
    return 'other';
  }

  function repositoryMetadataPresentation(item, maxVisible = 3) {
    if (item?.isGitRepo !== true) return { chips: [], hiddenCount: 0, title: '' };
    const limit = Math.max(1, Math.min(Number(maxVisible) || 3, 6));
    const descriptors = [];
    const seen = new Set();
    const append = (kind, prefix, metadata) => {
      for (const value of Array.isArray(metadata) ? metadata : []) {
        const name = String(value?.name || '')
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        if (!name) continue;
        const key = `${kind}\u0000${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rawColor = String(value?.color || '');
        descriptors.push({
          kind,
          label: `${prefix}${name}`,
          color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#86868b'
        });
      }
    };
    append('group', '组：', item.groups);
    append('tag', '#', item.tags);
    return {
      chips: descriptors.slice(0, limit),
      hiddenCount: Math.max(0, descriptors.length - limit),
      title: descriptors.map(item => item.label).join(' · ')
    };
  }

  function filterDirectoryItems(items, type = 'all') {
    const source = Array.isArray(items) ? items : [];
    const normalizedType = normalizeDirectoryType(type);
    if (normalizedType === 'all') return [...source];
    if (normalizedType === 'project') return source.filter(item => item?.type === 'directory' && item?.isProject === true);
    if (normalizedType === 'repository') return source.filter(item => item?.isGitRepo === true);
    return source.filter(item => itemDirectoryType(item) === normalizedType);
  }

  function countDirectoryItems(items) {
    const counts = { all: 0, directory: 0, project: 0, repository: 0, file: 0 };
    for (const item of Array.isArray(items) ? items : []) {
      counts.all += 1;
      const type = itemDirectoryType(item);
      if (Object.hasOwn(counts, type)) counts[type] += 1;
      if (item?.type === 'directory' && item?.isProject === true) counts.project += 1;
      if (item?.isGitRepo === true) counts.repository += 1;
    }
    return counts;
  }

  function projectColor(item, fallback = PROJECT_COLORS.blue) {
    if (item?.isProject !== true) return null;
    const safeFallback = /^#[0-9a-f]{6}$/i.test(String(fallback || ''))
      ? String(fallback).toLowerCase()
      : PROJECT_COLORS.blue;
    return PROJECT_COLORS[item?.project?.color] || safeFallback;
  }

  function projectLifecycleKey(item) {
    if (item?.isProject !== true) return '';
    return Object.hasOwn(PROJECT_LIFECYCLE_LABELS, item?.project?.lifecycle)
      ? item.project.lifecycle
      : 'active';
  }

  function projectLifecycleLabel(item) {
    const lifecycle = projectLifecycleKey(item);
    return lifecycle ? PROJECT_LIFECYCLE_LABELS[lifecycle] : '';
  }

  function isExternalFileDrag(dataTransfer) {
    const types = Array.from(dataTransfer?.types || []);
    return types.includes('Files') && !types.includes(INTERNAL_DRAG_TYPE);
  }

  function uniqueDroppedPaths(paths, limit = 100) {
    const unique = [];
    const seen = new Set();
    for (const pathValue of Array.isArray(paths) ? paths : []) {
      const value = typeof pathValue === 'string' ? pathValue.trim() : '';
      if (!value || seen.has(value)) continue;
      seen.add(value);
      unique.push(value);
      if (unique.length >= limit) break;
    }
    return unique;
  }

  function internalDragMode(event = {}, platform = '') {
    return String(platform).toLowerCase() === 'darwin'
      ? (event.altKey === true ? 'copy' : 'move')
      : (event.ctrlKey === true ? 'copy' : 'move');
  }

  function internalDragModifierHint(platform = '') {
    return String(platform).toLowerCase() === 'darwin' ? '按住 ⌥ 可复制' : '按住 Ctrl 可复制';
  }

  function normalizeDragPath(value, platform = '') {
    let candidate = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
    if (!candidate || candidate.includes('\0')) return '';
    while (candidate.length > 1 && candidate.endsWith('/')) candidate = candidate.slice(0, -1);
    return String(platform).toLowerCase() === 'win32' ? candidate.toLowerCase() : candidate;
  }

  function dragPathParent(value) {
    if (value === '/') return '/';
    const index = value.lastIndexOf('/');
    if (index < 0) return value;
    if (index === 0) return '/';
    return value.slice(0, index);
  }

  function canDropPathsToDirectory(sourcePaths, targetPath, mode = 'move', platform = '') {
    const target = normalizeDragPath(targetPath, platform);
    const sources = (Array.isArray(sourcePaths) ? sourcePaths : [])
      .map(sourcePath => normalizeDragPath(sourcePath, platform))
      .filter(Boolean);
    if (!target || !sources.length) return false;
    const transferMode = mode === 'copy' ? 'copy' : 'move';
    return sources.every(source => {
      if (target === source || target.startsWith(`${source}/`)) return false;
      if (transferMode === 'move' && target === dragPathParent(source)) return false;
      return true;
    });
  }

  function constrainPanelWidths(viewportWidth, sidebarWidth, detailWidth, options = {}) {
    const minContentWidth = Number(options.minContentWidth) || 320;
    const handleWidth = Number(options.handleWidth) || 10;
    const minSidebarWidth = Number(options.minSidebarWidth) || 180;
    const maxSidebarWidth = Number(options.maxSidebarWidth) || 500;
    const minDetailWidth = Number(options.minDetailWidth) || 240;
    const maxDetailWidth = Number(options.maxDetailWidth) || 700;
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || minimum));
    let sidebar = clamp(sidebarWidth, minSidebarWidth, maxSidebarWidth);
    let detail = clamp(detailWidth, minDetailWidth, maxDetailWidth);
    const panelBudget = Math.max(
      minSidebarWidth + minDetailWidth,
      (Number(viewportWidth) || 0) - handleWidth - minContentWidth
    );
    const excess = Math.max(0, sidebar + detail - panelBudget);
    if (excess > 0) {
      const sidebarCapacity = sidebar - minSidebarWidth;
      const detailCapacity = detail - minDetailWidth;
      const totalCapacity = sidebarCapacity + detailCapacity;
      if (totalCapacity > 0) {
        const sidebarReduction = Math.min(sidebarCapacity, excess * (sidebarCapacity / totalCapacity));
        sidebar -= sidebarReduction;
        detail -= Math.min(detailCapacity, excess - sidebarReduction);
      }
    }
    return {
      sidebarWidth: Math.floor(sidebar),
      detailWidth: Math.floor(detail)
    };
  }

  function nextFileNavigationIndex(rects, currentIndex, key, viewStyle = 'card') {
    const items = Array.isArray(rects) ? rects : [];
    if (items.length === 0) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return items.length - 1;

    const index = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < items.length
      ? currentIndex
      : 0;
    if (viewStyle === 'list' || viewStyle === 'column') {
      if (key === 'ArrowUp') return Math.max(0, index - 1);
      if (key === 'ArrowDown') return Math.min(items.length - 1, index + 1);
      return null;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;

    const center = value => ({
      x: (Number(value?.left) || 0) + ((Number(value?.width) || 0) / 2),
      y: (Number(value?.top) || 0) + ((Number(value?.height) || 0) / 2)
    });
    const current = center(items[index]);
    let best = null;
    for (let candidateIndex = 0; candidateIndex < items.length; candidateIndex += 1) {
      if (candidateIndex === index) continue;
      const candidate = center(items[candidateIndex]);
      const dx = candidate.x - current.x;
      const dy = candidate.y - current.y;
      const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
      const inDirection = key === 'ArrowLeft' ? dx < -1
        : key === 'ArrowRight' ? dx > 1
          : key === 'ArrowUp' ? dy < -1
            : dy > 1;
      if (!inDirection) continue;
      const primaryDistance = Math.abs(horizontal ? dx : dy);
      const crossDistance = Math.abs(horizontal ? dy : dx);
      const score = primaryDistance + (crossDistance * 2);
      if (!best || score < best.score || (score === best.score && candidateIndex < best.index)) {
        best = { index: candidateIndex, score };
      }
    }
    return best?.index ?? index;
  }

  return {
    DIRECTORY_TYPES,
    normalizeDirectoryType,
    itemDirectoryType,
    itemVisualKind,
    repositoryMetadataPresentation,
    filterDirectoryItems,
    countDirectoryItems,
    projectColor,
    projectLifecycleKey,
    projectLifecycleLabel,
    PROJECT_COLORS,
    PROJECT_LIFECYCLE_LABELS,
    INTERNAL_DRAG_TYPE,
    isExternalFileDrag,
    uniqueDroppedPaths,
    internalDragMode,
    internalDragModifierHint,
    canDropPathsToDirectory,
    constrainPanelWidths,
    columnDirectoryPaths,
    nextFileNavigationIndex
  };
});
