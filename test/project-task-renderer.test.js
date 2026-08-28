const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ProjectTaskRelations = require('../src/renderer/scripts/projectTaskRelations');

function loadRenderer() {
  const AppState = {
    taskGitEvidenceByKey: new Map(),
    taskGitEvidenceLoading: new Set(),
    taskPortfolio: { projects: [], tasks: [], dependencies: [], milestones: [], timeline: [] },
    currentMode: 'tasks',
    selectedTaskKey: null,
    selectedMilestoneKey: null,
    taskViewMode: 'list',
    taskTimelineCategory: 'all',
    milestoneStatusFilter: 'open',
    taskTimelineScrollTop: 0,
    taskRelationScrollTop: 0,
    taskStatusPreview: null,
    taskStatusPreviewLoading: false,
    taskStatusApplying: false,
    taskEditTaskKey: null,
    taskEditDraft: null,
    taskEditPreview: null,
    taskEditStage: 'form',
    taskEditPreviewLoading: false,
    taskEditApplying: false,
    taskCreateDraft: null,
    taskCreatePreview: null,
    taskCreateStage: 'form',
    taskCreatePreviewLoading: false,
    taskCreateApplying: false,
    milestoneEditKey: null,
    milestoneEditDraft: null,
    milestoneEditPreview: null,
    milestoneEditStage: 'form',
    milestoneEditPreviewLoading: false,
    milestoneEditApplying: false,
    taskFilters: { projectId: 'all', status: 'open', priority: 'all', leafOnly: true }
  };
  const App = {
    escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'scripts', 'projectTasks.js'),
    'utf8'
  );
  vm.runInNewContext(source, { App, AppState, ProjectTaskRelations, console });
  return { App, AppState };
}

function evidenceRepository(overrides = {}) {
  return {
    success: true,
    name: 'Repo One',
    path: '/managed/repo-one',
    relation: 'evidence',
    git: {
      branch: 'main',
      overallStatus: 'dirty',
      ahead: 1,
      behind: 0,
      matchedCommits: [],
      recentCommits: [
        { hash: 'def5678', message: '<unsafe> maintenance', timestamp: 100, author: 'AI' }
      ],
      workingTree: {
        success: true,
        stagedCount: 0,
        unstagedCount: 1,
        conflictCount: 0,
        totalCount: 1,
        files: [{ path: 'src/<unsafe>.js', unstaged: true }]
      },
      ...overrides
    }
  };
}

test('任务详情明确区分强归因提交与未归因仓库活动', () => {
  const { App } = loadRenderer();
  const html = App.getTaskGitRepositoryEvidenceHtml(evidenceRepository(), 'TASK-42');

  assert.match(html, /明确关联提交/);
  assert.match(html, /近期仓库活动/);
  assert.match(html, /不能作为任务完成证明/);
  assert.match(html, /上下文，不归因/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test('显式关联提交显示归因来源，并从未归因活动中排除', () => {
  const { App } = loadRenderer();
  const matched = { hash: 'abc1234', message: 'TASK-42 done', timestamp: 100, author: 'AI', attribution: 'task-id' };
  const html = App.getTaskGitRepositoryEvidenceHtml(evidenceRepository({
    matchedCommits: [matched],
    recentCommits: [matched]
  }), 'TASK-42');

  assert.match(html, /任务 ID/);
  assert.match(html, /没有其他近期提交/);
});

test('渲染层只在 30 秒内复用 Git 实况缓存', () => {
  const { App } = loadRenderer();
  assert.equal(App.isProjectTaskGitEvidenceFresh({ generatedAt: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(App.isProjectTaskGitEvidenceFresh({ generatedAt: new Date(Date.now() - 31000).toISOString() }), false);
  assert.equal(App.isProjectTaskGitEvidenceFresh({}), false);
});

test('任务看板按权威状态排序并保留空列', () => {
  const { App } = loadRenderer();
  const tasks = [
    { key: 'P:T2', status: '阻塞', title: 'Blocked' },
    { key: 'P:T1', status: '未开始', title: 'Todo' },
    { key: 'P:T3', status: '自定义状态', title: 'Custom' }
  ];
  const columns = App.getProjectTaskBoardColumns(tasks);

  assert.equal(columns[0].status, '未开始');
  assert.equal(columns.find(column => column.status === '阻塞').tasks.length, 1);
  assert.equal(columns.some(column => column.status === '已有活动但未达标' && column.tasks.length === 0), true);
  assert.equal(columns.at(-1).status, '自定义状态');
  assert.equal(columns.some(column => column.status === '已验收完成'), false);
});

test('任务看板卡片展示准确状态、项目上下文和下一步', () => {
  const { App, AppState } = loadRenderer();
  AppState.selectedTaskKey = 'PRJ:TASK-1';
  const html = App.getProjectTaskBoardHtml([{
    key: 'PRJ:TASK-1',
    taskId: 'TASK-1',
    title: '<unsafe> task',
    projectName: 'Project One',
    stageName: 'Build',
    status: '未开始',
    statusTone: 'info',
    priority: 'P0',
    targetDate: '2026-09-01',
    overdue: false,
    nextAction: 'Run tests'
  }]);

  assert.match(html, /task-board-card selected/);
  assert.match(html, /Project One · Build/);
  assert.match(html, /Run tests/);
  assert.match(html, /2026-09-01/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; task/);
});

test('依赖验收视图展示权威关系、前后任务和验收门禁且不提供直接改写', () => {
  const { App } = loadRenderer();
  const dependencyTask = {
    key: 'PRJ:TASK-B', projectId: 'PRJ', projectName: '<unsafe> Project', projectRoot: '/managed/project',
    taskId: 'TASK-B', title: '<unsafe> Deploy', status: '部分验收条件通过', statusTone: 'warning',
    acceptanceTotal: 2, acceptancePassed: 1,
    acceptance: [
      { criterion: '<unsafe> tests', result: '通过', checkType: 'automatic', confirmedBy: 'tool' },
      { criterion: 'Human review', result: '待检查', checkType: 'manual', confirmedBy: '' }
    ],
    predecessors: [{
      taskKey: 'PRJ:TASK-A', taskId: 'TASK-A', title: '<unsafe> Build', status: '已有活动但未达标',
      statusTone: 'info', relation: 'FS', lagDays: 2
    }],
    successors: [],
    source: { authority: 'Local Project Manager', projectionPath: '/managed/data.json', generatedAt: '2026-08-01T00:00:00Z' }
  };

  const listHtml = App.getProjectTaskRelationsListHtml([dependencyTask]);
  const detailHtml = App.getProjectTaskRelationDetailHtml(dependencyTask);

  assert.match(listHtml, /data-task-key="PRJ:TASK-B"/);
  assert.match(listHtml, /前置 1/);
  assert.match(listHtml, /验收 1\/2/);
  assert.match(detailHtml, /执行门禁/);
  assert.match(detailHtml, /完成 → 开始/);
  assert.match(detailHtml, /滞后 2 天/);
  assert.match(detailHtml, /data-task-key="PRJ:TASK-A"/);
  assert.match(detailHtml, /Local Project Manager/);
  assert.match(detailHtml, /只读投影/);
  assert.doesNotMatch(detailHtml, /data-task-status-preview|data-task-edit/);
  assert.doesNotMatch(`${listHtml}${detailHtml}`, /<unsafe>/);
  assert.match(detailHtml, /&lt;unsafe&gt; tests/);
});

test('持久化时间线按项目、事件类型和关键词筛选', () => {
  const { App, AppState } = loadRenderer();
  AppState.taskPortfolio.timeline = [
    {
      key: 'PRJ-ONE:evidence:EVD-1', projectId: 'PRJ-ONE', projectName: 'Project One',
      category: 'activity', categories: ['activity', 'test'], type: 'test', summary: 'Test suite passed', taskTitle: 'Build feature',
      taskId: 'TASK-1', objectType: 'task', objectId: 'TASK-1', reference: 'test/'
    },
    {
      key: 'PRJ-TWO:activity:ACT-1', projectId: 'PRJ-TWO', projectName: 'Project Two',
      category: 'activity', type: 'plan_update', summary: 'Plan changed', objectType: 'project',
      objectId: 'PRJ-TWO'
    }
  ];
  AppState.taskFilters.projectId = 'PRJ-ONE';
  AppState.taskTimelineCategory = 'test';
  AppState.searchQuery = 'suite TASK-1';

  const filtered = App.getFilteredProjectTimeline();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].key, 'PRJ-ONE:evidence:EVD-1');

  AppState.searchQuery = 'missing';
  assert.equal(App.getFilteredProjectTimeline().length, 0);
});

test('持久化时间线按日期分组并转义权威投影内容', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskTimelineHtml([{
    id: 'EVD-1', key: 'PRJ-ONE:evidence:EVD-1', projectId: 'PRJ-ONE', projectName: '<unsafe> Project',
    category: 'test', kind: 'evidence', type: 'test', summary: '<unsafe> tests passed',
    timestamp: '2026-08-26T10:20:30+08:00', actor: '<tool>', status: '', detail: '',
    reference: 'test/<unsafe>.js', taskId: 'TASK-1', taskKey: 'PRJ-ONE:TASK-1',
    taskTitle: '<unsafe> task', objectType: 'task', objectId: 'TASK-1'
  }]);

  assert.match(html, /测试证据/);
  assert.match(html, /2026年8月26日/);
  assert.match(html, /data-task-timeline-open="PRJ-ONE:TASK-1"/);
  assert.match(html, /test\/&lt;unsafe&gt;\.js/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; tests passed/);
});

test('任务详情提供由 Local Project Manager 授权的状态推进入口', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskDetailHtml({
    key: 'PRJ-ONE:TASK-ONE',
    projectId: 'PRJ-ONE',
    projectName: 'Project One',
    projectRoot: '/managed/project-one',
    taskId: 'TASK-ONE',
    title: 'First task',
    status: '已有活动但未达标',
    statusTone: 'info',
    stageName: 'Build',
    priority: 'P0',
    owner: 'owner',
    startDate: '2026-08-01',
    targetDate: '2026-09-01',
    updatedAt: '2026-08-01T00:00:00Z',
    nextAction: 'Run checks',
    overdue: false,
    acceptanceTotal: 0,
    acceptancePassed: 0,
    acceptance: [],
    evidence: [],
    repositories: [],
    source: {
      authority: 'Local Project Manager',
      projectionPath: '/managed/project-one/cards/progress-overview/data/data.json',
      generatedAt: '2026-08-01T00:00:00Z'
    }
  });

  assert.match(html, /推进任务/);
  assert.match(html, /LPM 权威写回/);
  assert.match(html, /data-task-status-select="PRJ-ONE:TASK-ONE"/);
  assert.match(html, /data-task-status-preview="PRJ-ONE:TASK-ONE"/);
  assert.match(html, /data-task-edit="PRJ-ONE:TASK-ONE"/);
  assert.match(html, /data-task-create-child="PRJ-ONE:TASK-ONE"/);
  assert.match(html, /编辑任务/);
  assert.match(html, /先预览变更/);
  assert.doesNotMatch(html, />已有活动但未达标<\/option>/);
});

test('状态确认预览明确展示差异、校验和受影响文件，并转义外部内容', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskStatusPreviewHtml({
    authority: 'Local Project Manager',
    task_title: '<unsafe> task',
    task_id: 'TASK-ONE',
    current_status: '已有活动但未达标',
    target_status: '部分验收条件通过',
    revision: '1234567890abcdef',
    validations: [{ label: '<unsafe> validation', passed: true }],
    affected_files: ['management/<unsafe>.csv']
  });

  assert.match(html, /Local Project Manager/);
  assert.match(html, /已有活动但未达标/);
  assert.match(html, /部分验收条件通过/);
  assert.match(html, /自动备份/);
  assert.match(html, /1234567890abcdef/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test('任务编辑表单只暴露六个白名单字段并转义任务内容', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskEditFormHtml({
    taskId: 'TASK-ONE',
    title: '<unsafe> task',
    owner: 'owner',
    startDate: '2026-08-01',
    targetDate: '2026-08-20',
    priority: 'P1',
    nextAction: '<unsafe> action'
  });

  for (const field of ['title', 'owner', 'start_date', 'target_date', 'priority', 'next_action']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(html, /name="status"/);
  assert.doesNotMatch(html, /name="task_id"/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; task/);
  assert.match(html, /阶段、父任务、状态和任务 ID 不在本次编辑范围内/);
});

test('任务字段确认预览逐项展示差异并转义适配器内容', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskUpdatePreviewHtml({
    authority: 'Local Project Manager',
    task_title: '<unsafe> task',
    task_id: 'TASK-ONE',
    revision: '1234567890abcdef',
    changes: [{ label: '<unsafe> owner', field: 'owner', before: 'owner', after: '<AI>' }],
    validations: [{ label: '字段白名单', passed: true }],
    affected_files: ['management/<unsafe>.csv']
  });

  assert.match(html, /字段差异 · 1/);
  assert.match(html, /owner/);
  assert.match(html, /&lt;AI&gt;/);
  assert.match(html, /字段白名单/);
  assert.match(html, /自动备份/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test('任务创建表单使用权威项目阶段和可选父任务，不暴露任务 ID 或状态', () => {
  const { App, AppState } = loadRenderer();
  AppState.taskPortfolio = {
    projects: [{
      projectId: 'PRJ-ONE',
      name: '<unsafe> Project',
      stages: [{ stageId: 'STAGE-ONE', name: 'Build', sequence: 1 }]
    }],
    tasks: [{
      projectId: 'PRJ-ONE', taskId: 'TASK-PARENT', title: '<unsafe> Parent', stageId: 'STAGE-ONE'
    }]
  };
  const html = App.getProjectTaskCreateFormHtml({
    project_id: 'PRJ-ONE',
    stage_id: 'STAGE-ONE',
    parent_task_id: 'TASK-PARENT',
    title: 'New task',
    owner: 'AI',
    priority: 'P1'
  });

  for (const field of ['project_id', 'stage_id', 'parent_task_id', 'title', 'owner', 'start_date', 'target_date', 'priority', 'next_action']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(html, /name="task_id"/);
  assert.doesNotMatch(html, /name="status"/);
  assert.match(html, /初始状态固定为“未开始”/);
  assert.match(html, /TASK-PARENT/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test('任务创建确认预览隐藏内部创建标记并展示固定初始状态', () => {
  const { App } = loadRenderer();
  const html = App.getProjectTaskCreatePreviewHtml({
    authority: 'Local Project Manager',
    task_title: '<unsafe> task',
    task_id: 'TASK-GF-ONE',
    revision: '1234567890abcdef',
    changes: [
      { field: '__created__', label: '创建任务', before: '', after: '<unsafe> task' },
      { field: 'stage_id', label: '阶段', before: '', after: 'STAGE-ONE' },
      { field: 'status', label: '初始状态', before: '', after: '未开始' }
    ],
    validations: [{ label: '任务 ID 可用', passed: true }],
    affected_files: ['management/plan_changes.csv']
  });

  assert.match(html, /新任务字段 · 2/);
  assert.match(html, /未开始/);
  assert.match(html, /__created__ 计划差异/);
  assert.doesNotMatch(html, />创建任务</);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test('里程碑列表按项目、状态和关键词筛选，并转义正式计划内容', () => {
  const { App, AppState } = loadRenderer();
  AppState.taskPortfolio.milestones = [
    {
      key: 'PRJ-ONE:MS-ONE', projectId: 'PRJ-ONE', projectName: 'Project One',
      milestoneId: 'MS-ONE', stageId: 'STAGE-ONE', stageName: 'Build', name: '<unsafe> milestone',
      targetDate: '2026-08-31', status: '未开始', acceptanceSummary: 'Run tests', overdue: false
    },
    {
      key: 'PRJ-TWO:MS-TWO', projectId: 'PRJ-TWO', projectName: 'Project Two',
      milestoneId: 'MS-TWO', stageId: 'STAGE-TWO', stageName: 'Release', name: 'Completed',
      targetDate: '2026-08-01', status: '已验收完成', acceptanceSummary: 'Accepted', overdue: false
    }
  ];
  AppState.taskFilters.projectId = 'PRJ-ONE';
  AppState.milestoneStatusFilter = 'open';
  AppState.searchQuery = 'unsafe build';
  AppState.selectedMilestoneKey = 'PRJ-ONE:MS-ONE';

  const filtered = App.getFilteredProjectMilestones();
  assert.equal(filtered.length, 1);
  const html = App.getProjectMilestoneRowHtml(filtered[0]);
  assert.match(html, /milestone-row selected/);
  assert.match(html, /MS-ONE/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; milestone/);
});

test('里程碑详情明确人工验收边界并提供权威编辑入口', () => {
  const { App } = loadRenderer();
  const html = App.getProjectMilestoneDetailHtml({
    key: 'PRJ-ONE:MS-ONE', projectId: 'PRJ-ONE', projectName: 'Project One',
    projectRoot: '/managed/project-one', milestoneId: 'MS-ONE', stageId: 'STAGE-ONE',
    stageName: 'Build', name: 'First milestone', targetDate: '2026-08-31', status: '部分验收条件通过',
    statusTone: 'warning', acceptanceSummary: '<unsafe> human review', overdue: false, dueSoon: true,
    source: { authority: 'Local Project Manager', projectionPath: '/managed/data.json', generatedAt: '2026-08-01T00:00:00Z' }
  });

  assert.match(html, /正式计划/);
  assert.match(html, /data-milestone-edit="PRJ-ONE:MS-ONE"/);
  assert.match(html, /“已验收完成”是人工决定/);
  assert.match(html, /自动检查通过不会自动完成里程碑/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; human review/);
});

test('里程碑编辑表单只暴露五个白名单字段并锁定里程碑 ID', () => {
  const { App, AppState } = loadRenderer();
  AppState.taskPortfolio.projects = [{
    projectId: 'PRJ-ONE', stages: [{ stageId: 'STAGE-ONE', name: '<unsafe> Build' }]
  }];
  const html = App.getProjectMilestoneEditFormHtml({
    projectId: 'PRJ-ONE', milestoneId: 'MS-ONE', stageId: 'STAGE-ONE', name: '<unsafe> milestone',
    targetDate: '2026-08-31', status: '未开始', acceptanceSummary: 'Review'
  });

  for (const field of ['stage_id', 'name', 'target_date', 'status', 'acceptance_summary']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(html, /name="milestone_id"/);
  assert.match(html, /里程碑 ID 不可修改/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; milestone/);
});

test('里程碑确认预览逐项展示差异、人工确认与计划审计文件', () => {
  const { App } = loadRenderer();
  const html = App.getProjectMilestoneUpdatePreviewHtml({
    authority: 'Local Project Manager', milestone_name: '<unsafe> milestone', milestone_id: 'MS-ONE',
    revision: '1234567890abcdef',
    changes: [{ label: '状态', field: 'status', before: '未开始', after: '已验收完成' }],
    validations: [{ label: '应用前需要人工确认里程碑决定', passed: true }],
    affected_files: ['management/milestones.csv', 'management/plan_changes.csv']
  });

  assert.match(html, /里程碑计划差异 · 1/);
  assert.match(html, /未开始/);
  assert.match(html, /已验收完成/);
  assert.match(html, /应用前需要人工确认里程碑决定/);
  assert.match(html, /management\/plan_changes\.csv/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /&lt;unsafe&gt; milestone/);
});
