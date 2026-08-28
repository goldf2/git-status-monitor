(function exposeRelationshipGraphModel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RelationshipGraphModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRelationshipGraphModel() {
  const VERSION = 1;
  const MAX_BOARDS = 20;
  const MAX_ENTITIES = 200;
  const MAX_RELATIONSHIPS = 400;
  const ENTITY_TYPES = Object.freeze(['server', 'deployment', 'project', 'repository', 'endpoint', 'group']);
  const RELATIONSHIP_TYPES = Object.freeze(['contains', 'source_of', 'runs_on', 'exposes', 'depends_on']);
  const FACT_SOURCES = Object.freeze(['manual', 'imported', 'observed', 'gitfinder-registry']);
  const VERIFICATION_STALE_DAYS = 30;
  const BOARD_VIEW_MODES = Object.freeze(['full', 'compact']);
  const BOARD_PROJECTIONS = Object.freeze(['facts', 'deployment-summary']);
  const VERIFICATION_FILTERS = Object.freeze(['all', 'unverified', 'verified', 'stale']);
  const ENTITY_ID_PATTERN = /^entity_[a-z0-9][a-z0-9_-]{7,79}$/i;
  const BOARD_ID_PATTERN = /^board_[a-z0-9][a-z0-9_-]{7,79}$/i;
  const RELATIONSHIP_ID_PATTERN = /^relationship_[a-z0-9][a-z0-9_-]{7,79}$/i;
  const REFERENCE_ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]{2,159}$/i;
  const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|credential|private.?key|access.?key)/i;
  const DETAILS_KEYS = Object.freeze({
    server: new Set(['environment', 'hostLabel', 'notes']),
    deployment: new Set(['environment', 'version', 'branch', 'revision', 'status', 'notes']),
    project: new Set(),
    repository: new Set(),
    endpoint: new Set(['urlLabel', 'notes']),
    group: new Set(['notes'])
  });
  const CONNECTIONS = Object.freeze({
    contains: [['project', 'repository']],
    source_of: [['repository', 'deployment']],
    runs_on: [['deployment', 'server']],
    exposes: [['deployment', 'endpoint']],
    depends_on: [
      ['project', 'project'],
      ['repository', 'repository'],
      ['deployment', 'deployment'],
      ['deployment', 'repository']
    ]
  });

  class RelationshipGraphValidationError extends Error {
    constructor(message, issues = []) {
      super(message);
      this.name = 'RelationshipGraphValidationError';
      this.issues = issues;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cleanText(value, maxLength, fallback = '') {
    const cleaned = String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (cleaned || fallback).slice(0, maxLength);
  }

  function finiteNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function normalizeFactSource(value, issues, pathPrefix) {
    const source = cleanText(value, 80);
    if (!source) return '';
    if (!FACT_SOURCES.includes(source)) {
      issues.push(`${pathPrefix} 不是允许的事实来源`);
      return '';
    }
    return source;
  }

  function normalizeVerifiedAt(value, issues, pathPrefix) {
    const verifiedAt = cleanText(value, 40);
    if (!verifiedAt) return '';
    const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
    const timestamp = Date.parse(verifiedAt);
    if (!isoTimestamp.test(verifiedAt) || !Number.isFinite(timestamp)) {
      issues.push(`${pathPrefix} 必须是带时区的 ISO 时间`);
      return '';
    }
    return new Date(timestamp).toISOString();
  }

  function normalizeReviewIntervalDays(value, issues, pathPrefix) {
    if (value == null || value === '') return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) {
      issues.push(`${pathPrefix} 必须是 1 到 3650 之间的整数天数`);
      return null;
    }
    return value;
  }

  function verificationStatus(fact, options = {}) {
    const requestedMaxAgeDays = options.maxAgeDays ?? fact?.reviewIntervalDays;
    const maxAgeDays = finiteNumber(requestedMaxAgeDays, VERIFICATION_STALE_DAYS, 1, 3650);
    const timestamp = Date.parse(String(fact?.verifiedAt || ''));
    if (!Number.isFinite(timestamp)) {
      return Object.freeze({ state: 'unverified', label: '待验证', ageDays: null, maxAgeDays });
    }
    const nowValue = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const nowTimestamp = Number.isFinite(nowValue.getTime()) ? nowValue.getTime() : Date.now();
    const ageDays = Math.max(0, (nowTimestamp - timestamp) / 86400000);
    if (ageDays > maxAgeDays) {
      return Object.freeze({ state: 'stale', label: '待复核', ageDays, maxAgeDays });
    }
    return Object.freeze({ state: 'verified', label: '已验证', ageDays, maxAgeDays });
  }

  function defaultStore() {
    return {
      schemaVersion: VERSION,
      activeBoardId: '',
      entities: [],
      relationships: [],
      boards: []
    };
  }

  function defaultBoardView() {
    return {
      mode: 'full',
      projection: 'facts',
      query: '',
      entityType: 'all',
      environment: '',
      verification: 'all'
    };
  }

  function normalizeBoardView(raw, issues, pathPrefix, strict) {
    const view = isPlainObject(raw) ? raw : {};
    if (raw != null && !isPlainObject(raw)) issues.push(`${pathPrefix} 必须是对象`);
    const mode = String(view.mode || 'full');
    const projection = String(view.projection || 'facts');
    const entityType = String(view.entityType || 'all');
    const verification = String(view.verification || 'all');
    if (!BOARD_VIEW_MODES.includes(mode)) issues.push(`${pathPrefix}.mode 无效`);
    if (!BOARD_PROJECTIONS.includes(projection)) issues.push(`${pathPrefix}.projection 无效`);
    if (entityType !== 'all' && !ENTITY_TYPES.includes(entityType)) issues.push(`${pathPrefix}.entityType 无效`);
    if (!VERIFICATION_FILTERS.includes(verification)) issues.push(`${pathPrefix}.verification 无效`);
    if (strict) {
      for (const key of Object.keys(view)) {
        if (!['mode', 'projection', 'query', 'entityType', 'environment', 'verification'].includes(key)) {
          issues.push(`${pathPrefix}.${key} 不是允许的字段`);
        }
      }
    }
    return {
      mode: BOARD_VIEW_MODES.includes(mode) ? mode : 'full',
      projection: BOARD_PROJECTIONS.includes(projection) ? projection : 'facts',
      query: cleanText(view.query, 120),
      entityType: entityType === 'all' || ENTITY_TYPES.includes(entityType) ? entityType : 'all',
      environment: cleanText(view.environment, 80),
      verification: VERIFICATION_FILTERS.includes(verification) ? verification : 'all'
    };
  }

  function normalizeDetails(type, rawDetails, issues, pathPrefix, strict) {
    const details = {};
    if (rawDetails == null) return details;
    if (!isPlainObject(rawDetails)) {
      issues.push(`${pathPrefix} 必须是对象`);
      return details;
    }
    const allowed = DETAILS_KEYS[type] || new Set();
    for (const [key, rawValue] of Object.entries(rawDetails)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        issues.push(`${pathPrefix}.${key} 不允许保存凭据或敏感信息`);
        continue;
      }
      if (!allowed.has(key)) {
        if (strict) issues.push(`${pathPrefix}.${key} 不是允许的字段`);
        continue;
      }
      const limit = key === 'notes' ? 1000 : 240;
      const value = cleanText(rawValue, limit);
      if (value) details[key] = value;
    }
    return details;
  }

  function normalizeEntity(raw, issues, index, strict) {
    const prefix = `entities[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push(`${prefix} 必须是对象`);
      return null;
    }
    const id = String(raw.id || '');
    const type = String(raw.type || '');
    if (!ENTITY_ID_PATTERN.test(id)) issues.push(`${prefix}.id 无效`);
    if (!ENTITY_TYPES.includes(type)) issues.push(`${prefix}.type 无效`);
    const name = cleanText(raw.name, 160);
    if (!name) issues.push(`${prefix}.name 不能为空`);
    if (!ENTITY_ID_PATTERN.test(id) || !ENTITY_TYPES.includes(type) || !name) return null;

    const referenceType = type === 'project' || type === 'repository';
    const refId = cleanText(raw.refId, 160);
    if (referenceType && !REFERENCE_ID_PATTERN.test(refId)) {
      issues.push(`${prefix}.refId 必须使用稳定项目或仓库身份`);
      return null;
    }
    if (!referenceType && refId && strict) issues.push(`${prefix}.refId 仅适用于项目或仓库节点`);

    if (strict) {
      for (const key of Object.keys(raw)) {
        if (!['id', 'type', 'name', 'refId', 'details', 'source', 'verifiedAt', 'reviewIntervalDays', 'evidenceSummary'].includes(key)) {
          issues.push(`${prefix}.${key} 不是允许的字段`);
        }
      }
    }

    const entity = {
      id,
      type,
      name,
      details: normalizeDetails(type, raw.details, issues, `${prefix}.details`, strict)
    };
    if (referenceType) entity.refId = refId;
    const source = normalizeFactSource(raw.source, issues, `${prefix}.source`);
    const verifiedAt = normalizeVerifiedAt(raw.verifiedAt, issues, `${prefix}.verifiedAt`);
    const reviewIntervalDays = normalizeReviewIntervalDays(raw.reviewIntervalDays, issues, `${prefix}.reviewIntervalDays`);
    const evidenceSummary = cleanText(raw.evidenceSummary, 500);
    if (source) entity.source = source;
    if (verifiedAt) entity.verifiedAt = verifiedAt;
    if (reviewIntervalDays) entity.reviewIntervalDays = reviewIntervalDays;
    if (evidenceSummary) entity.evidenceSummary = evidenceSummary;
    return entity;
  }

  function connectionAllowed(type, sourceType, targetType) {
    return Boolean(CONNECTIONS[type]?.some(([source, target]) => source === sourceType && target === targetType));
  }

  function normalizeRelationship(raw, issues, index, entitiesById, strict) {
    const prefix = `relationships[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push(`${prefix} 必须是对象`);
      return null;
    }
    const id = String(raw.id || '');
    const type = String(raw.type || '');
    const sourceId = String(raw.sourceId || '');
    const targetId = String(raw.targetId || '');
    if (!RELATIONSHIP_ID_PATTERN.test(id)) issues.push(`${prefix}.id 无效`);
    if (!RELATIONSHIP_TYPES.includes(type)) issues.push(`${prefix}.type 无效`);
    if (!entitiesById.has(sourceId)) issues.push(`${prefix}.sourceId 引用了不存在的节点`);
    if (!entitiesById.has(targetId)) issues.push(`${prefix}.targetId 引用了不存在的节点`);
    if (sourceId === targetId) issues.push(`${prefix} 不能连接节点自身`);
    if (!RELATIONSHIP_ID_PATTERN.test(id)
      || !RELATIONSHIP_TYPES.includes(type)
      || !entitiesById.has(sourceId)
      || !entitiesById.has(targetId)
      || sourceId === targetId) return null;
    const source = entitiesById.get(sourceId);
    const target = entitiesById.get(targetId);
    if (!connectionAllowed(type, source.type, target.type)) {
      issues.push(`${prefix} 不允许 ${source.type} 通过 ${type} 连接到 ${target.type}`);
      return null;
    }
    if (strict) {
      for (const key of Object.keys(raw)) {
        if (!['id', 'type', 'sourceId', 'targetId', 'source', 'verifiedAt', 'reviewIntervalDays', 'evidenceSummary'].includes(key)) {
          issues.push(`${prefix}.${key} 不是允许的字段`);
        }
      }
    }
    const relationship = { id, type, sourceId, targetId };
    const evidenceSource = normalizeFactSource(raw.source, issues, `${prefix}.source`);
    const verifiedAt = normalizeVerifiedAt(raw.verifiedAt, issues, `${prefix}.verifiedAt`);
    const reviewIntervalDays = normalizeReviewIntervalDays(raw.reviewIntervalDays, issues, `${prefix}.reviewIntervalDays`);
    const evidenceSummary = cleanText(raw.evidenceSummary, 500);
    if (evidenceSource) relationship.source = evidenceSource;
    if (verifiedAt) relationship.verifiedAt = verifiedAt;
    if (reviewIntervalDays) relationship.reviewIntervalDays = reviewIntervalDays;
    if (evidenceSummary) relationship.evidenceSummary = evidenceSummary;
    return relationship;
  }

  function normalizePlacement(raw, issues, boardIndex, index, entityIds, strict) {
    const prefix = `boards[${boardIndex}].placements[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push(`${prefix} 必须是对象`);
      return null;
    }
    const entityId = String(raw.entityId || '');
    if (!entityIds.has(entityId)) {
      issues.push(`${prefix}.entityId 引用了不存在的节点`);
      return null;
    }
    if (strict) {
      for (const key of Object.keys(raw)) {
        if (!['entityId', 'x', 'y'].includes(key)) issues.push(`${prefix}.${key} 不是允许的字段`);
      }
      if (!Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) {
        issues.push(`${prefix} 坐标必须是有限数字`);
      }
    }
    return {
      entityId,
      x: finiteNumber(raw.x, 0, -100000, 100000),
      y: finiteNumber(raw.y, 0, -100000, 100000)
    };
  }

  function normalizeBoard(raw, issues, index, entityIds, strict) {
    const prefix = `boards[${index}]`;
    if (!isPlainObject(raw)) {
      issues.push(`${prefix} 必须是对象`);
      return null;
    }
    const id = String(raw.id || '');
    const name = cleanText(raw.name, 80);
    if (!BOARD_ID_PATTERN.test(id)) issues.push(`${prefix}.id 无效`);
    if (!name) issues.push(`${prefix}.name 不能为空`);
    if (!BOARD_ID_PATTERN.test(id) || !name) return null;
    const viewport = isPlainObject(raw.viewport) ? raw.viewport : {};
    if (strict && raw.viewport != null && !isPlainObject(raw.viewport)) issues.push(`${prefix}.viewport 必须是对象`);
    const placements = [];
    const seen = new Set();
    const rawPlacements = Array.isArray(raw.placements) ? raw.placements : [];
    if (!Array.isArray(raw.placements) && raw.placements != null) issues.push(`${prefix}.placements 必须是数组`);
    for (let placementIndex = 0; placementIndex < rawPlacements.length; placementIndex += 1) {
      const placement = normalizePlacement(rawPlacements[placementIndex], issues, index, placementIndex, entityIds, strict);
      if (!placement) continue;
      if (seen.has(placement.entityId)) {
        issues.push(`${prefix}.placements 不能重复放置同一节点`);
        continue;
      }
      seen.add(placement.entityId);
      placements.push(placement);
    }
    if (strict) {
      for (const key of Object.keys(raw)) {
        if (!['id', 'name', 'viewport', 'placements', 'view'].includes(key)) issues.push(`${prefix}.${key} 不是允许的字段`);
      }
      for (const key of Object.keys(viewport)) {
        if (!['x', 'y', 'zoom'].includes(key)) issues.push(`${prefix}.viewport.${key} 不是允许的字段`);
      }
    }
    return {
      id,
      name,
      viewport: {
        x: finiteNumber(viewport.x, 0, -100000, 100000),
        y: finiteNumber(viewport.y, 0, -100000, 100000),
        zoom: finiteNumber(viewport.zoom, 1, 0.25, 4)
      },
      view: normalizeBoardView(raw.view, issues, `${prefix}.view`, strict),
      placements
    };
  }

  function normalizeStore(raw, options = {}) {
    const strict = options.strict === true;
    const issues = [];
    const candidate = isPlainObject(raw) ? raw : defaultStore();
    if (!isPlainObject(raw) && raw != null) issues.push('白板数据必须是对象');
    if (candidate.schemaVersion != null && Number(candidate.schemaVersion) !== VERSION) {
      issues.push(`暂不支持白板数据版本：${candidate.schemaVersion}`);
    }
    const rawEntities = Array.isArray(candidate.entities) ? candidate.entities : [];
    const rawRelationships = Array.isArray(candidate.relationships) ? candidate.relationships : [];
    const rawBoards = Array.isArray(candidate.boards) ? candidate.boards : [];
    if (rawEntities.length > MAX_ENTITIES) issues.push(`节点数量不能超过 ${MAX_ENTITIES}`);
    if (rawRelationships.length > MAX_RELATIONSHIPS) issues.push(`关系数量不能超过 ${MAX_RELATIONSHIPS}`);
    if (rawBoards.length > MAX_BOARDS) issues.push(`白板数量不能超过 ${MAX_BOARDS}`);

    const entities = [];
    const entityIds = new Set();
    const referenceKeys = new Set();
    for (let index = 0; index < rawEntities.slice(0, MAX_ENTITIES).length; index += 1) {
      const entity = normalizeEntity(rawEntities[index], issues, index, strict);
      if (!entity) continue;
      if (entityIds.has(entity.id)) {
        issues.push(`entities[${index}].id 重复`);
        continue;
      }
      const referenceKey = entity.refId ? `${entity.type}:${entity.refId}` : '';
      if (referenceKey && referenceKeys.has(referenceKey)) {
        issues.push(`entities[${index}] 重复引用同一${entity.type === 'project' ? '项目' : '仓库'}`);
        continue;
      }
      entityIds.add(entity.id);
      if (referenceKey) referenceKeys.add(referenceKey);
      entities.push(entity);
    }

    const entitiesById = new Map(entities.map(entity => [entity.id, entity]));
    const relationships = [];
    const relationshipIds = new Set();
    const relationshipKeys = new Set();
    for (let index = 0; index < rawRelationships.slice(0, MAX_RELATIONSHIPS).length; index += 1) {
      const relationship = normalizeRelationship(rawRelationships[index], issues, index, entitiesById, strict);
      if (!relationship) continue;
      if (relationshipIds.has(relationship.id)) {
        issues.push(`relationships[${index}].id 重复`);
        continue;
      }
      const relationshipKey = `${relationship.type}:${relationship.sourceId}:${relationship.targetId}`;
      if (relationshipKeys.has(relationshipKey)) {
        issues.push(`relationships[${index}] 是重复关系`);
        continue;
      }
      relationshipIds.add(relationship.id);
      relationshipKeys.add(relationshipKey);
      relationships.push(relationship);
    }

    const boards = [];
    const boardIds = new Set();
    for (let index = 0; index < rawBoards.slice(0, MAX_BOARDS).length; index += 1) {
      const board = normalizeBoard(rawBoards[index], issues, index, entityIds, strict);
      if (!board) continue;
      if (boardIds.has(board.id)) {
        issues.push(`boards[${index}].id 重复`);
        continue;
      }
      boardIds.add(board.id);
      boards.push(board);
    }
    const requestedActiveBoardId = String(candidate.activeBoardId || '');
    const activeBoardId = boardIds.has(requestedActiveBoardId) ? requestedActiveBoardId : (boards[0]?.id || '');
    if (strict && requestedActiveBoardId && !boardIds.has(requestedActiveBoardId)) {
      issues.push('activeBoardId 引用了不存在的白板');
    }
    if (strict) {
      for (const key of Object.keys(candidate)) {
        if (!['schemaVersion', 'activeBoardId', 'entities', 'relationships', 'boards'].includes(key)) {
          issues.push(`${key} 不是允许的根字段`);
        }
      }
    }

    const value = { schemaVersion: VERSION, activeBoardId, entities, relationships, boards };
    return { value, issues };
  }

  function assertValidStore(raw) {
    const result = normalizeStore(raw, { strict: true });
    if (result.issues.length) {
      throw new RelationshipGraphValidationError(`关系白板数据无效：${result.issues[0]}`, result.issues);
    }
    return result.value;
  }

  return Object.freeze({
    VERSION,
    MAX_BOARDS,
    MAX_ENTITIES,
    MAX_RELATIONSHIPS,
    ENTITY_TYPES,
    RELATIONSHIP_TYPES,
    FACT_SOURCES,
    VERIFICATION_STALE_DAYS,
    BOARD_VIEW_MODES,
    BOARD_PROJECTIONS,
    VERIFICATION_FILTERS,
    CONNECTIONS,
    RelationshipGraphValidationError,
    defaultStore,
    defaultBoardView,
    normalizeStore,
    assertValidStore,
    connectionAllowed,
    verificationStatus,
    cleanText
  });
});
