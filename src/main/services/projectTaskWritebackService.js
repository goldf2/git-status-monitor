const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const configService = require('./configService');
const projectTaskProjectionService = require('./projectTaskProjectionService');

const AUTHORITY_SCHEMA_VERSION = 'gitfinder-authority/1';
const STATUSES = new Set([
  '未开始',
  '已有活动但未达标',
  '部分验收条件通过',
  '所有自动检查通过，待人工验收',
  '已验收完成',
  '阻塞',
  '无法判定'
]);
const REVISION_PATTERN = /^[a-f0-9]{16}$/;
const PREVIEW_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;
const TASK_ID_PATTERN = /^TASK-[A-Z0-9][A-Z0-9-]{1,63}$/;
const MILESTONE_ID_PATTERN = /^MS-[A-Z0-9][A-Z0-9-]{1,63}$/;
const PRIORITY_PATTERN = /^P[0-9]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE_TASK_FIELDS = new Set([
  'title',
  'owner',
  'start_date',
  'target_date',
  'priority',
  'next_action'
]);
const TASK_CREATE_FIELDS = new Set([
  'stage_id',
  'parent_task_id',
  'title',
  'owner',
  'start_date',
  'target_date',
  'priority',
  'next_action',
  'status'
]);
const EDITABLE_MILESTONE_FIELDS = new Set([
  'stage_id',
  'name',
  'target_date',
  'status',
  'acceptance_summary'
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;

function defaultRunAuthority(adapterPath, args, options) {
  return new Promise((resolve, reject) => {
    execFile('python3', [adapterPath, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: options.timeout,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error && !String(stdout || '').trim()) {
        const detail = String(stderr || error.message || error).trim();
        reject(new Error(`Local Project Manager 权威适配器执行失败：${detail}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: error?.code || 0 });
    });
  });
}

class ProjectTaskWritebackService {
  constructor(options = {}) {
    this.projectionService = options.projectionService || projectTaskProjectionService;
    this.configService = options.configService || configService;
    this.runAuthority = options.runAuthority || defaultRunAuthority;
    this.createOperationId = options.createOperationId || (() => crypto.randomUUID());
  }

  async previewStatusChange(taskKey, targetStatus) {
    this._assertStatus(targetStatus);
    const located = await this._locateTask(taskKey);
    if (located.task.status === targetStatus) throw new Error('目标状态与当前状态相同');
    const args = this._baseArgs(located.task, targetStatus, located.projectRoot);
    const payload = await this._invoke(located.adapterPath, ['preview-status', ...args], 15000);
    if (payload.success) payload.operation_id = this.createOperationId();
    return payload;
  }

  async applyStatusChange(taskKey, request = {}) {
    this._assertStatus(request.currentStatus);
    this._assertStatus(request.targetStatus);
    if (
      !REVISION_PATTERN.test(String(request.revision || ''))
      || !PREVIEW_TOKEN_PATTERN.test(String(request.previewToken || ''))
      || !OPERATION_ID_PATTERN.test(String(request.operationId || ''))
    ) {
      throw new Error('预览凭据无效，请重新预览任务状态变更');
    }
    const located = await this._locateTask(taskKey);
    const args = [
      ...this._baseArgs({ ...located.task, status: request.currentStatus }, request.targetStatus, located.projectRoot),
      '--revision', request.revision,
      '--preview-token', request.previewToken,
      '--operation-id', request.operationId
    ];
    return this._invoke(located.adapterPath, ['apply-status', ...args], 135000);
  }

  async previewTaskUpdate(taskKey, changes = {}) {
    const located = await this._locateTask(taskKey);
    const normalized = this._normalizeTaskChanges(changes, located.task);
    const args = [
      ...this._projectArgs(located.task, located.projectRoot),
      '--changes-json', JSON.stringify(normalized)
    ];
    const payload = await this._invoke(located.adapterPath, ['preview-task-update', ...args], 15000);
    if (payload.success) payload.operation_id = this.createOperationId();
    return payload;
  }

  async applyTaskUpdate(taskKey, request = {}) {
    if (
      !REVISION_PATTERN.test(String(request.revision || ''))
      || !PREVIEW_TOKEN_PATTERN.test(String(request.previewToken || ''))
      || !OPERATION_ID_PATTERN.test(String(request.operationId || ''))
    ) {
      throw new Error('预览凭据无效，请重新预览任务字段变更');
    }
    const located = await this._locateTask(taskKey);
    const normalized = this._normalizeTaskChanges(request.changes, located.task);
    const args = [
      ...this._projectArgs(located.task, located.projectRoot),
      '--changes-json', JSON.stringify(normalized),
      '--revision', request.revision,
      '--preview-token', request.previewToken,
      '--operation-id', request.operationId
    ];
    return this._invoke(located.adapterPath, ['apply-task-update', ...args], 135000);
  }

  async previewMilestoneUpdate(milestoneKey, changes = {}) {
    const located = await this._locateMilestone(milestoneKey);
    const normalized = this._normalizeMilestoneChanges(changes, located.project);
    const args = [
      ...this._milestoneProjectArgs(located.milestone, located.projectRoot),
      '--changes-json', JSON.stringify(normalized)
    ];
    const payload = await this._invoke(located.adapterPath, ['preview-milestone-update', ...args], 15000);
    if (payload.success) payload.operation_id = this.createOperationId();
    return payload;
  }

  async applyMilestoneUpdate(milestoneKey, request = {}) {
    if (
      !REVISION_PATTERN.test(String(request.revision || ''))
      || !PREVIEW_TOKEN_PATTERN.test(String(request.previewToken || ''))
      || !OPERATION_ID_PATTERN.test(String(request.operationId || ''))
    ) {
      throw new Error('预览凭据无效，请重新预览里程碑变更');
    }
    const located = await this._locateMilestone(milestoneKey);
    const normalized = this._normalizeMilestoneChanges(request.changes, located.project);
    const args = [
      ...this._milestoneProjectArgs(located.milestone, located.projectRoot),
      '--changes-json', JSON.stringify(normalized),
      '--revision', request.revision,
      '--preview-token', request.previewToken,
      '--operation-id', request.operationId
    ];
    return this._invoke(located.adapterPath, ['apply-milestone-update', ...args], 135000);
  }

  async previewTaskCreate(projectId, values = {}) {
    const located = await this._locateProject(projectId);
    const normalized = this._normalizeTaskCreate(values, located.project, located.tasks, false);
    const operationId = this.createOperationId();
    if (!OPERATION_ID_PATTERN.test(String(operationId || ''))) {
      throw new Error('无法生成安全的任务创建操作标识');
    }
    const taskId = this._taskIdForOperation(operationId);
    const args = [
      ...this._projectArgs({ projectId: located.project.projectId, taskId }, located.projectRoot),
      '--task-json', JSON.stringify(normalized)
    ];
    const payload = await this._invoke(located.adapterPath, ['preview-task-create', ...args], 15000);
    if (payload.success) {
      if (payload.task_id !== taskId) throw new Error('权威适配器返回了不匹配的任务 ID');
      payload.operation_id = operationId;
    }
    return payload;
  }

  async applyTaskCreate(projectId, request = {}) {
    if (
      !TASK_ID_PATTERN.test(String(request.taskId || ''))
      || !REVISION_PATTERN.test(String(request.revision || ''))
      || !PREVIEW_TOKEN_PATTERN.test(String(request.previewToken || ''))
      || !OPERATION_ID_PATTERN.test(String(request.operationId || ''))
    ) {
      throw new Error('预览凭据无效，请重新预览任务创建');
    }
    const expectedTaskId = this._taskIdForOperation(request.operationId);
    if (request.taskId !== expectedTaskId) throw new Error('任务 ID 与创建操作不匹配，请重新预览');
    const located = await this._locateProject(projectId);
    const normalized = this._normalizeTaskCreate(request.values, located.project, located.tasks, true);
    const args = [
      ...this._projectArgs({ projectId: located.project.projectId, taskId: request.taskId }, located.projectRoot),
      '--task-json', JSON.stringify(normalized),
      '--revision', request.revision,
      '--preview-token', request.previewToken,
      '--operation-id', request.operationId
    ];
    return this._invoke(located.adapterPath, ['apply-task-create', ...args], 135000);
  }

  _assertStatus(status) {
    if (!STATUSES.has(String(status || ''))) {
      throw new Error('状态不在 Local Project Manager 契约中');
    }
  }

  _baseArgs(task, targetStatus, projectRoot) {
    return [
      ...this._projectArgs(task, projectRoot),
      '--current-status', task.status,
      '--target-status', targetStatus
    ];
  }

  _projectArgs(task, projectRoot) {
    return [
      '--project-root', projectRoot,
      '--project-id', task.projectId,
      '--task-id', task.taskId
    ];
  }

  _milestoneProjectArgs(milestone, projectRoot) {
    return [
      '--project-root', projectRoot,
      '--project-id', milestone.projectId,
      '--milestone-id', milestone.milestoneId
    ];
  }

  _normalizeMilestoneChanges(changes, project) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('里程碑字段变更必须是对象');
    }
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new Error('至少需要修改一个里程碑字段');
    const unsupported = keys.filter(field => !EDITABLE_MILESTONE_FIELDS.has(field));
    if (unsupported.length > 0) throw new Error(`不允许修改里程碑字段：${unsupported.join('、')}`);

    const normalized = {};
    for (const field of keys) {
      const value = changes[field];
      if (typeof value !== 'string') throw new Error(`里程碑字段 ${field} 必须是文本`);
      normalized[field] = value.trim();
    }
    if ('stage_id' in normalized && !(project?.stages || []).some(stage => stage.stageId === normalized.stage_id)) {
      throw new Error('所选阶段不存在，请重读里程碑投影');
    }
    if ('name' in normalized && (
      normalized.name.length < 1
      || normalized.name.length > 240
      || /[\r\n\0]/.test(normalized.name)
    )) throw new Error('里程碑名称必须是 1–240 个字符的单行文本');
    if ('target_date' in normalized && normalized.target_date && !DATE_PATTERN.test(normalized.target_date)) {
      throw new Error('里程碑日期必须使用 YYYY-MM-DD');
    }
    if ('status' in normalized) this._assertStatus(normalized.status);
    if ('acceptance_summary' in normalized && (
      normalized.acceptance_summary.length > 2000
      || normalized.acceptance_summary.includes('\0')
    )) throw new Error('验收摘要不能超过 2000 个字符');
    return normalized;
  }

  _normalizeTaskChanges(changes, task) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new Error('任务字段变更必须是对象');
    }
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new Error('至少需要修改一个任务字段');
    const unsupported = keys.filter(field => !EDITABLE_TASK_FIELDS.has(field));
    if (unsupported.length > 0) throw new Error(`不允许修改任务字段：${unsupported.join('、')}`);

    const normalized = {};
    for (const field of keys) {
      const value = changes[field];
      if (typeof value !== 'string') throw new Error(`任务字段 ${field} 必须是文本`);
      normalized[field] = value.trim();
    }
    if ('title' in normalized && (
      normalized.title.length < 1
      || normalized.title.length > 240
      || /[\r\n\0]/.test(normalized.title)
    )) throw new Error('任务标题必须是 1–240 个字符的单行文本');
    if ('owner' in normalized && (
      normalized.owner.length < 1
      || normalized.owner.length > 120
      || /[\r\n\0]/.test(normalized.owner)
    )) throw new Error('负责人必须是 1–120 个字符的单行文本');
    if ('priority' in normalized && !PRIORITY_PATTERN.test(normalized.priority)) {
      throw new Error('优先级必须是 P0–P9');
    }
    if ('next_action' in normalized && (
      normalized.next_action.length > 2000
      || normalized.next_action.includes('\0')
    )) throw new Error('下一步行动不能超过 2000 个字符');

    for (const field of ['start_date', 'target_date']) {
      if (field in normalized && normalized[field] && !DATE_PATTERN.test(normalized[field])) {
        throw new Error('任务日期必须使用 YYYY-MM-DD');
      }
    }
    const startDate = normalized.start_date ?? String(task?.startDate || '');
    const targetDate = normalized.target_date ?? String(task?.targetDate || '');
    if (startDate && targetDate && targetDate < startDate) {
      throw new Error('目标日期不能早于开始日期');
    }
    return normalized;
  }

  _taskIdForOperation(operationId) {
    const digest = crypto.createHash('sha256').update(operationId).digest('hex').slice(0, 20).toUpperCase();
    return `TASK-GF-${digest}`;
  }

  _normalizeTaskCreate(values, project, tasks, allowStatus) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('新任务字段必须是对象');
    }
    const unsupported = Object.keys(values).filter(field => !TASK_CREATE_FIELDS.has(field));
    if (unsupported.length > 0) throw new Error(`不允许创建任务字段：${unsupported.join('、')}`);
    if ('status' in values && !allowStatus) throw new Error('新任务不允许指定初始状态');

    const normalized = {};
    for (const [field, value] of Object.entries(values)) {
      if (typeof value !== 'string') throw new Error(`新任务字段 ${field} 必须是文本`);
      normalized[field] = value.trim();
    }
    normalized.stage_id ||= '';
    normalized.parent_task_id ||= '';
    normalized.title ||= '';
    normalized.owner ||= '未分配';
    normalized.start_date ||= '';
    normalized.target_date ||= '';
    normalized.priority ||= 'P1';
    normalized.next_action ||= '';
    if (allowStatus) normalized.status ||= '未开始';

    if (!(project?.stages || []).some(stage => stage.stageId === normalized.stage_id)) {
      throw new Error('所选阶段不存在，请重读任务投影');
    }
    if (normalized.parent_task_id && !(tasks || []).some(task => (
      task.projectId === project.projectId && task.taskId === normalized.parent_task_id
    ))) throw new Error('所选父任务不存在，请重读任务投影');
    if (
      normalized.title.length < 1
      || normalized.title.length > 240
      || /[\r\n\0]/.test(normalized.title)
    ) throw new Error('任务标题必须是 1–240 个字符的单行文本');
    if (
      normalized.owner.length < 1
      || normalized.owner.length > 120
      || /[\r\n\0]/.test(normalized.owner)
    ) throw new Error('负责人必须是 1–120 个字符的单行文本');
    if (!PRIORITY_PATTERN.test(normalized.priority)) throw new Error('优先级必须是 P0–P9');
    if (normalized.next_action.length > 2000 || normalized.next_action.includes('\0')) {
      throw new Error('下一步行动不能超过 2000 个字符');
    }
    for (const field of ['start_date', 'target_date']) {
      if (normalized[field] && !DATE_PATTERN.test(normalized[field])) {
        throw new Error('任务日期必须使用 YYYY-MM-DD');
      }
    }
    if (normalized.start_date && normalized.target_date && normalized.target_date < normalized.start_date) {
      throw new Error('目标日期不能早于开始日期');
    }
    if (allowStatus && normalized.status !== '未开始') throw new Error('新任务必须从“未开始”创建');
    return normalized;
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (
      !relative.startsWith(`..${path.sep}`)
      && relative !== '..'
      && !path.isAbsolute(relative)
    );
  }

  _configuredRoots() {
    return (this.configService.getTreeRoots?.() || [])
      .filter(root => root?.path && fs.existsSync(root.path))
      .map(root => ({ path: path.resolve(root.path), realPath: fs.realpathSync.native(root.path) }));
  }

  _assertManagedDirectory(candidatePath, roots, label) {
    const resolved = path.resolve(String(candidatePath || ''));
    const lexicalRoot = roots.find(root => (
      this._pathIsWithin(resolved, root.path) || this._pathIsWithin(resolved, root.realPath)
    ));
    if (!lexicalRoot || !fs.existsSync(resolved)) {
      throw new Error(`${label}不在受管开发目录中`);
    }
    const realPath = fs.realpathSync.native(resolved);
    if (!this._pathIsWithin(realPath, lexicalRoot.realPath) || !fs.statSync(realPath).isDirectory()) {
      throw new Error(`${label}路径不安全`);
    }
    return realPath;
  }

  _assertAdapter(connectorRoot) {
    const adapterPath = path.join(connectorRoot, 'scripts', 'gitfinder_authority.py');
    if (!fs.existsSync(adapterPath)) {
      throw new Error('Local Project Manager 尚未安装 GitFinder 权威适配器');
    }
    const stat = fs.lstatSync(adapterPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('权威适配器路径不安全');
    }
    const realAdapter = fs.realpathSync.native(adapterPath);
    if (!this._pathIsWithin(realAdapter, connectorRoot)) {
      throw new Error('权威适配器路径不安全');
    }
    return realAdapter;
  }

  async _locateTask(taskKey) {
    const portfolio = await this.projectionService.getPortfolio({ forceRefresh: true });
    if (!portfolio?.success || portfolio?.connector?.name !== 'Local Project Manager') {
      throw new Error(portfolio?.error || 'Local Project Manager 任务投影不可用');
    }
    const task = (portfolio.tasks || []).find(item => item.key === String(taskKey || ''));
    if (!task) throw new Error('任务已变化或不在当前任务投影中，请刷新后重试');
    if (task.source?.authority !== 'Local Project Manager') {
      throw new Error('任务事实来源不允许写回');
    }
    const roots = this._configuredRoots();
    if (roots.length === 0) throw new Error('GitFinder 没有可用的受管开发目录');
    const connectorRoot = this._assertManagedDirectory(portfolio.connector.root, roots, '连接器路径');
    const projectRoot = this._assertManagedDirectory(task.projectRoot, roots, '项目路径');
    const adapterPath = this._assertAdapter(connectorRoot);
    return { task, connectorRoot, projectRoot, adapterPath };
  }

  async _locateMilestone(milestoneKey) {
    const portfolio = await this.projectionService.getPortfolio({ forceRefresh: true });
    if (!portfolio?.success || portfolio?.connector?.name !== 'Local Project Manager') {
      throw new Error(portfolio?.error || 'Local Project Manager 里程碑投影不可用');
    }
    const milestone = (portfolio.milestones || []).find(item => item.key === String(milestoneKey || ''));
    if (!milestone || !MILESTONE_ID_PATTERN.test(String(milestone.milestoneId || ''))) {
      throw new Error('里程碑已变化或不在当前投影中，请刷新后重试');
    }
    if (milestone.source?.authority !== 'Local Project Manager') {
      throw new Error('里程碑事实来源不允许写回');
    }
    const project = (portfolio.projects || []).find(item => item.projectId === milestone.projectId);
    if (!project) throw new Error('里程碑所属项目不在当前投影中，请刷新后重试');
    const roots = this._configuredRoots();
    if (roots.length === 0) throw new Error('GitFinder 没有可用的受管开发目录');
    const connectorRoot = this._assertManagedDirectory(portfolio.connector.root, roots, '连接器路径');
    const projectRoot = this._assertManagedDirectory(milestone.projectRoot, roots, '项目路径');
    const adapterPath = this._assertAdapter(connectorRoot);
    return { milestone, project, connectorRoot, projectRoot, adapterPath };
  }

  async _locateProject(projectId) {
    const portfolio = await this.projectionService.getPortfolio({ forceRefresh: true });
    if (!portfolio?.success || portfolio?.connector?.name !== 'Local Project Manager') {
      throw new Error(portfolio?.error || 'Local Project Manager 任务投影不可用');
    }
    const project = (portfolio.projects || []).find(item => item.projectId === String(projectId || ''));
    if (!project) throw new Error('项目已变化或不在当前任务投影中，请刷新后重试');
    const roots = this._configuredRoots();
    if (roots.length === 0) throw new Error('GitFinder 没有可用的受管开发目录');
    const connectorRoot = this._assertManagedDirectory(portfolio.connector.root, roots, '连接器路径');
    const projectRoot = this._assertManagedDirectory(project.projectRoot, roots, '项目路径');
    const adapterPath = this._assertAdapter(connectorRoot);
    return {
      project,
      tasks: (portfolio.tasks || []).filter(task => task.projectId === project.projectId),
      connectorRoot,
      projectRoot,
      adapterPath
    };
  }

  async _invoke(adapterPath, args, timeout) {
    const result = await this.runAuthority(adapterPath, args, { timeout });
    const output = String(result?.stdout || '').trim();
    if (!output) {
      throw new Error(`Local Project Manager 权威适配器未返回结果${result?.stderr ? `：${String(result.stderr).trim()}` : ''}`);
    }
    let payload;
    try {
      payload = JSON.parse(output);
    } catch {
      throw new Error('Local Project Manager 权威适配器返回了无效数据');
    }
    if (payload?.schema_version !== AUTHORITY_SCHEMA_VERSION || typeof payload?.success !== 'boolean') {
      throw new Error('Local Project Manager 权威适配器协议不兼容');
    }
    return payload;
  }
}

const projectTaskWritebackService = new ProjectTaskWritebackService();

module.exports = projectTaskWritebackService;
module.exports.ProjectTaskWritebackService = ProjectTaskWritebackService;
module.exports.STATUSES = STATUSES;
module.exports.EDITABLE_TASK_FIELDS = EDITABLE_TASK_FIELDS;
module.exports.TASK_CREATE_FIELDS = TASK_CREATE_FIELDS;
module.exports.EDITABLE_MILESTONE_FIELDS = EDITABLE_MILESTONE_FIELDS;
