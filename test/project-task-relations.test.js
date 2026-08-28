const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Relations = require('../src/renderer/scripts/projectTaskRelations');

function task(overrides = {}) {
  return {
    key: 'PRJ:TASK-1',
    projectId: 'PRJ',
    projectName: 'Project',
    taskId: 'TASK-1',
    title: 'Task One',
    status: '未开始',
    acceptanceTotal: 0,
    acceptancePassed: 0,
    predecessors: [],
    successors: [],
    ...overrides
  };
}

test('依赖验收工作台只显示存在依赖或验收事实的任务并支持项目与关键词筛选', () => {
  const tasks = [
    task({
      key: 'PRJ:TASK-A', taskId: 'TASK-A', title: 'Build API',
      successors: [{ taskKey: 'PRJ:TASK-B' }]
    }),
    task({
      key: 'PRJ:TASK-B', taskId: 'TASK-B', title: 'Deploy App',
      predecessors: [{ taskKey: 'PRJ:TASK-A' }], acceptanceTotal: 2, acceptancePassed: 1
    }),
    task({ key: 'OTHER:TASK-C', projectId: 'OTHER', projectName: 'Other', taskId: 'TASK-C', title: 'Unrelated' })
  ];

  assert.deepEqual(
    Relations.filterTasks(tasks, { projectId: 'PRJ', query: '' }).map(item => item.taskId),
    ['TASK-A', 'TASK-B']
  );
  assert.deepEqual(
    Relations.filterTasks(tasks, { projectId: 'all', query: 'deploy task-b' }).map(item => item.taskId),
    ['TASK-B']
  );
});

test('关系指标分别统计依赖、涉及任务、验收待处理和阻塞任务', () => {
  const tasks = [
    task({ key: 'PRJ:TASK-A', taskId: 'TASK-A', status: '阻塞', acceptanceTotal: 2, acceptancePassed: 1 }),
    task({ key: 'PRJ:TASK-B', taskId: 'TASK-B', acceptanceTotal: 3, acceptancePassed: 3 }),
    task({
      key: 'PRJ:TASK-C', taskId: 'TASK-C', status: '所有自动检查通过，待人工验收',
      acceptanceTotal: 1, acceptancePassed: 1
    }),
    task({ key: 'OTHER:TASK-C', projectId: 'OTHER', taskId: 'TASK-C', acceptanceTotal: 4, acceptancePassed: 0 })
  ];
  const dependencies = [
    { projectId: 'PRJ', predecessorTaskKey: 'PRJ:TASK-A', successorTaskKey: 'PRJ:TASK-B' },
    { projectId: 'OTHER', predecessorTaskKey: 'OTHER:TASK-C', successorTaskKey: 'OTHER:TASK-D' }
  ];

  assert.deepEqual(Relations.metrics(tasks, dependencies, 'PRJ'), {
    dependencyCount: 1,
    relatedTaskCount: 2,
    pendingAcceptanceCount: 2,
    blockedTaskCount: 1
  });
});

test('依赖关系与滞后天数使用明确的人类可读语义', () => {
  assert.equal(Relations.relationLabel('FS'), '完成 → 开始');
  assert.equal(Relations.relationLabel('SS'), '开始 → 开始');
  assert.equal(Relations.relationLabel('FF'), '完成 → 完成');
  assert.equal(Relations.relationLabel('SF'), '开始 → 完成');
  assert.equal(Relations.relationLabel('custom'), 'custom');
  assert.equal(Relations.lagLabel(0), '无滞后');
  assert.equal(Relations.lagLabel(2), '滞后 2 天');
  assert.equal(Relations.lagLabel(-1), '提前 1 天');
});

test('依赖验收模块在任务渲染器之前加载且视图可持久化', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'scripts', 'projectTasks.js'), 'utf8');

  assert.ok(html.indexOf('scripts/projectTaskRelations.js') < html.indexOf('scripts/projectTasks.js'));
  assert.match(app, /\['list', 'board', 'timeline', 'milestones', 'relations'\]/);
  assert.match(renderer, /data-task-view="relations"/);
  assert.match(renderer, /\['list', 'board', 'timeline', 'milestones', 'relations'\]/);
});
