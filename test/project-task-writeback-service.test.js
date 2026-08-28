const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ProjectTaskWritebackService } = require('../src/main/services/projectTaskWritebackService');

function createFixture(t, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-writeback-service-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const connectorRoot = path.join(managedRoot, 'local-project-manager');
  const projectRoot = path.join(managedRoot, 'example-project');
  const adapterPath = path.join(connectorRoot, 'scripts', 'gitfinder_authority.py');
  fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(adapterPath, '# fixture\n');

  const task = {
    key: 'PRJ-ONE:TASK-ONE',
    projectId: 'PRJ-ONE',
    projectRoot,
    taskId: 'TASK-ONE',
    title: 'First task',
    owner: 'owner',
    startDate: '2026-08-01',
    targetDate: '2026-08-20',
    status: '已有活动但未达标',
    priority: 'P0',
    nextAction: 'Run checks',
    source: { authority: 'Local Project Manager', projectRoot }
  };
  const project = {
    projectId: 'PRJ-ONE',
    name: 'Example Project',
    projectRoot,
    stages: [{ stageId: 'STAGE-ONE', name: 'Build', sequence: 1 }],
    source: { authority: 'Local Project Manager', projectRoot }
  };
  const milestone = {
    key: 'PRJ-ONE:MS-ONE',
    projectId: 'PRJ-ONE',
    projectRoot,
    milestoneId: 'MS-ONE',
    stageId: 'STAGE-ONE',
    name: 'First milestone',
    targetDate: '2026-08-31',
    status: '已有活动但未达标',
    acceptanceSummary: 'Ship safely',
    source: { authority: 'Local Project Manager', projectRoot }
  };
  const projectionService = {
    calls: [],
    async getPortfolio(request) {
      this.calls.push(request);
      return {
        success: true,
        connector: { name: 'Local Project Manager', root: connectorRoot },
        projects: [project],
        tasks: [task],
        milestones: [milestone]
      };
    }
  };
  const configService = { getTreeRoots: () => [{ path: managedRoot, name: 'Managed' }] };
  const calls = [];
  const runAuthority = options.runAuthority || (async (file, args, settings) => {
    calls.push({ file, args, settings });
    const mode = args[0].startsWith('preview-') ? 'preview' : 'apply';
    const taskUpdate = args[0].endsWith('task-update');
    const taskCreate = args[0].endsWith('task-create');
    const milestoneUpdate = args[0].endsWith('milestone-update');
    return {
      stdout: JSON.stringify({
        success: true,
        schema_version: 'gitfinder-authority/1',
        mode,
        project_id: 'PRJ-ONE',
        project_root: projectRoot,
        task_id: taskCreate ? args[6] : 'TASK-ONE',
        milestone_id: milestoneUpdate ? 'MS-ONE' : undefined,
        action: taskUpdate
          ? 'task_update'
          : (taskCreate ? 'task_create' : (milestoneUpdate ? 'milestone_update' : undefined)),
        current_status: '已有活动但未达标',
        target_status: '部分验收条件通过',
        current_values: taskUpdate ? { owner: 'owner' } : undefined,
        proposed_values: milestoneUpdate
          ? { target_date: '2026-09-02', status: '所有自动检查通过，待人工验收' }
          : (taskUpdate
          ? { owner: 'AI' }
          : (taskCreate ? { stage_id: 'STAGE-ONE', title: 'Created task', status: '未开始' } : undefined)),
        revision: mode === 'preview' ? '1234567890abcdef' : 'fedcba0987654321',
        preview_token: mode === 'preview' ? 'a'.repeat(64) : undefined,
        already_applied: false,
        affected_files: ['management/tasks.csv']
      }),
      stderr: ''
    };
  });
  const service = new ProjectTaskWritebackService({
    projectionService,
    configService,
    runAuthority,
    createOperationId: () => 'operation-12345678'
  });
  return { tempRoot, managedRoot, connectorRoot, projectRoot, adapterPath, task, milestone, project, projectionService, calls, service };
}

test('预览只按任务键解析受管路径，并调用 LPM 自有适配器', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.previewStatusChange(
    'PRJ-ONE:TASK-ONE',
    '部分验收条件通过'
  );

  assert.equal(result.success, true);
  assert.equal(result.operation_id, 'operation-12345678');
  assert.equal(fixture.projectionService.calls[0].forceRefresh, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].file, fs.realpathSync.native(fixture.adapterPath));
  assert.deepEqual(fixture.calls[0].args, [
    'preview-status',
    '--project-root', fs.realpathSync.native(fixture.projectRoot),
    '--project-id', 'PRJ-ONE',
    '--task-id', 'TASK-ONE',
    '--current-status', '已有活动但未达标',
    '--target-status', '部分验收条件通过'
  ]);
  assert.equal(fixture.calls[0].settings.timeout, 15000);
});

test('应用只接受预览凭据，并将同一 operation id 交给权威适配器', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.applyStatusChange('PRJ-ONE:TASK-ONE', {
    currentStatus: '已有活动但未达标',
    targetStatus: '部分验收条件通过',
    revision: '1234567890abcdef',
    previewToken: 'a'.repeat(64),
    operationId: 'operation-12345678'
  });

  assert.equal(result.success, true);
  assert.equal(fixture.calls[0].args[0], 'apply-status');
  assert.deepEqual(fixture.calls[0].args.slice(-6), [
    '--revision', '1234567890abcdef',
    '--preview-token', 'a'.repeat(64),
    '--operation-id', 'operation-12345678'
  ]);
  assert.equal(fixture.calls[0].settings.timeout, 135000);
});

test('任务字段预览只发送白名单规范化值，并附加一次性 operation id', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.previewTaskUpdate('PRJ-ONE:TASK-ONE', {
    title: ' Updated task ',
    owner: ' AI ',
    start_date: '2026-08-02',
    target_date: '2026-08-21',
    priority: 'P1',
    next_action: ' Ship it '
  });

  assert.equal(result.success, true);
  assert.equal(result.operation_id, 'operation-12345678');
  assert.deepEqual(fixture.calls[0].args.slice(0, 7), [
    'preview-task-update',
    '--project-root', fs.realpathSync.native(fixture.projectRoot),
    '--project-id', 'PRJ-ONE',
    '--task-id', 'TASK-ONE'
  ]);
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), {
    title: 'Updated task',
    owner: 'AI',
    start_date: '2026-08-02',
    target_date: '2026-08-21',
    priority: 'P1',
    next_action: 'Ship it'
  });
  assert.equal(fixture.calls[0].settings.timeout, 15000);
});

test('任务字段应用绑定预览值与凭据，并拒绝越权或无效字段', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.applyTaskUpdate('PRJ-ONE:TASK-ONE', {
    changes: { owner: 'AI', next_action: 'Ship it' },
    revision: '1234567890abcdef',
    previewToken: 'a'.repeat(64),
    operationId: 'operation-12345678'
  });

  assert.equal(result.success, true);
  assert.equal(fixture.calls[0].args[0], 'apply-task-update');
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), { owner: 'AI', next_action: 'Ship it' });
  assert.deepEqual(fixture.calls[0].args.slice(-6), [
    '--revision', '1234567890abcdef',
    '--preview-token', 'a'.repeat(64),
    '--operation-id', 'operation-12345678'
  ]);
  assert.equal(fixture.calls[0].settings.timeout, 135000);

  await assert.rejects(
    () => fixture.service.previewTaskUpdate('PRJ-ONE:TASK-ONE', { status: '已验收完成' }),
    /不允许修改任务字段/
  );
  await assert.rejects(
    () => fixture.service.previewTaskUpdate('PRJ-ONE:TASK-ONE', { target_date: '2026-07-31' }),
    /目标日期不能早于开始日期/
  );
  await assert.rejects(
    () => fixture.service.applyTaskUpdate('PRJ-ONE:TASK-ONE', {
      changes: { owner: 'AI' }, revision: 'bad', previewToken: 'bad', operationId: 'bad'
    }),
    /预览凭据无效/
  );
});

test('任务创建由主进程生成稳定任务 ID，并只向所选权威项目发送规范化计划字段', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.previewTaskCreate('PRJ-ONE', {
    stage_id: 'STAGE-ONE',
    parent_task_id: 'TASK-ONE',
    title: ' Created task ',
    owner: '',
    start_date: '2026-08-02',
    target_date: '2026-08-22',
    priority: '',
    next_action: ' Start safely '
  });

  assert.equal(result.success, true);
  assert.equal(result.operation_id, 'operation-12345678');
  assert.match(result.task_id, /^TASK-GF-[A-F0-9]{20}$/);
  assert.deepEqual(fixture.calls[0].args.slice(0, 7), [
    'preview-task-create',
    '--project-root', fs.realpathSync.native(fixture.projectRoot),
    '--project-id', 'PRJ-ONE',
    '--task-id', result.task_id
  ]);
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), {
    stage_id: 'STAGE-ONE',
    parent_task_id: 'TASK-ONE',
    title: 'Created task',
    owner: '未分配',
    start_date: '2026-08-02',
    target_date: '2026-08-22',
    priority: 'P1',
    next_action: 'Start safely'
  });
});

test('任务创建应用绑定预览任务 ID、规范化值与 operation id，并拒绝无效引用', async (t) => {
  const fixture = createFixture(t);
  const taskId = `TASK-GF-${crypto.createHash('sha256').update('operation-12345678').digest('hex').slice(0, 20).toUpperCase()}`;
  const result = await fixture.service.applyTaskCreate('PRJ-ONE', {
    taskId,
    values: { stage_id: 'STAGE-ONE', title: 'Created task', status: '未开始' },
    revision: '1234567890abcdef',
    previewToken: 'a'.repeat(64),
    operationId: 'operation-12345678'
  });

  assert.equal(result.success, true);
  assert.equal(fixture.calls[0].args[0], 'apply-task-create');
  assert.equal(fixture.calls[0].args[6], taskId);
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), {
    stage_id: 'STAGE-ONE',
    parent_task_id: '',
    title: 'Created task',
    owner: '未分配',
    start_date: '',
    target_date: '',
    priority: 'P1',
    next_action: '',
    status: '未开始'
  });
  assert.deepEqual(fixture.calls[0].args.slice(-6), [
    '--revision', '1234567890abcdef',
    '--preview-token', 'a'.repeat(64),
    '--operation-id', 'operation-12345678'
  ]);

  await assert.rejects(
    () => fixture.service.previewTaskCreate('PRJ-ONE', { stage_id: 'STAGE-MISSING', title: 'Task' }),
    /阶段不存在/
  );
  await assert.rejects(
    () => fixture.service.previewTaskCreate('PRJ-ONE', {
      stage_id: 'STAGE-ONE', parent_task_id: 'TASK-MISSING', title: 'Task'
    }),
    /父任务不存在/
  );
  await assert.rejects(
    () => fixture.service.previewTaskCreate('PRJ-ONE', {
      stage_id: 'STAGE-ONE', title: 'Task', status: '已验收完成'
    }),
    /不允许指定初始状态/
  );
});

test('里程碑预览只按投影键解析权威对象并发送白名单规范化值', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.previewMilestoneUpdate('PRJ-ONE:MS-ONE', {
    name: ' Updated milestone ',
    target_date: '2026-09-02',
    status: '所有自动检查通过，待人工验收',
    acceptance_summary: ' Human acceptance remains '
  });

  assert.equal(result.success, true);
  assert.equal(result.operation_id, 'operation-12345678');
  assert.deepEqual(fixture.calls[0].args.slice(0, 7), [
    'preview-milestone-update',
    '--project-root', fs.realpathSync.native(fixture.projectRoot),
    '--project-id', 'PRJ-ONE',
    '--milestone-id', 'MS-ONE'
  ]);
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), {
    name: 'Updated milestone',
    target_date: '2026-09-02',
    status: '所有自动检查通过，待人工验收',
    acceptance_summary: 'Human acceptance remains'
  });
  assert.equal(fixture.calls[0].settings.timeout, 15000);
});

test('里程碑应用绑定预览差异与操作标识，并拒绝越权字段和伪造对象', async (t) => {
  const fixture = createFixture(t);
  const result = await fixture.service.applyMilestoneUpdate('PRJ-ONE:MS-ONE', {
    changes: { target_date: '2026-09-02', status: '所有自动检查通过，待人工验收' },
    revision: '1234567890abcdef',
    previewToken: 'a'.repeat(64),
    operationId: 'operation-12345678'
  });

  assert.equal(result.success, true);
  assert.equal(fixture.calls[0].args[0], 'apply-milestone-update');
  assert.deepEqual(JSON.parse(fixture.calls[0].args[8]), {
    target_date: '2026-09-02', status: '所有自动检查通过，待人工验收'
  });
  assert.deepEqual(fixture.calls[0].args.slice(-6), [
    '--revision', '1234567890abcdef',
    '--preview-token', 'a'.repeat(64),
    '--operation-id', 'operation-12345678'
  ]);
  assert.equal(fixture.calls[0].settings.timeout, 135000);

  await assert.rejects(
    () => fixture.service.previewMilestoneUpdate('PRJ-ONE:MS-ONE', { milestone_id: 'MS-TWO' }),
    /不允许修改里程碑字段/
  );
  await assert.rejects(
    () => fixture.service.previewMilestoneUpdate('PRJ-ONE:MS-ONE', { stage_id: 'STAGE-MISSING' }),
    /阶段不存在/
  );
  await assert.rejects(
    () => fixture.service.applyMilestoneUpdate('PRJ-ONE:MS-ONE', {
      changes: { target_date: '2026-09-02' }, revision: 'bad', previewToken: 'bad', operationId: 'bad'
    }),
    /预览凭据无效/
  );
  await assert.rejects(
    () => fixture.service.previewMilestoneUpdate('PRJ-ONE:MS-MISSING', { target_date: '2026-09-02' }),
    /里程碑已变化/
  );
});

test('拒绝非法状态、伪造预览凭据、适配器符号链接和项目路径逃逸', async (t) => {
  const invalid = createFixture(t);
  await assert.rejects(
    () => invalid.service.previewStatusChange('PRJ-ONE:TASK-ONE', '完成'),
    /状态不在 Local Project Manager 契约中/
  );

  await assert.rejects(
    () => invalid.service.applyStatusChange('PRJ-ONE:TASK-ONE', {
      currentStatus: '已有活动但未达标',
      targetStatus: '部分验收条件通过',
      revision: 'bad',
      previewToken: 'bad',
      operationId: 'bad'
    }),
    /预览凭据无效/
  );

  const symlinkAdapter = createFixture(t);
  const outsideAdapter = path.join(symlinkAdapter.tempRoot, 'outside.py');
  fs.writeFileSync(outsideAdapter, '# outside\n');
  fs.rmSync(symlinkAdapter.adapterPath);
  fs.symlinkSync(outsideAdapter, symlinkAdapter.adapterPath);
  await assert.rejects(
    () => symlinkAdapter.service.previewStatusChange('PRJ-ONE:TASK-ONE', '部分验收条件通过'),
    /权威适配器路径不安全/
  );

  const escapedProject = createFixture(t);
  const outsideProject = path.join(escapedProject.tempRoot, 'outside-project');
  fs.mkdirSync(outsideProject);
  escapedProject.task.projectRoot = outsideProject;
  escapedProject.task.source.projectRoot = outsideProject;
  await assert.rejects(
    () => escapedProject.service.previewStatusChange('PRJ-ONE:TASK-ONE', '部分验收条件通过'),
    /项目路径不在受管开发目录中/
  );
});

test('适配器失败以结构化结果返回，不丢失冲突原因', async (t) => {
  const fixture = createFixture(t, {
    runAuthority: async () => ({
      stdout: JSON.stringify({
        success: false,
        schema_version: 'gitfinder-authority/1',
        error_code: 'revision_conflict',
        error: 'project facts changed after preview'
      }),
      stderr: ''
    })
  });
  const result = await fixture.service.previewStatusChange('PRJ-ONE:TASK-ONE', '部分验收条件通过');
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'revision_conflict');
});
