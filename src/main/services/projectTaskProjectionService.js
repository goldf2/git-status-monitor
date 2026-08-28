const fs = require('node:fs');
const path = require('node:path');
const configService = require('./configService');

const SUPPORTED_SCHEMA_VERSION = '1.1';
const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024 * 1024;
const MAX_PROJECTION_BYTES = 20 * 1024 * 1024;
const COMPLETE_STATUS = '已验收完成';
const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.parcel-cache', 'out', 'target'
]);

function parseCsvRows(content) {
  const source = String(content || '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some(value => value !== '')) records.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some(value => value !== '')) records.push(row);
  }
  if (records.length === 0) return [];

  const headers = records[0].map(header => header.trim());
  return records.slice(1).map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
}

class ProjectTaskProjectionService {
  constructor(options = {}) {
    this.configService = options.configService || configService;
    this.now = options.now || (() => new Date());
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.cache = null;
  }

  async getPortfolio(options = {}) {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!forceRefresh && this.cache && Date.now() - this.cache.cachedAt < this.cacheTtlMs) {
      return this.cache.value;
    }

    const warnings = [];
    try {
      const roots = this._configuredRoots();
      if (roots.length === 0) {
        return this._cacheResult(this._emptyResult('GitFinder 还没有可用的受管开发目录', warnings));
      }

      const connectorRoot = this._findConnectorRoot(roots);
      if (!connectorRoot) {
        return this._cacheResult(this._emptyResult('未发现 Local Project Manager 数据连接器', warnings));
      }

      const registryPath = path.join(connectorRoot, 'portfolio', 'projects.csv');
      const registryRows = parseCsvRows(this._readTextFile(registryPath, MAX_REGISTRY_BYTES));
      const projects = [];
      const tasks = [];
      const dependencies = [];
      const milestones = [];
      const timeline = [];

      for (const row of registryRows) {
        if (!this._isEnabled(row.enabled)) continue;
        try {
          const projection = this._readProjectProjection(row, connectorRoot, roots, warnings);
          projects.push(projection.project);
          tasks.push(...projection.tasks);
          dependencies.push(...projection.dependencies);
          milestones.push(...projection.milestones);
          timeline.push(...projection.timeline);
        } catch (error) {
          warnings.push({
            code: 'invalid-project',
            projectId: String(row.project_id || ''),
            path: String(row.path || ''),
            message: error?.message || String(error)
          });
        }
      }

      tasks.sort((left, right) => this._compareTasks(left, right));
      dependencies.sort((left, right) => (
        `${left.projectName}\u0000${left.successorTitle}\u0000${left.predecessorTitle}`
          .localeCompare(`${right.projectName}\u0000${right.successorTitle}\u0000${right.predecessorTitle}`, 'zh-CN')
      ));
      milestones.sort((left, right) => this._compareMilestones(left, right));
      timeline.sort((left, right) => this._compareTimelineEvents(left, right));
      const result = {
        success: true,
        readOnly: true,
        connector: {
          name: 'Local Project Manager',
          root: connectorRoot,
          registryPath,
          schemaVersion: SUPPORTED_SCHEMA_VERSION,
          readOnly: true
        },
        projects,
        tasks,
        dependencies,
        milestones,
        timeline,
        warnings,
        refreshedAt: this.now().toISOString()
      };
      return this._cacheResult(result);
    } catch (error) {
      return this._cacheResult(this._emptyResult(error?.message || String(error), warnings));
    }
  }

  _emptyResult(error, warnings) {
    return {
      success: false,
      readOnly: true,
      connector: null,
      projects: [],
      tasks: [],
      dependencies: [],
      milestones: [],
      timeline: [],
      warnings,
      error,
      refreshedAt: this.now().toISOString()
    };
  }

  _cacheResult(value) {
    this.cache = { cachedAt: Date.now(), value };
    return value;
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _configuredRoots() {
    const seen = new Set();
    const roots = [];
    for (const root of this.configService.getTreeRoots?.() || []) {
      if (!root?.path || !fs.existsSync(root.path)) continue;
      const resolved = path.resolve(root.path);
      const realPath = fs.realpathSync.native(resolved);
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      roots.push({ path: resolved, realPath, name: root.name || path.basename(resolved) });
    }
    return roots;
  }

  _assertManagedExistingPath(candidatePath, roots, expectedType = 'directory') {
    const resolved = path.resolve(String(candidatePath || ''));
    const lexicalRoot = roots.find(root => (
      this._pathIsWithin(resolved, root.path) || this._pathIsWithin(resolved, root.realPath)
    ));
    if (!lexicalRoot) throw new Error(`路径不在受管开发目录中：${resolved}`);
    if (!fs.existsSync(resolved)) throw new Error(`路径不存在：${resolved}`);
    const realPath = fs.realpathSync.native(resolved);
    if (!this._pathIsWithin(realPath, lexicalRoot.realPath)) {
      throw new Error(`符号链接指向受管目录之外：${resolved}`);
    }
    const stat = fs.statSync(realPath);
    if (expectedType === 'directory' && !stat.isDirectory()) throw new Error(`目标不是目录：${resolved}`);
    if (expectedType === 'file' && !stat.isFile()) throw new Error(`目标不是文件：${resolved}`);
    return { resolved, realPath, root: lexicalRoot };
  }

  _isConnectorRoot(candidatePath, roots) {
    try {
      const managed = this._assertManagedExistingPath(candidatePath, roots, 'directory');
      const registryPath = path.join(managed.realPath, 'portfolio', 'projects.csv');
      this._assertManagedExistingPath(registryPath, roots, 'file');
      return managed.resolved;
    } catch {
      return null;
    }
  }

  _findConnectorRoot(roots) {
    const explicitPath = this.configService.get?.('localProjectManagerPath');
    if (explicitPath) {
      const explicit = this._isConnectorRoot(explicitPath, roots);
      if (explicit) return explicit;
    }

    const relativeCandidates = [
      ['开发中', '工具', 'local-project-manager'],
      ['开发中', 'local-project-manager'],
      ['工具', 'local-project-manager'],
      ['local-project-manager']
    ];
    for (const root of roots) {
      for (const segments of relativeCandidates) {
        const found = this._isConnectorRoot(path.join(root.path, ...segments), roots);
        if (found) return found;
      }
    }

    for (const root of roots) {
      const found = this._findNamedDirectory(root.path, 'local-project-manager', 4, candidate => (
        Boolean(this._isConnectorRoot(candidate, roots))
      ));
      if (found) return this._isConnectorRoot(found, roots);
    }
    return null;
  }

  _findNamedDirectory(rootPath, targetName, maxDepth, predicate = () => true) {
    const queue = [{ directory: rootPath, depth: 0 }];
    while (queue.length > 0) {
      const { directory, depth } = queue.shift();
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.name === targetName && predicate(candidate)) return candidate;
        if (depth < maxDepth) queue.push({ directory: candidate, depth: depth + 1 });
      }
    }
    return null;
  }

  _resolveProjectRoot(row, connectorRoot, roots) {
    const registeredPath = path.resolve(String(row.path || ''));
    try {
      return { ...this._assertManagedExistingPath(registeredPath, roots, 'directory'), registeredPath, pathRebound: false };
    } catch (_) {}

    const baseName = path.basename(registeredPath);
    if (!baseName || baseName === '.' || baseName === path.parse(registeredPath).root) {
      throw new Error(`项目注册路径无效：${row.path || ''}`);
    }
    const relativeCandidates = [
      path.join(path.dirname(connectorRoot), baseName),
      ...roots.flatMap(root => [
        path.join(root.path, '开发中', '工具', baseName),
        path.join(root.path, '开发中', baseName),
        path.join(root.path, '已部署', baseName),
        path.join(root.path, '已冻结', baseName),
        path.join(root.path, '已废弃', baseName),
        path.join(root.path, '工具', baseName),
        path.join(root.path, baseName)
      ])
    ];

    for (const candidate of relativeCandidates) {
      try {
        const managed = this._assertManagedExistingPath(candidate, roots, 'directory');
        if (this._hasProjectionFiles(managed.realPath)) {
          return { ...managed, registeredPath, pathRebound: true };
        }
      } catch (_) {}
    }

    for (const root of roots) {
      const found = this._findNamedDirectory(root.path, baseName, 4, candidate => this._hasProjectionFiles(candidate));
      if (!found) continue;
      const managed = this._assertManagedExistingPath(found, roots, 'directory');
      return { ...managed, registeredPath, pathRebound: true };
    }
    throw new Error(`无法找到已注册项目：${row.project_id || baseName}`);
  }

  _hasProjectionFiles(projectRoot) {
    return fs.existsSync(path.join(projectRoot, 'management', 'exports', 'progress-summary.json'))
      && fs.existsSync(path.join(projectRoot, 'cards', 'progress-overview', 'data', 'data.json'));
  }

  _readProjectProjection(row, connectorRoot, roots, warnings) {
    const located = this._resolveProjectRoot(row, connectorRoot, roots);
    const projectRoot = located.resolved;
    const summaryPath = path.join(projectRoot, 'management', 'exports', 'progress-summary.json');
    const projectionPath = path.join(projectRoot, 'cards', 'progress-overview', 'data', 'data.json');
    this._assertManagedExistingPath(summaryPath, roots, 'file');
    this._assertManagedExistingPath(projectionPath, roots, 'file');

    const summary = this._readJsonFile(summaryPath, MAX_SUMMARY_BYTES);
    if (String(summary?.schema_version || '') !== SUPPORTED_SCHEMA_VERSION) {
      throw new Error(`不支持的进度摘要协议版本：${summary?.schema_version || '缺失'}`);
    }
    const data = this._readJsonFile(projectionPath, MAX_PROJECTION_BYTES);
    for (const field of [
      'stages', 'milestones', 'tasks', 'dependencies', 'acceptance', 'evidence', 'activity',
      'runs', 'run_steps', 'repos', 'repo_task_links'
    ]) {
      if (data[field] != null && !Array.isArray(data[field])) throw new Error(`投影字段 ${field} 必须是数组`);
    }

    const projectId = String(summary?.project?.project_id || row.project_id || data?.project?.[0]?.project_id || '');
    if (!projectId) throw new Error('投影缺少 project_id');
    const projectName = String(summary?.project?.name || data?.project?.[0]?.name || projectId);
    const generatedAt = String(data?.meta?.generated_at || summary?.generated_at || '');
    const projectionStale = this._isProjectionStale(generatedAt);

    if (located.pathRebound) {
      warnings.push({
        code: 'path-rebound', projectId, path: projectRoot,
        message: `注册路径已过期，已只读重绑定到 ${projectRoot}`
      });
    }
    if (projectionStale) {
      warnings.push({
        code: 'projection-stale', projectId, path: projectionPath,
        message: `项目投影最后生成于 ${generatedAt || '未知时间'}`
      });
    }

    const rawStages = data.stages || [];
    const rawTasks = data.tasks || [];
    const stagesById = new Map(rawStages.map(stage => [String(stage.stage_id || ''), stage]));
    const childIds = new Set(rawTasks.map(task => String(task.parent_task_id || '')).filter(Boolean));
    const acceptanceByTask = this._groupByObjectId(data.acceptance || [], 'task');
    const evidenceByTask = this._groupByObjectId(data.evidence || [], 'task');
    const evidenceById = new Map((data.evidence || []).map(item => [String(item.evidence_id || ''), item]));
    const reposById = new Map((data.repos || []).map(repo => [String(repo.repo_id || ''), repo]));
    const linksByTask = new Map();
    for (const link of data.repo_task_links || []) {
      const taskId = String(link.task_id || '');
      if (!taskId) continue;
      if (!linksByTask.has(taskId)) linksByTask.set(taskId, []);
      linksByTask.get(taskId).push(link);
    }

    const source = {
      readOnly: true,
      authority: 'Local Project Manager',
      projectionPath,
      summaryPath,
      generatedAt,
      registeredPath: located.registeredPath,
      projectRoot
    };
    const normalizedTasks = rawTasks.map(rawTask => {
      const taskId = String(rawTask.task_id || '');
      const acceptance = (acceptanceByTask.get(taskId) || []).map(item => ({
        id: String(item.acceptance_id || ''),
        criterion: String(item.criterion || ''),
        checkType: String(item.check_type || ''),
        result: String(item.result || ''),
        evidenceId: String(item.evidence_id || ''),
        checkedAt: String(item.checked_at || ''),
        confirmedBy: String(item.confirmed_by || '')
      }));
      const evidenceIds = new Set(acceptance.map(item => item.evidenceId).filter(Boolean));
      const evidence = [...(evidenceByTask.get(taskId) || [])];
      for (const evidenceId of evidenceIds) {
        const item = evidenceById.get(evidenceId);
        if (item && !evidence.some(existing => existing === item)) evidence.push(item);
      }
      const repositories = (linksByTask.get(taskId) || []).map(link => {
        const repo = reposById.get(String(link.repo_id || '')) || {};
        const rawRepoPath = String(repo.path || '');
        const repoPath = rawRepoPath
          ? (path.isAbsolute(rawRepoPath) ? path.resolve(rawRepoPath) : path.resolve(projectRoot, rawRepoPath))
          : '';
        const navigation = this._resolveRepositoryNavigationPath(repoPath, roots);
        return {
          id: String(repo.repo_id || link.repo_id || ''),
          name: String(repo.name || repo.repo_id || link.repo_id || ''),
          path: navigation.path,
          available: navigation.available,
          pathRebound: navigation.pathRebound,
          relation: String(link.relation || ''),
          notes: String(link.notes || '')
        };
      });
      const status = String(rawTask.status || '无法判定');
      const targetDate = String(rawTask.target_date || '');
      const timing = this._taskTiming(targetDate, status);
      return {
        key: `${projectId}:${taskId}`,
        projectId,
        projectName,
        projectRoot,
        taskId,
        parentTaskId: String(rawTask.parent_task_id || ''),
        stageId: String(rawTask.stage_id || ''),
        stageName: String(stagesById.get(String(rawTask.stage_id || ''))?.name || rawTask.stage_id || '未分阶段'),
        title: String(rawTask.title || taskId || '未命名任务'),
        owner: String(rawTask.owner || ''),
        startDate: String(rawTask.start_date || ''),
        targetDate,
        status,
        statusTone: this._statusTone(status),
        priority: String(rawTask.priority || ''),
        nextAction: String(rawTask.next_action || ''),
        updatedAt: String(rawTask.updated_at || ''),
        isLeaf: !childIds.has(taskId),
        overdue: timing.overdue,
        dueSoon: timing.dueSoon,
        acceptanceTotal: acceptance.length,
        acceptancePassed: acceptance.filter(item => item.result === '通过').length,
        acceptance,
        evidence: evidence.map(item => ({
          id: String(item.evidence_id || ''),
          type: String(item.evidence_type || ''),
          summary: String(item.summary || ''),
          reference: String(item.reference || ''),
          capturedAt: String(item.captured_at || ''),
          capturedBy: String(item.captured_by || '')
        })),
        repositories,
        source: { ...source }
      };
    });
    const tasksById = new Map(normalizedTasks.map(task => [task.taskId, task]));
    const allowedRelations = new Set(['FS', 'SS', 'FF', 'SF']);
    const normalizedDependencies = (data.dependencies || []).map(rawDependency => {
      const dependencyId = String(rawDependency.dependency_id || '');
      const predecessorTaskId = String(rawDependency.predecessor_id || '');
      const successorTaskId = String(rawDependency.successor_id || '');
      const predecessor = tasksById.get(predecessorTaskId);
      const successor = tasksById.get(successorTaskId);
      const rawRelation = String(rawDependency.relation || '');
      const numericLag = Number(rawDependency.lag_days);
      return {
        key: `${projectId}:${dependencyId}`,
        dependencyId,
        projectId,
        projectName,
        predecessorTaskKey: predecessor?.key || `${projectId}:${predecessorTaskId}`,
        predecessorTaskId,
        predecessorTitle: predecessor?.title || predecessorTaskId || '未知前置任务',
        predecessorStatus: predecessor?.status || '无法判定',
        predecessorStatusTone: predecessor?.statusTone || 'muted',
        successorTaskKey: successor?.key || `${projectId}:${successorTaskId}`,
        successorTaskId,
        successorTitle: successor?.title || successorTaskId || '未知后继任务',
        successorStatus: successor?.status || '无法判定',
        successorStatusTone: successor?.statusTone || 'muted',
        relation: allowedRelations.has(rawRelation) ? rawRelation : (rawRelation || '未知'),
        lagDays: Number.isSafeInteger(numericLag) ? numericLag : 0,
        source: { ...source }
      };
    }).filter(dependency => dependency.dependencyId && dependency.predecessorTaskId && dependency.successorTaskId);

    for (const task of normalizedTasks) {
      task.predecessors = normalizedDependencies
        .filter(dependency => dependency.successorTaskId === task.taskId)
        .map(dependency => ({
          key: dependency.key,
          dependencyId: dependency.dependencyId,
          taskKey: dependency.predecessorTaskKey,
          taskId: dependency.predecessorTaskId,
          title: dependency.predecessorTitle,
          status: dependency.predecessorStatus,
          statusTone: dependency.predecessorStatusTone,
          relation: dependency.relation,
          lagDays: dependency.lagDays
        }));
      task.successors = normalizedDependencies
        .filter(dependency => dependency.predecessorTaskId === task.taskId)
        .map(dependency => ({
          key: dependency.key,
          dependencyId: dependency.dependencyId,
          taskKey: dependency.successorTaskKey,
          taskId: dependency.successorTaskId,
          title: dependency.successorTitle,
          status: dependency.successorStatus,
          statusTone: dependency.successorStatusTone,
          relation: dependency.relation,
          lagDays: dependency.lagDays
        }));
    }
    const normalizedMilestones = (data.milestones || []).map(rawMilestone => {
      const milestoneId = String(rawMilestone.milestone_id || '');
      const stageId = String(rawMilestone.stage_id || '');
      const status = String(rawMilestone.status || '无法判定');
      const targetDate = String(rawMilestone.target_date || '');
      const timing = this._taskTiming(targetDate, status);
      return {
        key: `${projectId}:${milestoneId}`,
        projectId,
        projectName,
        projectRoot,
        milestoneId,
        stageId,
        stageName: String(stagesById.get(stageId)?.name || stageId || '未分阶段'),
        name: String(rawMilestone.name || milestoneId || '未命名里程碑'),
        targetDate,
        status,
        statusTone: this._statusTone(status),
        acceptanceSummary: String(rawMilestone.acceptance_summary || ''),
        overdue: timing.overdue,
        dueSoon: timing.dueSoon,
        source: { ...source }
      };
    }).filter(milestone => milestone.milestoneId);

    const progress = summary.progress || {};
    const project = {
      projectId,
      name: projectName,
      projectRoot,
      registeredPath: located.registeredPath,
      pathRebound: located.pathRebound,
      projectionStale,
      generatedAt,
      lifecycle: String(summary?.project?.lifecycle || data?.project?.[0]?.lifecycle || ''),
      owner: String(summary?.project?.owner || data?.project?.[0]?.owner || ''),
      targetDate: String(summary?.project?.target_date || ''),
      updatedAt: String(summary?.project?.updated_at || ''),
      leafTaskCount: Number(progress.leaf_task_count) || normalizedTasks.filter(task => task.isLeaf).length,
      acceptedTaskCount: Number(progress.accepted_task_count) || 0,
      acceptedRatio: Number(progress.accepted_ratio) || 0,
      blockedCount: Number(progress.blocked_count) || normalizedTasks.filter(task => task.status === '阻塞').length,
      overdueCount: Number(summary?.schedule_health?.overdue_count) || normalizedTasks.filter(task => task.overdue).length,
      dueSoonCount: Number(summary?.schedule_health?.due_soon_count) || normalizedTasks.filter(task => task.dueSoon).length,
      stages: rawStages
        .map(stage => ({
          stageId: String(stage.stage_id || ''),
          name: String(stage.name || stage.stage_id || '未命名阶段'),
          sequence: Number(stage.sequence) || 0,
          status: String(stage.status || ''),
          startDate: String(stage.start_date || ''),
          targetDate: String(stage.target_date || '')
        }))
        .filter(stage => stage.stageId)
        .sort((left, right) => left.sequence - right.sequence || left.stageId.localeCompare(right.stageId)),
      source: { ...source }
    };
    const timeline = this._buildTimelineEvents({
      data,
      projectId,
      projectName,
      projectRoot,
      tasks: normalizedTasks,
      evidenceById,
      source
    });
    return {
      project,
      tasks: normalizedTasks,
      dependencies: normalizedDependencies,
      milestones: normalizedMilestones,
      timeline
    };
  }

  _buildTimelineEvents({ data, projectId, projectName, projectRoot, tasks, evidenceById, source }) {
    const events = [];
    const tasksById = new Map(tasks.map(task => [task.taskId, task]));
    const embeddedEvidenceIds = new Set();
    const contextFor = (objectType, objectId) => {
      const normalizedType = String(objectType || '').toLowerCase();
      const normalizedId = String(objectId || '');
      const task = normalizedType === 'task' ? tasksById.get(normalizedId) : null;
      return {
        objectType: normalizedType || 'project',
        objectId: normalizedId || projectId,
        taskId: task?.taskId || '',
        taskKey: task?.key || '',
        taskTitle: task?.title || ''
      };
    };
    const normalizeEvidence = evidence => evidence ? {
      id: String(evidence.evidence_id || ''),
      type: String(evidence.evidence_type || ''),
      summary: String(evidence.summary || ''),
      reference: String(evidence.reference || ''),
      capturedAt: String(evidence.captured_at || ''),
      capturedBy: String(evidence.captured_by || '')
    } : null;
    const append = event => {
      const id = String(event.id || '');
      if (!id) return;
      const categories = [...new Set(
        (Array.isArray(event.categories) ? event.categories : [event.category]).filter(Boolean)
      )];
      events.push({
        key: `${projectId}:${event.kind}:${id}`,
        projectId,
        projectName,
        projectRoot,
        ...event,
        categories,
        source: { ...source }
      });
    };

    for (const item of data.activity || []) {
      const id = String(item.activity_id || '');
      const evidenceId = String(item.evidence_id || '');
      const evidence = normalizeEvidence(evidenceById.get(evidenceId));
      const evidenceCategory = evidence?.type.toLowerCase() === 'test' ? 'test' : (evidence ? 'evidence' : '');
      if (evidenceId && evidence) embeddedEvidenceIds.add(evidenceId);
      append({
        id,
        kind: 'activity',
        category: evidenceCategory === 'test' ? 'test' : 'activity',
        categories: ['activity', evidenceCategory].filter(Boolean),
        type: String(item.activity_type || 'activity'),
        summary: String(item.summary || item.activity_type || id),
        timestamp: String(item.occurred_at || ''),
        actor: String(item.actor || ''),
        status: '',
        detail: '',
        reference: evidence?.reference || '',
        evidence,
        ...contextFor(item.object_type, item.object_id)
      });
    }

    for (const item of data.acceptance || []) {
      const id = String(item.acceptance_id || '');
      const evidenceId = String(item.evidence_id || '');
      const evidence = normalizeEvidence(evidenceById.get(evidenceId));
      const evidenceCategory = evidence?.type.toLowerCase() === 'test' ? 'test' : (evidence ? 'evidence' : '');
      append({
        id,
        kind: 'acceptance',
        category: 'acceptance',
        categories: ['acceptance', evidenceCategory].filter(Boolean),
        type: String(item.check_type || 'acceptance'),
        summary: String(item.criterion || id),
        timestamp: String(item.checked_at || ''),
        actor: String(item.confirmed_by || ''),
        status: String(item.result || ''),
        detail: evidence?.summary || '',
        reference: evidence?.reference || '',
        evidence,
        ...contextFor(item.object_type, item.object_id)
      });
    }

    for (const item of data.run_steps || []) {
      const id = String(item.run_step_id || '');
      const evidenceId = String(item.evidence_id || '');
      const evidence = normalizeEvidence(evidenceById.get(evidenceId));
      const evidenceCategory = evidence?.type.toLowerCase() === 'test' ? 'test' : (evidence ? 'evidence' : '');
      if (evidenceId && evidence) embeddedEvidenceIds.add(evidenceId);
      append({
        id,
        kind: 'run_step',
        category: 'automation',
        categories: ['automation', evidenceCategory].filter(Boolean),
        type: String(item.step_id || 'run_step'),
        summary: String(item.output_summary || item.error || item.step_id || id),
        timestamp: String(item.finished_at || item.started_at || ''),
        actor: '',
        status: String(item.status || ''),
        detail: String(item.error || ''),
        reference: evidence?.reference || '',
        evidence,
        objectType: 'run',
        objectId: String(item.run_id || ''),
        taskId: '',
        taskKey: '',
        taskTitle: ''
      });
    }

    for (const item of data.runs || []) {
      const id = String(item.run_id || '');
      append({
        id,
        kind: 'run',
        category: 'automation',
        categories: ['automation'],
        type: String(item.workflow_id || 'run'),
        summary: String(item.error || item.workflow_id || id),
        timestamp: String(item.finished_at || item.triggered_at || ''),
        actor: String(item.actor || ''),
        status: String(item.status || ''),
        detail: String(item.error || ''),
        reference: '',
        evidence: null,
        objectType: 'run',
        objectId: id,
        taskId: '',
        taskKey: '',
        taskTitle: ''
      });
    }

    for (const item of data.evidence || []) {
      const id = String(item.evidence_id || '');
      if (!id || embeddedEvidenceIds.has(id)) continue;
      const type = String(item.evidence_type || 'evidence');
      append({
        id,
        kind: 'evidence',
        category: type.toLowerCase() === 'test' ? 'test' : 'evidence',
        categories: [type.toLowerCase() === 'test' ? 'test' : 'evidence'],
        type,
        summary: String(item.summary || id),
        timestamp: String(item.captured_at || ''),
        actor: String(item.captured_by || ''),
        status: '',
        detail: '',
        reference: String(item.reference || ''),
        evidence: normalizeEvidence(item),
        ...contextFor(item.object_type, item.object_id)
      });
    }

    return events;
  }

  _groupByObjectId(items, objectType) {
    const grouped = new Map();
    for (const item of items) {
      if (String(item.object_type || '').toLowerCase() !== objectType) continue;
      const objectId = String(item.object_id || '');
      if (!objectId) continue;
      if (!grouped.has(objectId)) grouped.set(objectId, []);
      grouped.get(objectId).push(item);
    }
    return grouped;
  }

  _safeManagedNavigationPath(candidatePath, roots) {
    if (!candidatePath) return '';
    const resolved = path.resolve(candidatePath);
    const lexicalRoot = roots.find(root => (
      this._pathIsWithin(resolved, root.path) || this._pathIsWithin(resolved, root.realPath)
    ));
    if (!lexicalRoot) return '';
    if (!fs.existsSync(resolved)) return resolved;
    try {
      const realPath = fs.realpathSync.native(resolved);
      return this._pathIsWithin(realPath, lexicalRoot.realPath) ? resolved : '';
    } catch {
      return '';
    }
  }

  _resolveRepositoryNavigationPath(candidatePath, roots) {
    const safeOriginal = this._safeManagedNavigationPath(candidatePath, roots);
    if (safeOriginal && fs.existsSync(safeOriginal)) {
      return { path: safeOriginal, available: true, pathRebound: false };
    }

    const baseName = path.basename(String(candidatePath || ''));
    const storedRepos = this.configService.getRepos?.()?.repos || [];
    for (const repo of storedRepos) {
      if (!repo?.path || path.basename(repo.path) !== baseName) continue;
      const safePath = this._safeManagedNavigationPath(repo.path, roots);
      if (safePath && fs.existsSync(safePath)) {
        return { path: safePath, available: true, pathRebound: safePath !== safeOriginal };
      }
    }
    return { path: safeOriginal, available: false, pathRebound: false };
  }

  _readTextFile(filePath, maxBytes) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`目标不是文件：${filePath}`);
    if (stat.size > maxBytes) throw new Error(`文件超过只读投影上限：${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
  }

  _readJsonFile(filePath, maxBytes) {
    try {
      return JSON.parse(this._readTextFile(filePath, maxBytes));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`JSON 解析失败：${filePath}`);
      throw error;
    }
  }

  _isEnabled(value) {
    return ['true', '1', 'yes', 'y', '是'].includes(String(value || '').trim().toLowerCase());
  }

  _isProjectionStale(generatedAt) {
    const generated = Date.parse(generatedAt);
    if (!Number.isFinite(generated)) return true;
    return this.now().getTime() - generated > this.staleAfterMs;
  }

  _taskTiming(targetDate, status) {
    if (!targetDate || status === COMPLETE_STATUS) return { overdue: false, dueSoon: false };
    const target = Date.parse(`${targetDate}T23:59:59`);
    if (!Number.isFinite(target)) return { overdue: false, dueSoon: false };
    const now = this.now().getTime();
    const difference = target - now;
    return {
      overdue: difference < 0,
      dueSoon: difference >= 0 && difference <= 7 * 24 * 60 * 60 * 1000
    };
  }

  _statusTone(status) {
    if (status === '阻塞') return 'danger';
    if (status === COMPLETE_STATUS) return 'success';
    if (status === '所有自动检查通过，待人工验收' || status === '部分验收条件通过') return 'warning';
    if (status === '无法判定') return 'muted';
    return 'info';
  }

  _priorityRank(priority) {
    const match = String(priority || '').toUpperCase().match(/^P(\d+)$/);
    return match ? Number(match[1]) : 99;
  }

  _compareTasks(left, right) {
    const blockedDifference = Number(right.status === '阻塞') - Number(left.status === '阻塞');
    if (blockedDifference) return blockedDifference;
    const overdueDifference = Number(right.overdue) - Number(left.overdue);
    if (overdueDifference) return overdueDifference;
    const priorityDifference = this._priorityRank(left.priority) - this._priorityRank(right.priority);
    if (priorityDifference) return priorityDifference;
    const leftTarget = left.targetDate || '9999-12-31';
    const rightTarget = right.targetDate || '9999-12-31';
    const targetDifference = leftTarget.localeCompare(rightTarget);
    if (targetDifference) return targetDifference;
    return `${left.projectName}\u0000${left.title}`.localeCompare(`${right.projectName}\u0000${right.title}`, 'zh-CN');
  }

  _compareMilestones(left, right) {
    const blockedDifference = Number(right.status === '阻塞') - Number(left.status === '阻塞');
    if (blockedDifference) return blockedDifference;
    const overdueDifference = Number(right.overdue) - Number(left.overdue);
    if (overdueDifference) return overdueDifference;
    const leftTarget = left.targetDate || '9999-12-31';
    const rightTarget = right.targetDate || '9999-12-31';
    const targetDifference = leftTarget.localeCompare(rightTarget);
    if (targetDifference) return targetDifference;
    return `${left.projectName}\u0000${left.name}`.localeCompare(`${right.projectName}\u0000${right.name}`, 'zh-CN');
  }

  _compareTimelineEvents(left, right) {
    const leftTime = Date.parse(left.timestamp || '') || 0;
    const rightTime = Date.parse(right.timestamp || '') || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(left.key || '').localeCompare(String(right.key || ''), 'zh-CN');
  }
}

const projectTaskProjectionService = new ProjectTaskProjectionService();

module.exports = projectTaskProjectionService;
module.exports.ProjectTaskProjectionService = ProjectTaskProjectionService;
module.exports.parseCsvRows = parseCsvRows;
