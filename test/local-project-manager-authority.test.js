const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const AUTHORITY_SOURCE = process.env.GITFINDER_AUTHORITY_SOURCE || path.resolve(
  '/Volumes/project/开发中/工具/local-project-manager/scripts/gitfinder_authority.py'
);
const authorityTest = process.platform !== 'win32' && fs.existsSync(AUTHORITY_SOURCE)
  ? test
  : test.skip;

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function snapshotTree(root) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        visit(absolute);
      } else if (entry.isSymbolicLink()) {
        result[relative] = `symlink:${fs.readlinkSync(absolute)}`;
      } else {
        result[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      }
    }
  }
  visit(root);
  return result;
}

function createFixture(t, {
  pendingProposal = false,
  pendingField = 'status',
  pendingObjectType = 'task',
  pendingObjectId = 'TASK-ONE',
  pendingTaskProposal = false,
  projectionFails = false
} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-authority-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const connectorRoot = path.join(managedRoot, 'local-project-manager');
  const projectRoot = path.join(managedRoot, 'example-project');
  const adapterPath = path.join(connectorRoot, 'scripts', 'gitfinder_authority.py');
  fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
  fs.copyFileSync(AUTHORITY_SOURCE, adapterPath);
  write(
    path.join(connectorRoot, 'portfolio', 'projects.csv'),
    [
      'project_id,path,enabled,display_order,entry_url',
      `PRJ-ONE,${path.join(managedRoot, 'old', 'example-project')},true,1,/projects/PRJ-ONE/`
    ].join('\n') + '\n'
  );
  write(
    path.join(projectRoot, 'management', 'project.csv'),
    'project_id,name,delivery_type,objective,lifecycle,owner,start_date,target_date,updated_at\n' +
      'PRJ-ONE,Example,DT-SOFTWARE,Test safely,开发中,owner,2026-08-01,,2026-08-01T00:00:00+08:00\n'
  );
  write(
    path.join(projectRoot, 'management', 'schema.csv'),
    'schema_version,project_id,updated_at\n1.1,PRJ-ONE,2026-08-01T00:00:00+08:00\n'
  );
  write(
    path.join(projectRoot, 'management', 'stages.csv'),
    'stage_id,name,sequence,objective,start_date,target_date,status\n' +
      'STAGE-ONE,Build,1,Build it,2026-08-01,2026-09-01,已有活动但未达标\n'
  );
  write(
    path.join(projectRoot, 'management', 'milestones.csv'),
    'milestone_id,stage_id,name,target_date,status,acceptance_summary\n' +
      'MS-ONE,STAGE-ONE,First milestone,2026-08-31,已有活动但未达标,Ship safely\n'
  );
  write(
    path.join(projectRoot, 'management', 'tasks.csv'),
    'task_id,parent_task_id,stage_id,title,owner,start_date,target_date,status,priority,next_action,updated_at\n' +
      'TASK-ONE,,STAGE-ONE,First task,owner,2026-08-01,2026-08-20,已有活动但未达标,P0,Run checks,2026-08-01T00:00:00+08:00\n'
  );
  write(
    path.join(projectRoot, 'management', 'dependencies.csv'),
    'dependency_id,predecessor_id,successor_id,relation,lag_days\n'
  );
  write(
    path.join(projectRoot, 'management', 'activity.csv'),
    'activity_id,object_type,object_id,activity_type,summary,occurred_at,actor,evidence_id\n' +
      'ACT-BASE,project,PRJ-ONE,baseline,Created,2026-08-01T00:00:00+08:00,human,\n'
  );
  write(
    path.join(projectRoot, 'management', 'change_proposals.csv'),
    'proposal_id,object_type,object_id,field,current_value,proposed_value,reason,evidence_ids,confidence,status,created_at,resolved_at,resolved_by\n' +
      (pendingProposal
        ? `PROP-ONE,${pendingObjectType},${pendingObjectId},${pendingField},已有活动但未达标,部分验收条件通过,Review evidence,,高,待确认,2026-08-01T00:00:00+08:00,,\n`
        : '')
  );
  write(
    path.join(projectRoot, 'management', 'task_proposals.csv'),
    'proposal_id,task_id,stage_id,parent_task_id,title,owner,start_date,target_date,priority,next_action,reason,evidence_ids,confidence,status,created_at,resolved_at,resolved_by\n' +
      (pendingTaskProposal
        ? 'TPROP-ONE,TASK-GF-NEW,STAGE-ONE,,Pending task,AI,2026-08-02,2026-08-22,P1,Review it,Pending proposal,,中,待确认,2026-08-01T00:00:00+08:00,,\n'
        : '')
  );
  write(
    path.join(projectRoot, 'management', 'plan_changes.csv'),
    'change_id,plan_revision,object_type,object_id,object_name,field,previous_value,new_value,changed_at,actor\n'
  );
  write(
    path.join(projectRoot, 'cards', 'progress-overview', 'scripts', 'build.py'),
    [
      '#!/usr/bin/env python3',
      'import argparse, json',
      'from pathlib import Path',
      'parser = argparse.ArgumentParser()',
      'parser.add_argument("--project-root", required=True)',
      'args = parser.parse_args()',
      'root = Path(args.project_root)',
      ...(projectionFails ? ['raise RuntimeError("projection unavailable")'] : []),
      'task_text = (root / "management" / "tasks.csv").read_text(encoding="utf-8")',
      'output = root / "cards" / "progress-overview" / "data" / "data.json"',
      'output.parent.mkdir(parents=True, exist_ok=True)',
      'output.write_text(json.dumps({"tasks_csv": task_text}, ensure_ascii=False), encoding="utf-8")',
      'summary = root / "management" / "exports" / "progress-summary.json"',
      'summary.parent.mkdir(parents=True, exist_ok=True)',
      'summary.write_text(json.dumps({"project": {"project_id": "PRJ-ONE"}}), encoding="utf-8")'
    ].join('\n') + '\n'
  );
  return { tempRoot, managedRoot, connectorRoot, projectRoot, adapterPath };
}

function invoke(fixture, command, values = {}) {
  const args = [
    fixture.adapterPath,
    command,
    '--project-root', fixture.projectRoot,
    '--project-id', values.projectId || 'PRJ-ONE',
    '--task-id', values.taskId || 'TASK-ONE',
    '--current-status', values.currentStatus || '已有活动但未达标',
    '--target-status', values.targetStatus || '部分验收条件通过'
  ];
  if (command === 'apply-status') {
    args.push(
      '--revision', values.revision,
      '--preview-token', values.previewToken,
      '--operation-id', values.operationId || 'operation-12345678'
    );
  }
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  const output = (result.stdout || result.stderr).trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    assert.fail(`Authority returned invalid JSON (${result.status}): ${output}`);
  }
  return { ...result, payload };
}

function invokeUpdate(fixture, command, changes, values = {}) {
  const args = [
    fixture.adapterPath,
    command,
    '--project-root', fixture.projectRoot,
    '--project-id', values.projectId || 'PRJ-ONE',
    '--task-id', values.taskId || 'TASK-ONE',
    '--changes-json', JSON.stringify(changes)
  ];
  if (command === 'apply-task-update') {
    args.push(
      '--revision', values.revision,
      '--preview-token', values.previewToken,
      '--operation-id', values.operationId || 'operation-update-1234'
    );
  }
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  const output = (result.stdout || result.stderr).trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    assert.fail(`Authority returned invalid JSON (${result.status}): ${output}`);
  }
  return { ...result, payload };
}

function invokeCreate(fixture, command, task, values = {}) {
  const args = [
    fixture.adapterPath,
    command,
    '--project-root', fixture.projectRoot,
    '--project-id', values.projectId || 'PRJ-ONE',
    '--task-id', values.taskId || 'TASK-GF-NEW',
    '--task-json', JSON.stringify(task)
  ];
  if (command === 'apply-task-create') {
    args.push(
      '--revision', values.revision,
      '--preview-token', values.previewToken,
      '--operation-id', values.operationId || 'operation-create-1234'
    );
  }
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  const output = (result.stdout || result.stderr).trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    assert.fail(`Authority returned invalid JSON (${result.status}): ${output}`);
  }
  return { ...result, payload };
}

function invokeMilestoneUpdate(fixture, command, changes, values = {}) {
  const args = [
    fixture.adapterPath,
    command,
    '--project-root', fixture.projectRoot,
    '--project-id', values.projectId || 'PRJ-ONE',
    '--milestone-id', values.milestoneId || 'MS-ONE',
    '--changes-json', JSON.stringify(changes)
  ];
  if (command === 'apply-milestone-update') {
    args.push(
      '--revision', values.revision,
      '--preview-token', values.previewToken,
      '--operation-id', values.operationId || 'operation-milestone-1234'
    );
  }
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  const output = (result.stdout || result.stderr).trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    assert.fail(`Authority returned invalid JSON (${result.status}): ${output}`);
  }
  return { ...result, payload };
}

authorityTest('状态预览返回确定性差异、修订和令牌，且对项目目录绝对零写入', (t) => {
  const fixture = createFixture(t);
  const before = snapshotTree(fixture.tempRoot);
  const first = invoke(fixture, 'preview-status');
  const second = invoke(fixture, 'preview-status');

  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.payload.success, true);
  assert.equal(first.payload.mode, 'preview');
  assert.equal(first.payload.schema_version, 'gitfinder-authority/1');
  assert.equal(first.payload.task_id, 'TASK-ONE');
  assert.equal(first.payload.current_status, '已有活动但未达标');
  assert.equal(first.payload.target_status, '部分验收条件通过');
  assert.match(first.payload.revision, /^[a-f0-9]{16}$/);
  assert.match(first.payload.preview_token, /^[a-f0-9]{64}$/);
  assert.equal(second.payload.preview_token, first.payload.preview_token);
  assert.equal(first.payload.changes[0].field, 'status');
  assert.equal(first.payload.validations.every(item => item.passed), true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);
});

authorityTest('状态应用创建备份和投影，并以 operation id 保证重复请求幂等', (t) => {
  const fixture = createFixture(t);
  const preview = invoke(fixture, 'preview-status').payload;
  const applied = invoke(fixture, 'apply-status', {
    revision: preview.revision,
    previewToken: preview.preview_token
  });

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.payload.success, true);
  assert.equal(applied.payload.mode, 'apply');
  assert.equal(applied.payload.already_applied, false);
  assert.notEqual(applied.payload.revision, preview.revision);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'tasks.csv'), 'utf8'), /部分验收条件通过/);
  assert.equal(fs.readdirSync(path.join(fixture.projectRoot, 'management', 'backups')).length, 1);
  assert.equal(fs.existsSync(path.join(fixture.projectRoot, 'cards', 'progress-overview', 'data', 'data.json')), true);
  assert.equal(fs.existsSync(path.join(fixture.projectRoot, 'management', 'exports', 'progress-summary.json')), true);

  const beforeRetry = snapshotTree(fixture.tempRoot);
  const retried = invoke(fixture, 'apply-status', {
    revision: preview.revision,
    previewToken: preview.preview_token
  });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(retried.payload.already_applied, true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), beforeRetry);
});

authorityTest('过期修订和被篡改的预览令牌都会在写入前被拒绝', (t) => {
  const staleFixture = createFixture(t);
  const stalePreview = invoke(staleFixture, 'preview-status').payload;
  fs.appendFileSync(path.join(staleFixture.projectRoot, 'management', 'tasks.csv'), '\n');
  const afterExternalChange = snapshotTree(staleFixture.tempRoot);
  const stale = invoke(staleFixture, 'apply-status', {
    revision: stalePreview.revision,
    previewToken: stalePreview.preview_token
  });
  assert.notEqual(stale.status, 0);
  assert.equal(stale.payload.error_code, 'revision_conflict');
  assert.deepEqual(snapshotTree(staleFixture.tempRoot), afterExternalChange);

  const tokenFixture = createFixture(t);
  const tokenPreview = invoke(tokenFixture, 'preview-status').payload;
  const beforeTokenApply = snapshotTree(tokenFixture.tempRoot);
  const invalidToken = invoke(tokenFixture, 'apply-status', {
    revision: tokenPreview.revision,
    previewToken: '0'.repeat(64)
  });
  assert.notEqual(invalidToken.status, 0);
  assert.equal(invalidToken.payload.error_code, 'preview_mismatch');
  assert.deepEqual(snapshotTree(tokenFixture.tempRoot), beforeTokenApply);
});

authorityTest('待确认状态建议、项目身份不符和符号链接逃逸均被拒绝', (t) => {
  const pendingFixture = createFixture(t, { pendingProposal: true });
  const beforePending = snapshotTree(pendingFixture.tempRoot);
  const pending = invoke(pendingFixture, 'preview-status');
  assert.notEqual(pending.status, 0);
  assert.equal(pending.payload.error_code, 'pending_proposal');
  assert.deepEqual(snapshotTree(pendingFixture.tempRoot), beforePending);

  const mismatchFixture = createFixture(t);
  const mismatch = invoke(mismatchFixture, 'preview-status', { projectId: 'PRJ-TWO' });
  assert.notEqual(mismatch.status, 0);
  assert.equal(mismatch.payload.error_code, 'project_not_registered');

  const escapedFixture = createFixture(t);
  const outsideRoot = path.join(escapedFixture.tempRoot, 'outside', 'example-project');
  fs.mkdirSync(path.dirname(outsideRoot), { recursive: true });
  fs.renameSync(escapedFixture.projectRoot, outsideRoot);
  fs.symlinkSync(outsideRoot, escapedFixture.projectRoot);
  const escaped = invoke(escapedFixture, 'preview-status');
  assert.notEqual(escaped.status, 0);
  assert.equal(escaped.payload.error_code, 'unsafe_project_root');
});

authorityTest('任务字段预览只允许白名单字段、规范化差异，且保持项目树零写入', (t) => {
  const fixture = createFixture(t);
  const before = snapshotTree(fixture.tempRoot);
  const preview = invokeUpdate(fixture, 'preview-task-update', {
    title: ' Updated task ',
    owner: 'AI',
    start_date: '2026-08-02',
    target_date: '2026-08-21',
    priority: 'P1',
    next_action: ' Ship it '
  });

  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.payload.success, true);
  assert.equal(preview.payload.mode, 'preview');
  assert.equal(preview.payload.action, 'task_update');
  assert.equal(preview.payload.changes.length, 6);
  assert.equal(preview.payload.proposed_values.title, 'Updated task');
  assert.equal(preview.payload.proposed_values.next_action, 'Ship it');
  assert.equal(preview.payload.changes.find(change => change.field === 'owner').before, 'owner');
  assert.match(preview.payload.preview_token, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);

  const unknown = invokeUpdate(fixture, 'preview-task-update', { status: '已验收完成' });
  assert.notEqual(unknown.status, 0);
  assert.equal(unknown.payload.error_code, 'unsupported_field');
  const invalidDate = invokeUpdate(fixture, 'preview-task-update', { target_date: '2026-07-01' });
  assert.notEqual(invalidDate.status, 0);
  assert.equal(invalidDate.payload.error_code, 'invalid_date_range');
  const unchanged = invokeUpdate(fixture, 'preview-task-update', { title: 'First task' });
  assert.notEqual(unchanged.status, 0);
  assert.equal(unchanged.payload.error_code, 'no_changes');
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);
});

authorityTest('任务字段应用备份、审计并重建投影，重复 operation id 不会再次写入', (t) => {
  const fixture = createFixture(t);
  const changes = {
    title: 'Updated task',
    owner: 'AI',
    target_date: '2026-08-21',
    priority: 'P1',
    next_action: 'Ship it'
  };
  const preview = invokeUpdate(fixture, 'preview-task-update', changes).payload;
  const applied = invokeUpdate(fixture, 'apply-task-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.payload.success, true);
  assert.equal(applied.payload.action, 'task_update');
  assert.equal(applied.payload.already_applied, false);
  const taskRows = fs.readFileSync(path.join(fixture.projectRoot, 'management', 'tasks.csv'), 'utf8');
  assert.match(taskRows, /Updated task/);
  assert.match(taskRows, /Ship it/);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'activity.csv'), 'utf8'), /task_update/);
  assert.equal(fs.readdirSync(path.join(fixture.projectRoot, 'management', 'backups')).length, 1);
  assert.equal(fs.existsSync(path.join(fixture.projectRoot, 'cards', 'progress-overview', 'data', 'data.json')), true);

  const beforeRetry = snapshotTree(fixture.tempRoot);
  const retried = invokeUpdate(fixture, 'apply-task-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(retried.payload.already_applied, true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), beforeRetry);
});

authorityTest('任务字段写回在过期修订、篡改令牌和同字段待确认建议时零写入拒绝', (t) => {
  const staleFixture = createFixture(t);
  const changes = { next_action: 'New action' };
  const preview = invokeUpdate(staleFixture, 'preview-task-update', changes).payload;
  fs.appendFileSync(path.join(staleFixture.projectRoot, 'management', 'tasks.csv'), '\n');
  const afterExternalChange = snapshotTree(staleFixture.tempRoot);
  const stale = invokeUpdate(staleFixture, 'apply-task-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });
  assert.notEqual(stale.status, 0);
  assert.equal(stale.payload.error_code, 'revision_conflict');
  assert.deepEqual(snapshotTree(staleFixture.tempRoot), afterExternalChange);

  const tokenFixture = createFixture(t);
  const tokenPreview = invokeUpdate(tokenFixture, 'preview-task-update', changes).payload;
  const beforeToken = snapshotTree(tokenFixture.tempRoot);
  const token = invokeUpdate(tokenFixture, 'apply-task-update', changes, {
    revision: tokenPreview.revision,
    previewToken: '0'.repeat(64)
  });
  assert.notEqual(token.status, 0);
  assert.equal(token.payload.error_code, 'preview_mismatch');
  assert.deepEqual(snapshotTree(tokenFixture.tempRoot), beforeToken);

  const pendingFixture = createFixture(t, { pendingProposal: true, pendingField: 'next_action' });
  const beforePending = snapshotTree(pendingFixture.tempRoot);
  const pending = invokeUpdate(pendingFixture, 'preview-task-update', changes);
  assert.notEqual(pending.status, 0);
  assert.equal(pending.payload.error_code, 'pending_proposal');
  assert.deepEqual(snapshotTree(pendingFixture.tempRoot), beforePending);
});

authorityTest('任务字段写回在投影失败时恢复全部权威 CSV', (t) => {
  const fixture = createFixture(t, { projectionFails: true });
  const changes = { owner: 'AI', next_action: 'Retry after repair' };
  const preview = invokeUpdate(fixture, 'preview-task-update', changes).payload;
  const authorityFiles = ['tasks.csv', 'activity.csv', 'project.csv', 'schema.csv'];
  const before = Object.fromEntries(authorityFiles.map(file => [
    file,
    fs.readFileSync(path.join(fixture.projectRoot, 'management', file))
  ]));

  const applied = invokeUpdate(fixture, 'apply-task-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });

  assert.notEqual(applied.status, 0);
  assert.equal(applied.payload.error_code, 'projection_failed');
  for (const file of authorityFiles) {
    assert.deepEqual(
      fs.readFileSync(path.join(fixture.projectRoot, 'management', file)),
      before[file],
      `${file} should be restored byte-for-byte`
    );
  }
});

authorityTest('任务创建预览规范化默认值并校验阶段、父任务、ID 与待确认草案，且零写入', (t) => {
  const fixture = createFixture(t);
  const before = snapshotTree(fixture.tempRoot);
  const preview = invokeCreate(fixture, 'preview-task-create', {
    stage_id: 'STAGE-ONE',
    parent_task_id: 'TASK-ONE',
    title: ' New child task ',
    owner: '',
    start_date: '2026-08-03',
    target_date: '2026-08-22',
    priority: '',
    next_action: ' Start safely '
  });

  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.payload.success, true);
  assert.equal(preview.payload.action, 'task_create');
  assert.equal(preview.payload.task_id, 'TASK-GF-NEW');
  assert.equal(preview.payload.proposed_values.title, 'New child task');
  assert.equal(preview.payload.proposed_values.owner, '未分配');
  assert.equal(preview.payload.proposed_values.priority, 'P1');
  assert.equal(preview.payload.proposed_values.status, '未开始');
  assert.equal(preview.payload.changes.some(change => change.field === '__created__'), true);
  assert.match(preview.payload.preview_token, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);

  const invalidStage = invokeCreate(fixture, 'preview-task-create', {
    stage_id: 'STAGE-MISSING', title: 'Task'
  });
  assert.equal(invalidStage.payload.error_code, 'stage_not_found');
  const invalidParent = invokeCreate(fixture, 'preview-task-create', {
    stage_id: 'STAGE-ONE', parent_task_id: 'TASK-MISSING', title: 'Task'
  });
  assert.equal(invalidParent.payload.error_code, 'parent_task_not_found');
  const duplicate = invokeCreate(fixture, 'preview-task-create', {
    stage_id: 'STAGE-ONE', title: 'Task'
  }, { taskId: 'TASK-ONE' });
  assert.equal(duplicate.payload.error_code, 'task_already_exists');
  const invalidDate = invokeCreate(fixture, 'preview-task-create', {
    stage_id: 'STAGE-ONE', title: 'Task', start_date: '2026-08-22', target_date: '2026-08-03'
  });
  assert.equal(invalidDate.payload.error_code, 'invalid_date_range');
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);

  const pendingFixture = createFixture(t, { pendingTaskProposal: true });
  const beforePending = snapshotTree(pendingFixture.tempRoot);
  const pending = invokeCreate(pendingFixture, 'preview-task-create', {
    stage_id: 'STAGE-ONE', title: 'Task'
  });
  assert.equal(pending.payload.error_code, 'pending_task_proposal');
  assert.deepEqual(snapshotTree(pendingFixture.tempRoot), beforePending);
});

authorityTest('任务创建应用写入未开始任务、计划差异与审计，并保持 operation id 幂等', (t) => {
  const fixture = createFixture(t);
  const task = {
    stage_id: 'STAGE-ONE',
    parent_task_id: '',
    title: 'Created task',
    owner: 'AI',
    start_date: '2026-08-03',
    target_date: '2026-08-22',
    priority: 'P1',
    next_action: 'Run checks'
  };
  const preview = invokeCreate(fixture, 'preview-task-create', task).payload;
  const applied = invokeCreate(fixture, 'apply-task-create', task, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.payload.success, true);
  assert.equal(applied.payload.action, 'task_create');
  assert.equal(applied.payload.already_applied, false);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'tasks.csv'), 'utf8'), /TASK-GF-NEW.*Created task.*未开始/);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'plan_changes.csv'), 'utf8'), /TASK-GF-NEW.*__created__/);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'activity.csv'), 'utf8'), /task_created/);
  assert.equal(fs.readdirSync(path.join(fixture.projectRoot, 'management', 'backups')).length, 1);
  assert.equal(fs.existsSync(path.join(fixture.projectRoot, 'cards', 'progress-overview', 'data', 'data.json')), true);

  const beforeRetry = snapshotTree(fixture.tempRoot);
  const retried = invokeCreate(fixture, 'apply-task-create', task, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(retried.payload.already_applied, true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), beforeRetry);
});

authorityTest('任务创建在过期修订、篡改令牌和投影失败时拒绝或完整回滚', (t) => {
  const task = { stage_id: 'STAGE-ONE', title: 'Created task' };
  const staleFixture = createFixture(t);
  const stalePreview = invokeCreate(staleFixture, 'preview-task-create', task).payload;
  fs.appendFileSync(path.join(staleFixture.projectRoot, 'management', 'tasks.csv'), '\n');
  const afterExternalChange = snapshotTree(staleFixture.tempRoot);
  const stale = invokeCreate(staleFixture, 'apply-task-create', task, {
    revision: stalePreview.revision,
    previewToken: stalePreview.preview_token
  });
  assert.equal(stale.payload.error_code, 'revision_conflict');
  assert.deepEqual(snapshotTree(staleFixture.tempRoot), afterExternalChange);

  const tokenFixture = createFixture(t);
  const tokenPreview = invokeCreate(tokenFixture, 'preview-task-create', task).payload;
  const beforeToken = snapshotTree(tokenFixture.tempRoot);
  const token = invokeCreate(tokenFixture, 'apply-task-create', task, {
    revision: tokenPreview.revision,
    previewToken: '0'.repeat(64)
  });
  assert.equal(token.payload.error_code, 'preview_mismatch');
  assert.deepEqual(snapshotTree(tokenFixture.tempRoot), beforeToken);

  const rollbackFixture = createFixture(t, { projectionFails: true });
  const rollbackPreview = invokeCreate(rollbackFixture, 'preview-task-create', task).payload;
  const authorityFiles = ['tasks.csv', 'activity.csv', 'plan_changes.csv', 'project.csv', 'schema.csv'];
  const beforeRollback = Object.fromEntries(authorityFiles.map(file => [
    file,
    fs.readFileSync(path.join(rollbackFixture.projectRoot, 'management', file))
  ]));
  const rollback = invokeCreate(rollbackFixture, 'apply-task-create', task, {
    revision: rollbackPreview.revision,
    previewToken: rollbackPreview.preview_token
  });
  assert.equal(rollback.payload.error_code, 'projection_failed');
  for (const file of authorityFiles) {
    assert.deepEqual(
      fs.readFileSync(path.join(rollbackFixture.projectRoot, 'management', file)),
      beforeRollback[file]
    );
  }
});

authorityTest('里程碑预览规范化白名单差异并保持项目树绝对零写入', (t) => {
  const fixture = createFixture(t);
  const before = snapshotTree(fixture.tempRoot);
  const preview = invokeMilestoneUpdate(fixture, 'preview-milestone-update', {
    name: ' Updated milestone ',
    target_date: '2026-09-02',
    status: '所有自动检查通过，待人工验收',
    acceptance_summary: ' Checks passed; human acceptance remains. '
  });

  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.payload.success, true);
  assert.equal(preview.payload.action, 'milestone_update');
  assert.equal(preview.payload.milestone_id, 'MS-ONE');
  assert.equal(preview.payload.proposed_values.name, 'Updated milestone');
  assert.equal(preview.payload.changes.length, 4);
  assert.match(preview.payload.preview_token, /^[a-f0-9]{64}$/);
  assert.equal(preview.payload.validations.some(item => item.code === 'human-confirmation'), true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);

  const unsupported = invokeMilestoneUpdate(fixture, 'preview-milestone-update', { milestone_id: 'MS-TWO' });
  assert.equal(unsupported.payload.error_code, 'unsupported_field');
  const invalidStage = invokeMilestoneUpdate(fixture, 'preview-milestone-update', { stage_id: 'STAGE-MISSING' });
  assert.equal(invalidStage.payload.error_code, 'stage_not_found');
  const invalidStatus = invokeMilestoneUpdate(fixture, 'preview-milestone-update', { status: '完成' });
  assert.equal(invalidStatus.payload.error_code, 'invalid_status');
  assert.deepEqual(snapshotTree(fixture.tempRoot), before);
});

authorityTest('里程碑应用写入事实、逐字段计划差异和人工审计，并保持 operation id 幂等', (t) => {
  const fixture = createFixture(t);
  const changes = {
    name: 'Updated milestone',
    target_date: '2026-09-02',
    status: '所有自动检查通过，待人工验收',
    acceptance_summary: 'Human acceptance remains'
  };
  const preview = invokeMilestoneUpdate(fixture, 'preview-milestone-update', changes).payload;
  const applied = invokeMilestoneUpdate(fixture, 'apply-milestone-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });

  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.payload.success, true);
  assert.equal(applied.payload.action, 'milestone_update');
  assert.equal(applied.payload.already_applied, false);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'milestones.csv'), 'utf8'), /Updated milestone.*2026-09-02.*待人工验收/);
  const planChanges = fs.readFileSync(path.join(fixture.projectRoot, 'management', 'plan_changes.csv'), 'utf8');
  assert.match(planChanges, /milestone,MS-ONE,Updated milestone,name,First milestone,Updated milestone/);
  assert.match(planChanges, /milestone,MS-ONE,Updated milestone,status,已有活动但未达标,所有自动检查通过/);
  assert.match(fs.readFileSync(path.join(fixture.projectRoot, 'management', 'activity.csv'), 'utf8'), /milestone_update/);
  assert.equal(fs.readdirSync(path.join(fixture.projectRoot, 'management', 'backups')).length, 1);

  const beforeRetry = snapshotTree(fixture.tempRoot);
  const retried = invokeMilestoneUpdate(fixture, 'apply-milestone-update', changes, {
    revision: preview.revision,
    previewToken: preview.preview_token
  });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(retried.payload.already_applied, true);
  assert.deepEqual(snapshotTree(fixture.tempRoot), beforeRetry);
});

authorityTest('里程碑写回在过期修订、同字段待确认建议和投影失败时零写入拒绝或回滚', (t) => {
  const changes = { target_date: '2026-09-02' };
  const staleFixture = createFixture(t);
  const stalePreview = invokeMilestoneUpdate(staleFixture, 'preview-milestone-update', changes).payload;
  fs.appendFileSync(path.join(staleFixture.projectRoot, 'management', 'milestones.csv'), '\n');
  const afterExternalChange = snapshotTree(staleFixture.tempRoot);
  const stale = invokeMilestoneUpdate(staleFixture, 'apply-milestone-update', changes, {
    revision: stalePreview.revision,
    previewToken: stalePreview.preview_token
  });
  assert.equal(stale.payload.error_code, 'revision_conflict');
  assert.deepEqual(snapshotTree(staleFixture.tempRoot), afterExternalChange);

  const pendingFixture = createFixture(t, {
    pendingProposal: true,
    pendingObjectType: 'milestone',
    pendingObjectId: 'MS-ONE',
    pendingField: 'target_date'
  });
  const beforePending = snapshotTree(pendingFixture.tempRoot);
  const pending = invokeMilestoneUpdate(pendingFixture, 'preview-milestone-update', changes);
  assert.equal(pending.payload.error_code, 'pending_proposal');
  assert.deepEqual(snapshotTree(pendingFixture.tempRoot), beforePending);

  const rollbackFixture = createFixture(t, { projectionFails: true });
  const rollbackPreview = invokeMilestoneUpdate(rollbackFixture, 'preview-milestone-update', changes).payload;
  const authorityFiles = ['milestones.csv', 'activity.csv', 'plan_changes.csv', 'project.csv', 'schema.csv'];
  const beforeRollback = Object.fromEntries(authorityFiles.map(file => [
    file,
    fs.readFileSync(path.join(rollbackFixture.projectRoot, 'management', file))
  ]));
  const rollback = invokeMilestoneUpdate(rollbackFixture, 'apply-milestone-update', changes, {
    revision: rollbackPreview.revision,
    previewToken: rollbackPreview.preview_token
  });
  assert.equal(rollback.payload.error_code, 'projection_failed');
  for (const file of authorityFiles) {
    assert.deepEqual(
      fs.readFileSync(path.join(rollbackFixture.projectRoot, 'management', file)),
      beforeRollback[file]
    );
  }
});
