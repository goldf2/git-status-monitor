const test = require('node:test');
const assert = require('node:assert/strict');
const RelationshipGraphModel = require('../src/shared/relationshipGraphModel');

function validStore() {
  return {
    schemaVersion: 1,
    activeBoardId: 'board_12345678',
    entities: [
      { id: 'entity_project1', type: 'project', name: 'MES', refId: 'project_12345678-1234-4234-9234-123456789abc', details: {} },
      { id: 'entity_repo0001', type: 'repository', name: 'MES Repo', refId: 'r_123456789abc', details: {} },
      { id: 'entity_deploy01', type: 'deployment', name: 'Production', details: { environment: 'production' } },
      { id: 'entity_server01', type: 'server', name: 'Con01', details: { hostLabel: 'con01.internal' } }
    ],
    relationships: [
      { id: 'relationship_00000001', type: 'contains', sourceId: 'entity_project1', targetId: 'entity_repo0001' },
      { id: 'relationship_00000002', type: 'source_of', sourceId: 'entity_repo0001', targetId: 'entity_deploy01' },
      { id: 'relationship_00000003', type: 'runs_on', sourceId: 'entity_deploy01', targetId: 'entity_server01' }
    ],
    boards: [{
      id: 'board_12345678',
      name: '生产部署',
      viewport: { x: 20, y: 30, zoom: 1 },
      placements: [
        { entityId: 'entity_project1', x: 0, y: 0 },
        { entityId: 'entity_repo0001', x: 320, y: 0 },
        { entityId: 'entity_deploy01', x: 640, y: 0 },
        { entityId: 'entity_server01', x: 960, y: 0 }
      ]
    }]
  };
}

test('关系模型接受项目到仓库再到部署和服务器的受约束链路', () => {
  const normalized = RelationshipGraphModel.assertValidStore(validStore());
  assert.equal(normalized.relationships.length, 3);
  assert.equal(normalized.boards[0].placements.length, 4);
  assert.deepEqual(normalized.boards[0].view, RelationshipGraphModel.defaultBoardView());
});

test('白板视图配置保存筛选和精简模式并兼容旧数据', () => {
  const store = validStore();
  store.boards[0].view = {
    mode: 'compact',
    projection: 'deployment-summary',
    query: 'MES production',
    entityType: 'deployment',
    environment: 'production',
    verification: 'stale'
  };

  const normalized = RelationshipGraphModel.assertValidStore(store);

  assert.deepEqual(normalized.boards[0].view, store.boards[0].view);
});

test('白板视图配置拒绝未知模式、筛选枚举和额外字段', () => {
  const store = validStore();
  store.boards[0].view = {
    mode: 'dense',
    projection: 'guessed-runtime',
    query: '',
    entityType: 'folder',
    environment: '',
    verification: 'trusted',
    hiddenFact: true
  };

  assert.throws(
    () => RelationshipGraphModel.assertValidStore(store),
    /mode 无效|entityType 无效|verification 无效|不是允许的字段/
  );
});

test('关系模型拒绝不符合类型方向的连线', () => {
  const store = validStore();
  store.relationships[0] = {
    id: 'relationship_00000009',
    type: 'runs_on',
    sourceId: 'entity_server01',
    targetId: 'entity_deploy01'
  };
  assert.throws(
    () => RelationshipGraphModel.assertValidStore(store),
    /不允许 server 通过 runs_on 连接到 deployment/
  );
});

test('关系模型不允许路径字段和服务器凭据进入持久化数据', () => {
  const store = validStore();
  store.entities[0].path = '/Volumes/project/secret';
  store.entities[3].details.password = 'do-not-store';
  assert.throws(() => RelationshipGraphModel.assertValidStore(store), /不是允许的字段|敏感信息/);
});

test('关系模型拒绝重复引用和悬空布局', () => {
  const duplicate = validStore();
  duplicate.entities.push({
    id: 'entity_project2',
    type: 'project',
    name: 'MES duplicate',
    refId: duplicate.entities[0].refId,
    details: {}
  });
  assert.throws(() => RelationshipGraphModel.assertValidStore(duplicate), /重复引用/);

  const dangling = validStore();
  dangling.boards[0].placements.push({ entityId: 'entity_missing1', x: 10, y: 10 });
  assert.throws(() => RelationshipGraphModel.assertValidStore(dangling), /不存在的节点/);
});

test('事实来源和验证时间使用受控值并规范化为 ISO 时间', () => {
  const store = validStore();
  store.relationships[2].source = 'observed';
  store.relationships[2].verifiedAt = '2026-08-27T14:30:00+08:00';
  store.relationships[2].evidenceSummary = '只读检查部署状态';

  const normalized = RelationshipGraphModel.assertValidStore(store);

  assert.equal(normalized.relationships[2].source, 'observed');
  assert.equal(normalized.relationships[2].verifiedAt, '2026-08-27T06:30:00.000Z');
  assert.equal(normalized.relationships[2].evidenceSummary, '只读检查部署状态');
});

test('关系模型拒绝伪造来源和无时区验证时间', () => {
  const invalidSource = validStore();
  invalidSource.relationships[0].source = 'auto-trusted';
  assert.throws(() => RelationshipGraphModel.assertValidStore(invalidSource), /不是允许的事实来源/);

  const invalidTime = validStore();
  invalidTime.relationships[0].verifiedAt = '2026-08-27 14:30';
  assert.throws(() => RelationshipGraphModel.assertValidStore(invalidTime), /带时区的 ISO 时间/);
});

test('事实核验状态明确区分待验证、已验证和超过三十天待复核', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  assert.equal(RelationshipGraphModel.verificationStatus({}, { now }).state, 'unverified');
  assert.equal(RelationshipGraphModel.verificationStatus({
    verifiedAt: '2026-08-20T12:00:00.000Z'
  }, { now }).state, 'verified');
  const stale = RelationshipGraphModel.verificationStatus({
    verifiedAt: '2026-07-01T12:00:00.000Z'
  }, { now });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.label, '待复核');
  assert.ok(stale.ageDays > RelationshipGraphModel.VERIFICATION_STALE_DAYS);
});

test('单条事实可覆盖默认复核周期并保持整数天边界', () => {
  const store = validStore();
  store.entities[3].verifiedAt = '2026-08-20T12:00:00.000Z';
  store.entities[3].reviewIntervalDays = 7;
  store.relationships[0].verifiedAt = '2026-08-20T12:00:00.000Z';
  store.relationships[0].reviewIntervalDays = 90;

  const normalized = RelationshipGraphModel.assertValidStore(store);
  const now = new Date('2026-08-28T12:00:00.000Z');

  assert.equal(normalized.entities[3].reviewIntervalDays, 7);
  assert.equal(normalized.relationships[0].reviewIntervalDays, 90);
  assert.equal(RelationshipGraphModel.verificationStatus(normalized.entities[3], { now }).state, 'stale');
  assert.equal(RelationshipGraphModel.verificationStatus(normalized.entities[3], { now }).maxAgeDays, 7);
  assert.equal(RelationshipGraphModel.verificationStatus(normalized.relationships[0], { now }).state, 'verified');

  for (const invalidValue of [0, 3651, 7.5, '7']) {
    const invalid = validStore();
    invalid.entities[3].reviewIntervalDays = invalidValue;
    assert.throws(
      () => RelationshipGraphModel.assertValidStore(invalid),
      /reviewIntervalDays 必须是 1 到 3650 之间的整数天数/
    );
  }
});
