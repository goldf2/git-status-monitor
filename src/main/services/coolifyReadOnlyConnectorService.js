const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const RelationshipGraphModel = require('../../shared/relationshipGraphModel');
const configService = require('./configService');
const relationshipBoardImportService = require('./relationshipBoardImportService');

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SERVERS = 50;
const MAX_APPLICATIONS = 100;
const MAX_RESOURCES_PER_SERVER = 100;
const RESOURCE_CONCURRENCY = 4;
const TOKEN_MAX_LENGTH = 4096;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function cleanText(value, maxLength, fallback = '') {
  return RelationshipGraphModel.cleanText(value, maxLength, fallback);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableId(prefix, value) {
  return `${prefix}_${hash(value).slice(0, 24)}`;
}

function normalizeBaseUrl(value) {
  const input = String(value || '').trim();
  if (!input || input.length > 2048 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Coolify 实例地址无效');
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    throw new Error('Coolify 实例地址必须是完整 URL');
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(hostname) || hostname.startsWith('127.');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('Coolify 实例必须使用 HTTPS；仅本机 localhost 允许 HTTP');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Coolify 实例地址不能包含凭据、查询参数或片段');
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/' && normalizedPath !== '/api/v1') {
    throw new Error('Coolify 实例地址只能填写站点根地址或 /api/v1');
  }
  return Object.freeze({
    origin: parsed.origin,
    hostname: cleanText(parsed.hostname, 180, 'Coolify'),
    apiBaseUrl: `${parsed.origin}/api/v1`
  });
}

function normalizeAccessToken(value) {
  const token = String(value || '').trim();
  if (token.length < 8 || token.length > TOKEN_MAX_LENGTH || /[\u0000-\u0020\u007f]/.test(token)) {
    throw new Error('Coolify Access Token 无效');
  }
  return token;
}

function safeHttpError(statusCode) {
  if (statusCode === 401) return 'Coolify 拒绝了令牌，请检查 Token 是否完整';
  if (statusCode === 403) return 'Coolify 拒绝访问，请使用仅含 read 权限的团队令牌';
  if (statusCode === 404) return '未找到 Coolify API，请检查实例地址和 API 是否已启用';
  if (statusCode === 429) return 'Coolify API 请求过于频繁，请稍后重试';
  return `Coolify API 返回 HTTP ${statusCode}`;
}

function requestJson(options) {
  const url = options.url instanceof URL ? options.url : new URL(options.url);
  const token = normalizeAccessToken(options.accessToken);
  const timeoutMs = Number(options.timeoutMs) || REQUEST_TIMEOUT_MS;
  const maxBytes = Number(options.maxBytes) || MAX_RESPONSE_BYTES;
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    const request = client.request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'GitFinder-Coolify-ReadOnly/1'
      }
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        finish(reject, new Error(safeHttpError(statusCode)));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        response.resume();
        finish(reject, new Error('Coolify API 未返回 JSON'));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        if (settled) return;
        length += chunk.length;
        if (length > maxBytes) {
          response.destroy();
          finish(reject, new Error('Coolify API 响应超过 2 MB 安全限制'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        try {
          finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (_) {
          finish(reject, new Error('Coolify API 返回了无效 JSON'));
        }
      });
      response.on('error', () => finish(reject, new Error('读取 Coolify API 响应失败')));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', error => {
      const message = error?.message === 'timeout'
        ? '连接 Coolify API 超时'
        : '无法连接 Coolify API';
      finish(reject, new Error(message));
    });
    request.end();
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function arrayResponse(value, label, maximum) {
  if (!Array.isArray(value)) throw new Error(`Coolify ${label}响应格式无效`);
  if (value.length > maximum) throw new Error(`Coolify ${label}数量超过当前安全上限 ${maximum}`);
  return value;
}

function normalizeRemoteAliases(value) {
  const raw = cleanText(value, 500).replace(/\.git\/?$/i, '').replace(/\/+$/, '');
  if (!raw) return [];
  const aliases = new Set();
  try {
    const parsed = new URL(raw);
    const repositoryPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git\/?$/i, '').replace(/\/+$/, '').toLowerCase();
    if (repositoryPath) {
      aliases.add(`${parsed.hostname.toLowerCase()}/${repositoryPath}`);
      aliases.add(repositoryPath);
    }
  } catch (_) {
    const scpMatch = raw.match(/^(?:[^@\s]+@)?([^:\s/]+):(.+)$/);
    if (scpMatch) {
      const host = scpMatch[1].toLowerCase();
      const repositoryPath = scpMatch[2].replace(/^\/+/, '').toLowerCase();
      aliases.add(`${host}/${repositoryPath}`);
      aliases.add(repositoryPath);
    } else {
      const repositoryPath = raw.replace(/^\/+/, '').toLowerCase();
      if (repositoryPath.includes('/')) aliases.add(repositoryPath);
    }
  }
  return [...aliases];
}

function buildRepositoryMatcher(registry) {
  const aliases = new Map();
  for (const repository of Array.isArray(registry?.repos) ? registry.repos : []) {
    if (!repository?.id || repository.archived === true) continue;
    for (const alias of normalizeRemoteAliases(repository.originUrl)) {
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push(repository);
    }
  }
  return value => {
    const matches = new Map();
    for (const alias of normalizeRemoteAliases(value)) {
      for (const repository of aliases.get(alias) || []) matches.set(repository.id, repository);
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  };
}

function safeRepositoryLabel(value) {
  return cleanText(normalizeRemoteAliases(value)[0], 180);
}

function publicEndpoints(value) {
  const endpoints = new Set();
  for (const candidate of cleanText(value, 2000).split(/[\s,]+/)) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
      parsed.search = '';
      parsed.hash = '';
      endpoints.add(cleanText(parsed.toString().replace(/\/$/, ''), 240));
    } catch (_) {}
  }
  return [...endpoints].filter(Boolean);
}

function observedFact(verifiedAt, evidenceSummary) {
  return {
    source: 'observed',
    verifiedAt,
    reviewIntervalDays: 1,
    evidenceSummary
  };
}

function buildObservedStore(snapshot, registry, source) {
  const verifiedAt = source.verifiedAt;
  const evidence = `Coolify read-only API snapshot · ${source.hostname}`;
  const entities = new Map();
  const relationships = new Map();
  const repositoryMatcher = buildRepositoryMatcher(registry);
  const unmatchedRepositories = new Set();
  const matchedRepositories = new Set();
  const appByUuid = new Map();

  const addEntity = entity => {
    entities.set(entity.id, entity);
    return entity;
  };
  const addRelationship = (type, sourceEntity, targetEntity) => {
    const semanticKey = `${type}:${sourceEntity.id}:${targetEntity.id}`;
    if (relationships.has(semanticKey)) return;
    relationships.set(semanticKey, {
      id: stableId('relationship', `${source.origin}:${semanticKey}`),
      type,
      sourceId: sourceEntity.id,
      targetId: targetEntity.id,
      ...observedFact(verifiedAt, evidence)
    });
  };
  const deploymentFor = raw => {
    const uuid = cleanText(raw?.uuid, 180);
    if (!uuid) return null;
    const app = appByUuid.get(uuid);
    const name = cleanText(app?.name || raw?.name, 160, '未命名 Coolify 资源');
    const status = cleanText(raw?.status || app?.status, 240);
    const type = cleanText(raw?.type || (app ? 'application' : 'resource'), 80);
    const branch = cleanText(app?.git_branch, 120);
    const revision = /^[a-f0-9]{7,64}$/i.test(String(app?.git_commit_sha || ''))
      ? String(app.git_commit_sha).slice(0, 12)
      : '';
    const notes = type ? `Coolify ${type}` : '';
    const id = stableId('entity', `${source.origin}:deployment:${uuid}`);
    return addEntity({
      id,
      type: 'deployment',
      name,
      details: {
        ...(branch ? { branch } : {}),
        ...(revision ? { revision } : {}),
        ...(status ? { status } : {}),
        ...(notes ? { notes } : {})
      },
      ...observedFact(verifiedAt, evidence)
    });
  };

  for (const rawApp of snapshot.applications) {
    const uuid = cleanText(rawApp?.uuid, 180);
    if (!uuid) continue;
    appByUuid.set(uuid, {
      uuid,
      name: cleanText(rawApp?.name, 160),
      fqdn: cleanText(rawApp?.fqdn, 2000),
      git_repository: safeRepositoryLabel(rawApp?.git_repository),
      git_branch: cleanText(rawApp?.git_branch, 120),
      git_commit_sha: cleanText(rawApp?.git_commit_sha, 64),
      status: cleanText(rawApp?.status, 240)
    });
  }

  for (const rawServer of snapshot.servers) {
    const uuid = cleanText(rawServer?.uuid, 180);
    if (!uuid) continue;
    const server = addEntity({
      id: stableId('entity', `${source.origin}:server:${uuid}`),
      type: 'server',
      name: cleanText(rawServer?.name, 160, '未命名 Coolify 服务器'),
      details: {
        hostLabel: source.hostname,
        notes: rawServer?.settings?.is_reachable === false ? 'Coolify 报告：不可达' : 'Coolify 只读观测'
      },
      ...observedFact(verifiedAt, evidence)
    });
    for (const rawResource of snapshot.resourcesByServer.get(uuid) || []) {
      const deployment = deploymentFor(rawResource);
      if (deployment) addRelationship('runs_on', deployment, server);
    }
  }

  for (const app of appByUuid.values()) {
    const deployment = deploymentFor(app);
    if (!deployment) continue;
    if (app.git_repository) {
      const repository = repositoryMatcher(app.git_repository);
      if (repository) {
        const repositoryEntity = addEntity({
          id: stableId('entity', `repository:${repository.id}`),
          type: 'repository',
          name: cleanText(repository.name, 160, 'Git 仓库'),
          refId: String(repository.id),
          details: {},
          source: 'gitfinder-registry'
        });
        matchedRepositories.add(repository.id);
        addRelationship('source_of', repositoryEntity, deployment);
      } else {
        unmatchedRepositories.add(cleanText(app.git_repository, 180));
      }
    }
    for (const endpointLabel of publicEndpoints(app.fqdn)) {
      const endpoint = addEntity({
        id: stableId('entity', `${source.origin}:endpoint:${endpointLabel.toLowerCase()}`),
        type: 'endpoint',
        name: cleanText(new URL(endpointLabel).hostname, 160, endpointLabel),
        details: { urlLabel: endpointLabel },
        ...observedFact(verifiedAt, evidence)
      });
      addRelationship('exposes', deployment, endpoint);
    }
  }

  const orderedEntities = [...entities.values()].sort((left, right) => {
    const order = { repository: 0, deployment: 1, server: 2, endpoint: 3 };
    return (order[left.type] - order[right.type]) || left.name.localeCompare(right.name, 'zh-CN');
  });
  if (orderedEntities.length > RelationshipGraphModel.MAX_ENTITIES) {
    throw new Error(`Coolify 观测到 ${orderedEntities.length} 个节点，超过白板上限 ${RelationshipGraphModel.MAX_ENTITIES}`);
  }
  if (relationships.size > RelationshipGraphModel.MAX_RELATIONSHIPS) {
    throw new Error(`Coolify 观测到 ${relationships.size} 条关系，超过白板上限 ${RelationshipGraphModel.MAX_RELATIONSHIPS}`);
  }
  const positions = { repository: 0, deployment: 0, server: 0, endpoint: 0 };
  const columns = { repository: 40, deployment: 360, server: 680, endpoint: 1000 };
  const placements = orderedEntities.map(entity => {
    const row = positions[entity.type] || 0;
    positions[entity.type] = row + 1;
    return { entityId: entity.id, x: columns[entity.type] || 40, y: 50 + row * 130 };
  });
  const boardId = stableId('board', `${source.origin}:coolify`);
  const store = RelationshipGraphModel.assertValidStore({
    schemaVersion: RelationshipGraphModel.VERSION,
    activeBoardId: boardId,
    entities: orderedEntities,
    relationships: [...relationships.values()],
    boards: [{
      id: boardId,
      name: cleanText(`Coolify · ${source.hostname}`, 80),
      viewport: { x: 40, y: 40, zoom: 0.8 },
      view: RelationshipGraphModel.defaultBoardView(),
      placements
    }]
  });
  return {
    store,
    unmatchedRepositories: [...unmatchedRepositories],
    observations: {
      servers: snapshot.servers.length,
      deployments: orderedEntities.filter(entity => entity.type === 'deployment').length,
      endpoints: orderedEntities.filter(entity => entity.type === 'endpoint').length,
      matchedRepositories: matchedRepositories.size,
      unmatchedRepositories: unmatchedRepositories.size
    }
  };
}

function sanitizedConnectorError(error, accessToken) {
  const raw = String(error?.message || error || 'Coolify 只读发现失败');
  const withoutBearer = raw.replace(/Bearer\s+[^\s]+/gi, 'Bearer [已隐藏]');
  return new Error(accessToken ? withoutBearer.split(accessToken).join('[已隐藏]') : withoutBearer);
}

class CoolifyReadOnlyConnectorService {
  constructor(options = {}) {
    this.requestJson = options.requestJson || requestJson;
    this.registryProvider = options.registryProvider || (() => configService.getRegistry());
    this.importService = options.importService || relationshipBoardImportService;
    this.now = options.now || (() => new Date());
  }

  async preview(request = {}) {
    const base = normalizeBaseUrl(request.baseUrl);
    const accessToken = normalizeAccessToken(request.accessToken);
    try {
      const get = async pathname => this.requestJson({
        url: new URL(`${base.apiBaseUrl}${pathname}`),
        method: 'GET',
        accessToken,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES
      });
      const [rawServers, rawApplications] = await Promise.all([
        get('/servers'),
        get('/applications')
      ]);
      const servers = arrayResponse(rawServers, '服务器', MAX_SERVERS);
      const applications = arrayResponse(rawApplications, '应用', MAX_APPLICATIONS);
      const resourceLists = await mapWithConcurrency(servers, RESOURCE_CONCURRENCY, async server => {
        const uuid = cleanText(server?.uuid, 180);
        if (!uuid || !/^[a-z0-9_-]+$/i.test(uuid)) throw new Error('Coolify 返回了无效服务器 UUID');
        const resources = await get(`/servers/${encodeURIComponent(uuid)}/resources`);
        return [uuid, arrayResponse(resources, '服务器资源', MAX_RESOURCES_PER_SERVER)];
      });
      const verifiedAtValue = new Date(this.now());
      const verifiedAt = Number.isFinite(verifiedAtValue.getTime())
        ? verifiedAtValue.toISOString()
        : new Date().toISOString();
      const observed = buildObservedStore({
        servers,
        applications,
        resourcesByServer: new Map(resourceLists)
      }, this.registryProvider() || { repos: [] }, {
        origin: base.origin,
        hostname: base.hostname,
        verifiedAt
      });
      const warnings = [];
      if (observed.unmatchedRepositories.length) {
        warnings.push(`${observed.unmatchedRepositories.length} 个远程仓库未匹配到本机 GitFinder 注册表，未创建仓库连线。`);
      }
      return this.importService.previewStore(observed.store, {
        sourceKind: 'coolify',
        sourceLabel: `Coolify · ${base.hostname}`,
        preserveSource: true,
        observations: observed.observations,
        warnings,
        unmatchedRepositories: observed.unmatchedRepositories,
        boundary: '仅保存本次只读快照中的服务器、部署、公开端点及已匹配仓库关系；不保存 Access Token，不读取敏感字段，不删除现有事实，也不会部署、重启或修改 Coolify。'
      });
    } catch (error) {
      throw sanitizedConnectorError(error, accessToken);
    }
  }
}

let defaultService = null;

function getDefaultService() {
  if (!defaultService) defaultService = new CoolifyReadOnlyConnectorService();
  return defaultService;
}

module.exports = {
  preview: request => getDefaultService().preview(request),
  CoolifyReadOnlyConnectorService,
  normalizeBaseUrl,
  normalizeAccessToken,
  normalizeRemoteAliases,
  safeRepositoryLabel,
  publicEndpoints,
  buildObservedStore,
  requestJson,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_SERVERS,
  MAX_APPLICATIONS,
  MAX_RESOURCES_PER_SERVER,
  RESOURCE_CONCURRENCY
};
