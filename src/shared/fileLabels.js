(function exposeFileLabels(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileLabels = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileLabelsApi() {
  const VERSION = 1;
  const MAX_LABELS = 24;
  const MAX_ASSIGNMENTS = 10000;
  const MAX_LABELS_PER_PATH = 8;
  const DEFAULT_COLORS = Object.freeze([
    '#ff5f57', '#ff9f0a', '#ffd60a', '#30d158',
    '#64d2ff', '#0a84ff', '#bf5af2', '#8e8e93'
  ]);

  function defaultStore() {
    return { version: VERSION, labels: [], assignments: {} };
  }

  function normalizeName(value) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 40);
  }

  function normalizeColor(value, fallback = DEFAULT_COLORS[5]) {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/u.test(color) ? color : fallback;
  }

  function normalizeId(value) {
    const id = String(value || '').trim();
    return /^fl_[a-z0-9_-]{4,80}$/iu.test(id) ? id : '';
  }

  function normalizePathValue(value) {
    const candidate = String(value || '');
    return candidate && !candidate.includes('\0') ? candidate : '';
  }

  function normalizeStore(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const labels = [];
    const knownIds = new Set();
    for (const raw of Array.isArray(source.labels) ? source.labels : []) {
      const id = normalizeId(raw?.id);
      const name = normalizeName(raw?.name);
      if (!id || !name || knownIds.has(id)) continue;
      knownIds.add(id);
      labels.push({
        id,
        name,
        color: normalizeColor(raw?.color, DEFAULT_COLORS[labels.length % DEFAULT_COLORS.length]),
        createdAt: Number.isSafeInteger(raw?.createdAt) && raw.createdAt > 0 ? raw.createdAt : 0
      });
      if (labels.length >= MAX_LABELS) break;
    }

    const assignments = {};
    let assignmentCount = 0;
    const entries = source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments)
      ? Object.entries(source.assignments)
      : [];
    for (const [rawPath, rawIds] of entries) {
      if (assignmentCount >= MAX_ASSIGNMENTS) break;
      const pathValue = normalizePathValue(rawPath);
      if (!pathValue) continue;
      const ids = [...new Set((Array.isArray(rawIds) ? rawIds : [])
        .map(normalizeId)
        .filter(id => id && knownIds.has(id)))]
        .slice(0, MAX_LABELS_PER_PATH);
      if (!ids.length) continue;
      assignments[pathValue] = ids;
      assignmentCount += 1;
    }
    return { version: VERSION, labels, assignments };
  }

  function createLabel(store, input, options = {}) {
    const value = normalizeStore(store);
    if (value.labels.length >= MAX_LABELS) throw new Error(`最多创建 ${MAX_LABELS} 个文件标签`);
    const name = normalizeName(input?.name);
    if (!name) throw new Error('文件标签名称不能为空');
    if (value.labels.some(label => label.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('文件标签名称已存在');
    }
    const idFactory = typeof options.idFactory === 'function'
      ? options.idFactory
      : () => `fl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const id = normalizeId(idFactory());
    if (!id || value.labels.some(label => label.id === id)) throw new Error('无法生成有效的文件标签标识');
    const label = {
      id,
      name,
      color: normalizeColor(input?.color, DEFAULT_COLORS[value.labels.length % DEFAULT_COLORS.length]),
      createdAt: Number.isSafeInteger(options.now) ? options.now : Date.now()
    };
    value.labels.push(label);
    return { store: value, label };
  }

  function updateLabel(store, idValue, updates) {
    const value = normalizeStore(store);
    const id = normalizeId(idValue);
    const label = value.labels.find(item => item.id === id);
    if (!label) throw new Error('找不到文件标签');
    if (Object.hasOwn(updates || {}, 'name')) {
      const name = normalizeName(updates.name);
      if (!name) throw new Error('文件标签名称不能为空');
      if (value.labels.some(item => item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error('文件标签名称已存在');
      }
      label.name = name;
    }
    if (Object.hasOwn(updates || {}, 'color')) label.color = normalizeColor(updates.color, label.color);
    return { store: value, label };
  }

  function deleteLabel(store, idValue) {
    const value = normalizeStore(store);
    const id = normalizeId(idValue);
    if (!value.labels.some(label => label.id === id)) throw new Error('找不到文件标签');
    value.labels = value.labels.filter(label => label.id !== id);
    for (const [pathValue, ids] of Object.entries(value.assignments)) {
      const nextIds = ids.filter(labelId => labelId !== id);
      if (nextIds.length) value.assignments[pathValue] = nextIds;
      else delete value.assignments[pathValue];
    }
    return value;
  }

  function updateAssignments(store, paths, changes = {}) {
    const value = normalizeStore(store);
    const knownIds = new Set(value.labels.map(label => label.id));
    const addIds = [...new Set((Array.isArray(changes.addIds) ? changes.addIds : [])
      .map(normalizeId).filter(id => id && knownIds.has(id)))];
    const removeIds = new Set((Array.isArray(changes.removeIds) ? changes.removeIds : [])
      .map(normalizeId).filter(Boolean));
    const normalizedPaths = [...new Set((Array.isArray(paths) ? paths : []).map(normalizePathValue).filter(Boolean))];
    for (const pathValue of normalizedPaths) {
      const current = (value.assignments[pathValue] || []).filter(id => !removeIds.has(id));
      const next = [...new Set([...current, ...addIds])].slice(0, MAX_LABELS_PER_PATH);
      if (next.length) {
        if (!Object.hasOwn(value.assignments, pathValue)
            && Object.keys(value.assignments).length >= MAX_ASSIGNMENTS) {
          throw new Error(`最多为 ${MAX_ASSIGNMENTS} 个项目分配文件标签`);
        }
        value.assignments[pathValue] = next;
      } else {
        delete value.assignments[pathValue];
      }
    }
    return value;
  }

  function labelsForPaths(store, paths) {
    const value = normalizeStore(store);
    const byId = new Map(value.labels.map(label => [label.id, label]));
    const result = {};
    for (const pathValue of [...new Set((Array.isArray(paths) ? paths : []).map(normalizePathValue).filter(Boolean))]) {
      result[pathValue] = (value.assignments[pathValue] || []).map(id => byId.get(id)).filter(Boolean);
    }
    return result;
  }

  function pathsForLabelIds(store, labelIds) {
    const value = normalizeStore(store);
    const knownIds = new Set(value.labels.map(label => label.id));
    const selectedIds = new Set((Array.isArray(labelIds) ? labelIds : [])
      .map(normalizeId)
      .filter(id => id && knownIds.has(id)));
    if (!selectedIds.size) return [];
    return Object.entries(value.assignments)
      .filter(([, ids]) => ids.some(id => selectedIds.has(id)))
      .map(([pathValue]) => pathValue);
  }

  function assignmentCounts(store) {
    const value = normalizeStore(store);
    const counts = Object.fromEntries(value.labels.map(label => [label.id, 0]));
    for (const ids of Object.values(value.assignments)) {
      for (const id of ids) {
        if (Object.hasOwn(counts, id)) counts[id] += 1;
      }
    }
    return counts;
  }

  return {
    VERSION,
    MAX_LABELS,
    MAX_ASSIGNMENTS,
    MAX_LABELS_PER_PATH,
    DEFAULT_COLORS,
    createLabel,
    assignmentCounts,
    defaultStore,
    deleteLabel,
    labelsForPaths,
    normalizeColor,
    normalizeId,
    normalizeName,
    normalizeStore,
    pathsForLabelIds,
    updateAssignments,
    updateLabel
  };
});
