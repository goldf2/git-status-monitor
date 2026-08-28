const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const RelationshipGraphModel = require('../../shared/relationshipGraphModel');
const relationshipBoardService = require('./relationshipBoardService');

const MAX_IMPORT_BYTES = relationshipBoardService.MAX_FILE_BYTES;
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_PREVIEWS = 20;
const MAX_COMPLETED_OPERATIONS = 50;
const PREVIEW_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^relationship_import_[a-f0-9]{32}$/;
const HIGH_CONFIDENCE_SECRET_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----|(?:password|passwd|secret|token|credential|private[_ -]?key|access[_ -]?key)\s*[:=]\s*\S+/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cleanFileName(filePath) {
  return RelationshipGraphModel.cleanText(path.basename(filePath), 180, '关系白板.json');
}

function containsHighConfidenceSecret(value) {
  if (typeof value === 'string') return HIGH_CONFIDENCE_SECRET_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsHighConfidenceSecret);
  if (value && typeof value === 'object') return Object.values(value).some(containsHighConfidenceSecret);
  return false;
}

function factFields(source) {
  const result = {};
  if (source.verifiedAt) result.verifiedAt = source.verifiedAt;
  if (source.reviewIntervalDays) result.reviewIntervalDays = source.reviewIntervalDays;
  if (source.evidenceSummary) result.evidenceSummary = source.evidenceSummary;
  return result;
}

function fieldChanges(before, after, fields) {
  return fields.filter(field => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
}

class RelationshipBoardImportService {
  constructor(options = {}) {
    this.boardStore = options.boardStore || relationshipBoardService;
    this.fs = options.fsModule || fs;
    this.now = options.now || (() => new Date());
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.previewTtlMs = options.previewTtlMs || PREVIEW_TTL_MS;
    this.previews = new Map();
    this.completedOperations = new Map();
  }

  _nowMs() {
    const value = new Date(this.now()).getTime();
    return Number.isFinite(value) ? value : Date.now();
  }

  _randomHex(bytes) {
    return this.randomBytes(bytes).toString('hex');
  }

  _newId(prefix, existingIds) {
    let id;
    do id = `${prefix}_${this._randomHex(16)}`; while (existingIds.has(id));
    existingIds.add(id);
    return id;
  }

  _cleanup() {
    const now = this._nowMs();
    for (const [token, preview] of this.previews) {
      if (preview.expiresAtMs <= now) this.previews.delete(token);
    }
    while (this.previews.size >= MAX_ACTIVE_PREVIEWS) this.previews.delete(this.previews.keys().next().value);
    while (this.completedOperations.size > MAX_COMPLETED_OPERATIONS) {
      this.completedOperations.delete(this.completedOperations.keys().next().value);
    }
  }

  _readImportFile(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) {
      throw new Error('关系白板导入文件路径无效');
    }
    const before = this.fs.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('关系白板导入源必须是普通 JSON 文件');
    if (before.size > MAX_IMPORT_BYTES) throw new Error('关系白板导入文件超过 2 MB 安全限制');
    const buffer = this.fs.readFileSync(filePath);
    if (buffer.length > MAX_IMPORT_BYTES) throw new Error('关系白板导入文件超过 2 MB 安全限制');
    const after = this.fs.lstatSync(filePath);
    if (after.isSymbolicLink() || !after.isFile()
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs) {
      throw new Error('关系白板导入文件在读取期间发生变化，请重新选择');
    }
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch (_) {
      throw new Error('关系白板导入文件不是有效 JSON');
    }
    if (containsHighConfidenceSecret(parsed)) {
      throw new Error('关系白板导入文件疑似包含密码、令牌或私钥，已拒绝读取');
    }
    const store = RelationshipGraphModel.assertValidStore(parsed);
    return {
      store,
      fingerprint: {
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
      }
    };
  }

  _mergeStores(currentInput, importedInput, options = {}) {
    const current = RelationshipGraphModel.assertValidStore(currentInput);
    const imported = RelationshipGraphModel.assertValidStore(importedInput);
    const next = clone(current);
    const changes = [];
    const counts = {
      addedEntities: 0,
      updatedEntities: 0,
      addedRelationships: 0,
      updatedRelationships: 0,
      addedBoards: 0,
      updatedBoards: 0
    };
    const entityIds = new Set(next.entities.map(entity => entity.id));
    const relationshipIds = new Set(next.relationships.map(relationship => relationship.id));
    const localEntitiesById = new Map(next.entities.map(entity => [entity.id, entity]));
    const localReferences = new Map(next.entities.filter(entity => entity.refId).map(entity => [`${entity.type}:${entity.refId}`, entity]));
    const entityIdMap = new Map();

    for (const incoming of imported.entities) {
      const referenceKey = incoming.refId ? `${incoming.type}:${incoming.refId}` : '';
      const idMatch = localEntitiesById.get(incoming.id);
      const existing = (referenceKey && localReferences.get(referenceKey))
        || (idMatch?.type === incoming.type ? idMatch : null);
      if (!existing) {
        const desiredId = entityIds.has(incoming.id) ? this._newId('entity', entityIds) : incoming.id;
        entityIds.add(desiredId);
        const created = {
          ...clone(incoming),
          id: desiredId,
          details: clone(incoming.details || {}),
          source: options.preserveSource ? (incoming.source || 'observed') : 'imported'
        };
        next.entities.push(created);
        localEntitiesById.set(created.id, created);
        if (created.refId) localReferences.set(`${created.type}:${created.refId}`, created);
        entityIdMap.set(incoming.id, created.id);
        counts.addedEntities += 1;
        changes.push({ kind: 'entity', action: 'add', label: created.name, detail: created.type, fields: [] });
        continue;
      }

      entityIdMap.set(incoming.id, existing.id);
      const before = clone(existing);
      if (!['project', 'repository'].includes(existing.type)) {
        existing.name = incoming.name;
        existing.details = { ...(existing.details || {}), ...(incoming.details || {}) };
      }
      if (existing.source !== 'gitfinder-registry') {
        existing.source = options.preserveSource ? (incoming.source || 'observed') : 'imported';
      }
      const incomingFacts = factFields(incoming);
      if (incomingFacts.verifiedAt
        && (!existing.verifiedAt || Date.parse(incomingFacts.verifiedAt) >= Date.parse(existing.verifiedAt))) {
        existing.verifiedAt = incomingFacts.verifiedAt;
      }
      if (incomingFacts.reviewIntervalDays) existing.reviewIntervalDays = incomingFacts.reviewIntervalDays;
      if (incomingFacts.evidenceSummary) existing.evidenceSummary = incomingFacts.evidenceSummary;
      const fields = fieldChanges(before, existing, ['name', 'details', 'source', 'verifiedAt', 'reviewIntervalDays', 'evidenceSummary']);
      if (fields.length) {
        counts.updatedEntities += 1;
        changes.push({ kind: 'entity', action: 'update', label: existing.name, detail: existing.type, fields });
      }
    }

    const relationshipKey = relationship => `${relationship.type}:${relationship.sourceId}:${relationship.targetId}`;
    const localRelationships = new Map(next.relationships.map(relationship => [relationshipKey(relationship), relationship]));
    for (const incoming of imported.relationships) {
      const sourceId = entityIdMap.get(incoming.sourceId);
      const targetId = entityIdMap.get(incoming.targetId);
      if (!sourceId || !targetId) throw new Error('导入关系引用的节点无法解析');
      const semanticKey = `${incoming.type}:${sourceId}:${targetId}`;
      const existing = localRelationships.get(semanticKey);
      const sourceName = localEntitiesById.get(sourceId)?.name || sourceId;
      const targetName = localEntitiesById.get(targetId)?.name || targetId;
      if (!existing) {
        const desiredId = relationshipIds.has(incoming.id) ? this._newId('relationship', relationshipIds) : incoming.id;
        relationshipIds.add(desiredId);
        const created = {
          id: desiredId,
          type: incoming.type,
          sourceId,
          targetId,
          source: options.preserveSource ? (incoming.source || 'observed') : 'imported',
          ...factFields(incoming)
        };
        next.relationships.push(created);
        localRelationships.set(semanticKey, created);
        counts.addedRelationships += 1;
        changes.push({ kind: 'relationship', action: 'add', label: `${sourceName} → ${targetName}`, detail: incoming.type, fields: [] });
        continue;
      }
      const before = clone(existing);
      existing.source = options.preserveSource ? (incoming.source || 'observed') : 'imported';
      const incomingFacts = factFields(incoming);
      if (incomingFacts.verifiedAt
        && (!existing.verifiedAt || Date.parse(incomingFacts.verifiedAt) >= Date.parse(existing.verifiedAt))) {
        existing.verifiedAt = incomingFacts.verifiedAt;
      }
      if (incomingFacts.reviewIntervalDays) existing.reviewIntervalDays = incomingFacts.reviewIntervalDays;
      if (incomingFacts.evidenceSummary) existing.evidenceSummary = incomingFacts.evidenceSummary;
      const fields = fieldChanges(before, existing, ['source', 'verifiedAt', 'reviewIntervalDays', 'evidenceSummary']);
      if (fields.length) {
        counts.updatedRelationships += 1;
        changes.push({ kind: 'relationship', action: 'update', label: `${sourceName} → ${targetName}`, detail: incoming.type, fields });
      }
    }

    const boardsById = new Map(next.boards.map(board => [board.id, board]));
    for (const incoming of imported.boards) {
      const placements = incoming.placements.map(placement => ({
        entityId: entityIdMap.get(placement.entityId),
        x: placement.x,
        y: placement.y
      })).filter(placement => placement.entityId);
      const existing = boardsById.get(incoming.id);
      if (!existing) {
        const created = { ...clone(incoming), placements };
        next.boards.push(created);
        boardsById.set(created.id, created);
        counts.addedBoards += 1;
        changes.push({ kind: 'board', action: 'add', label: created.name, detail: `${placements.length} 个节点`, fields: [] });
        continue;
      }
      const placedIds = new Set(existing.placements.map(placement => placement.entityId));
      const additions = placements.filter(placement => !placedIds.has(placement.entityId));
      if (additions.length) {
        existing.placements.push(...additions);
        counts.updatedBoards += 1;
        changes.push({ kind: 'board', action: 'update', label: existing.name, detail: `新增 ${additions.length} 个布局节点`, fields: ['placements'] });
      }
    }

    if (!next.activeBoardId && next.boards.length) next.activeBoardId = next.boards[0].id;
    const normalized = RelationshipGraphModel.assertValidStore(next);
    return {
      store: normalized,
      counts,
      changes,
      totalChanges: changes.length,
      hasChanges: stableHash(normalized) !== stableHash(current)
    };
  }

  previewFromFile(filePath) {
    this._cleanup();
    const source = this._readImportFile(filePath);
    return this.previewStore(source.store, {
      sourceKind: 'file',
      fileName: cleanFileName(filePath),
      fileSize: source.fingerprint.size,
      sourcePath: filePath,
      sourceFingerprint: source.fingerprint,
      boundary: '仅合并新增或更新事实，不删除现有节点、关系或白板；导入来源不会被视为实时健康状态。'
    });
  }

  previewStore(rawStore, options = {}) {
    this._cleanup();
    const sourceKind = options.sourceKind === 'coolify' ? 'coolify' : 'memory';
    const current = this.boardStore.load().store;
    const merged = this._mergeStores(current, rawStore, {
      preserveSource: options.preserveSource === true
    });
    const operationId = `relationship_import_${this._randomHex(16)}`;
    const previewToken = this._randomHex(32);
    const expiresAtMs = this._nowMs() + this.previewTtlMs;
    const publicPreview = {
      cancelled: false,
      sourceKind: options.sourceKind === 'file' ? 'file' : sourceKind,
      sourceLabel: RelationshipGraphModel.cleanText(options.sourceLabel, 180),
      fileName: RelationshipGraphModel.cleanText(options.fileName, 180),
      fileSize: Number.isSafeInteger(options.fileSize) && options.fileSize >= 0 ? options.fileSize : 0,
      operationId,
      previewToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      hasChanges: merged.hasChanges,
      totalChanges: merged.totalChanges,
      counts: merged.counts,
      changes: merged.changes.slice(0, 80),
      truncatedChanges: Math.max(0, merged.changes.length - 80),
      observations: options.observations && typeof options.observations === 'object'
        ? clone(options.observations)
        : null,
      warnings: Array.isArray(options.warnings)
        ? options.warnings.slice(0, 20).map(value => RelationshipGraphModel.cleanText(value, 300)).filter(Boolean)
        : [],
      unmatchedRepositories: Array.isArray(options.unmatchedRepositories)
        ? options.unmatchedRepositories.slice(0, 30).map(value => RelationshipGraphModel.cleanText(value, 180)).filter(Boolean)
        : [],
      boundary: RelationshipGraphModel.cleanText(options.boundary, 600,
        '仅合并新增或更新事实，不删除现有节点、关系或白板。')
    };
    if (merged.hasChanges) {
      this.previews.set(previewToken, {
        operationId,
        previewToken,
        sourceKind: publicPreview.sourceKind,
        sourcePath: options.sourcePath || '',
        sourceFingerprint: options.sourceFingerprint || null,
        baseRevision: stableHash(current),
        proposedStore: merged.store,
        publicPreview,
        expiresAtMs
      });
    }
    return clone(publicPreview);
  }

  applyImport(request = {}) {
    this._cleanup();
    const operationId = String(request.operationId || '');
    const previewToken = String(request.previewToken || '');
    if (!OPERATION_ID_PATTERN.test(operationId) || !PREVIEW_TOKEN_PATTERN.test(previewToken)) {
      throw new Error('关系白板导入预览凭据无效');
    }
    const completed = this.completedOperations.get(operationId);
    if (completed) {
      if (completed.previewToken !== previewToken) throw new Error('关系白板导入操作标识与预览不匹配');
      return { ...clone(completed.result), alreadyApplied: true };
    }
    const preview = this.previews.get(previewToken);
    if (!preview || preview.operationId !== operationId) throw new Error('关系白板导入预览已失效，请重新选择文件');
    if (preview.expiresAtMs <= this._nowMs()) {
      this.previews.delete(previewToken);
      throw new Error('关系白板导入预览已过期，请重新选择文件');
    }
    const current = this.boardStore.load().store;
    if (stableHash(current) !== preview.baseRevision) {
      this.previews.delete(previewToken);
      throw new Error('关系白板已在预览后发生变化，请重新预览导入差异');
    }
    if (preview.sourceKind === 'file') {
      const source = this._readImportFile(preview.sourcePath);
      if (source.fingerprint.size !== preview.sourceFingerprint.size
        || source.fingerprint.sha256 !== preview.sourceFingerprint.sha256) {
        this.previews.delete(previewToken);
        throw new Error('关系白板导入文件已在预览后发生变化，请重新选择');
      }
    }
    const backupPath = this.boardStore.createImportBackup();
    const saved = this.boardStore.save(preview.proposedStore);
    const result = {
      applied: true,
      alreadyApplied: false,
      store: saved.store,
      counts: preview.publicPreview.counts,
      totalChanges: preview.publicPreview.totalChanges,
      backupFileName: path.basename(backupPath)
    };
    this.completedOperations.set(operationId, { previewToken, result: clone(result) });
    this.previews.delete(previewToken);
    this._cleanup();
    return clone(result);
  }
}

let defaultService = null;

function getDefaultService() {
  if (!defaultService) defaultService = new RelationshipBoardImportService();
  return defaultService;
}

module.exports = {
  previewFromFile: filePath => getDefaultService().previewFromFile(filePath),
  previewStore: (store, options) => getDefaultService().previewStore(store, options),
  applyImport: request => getDefaultService().applyImport(request),
  RelationshipBoardImportService,
  MAX_IMPORT_BYTES,
  PREVIEW_TTL_MS,
  PREVIEW_TOKEN_PATTERN,
  OPERATION_ID_PATTERN,
  containsHighConfidenceSecret
};
