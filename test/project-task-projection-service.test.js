const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProjectTaskProjectionService,
  parseCsvRows
} = require('../src/main/services/projectTaskProjectionService');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createProjection(projectRoot, { projectId = 'PRJ-ONE', schemaVersion = '1.1', title = 'First task' } = {}) {
  writeJson(path.join(projectRoot, 'management/exports/progress-summary.json'), {
    schema_version: schemaVersion,
    generated_at: '2026-07-01T00:00:00Z',
    project: {
      project_id: projectId,
      name: 'Example Project',
      delivery_type: 'DT-SOFTWARE',
      lifecycle: '开发中',
      owner: 'owner',
      target_date: '2026-09-01',
      updated_at: '2026-07-01T00:00:00Z'
    },
    progress: {
      leaf_task_count: 1,
      accepted_task_count: 0,
      accepted_ratio: 0,
      status_counts: { '未开始': 1 },
      blocked_count: 0
    },
    schedule_health: { overdue_count: 0, due_soon_count: 1, total_alerts: 1 },
    capacity: { resource_count: 1, overloaded_resource_count: 0, unassigned_count: 0 }
  });
  writeJson(path.join(projectRoot, 'cards/progress-overview/data/data.json'), {
    project: [{ project_id: projectId, name: 'Example Project', lifecycle: '开发中', owner: 'owner' }],
    stages: [{
      stage_id: 'STAGE-1', name: 'Build', sequence: '1', status: '已有活动但未达标',
      start_date: '2026-07-01', target_date: '2026-08-30'
    }],
    milestones: [{
      milestone_id: 'MS-ONE', stage_id: 'STAGE-1', name: 'First milestone',
      target_date: '2026-08-18', status: '部分验收条件通过', acceptance_summary: 'Human review remains'
    }],
    tasks: [
      {
        task_id: 'TASK-PARENT', parent_task_id: '', stage_id: 'STAGE-1', title: 'Parent', owner: 'owner',
        start_date: '2026-07-01', target_date: '2026-08-30', status: '已有活动但未达标', priority: 'P0',
        next_action: 'Continue', updated_at: '2026-07-01T00:00:00Z'
      },
      {
        task_id: 'TASK-LEAF', parent_task_id: 'TASK-PARENT', stage_id: 'STAGE-1', title, owner: 'owner',
        start_date: '2026-07-02', target_date: '2026-08-20', status: '所有自动检查通过，待人工验收', priority: 'P1',
        next_action: 'Ask for acceptance', updated_at: '2026-07-02T00:00:00Z'
      }
    ],
    dependencies: [{
      dependency_id: 'DEP-PARENT-LEAF',
      predecessor_id: 'TASK-PARENT',
      successor_id: 'TASK-LEAF',
      relation: 'FS',
      lag_days: '2'
    }],
    acceptance: [
      {
        acceptance_id: 'AC-1', object_type: 'task', object_id: 'TASK-LEAF', criterion: 'Tests pass',
        check_type: 'automatic', result: '通过', evidence_id: 'EVD-1', checked_at: '2026-07-04T10:00:00Z'
      }
    ],
    evidence: [
      {
        evidence_id: 'EVD-1', object_type: 'task', object_id: 'TASK-LEAF', evidence_type: 'test',
        summary: 'Test suite passed', reference: 'test/', captured_at: '2026-07-04T09:59:00Z', captured_by: 'tool'
      },
      {
        evidence_id: 'EVD-ACTIVITY', object_type: 'task', object_id: 'TASK-LEAF', evidence_type: 'document',
        summary: 'Plan note', reference: 'CONTEXT.md', captured_at: '2026-07-05T10:00:00Z', captured_by: 'human'
      },
      {
        evidence_id: 'EVD-RUN', object_type: 'project', object_id: projectId, evidence_type: 'log',
        summary: 'Automation log', reference: 'logs/run.txt', captured_at: '2026-07-03T10:00:00Z', captured_by: 'tool'
      }
    ],
    activity: [{
      activity_id: 'ACT-1', object_type: 'task', object_id: 'TASK-LEAF', activity_type: 'plan_update',
      summary: 'Task plan updated', occurred_at: '2026-07-05T10:00:00Z', actor: 'human', evidence_id: 'EVD-ACTIVITY'
    }],
    runs: [{
      run_id: 'RUN-1', workflow_id: 'WF-CHECK', status: '已完成', approval_state: 'approved',
      triggered_at: '2026-07-02T10:00:00Z', finished_at: '', actor: 'human', error: ''
    }],
    run_steps: [{
      run_step_id: 'RUN-1-STEP-1', run_id: 'RUN-1', step_id: 'STEP-TEST', status: '已完成',
      started_at: '2026-07-03T09:59:00Z', finished_at: '2026-07-03T10:00:00Z',
      output_summary: 'Checks passed', evidence_id: 'EVD-RUN', error: ''
    }],
    repos: [{ repo_id: 'REPO-1', name: 'Repo', path: path.join(projectRoot, 'repo'), enabled: 'true' }],
    repo_task_links: [{ link_id: 'LINK-1', repo_id: 'REPO-1', task_id: 'TASK-LEAF', relation: 'evidence' }],
    meta: {
      project_root: '/old/location/example-project',
      generated_at: '2026-07-01T00:00:00Z',
      source: 'management/*.csv'
    }
  });
}

function createFixture(t, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-task-projection-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const connectorRoot = path.join(managedRoot, 'local-project-manager');
  const projectRoot = path.join(managedRoot, 'example-project');
  fs.mkdirSync(path.join(connectorRoot, 'portfolio'), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(connectorRoot, 'portfolio/projects.csv'),
    [
      'project_id,path,enabled,display_order,entry_url',
      `PRJ-ONE,${path.join(managedRoot, 'old', 'example-project')},true,1,/projects/PRJ-ONE/`,
      `PRJ-DISABLED,${path.join(managedRoot, 'disabled-project')},false,2,/disabled/`
    ].join('\n')
  );
  createProjection(projectRoot, options);
  const configService = {
    getTreeRoots: () => [{ path: managedRoot, name: 'Managed' }],
    get: key => key === 'localProjectManagerPath' ? connectorRoot : undefined,
    getRepos: () => ({ repos: [] })
  };
  return { tempRoot, managedRoot, connectorRoot, projectRoot, configService };
}

test('CSV 注册表解析支持引号、逗号和字段内换行', () => {
  const rows = parseCsvRows('id,title,notes\r\n1,"Alpha, Beta","line 1\nline 2"\r\n');
  assert.deepEqual(rows, [{ id: '1', title: 'Alpha, Beta', notes: 'line 1\nline 2' }]);
});

test('只读连接器重绑定过期路径并投影任务、验收、证据和仓库关系', async (t) => {
  const fixture = createFixture(t);
  const reboundRepoPath = path.join(fixture.managedRoot, 'deployed', 'repo');
  fs.mkdirSync(reboundRepoPath, { recursive: true });
  fixture.configService.getRepos = () => ({ repos: [{ name: 'Repo', path: reboundRepoPath }] });
  const service = new ProjectTaskProjectionService({
    configService: fixture.configService,
    now: () => new Date('2026-08-26T00:00:00Z')
  });

  const result = await service.getPortfolio();
  assert.equal(result.success, true, result.error);
  assert.equal(result.readOnly, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projectRoot, fixture.projectRoot);
  assert.equal(result.projects[0].pathRebound, true);
  assert.equal(result.projects[0].projectionStale, true);
  assert.deepEqual(result.projects[0].stages, [{
    stageId: 'STAGE-1',
    name: 'Build',
    sequence: 1,
    status: '已有活动但未达标',
    startDate: '2026-07-01',
    targetDate: '2026-08-30'
  }]);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.milestones.length, 1);
  assert.deepEqual(result.milestones[0], {
    key: 'PRJ-ONE:MS-ONE',
    projectId: 'PRJ-ONE',
    projectName: 'Example Project',
    projectRoot: fixture.projectRoot,
    milestoneId: 'MS-ONE',
    stageId: 'STAGE-1',
    stageName: 'Build',
    name: 'First milestone',
    targetDate: '2026-08-18',
    status: '部分验收条件通过',
    statusTone: 'warning',
    acceptanceSummary: 'Human review remains',
    overdue: true,
    dueSoon: false,
    source: result.milestones[0].source
  });
  assert.equal(result.milestones[0].source.readOnly, true);

  const parent = result.tasks.find(task => task.taskId === 'TASK-PARENT');
  const leaf = result.tasks.find(task => task.taskId === 'TASK-LEAF');
  assert.equal(parent.isLeaf, false);
  assert.equal(leaf.isLeaf, true);
  assert.equal(leaf.stageName, 'Build');
  assert.equal(leaf.acceptancePassed, 1);
  assert.equal(leaf.acceptanceTotal, 1);
  assert.equal(result.dependencies.length, 1);
  assert.deepEqual(result.dependencies[0], {
    key: 'PRJ-ONE:DEP-PARENT-LEAF',
    dependencyId: 'DEP-PARENT-LEAF',
    projectId: 'PRJ-ONE',
    projectName: 'Example Project',
    predecessorTaskKey: 'PRJ-ONE:TASK-PARENT',
    predecessorTaskId: 'TASK-PARENT',
    predecessorTitle: 'Parent',
    predecessorStatus: '已有活动但未达标',
    predecessorStatusTone: 'info',
    successorTaskKey: 'PRJ-ONE:TASK-LEAF',
    successorTaskId: 'TASK-LEAF',
    successorTitle: 'First task',
    successorStatus: '所有自动检查通过，待人工验收',
    successorStatusTone: 'warning',
    relation: 'FS',
    lagDays: 2,
    source: result.dependencies[0].source
  });
  assert.equal(parent.successors[0].taskKey, 'PRJ-ONE:TASK-LEAF');
  assert.equal(parent.successors[0].relation, 'FS');
  assert.equal(leaf.predecessors[0].taskKey, 'PRJ-ONE:TASK-PARENT');
  assert.equal(leaf.predecessors[0].lagDays, 2);
  assert.equal(leaf.evidence.length, 2);
  assert.equal(leaf.repositories[0].name, 'Repo');
  assert.equal(leaf.repositories[0].path, reboundRepoPath);
  assert.equal(leaf.repositories[0].available, true);
  assert.equal(leaf.repositories[0].pathRebound, true);
  assert.equal(leaf.source.readOnly, true);
  assert.match(leaf.source.projectionPath, /cards\/progress-overview\/data\/data\.json$/);
  assert.equal(result.timeline.length, 5);
  assert.deepEqual(result.timeline.map(event => event.kind), [
    'activity', 'acceptance', 'evidence', 'run_step', 'run'
  ]);
  assert.equal(result.timeline[0].taskKey, 'PRJ-ONE:TASK-LEAF');
  assert.equal(result.timeline[0].evidence.id, 'EVD-ACTIVITY');
  assert.deepEqual(result.timeline[0].categories, ['activity', 'evidence']);
  assert.equal(result.timeline.some(event => event.kind === 'evidence' && event.id === 'EVD-ACTIVITY'), false);
  assert.equal(result.timeline.some(event => event.kind === 'evidence' && event.id === 'EVD-RUN'), false);
  assert.equal(result.timeline.find(event => event.id === 'EVD-1').category, 'test');
  assert.equal(result.timeline.find(event => event.id === 'AC-1').status, '通过');
  assert.equal(result.timeline.every(event => event.source.readOnly), true);
  assert.equal(result.warnings.some(warning => warning.code === 'path-rebound'), true);
  assert.equal(result.warnings.some(warning => warning.code === 'projection-stale'), true);
});

test('缓存默认复用投影，强制刷新后读取新的任务事实', async (t) => {
  const fixture = createFixture(t);
  const service = new ProjectTaskProjectionService({ configService: fixture.configService });
  const first = await service.getPortfolio();
  assert.equal(first.tasks.find(task => task.taskId === 'TASK-LEAF').title, 'First task');

  createProjection(fixture.projectRoot, { title: 'Updated task' });
  const cached = await service.getPortfolio();
  const refreshed = await service.getPortfolio({ forceRefresh: true });
  assert.equal(cached.tasks.find(task => task.taskId === 'TASK-LEAF').title, 'First task');
  assert.equal(refreshed.tasks.find(task => task.taskId === 'TASK-LEAF').title, 'Updated task');
});

test('拒绝不兼容摘要版本与通过符号链接逃逸的项目投影', async (t) => {
  const incompatible = createFixture(t, { schemaVersion: '1.0' });
  const incompatibleResult = await new ProjectTaskProjectionService({ configService: incompatible.configService }).getPortfolio();
  assert.equal(incompatibleResult.projects.length, 0);
  assert.equal(incompatibleResult.warnings.some(warning => warning.code === 'invalid-project'), true);

  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-task-outside-'));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
  const escaped = createFixture(t);
  fs.rmSync(escaped.projectRoot, { recursive: true, force: true });
  createProjection(outsideRoot);
  fs.symlinkSync(outsideRoot, escaped.projectRoot);
  const escapedResult = await new ProjectTaskProjectionService({ configService: escaped.configService }).getPortfolio();
  assert.equal(escapedResult.projects.length, 0);
  assert.equal(escapedResult.warnings.some(warning => warning.code === 'invalid-project'), true);
});
