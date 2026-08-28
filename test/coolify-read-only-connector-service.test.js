const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { RelationshipBoardService } = require('../src/main/services/relationshipBoardService');
const { RelationshipBoardImportService } = require('../src/main/services/relationshipBoardImportService');
const {
  CoolifyReadOnlyConnectorService,
  normalizeBaseUrl,
  normalizeAccessToken,
  requestJson,
  RESOURCE_CONCURRENCY
} = require('../src/main/services/coolifyReadOnlyConnectorService');

const FAKE_TOKEN = '42|gitfinder-read-only-test-token';

function makeTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-coolify-connector-'));
}

function setup(options = {}) {
  const directory = makeTemporaryDirectory();
  const boardStore = new RelationshipBoardService({
    baseDirectory: path.join(directory, 'user-data'),
    now: options.now || (() => new Date('2026-08-27T12:00:00.000Z'))
  });
  boardStore.load();
  const importService = new RelationshipBoardImportService({
    boardStore,
    now: options.now || (() => new Date('2026-08-27T12:00:00.000Z')),
    previewTtlMs: options.previewTtlMs
  });
  return { directory, boardStore, importService };
}

function fixtureResponse(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/v1/servers') {
    return [{
      uuid: 'server-one',
      name: 'Con01',
      ip: '10.0.0.8',
      private_key: 'must-not-be-kept',
      settings: { is_reachable: true, sentinel_token: 'must-not-be-kept' }
    }];
  }
  if (pathname === '/api/v1/applications') {
    return [{
      uuid: 'app-one',
      name: 'MES production',
      fqdn: 'https://mes.example.com?preview_token=must-not-be-kept',
      git_repository: 'goldf2/mes-lite',
      git_branch: 'main',
      git_commit_sha: 'abcdef0123456789abcdef0123456789abcdef01',
      status: 'running:healthy',
      http_basic_auth_password: 'must-not-be-kept',
      docker_compose_raw: 'TOKEN=must-not-be-kept'
    }, {
      uuid: 'app-two',
      name: 'Unmatched API',
      fqdn: 'https://api.example.com',
      git_repository: 'https://reader:must-not-be-kept@gitlab.example.com/another-owner/unmatched-api.git',
      status: 'running'
    }];
  }
  if (pathname === '/api/v1/servers/server-one/resources') {
    return [{ uuid: 'app-one', name: 'MES production', type: 'application', status: 'running:healthy' },
      { uuid: 'service-one', name: 'PostgreSQL', type: 'database', status: 'running' }];
  }
  throw new Error(`unexpected test URL ${pathname}`);
}

test('Coolify 只读发现零写入预览，白名单化后确认合并并支持幂等重试', async t => {
  const { directory, boardStore, importService } = setup();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const connector = new CoolifyReadOnlyConnectorService({
    importService,
    registryProvider: () => ({
      repos: [{
        id: 'r_123456789abc',
        name: 'mes-lite',
        originUrl: 'git@github.com:goldf2/mes-lite.git',
        archived: false
      }]
    }),
    now: () => new Date('2026-08-27T12:00:00.000Z'),
    requestJson: async request => {
      calls.push({ url: String(request.url), method: request.method, token: request.accessToken });
      return fixtureResponse(request.url);
    }
  });
  const before = JSON.stringify(boardStore.load().store);

  const preview = await connector.preview({
    baseUrl: 'https://coolify.example.com/api/v1',
    accessToken: FAKE_TOKEN
  });

  assert.equal(JSON.stringify(boardStore.load().store), before);
  assert.equal(preview.sourceKind, 'coolify');
  assert.equal(preview.sourceLabel, 'Coolify · coolify.example.com');
  assert.equal(preview.hasChanges, true);
  assert.deepEqual(preview.observations, {
    servers: 1,
    deployments: 3,
    endpoints: 2,
    matchedRepositories: 1,
    unmatchedRepositories: 1
  });
  assert.deepEqual(preview.unmatchedRepositories, ['gitlab.example.com/another-owner/unmatched-api']);
  assert.match(preview.boundary, /不保存 Access Token/);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname).sort(), [
    '/api/v1/applications',
    '/api/v1/servers',
    '/api/v1/servers/server-one/resources'
  ]);
  assert.ok(calls.every(call => call.method === 'GET' && call.token === FAKE_TOKEN));
  const retainedPreview = JSON.stringify([...importService.previews.values()]);
  assert.doesNotMatch(JSON.stringify(preview), /must-not-be-kept|gitfinder-read-only-test-token/);
  assert.doesNotMatch(retainedPreview, /must-not-be-kept|gitfinder-read-only-test-token|preview_token/);

  const applied = importService.applyImport({
    operationId: preview.operationId,
    previewToken: preview.previewToken
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.alreadyApplied, false);
  assert.match(applied.backupFileName, /^relationship-boards\.import-backup-/);
  const store = boardStore.load().store;
  assert.equal(store.entities.filter(entity => entity.type === 'server').length, 1);
  assert.equal(store.entities.filter(entity => entity.type === 'deployment').length, 3);
  assert.equal(store.entities.filter(entity => entity.type === 'endpoint').length, 2);
  assert.equal(store.entities.filter(entity => entity.type === 'repository').length, 1);
  assert.equal(store.relationships.filter(relation => relation.type === 'runs_on').length, 2);
  assert.equal(store.relationships.filter(relation => relation.type === 'source_of').length, 1);
  assert.equal(store.relationships.filter(relation => relation.type === 'exposes').length, 2);
  assert.ok(store.relationships.every(relation => relation.source === 'observed'));
  assert.equal(store.entities.find(entity => entity.type === 'repository').source, 'gitfinder-registry');
  assert.doesNotMatch(JSON.stringify(store), /must-not-be-kept|preview_token|10\.0\.0\.8/);

  const retried = importService.applyImport({
    operationId: preview.operationId,
    previewToken: preview.previewToken
  });
  assert.equal(retried.alreadyApplied, true);
  assert.equal(boardStore.load().store.relationships.length, 5);
});

test('Coolify 观测预览拒绝过期、篡改和预览后变化的本机白板', async t => {
  let now = new Date('2026-08-27T12:00:00.000Z');
  const { directory, boardStore, importService } = setup({ now: () => now, previewTtlMs: 1000 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const connector = new CoolifyReadOnlyConnectorService({
    importService,
    registryProvider: () => ({ repos: [] }),
    now: () => now,
    requestJson: async request => fixtureResponse(request.url)
  });
  const preview = await connector.preview({ baseUrl: 'https://coolify.example.com', accessToken: FAKE_TOKEN });
  assert.throws(() => importService.applyImport({
    operationId: preview.operationId,
    previewToken: 'a'.repeat(64)
  }), /不匹配|失效/);

  const changed = boardStore.load().store;
  changed.boards.push({
    id: 'board_localchange',
    name: '本机修改',
    viewport: { x: 0, y: 0, zoom: 1 },
    view: { mode: 'full', projection: 'facts', query: '', entityType: 'all', environment: '', verification: 'all' },
    placements: []
  });
  changed.activeBoardId = 'board_localchange';
  boardStore.save(changed);
  assert.throws(() => importService.applyImport(preview), /白板已在预览后发生变化/);

  const nextPreview = await connector.preview({ baseUrl: 'https://coolify.example.com', accessToken: FAKE_TOKEN });
  now = new Date('2026-08-27T12:00:02.000Z');
  assert.throws(() => importService.applyImport(nextPreview), /已失效|已过期/);
});

test('Coolify 地址与令牌约束拒绝不安全来源，错误消息不会泄漏令牌', async () => {
  assert.equal(normalizeBaseUrl('https://coolify.example.com/').apiBaseUrl, 'https://coolify.example.com/api/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8000').apiBaseUrl, 'http://127.0.0.1:8000/api/v1');
  assert.throws(() => normalizeBaseUrl('http://coolify.example.com'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@coolify.example.com'), /不能包含凭据/);
  assert.throws(() => normalizeBaseUrl('https://coolify.example.com/api/v1?token=x'), /查询参数/);
  assert.throws(() => normalizeBaseUrl('https://coolify.example.com/admin'), /站点根地址/);
  assert.equal(normalizeAccessToken(` ${FAKE_TOKEN} `), FAKE_TOKEN);
  assert.throws(() => normalizeAccessToken('short'), /Token 无效/);
  assert.throws(() => normalizeAccessToken('42|has whitespace'), /Token 无效/);

  const connector = new CoolifyReadOnlyConnectorService({
    registryProvider: () => ({ repos: [] }),
    importService: { previewStore: () => { throw new Error('should not apply'); } },
    requestJson: async () => { throw new Error(`Bearer ${FAKE_TOKEN} ${FAKE_TOKEN}`); }
  });
  await assert.rejects(
    () => connector.preview({ baseUrl: 'https://coolify.example.com', accessToken: FAKE_TOKEN }),
    error => !String(error.message).includes(FAKE_TOKEN) && /已隐藏/.test(error.message)
  );
});

test('服务器资源读取并发不超过四个且只调用固定 GET 端点', async () => {
  const { directory, importService } = setup();
  const serverCount = 9;
  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const connector = new CoolifyReadOnlyConnectorService({
    importService,
    registryProvider: () => ({ repos: [] }),
    requestJson: async request => {
      const pathname = new URL(request.url).pathname;
      calls.push({ pathname, method: request.method });
      if (pathname === '/api/v1/servers') {
        return Array.from({ length: serverCount }, (_, index) => ({ uuid: `server-${index}`, name: `Server ${index}` }));
      }
      if (pathname === '/api/v1/applications') return [];
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 4));
      active -= 1;
      return [];
    }
  });
  try {
    await connector.preview({ baseUrl: 'https://coolify.example.com', accessToken: FAKE_TOKEN });
    assert.equal(calls.length, serverCount + 2);
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.ok(calls.every(call => /^\/api\/v1\/(?:servers(?:\/[a-z0-9_-]+\/resources)?|applications)$/.test(call.pathname)));
    assert.ok(maximumActive <= RESOURCE_CONCURRENCY);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP 传输固定使用 GET 与 Bearer，并拒绝重定向和非 JSON 响应', async t => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, authorization: request.headers.authorization, url: request.url });
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/ok', 'Content-Type': 'application/json' });
      response.end('{}');
      return;
    }
    if (request.url === '/text') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('not json');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  assert.deepEqual(await requestJson({ url: `${origin}/ok`, accessToken: FAKE_TOKEN }), { ok: true });
  await assert.rejects(() => requestJson({ url: `${origin}/redirect`, accessToken: FAKE_TOKEN }), /HTTP 302/);
  await assert.rejects(() => requestJson({ url: `${origin}/text`, accessToken: FAKE_TOKEN }), /未返回 JSON/);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(requests.every(request => request.authorization === `Bearer ${FAKE_TOKEN}`));
});
