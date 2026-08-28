(function exposeSmartCollections(root, factory) {
  const contentQuery = typeof module !== 'undefined' && module.exports
    ? require('./contentQuery')
    : root?.ContentQuery;
  const api = factory(contentQuery);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SmartCollections = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSmartCollectionsApi(ContentQuery) {
  const VERSION = 1;
  const MAX_COLLECTIONS = 50;
  const MAX_NAME_LENGTH = 60;
  const MAX_SEARCH_LENGTH = 200;
  const MAX_TAGS = 32;
  const VALID_SEARCH_FIELDS = new Set(['name', 'readme']);

  function normalizeText(value, maxLength) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function normalizeName(value) {
    return normalizeText(value, MAX_NAME_LENGTH);
  }

  function normalizeId(value) {
    const id = String(value || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(id) ? id : '';
  }

  function normalizeTokens(values, limit = MAX_TAGS) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = String(raw || '').trim();
      if (!value || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value) || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length >= limit) break;
    }
    return result.sort((left, right) => left.localeCompare(right, 'en'));
  }

  function isSavableQuery(query) {
    return ['projects', 'repositories', 'project-repositories'].includes(ContentQuery.collectionKind(query));
  }

  function normalizeCollection(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = normalizeId(raw.id);
    const name = normalizeName(raw.name);
    const query = ContentQuery.normalize(raw.query);
    if (!id || !name || !isSavableQuery(query)) return null;
    const kind = ContentQuery.collectionKind(query);
    const searchText = normalizeText(raw.searchText, MAX_SEARCH_LENGTH);
    const searchFields = normalizeTokens(raw.searchFields, VALID_SEARCH_FIELDS.size)
      .filter(field => VALID_SEARCH_FIELDS.has(field));
    return {
      version: VERSION,
      id,
      name,
      query,
      searchText,
      searchFields: searchText ? searchFields : [],
      repositoryTagIds: kind === 'repositories' ? normalizeTokens(raw.repositoryTagIds) : []
    };
  }

  function normalizeStore(raw) {
    const candidates = Array.isArray(raw) ? raw : (Array.isArray(raw?.collections) ? raw.collections : []);
    const collections = [];
    const seenIds = new Set();
    for (const candidate of candidates) {
      const collection = normalizeCollection(candidate);
      if (!collection || seenIds.has(collection.id)) continue;
      seenIds.add(collection.id);
      collections.push(collection);
      if (collections.length >= MAX_COLLECTIONS) break;
    }
    return { version: VERSION, collections };
  }

  function defaultIdFactory() {
    const uuid = globalThis.crypto?.randomUUID?.().replace(/-/gu, '');
    return `collection_${uuid || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
  }

  function create(store, input, idFactory = defaultIdFactory) {
    const current = normalizeStore(store);
    const name = normalizeName(input?.name);
    if (!name) return { ok: false, error: '请输入集合名称', store: current };
    if (current.collections.some(item => item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) {
      return { ok: false, error: '已有同名智能集合', store: current };
    }
    if (current.collections.length >= MAX_COLLECTIONS) {
      return { ok: false, error: `最多保存 ${MAX_COLLECTIONS} 个智能集合`, store: current };
    }
    if (!isSavableQuery(input?.query)) {
      return { ok: false, error: '只有所有项目或所有 Git 仓库筛选可以保存为智能集合', store: current };
    }

    let id = '';
    for (let attempt = 0; attempt < 8 && !id; attempt++) {
      const candidate = normalizeId(idFactory());
      if (candidate && !current.collections.some(item => item.id === candidate)) id = candidate;
    }
    if (!id) return { ok: false, error: '无法生成唯一集合标识', store: current };
    const collection = normalizeCollection({ ...input, id, name });
    if (!collection) return { ok: false, error: '筛选条件无效', store: current };
    return {
      ok: true,
      collection,
      store: { version: VERSION, collections: [...current.collections, collection] }
    };
  }

  function remove(store, id) {
    const current = normalizeStore(store);
    const collections = current.collections.filter(item => item.id !== id);
    return {
      removed: collections.length !== current.collections.length,
      store: { version: VERSION, collections }
    };
  }

  function rename(store, id, name) {
    const current = normalizeStore(store);
    const normalizedId = normalizeId(id);
    const normalizedName = normalizeName(name);
    const index = current.collections.findIndex(item => item.id === normalizedId);
    if (index < 0) return { ok: false, error: '智能集合不存在', store: current };
    if (!normalizedName) return { ok: false, error: '请输入集合名称', store: current };
    if (current.collections.some((item, itemIndex) => itemIndex !== index
      && item.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0)) {
      return { ok: false, error: '已有同名智能集合', store: current };
    }
    const collection = { ...current.collections[index], name: normalizedName };
    const collections = [...current.collections];
    collections[index] = collection;
    return {
      ok: true,
      collection,
      changed: collection.name !== current.collections[index].name,
      store: { version: VERSION, collections }
    };
  }

  function reorder(store, orderedIds) {
    const current = normalizeStore(store);
    const byId = new Map(current.collections.map(item => [item.id, item]));
    const ids = [];
    for (const rawId of Array.isArray(orderedIds) ? orderedIds : []) {
      const id = normalizeId(rawId);
      if (!id || !byId.has(id) || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= MAX_COLLECTIONS) break;
    }
    const seen = new Set(ids);
    const collections = [
      ...ids.map(id => byId.get(id)),
      ...current.collections.filter(item => !seen.has(item.id))
    ];
    return {
      changed: collections.some((item, index) => item.id !== current.collections[index]?.id),
      store: { version: VERSION, collections }
    };
  }

  function matchesContext(collection, context) {
    const value = normalizeCollection(collection);
    if (!value || !context) return false;
    const searchText = normalizeText(context.searchText, MAX_SEARCH_LENGTH);
    const searchFields = normalizeTokens(context.searchFields, VALID_SEARCH_FIELDS.size)
      .filter(field => VALID_SEARCH_FIELDS.has(field));
    const repositoryTagIds = ContentQuery.collectionKind(value.query) === 'repositories'
      ? normalizeTokens(context.repositoryTagIds)
      : [];
    return ContentQuery.equals(value.query, context.query)
      && value.searchText === searchText
      && value.searchFields.join('\0') === (searchText ? searchFields : []).join('\0')
      && value.repositoryTagIds.join('\0') === repositoryTagIds.join('\0');
  }

  return {
    VERSION,
    MAX_COLLECTIONS,
    MAX_NAME_LENGTH,
    MAX_SEARCH_LENGTH,
    create,
    isSavableQuery,
    matchesContext,
    normalizeCollection,
    normalizeName,
    normalizeStore,
    remove,
    rename,
    reorder
  };
});
