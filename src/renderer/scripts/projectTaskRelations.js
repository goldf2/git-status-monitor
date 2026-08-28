(function exposeProjectTaskRelations(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectTaskRelations = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProjectTaskRelationsApi() {
  function hasRelationFacts(task) {
    return (task?.predecessors?.length || 0) > 0
      || (task?.successors?.length || 0) > 0
      || Number(task?.acceptanceTotal || 0) > 0;
  }

  function filterTasks(tasks, options = {}) {
    const projectId = String(options.projectId || 'all');
    const tokens = String(options.query || '')
      .trim()
      .toLocaleLowerCase('zh-CN')
      .split(/\s+/)
      .filter(Boolean);
    return (Array.isArray(tasks) ? tasks : []).filter(task => {
      if (!hasRelationFacts(task)) return false;
      if (projectId !== 'all' && task.projectId !== projectId) return false;
      if (!tokens.length) return true;
      const related = [...(task.predecessors || []), ...(task.successors || [])];
      const haystack = [
        task.title,
        task.taskId,
        task.projectName,
        task.projectId,
        task.status,
        task.stageName,
        ...related.flatMap(item => [item.title, item.taskId, item.status, item.relation])
      ].join(' ').toLocaleLowerCase('zh-CN');
      return tokens.every(token => haystack.includes(token));
    });
  }

  function metrics(tasks, dependencies, projectId = 'all') {
    const scopedTasks = (Array.isArray(tasks) ? tasks : []).filter(task => (
      projectId === 'all' || task.projectId === projectId
    ));
    const scopedDependencies = (Array.isArray(dependencies) ? dependencies : []).filter(dependency => (
      projectId === 'all' || dependency.projectId === projectId
    ));
    const relatedTaskKeys = new Set();
    for (const dependency of scopedDependencies) {
      if (dependency.predecessorTaskKey) relatedTaskKeys.add(dependency.predecessorTaskKey);
      if (dependency.successorTaskKey) relatedTaskKeys.add(dependency.successorTaskKey);
    }
    return {
      dependencyCount: scopedDependencies.length,
      relatedTaskCount: relatedTaskKeys.size,
      pendingAcceptanceCount: scopedTasks.filter(task => (
        task.status === '所有自动检查通过，待人工验收'
        || Number(task.acceptanceTotal || 0) > Number(task.acceptancePassed || 0)
      )).length,
      blockedTaskCount: scopedTasks.filter(task => task.status === '阻塞').length
    };
  }

  function relationLabel(relation) {
    const labels = {
      FS: '完成 → 开始',
      SS: '开始 → 开始',
      FF: '完成 → 完成',
      SF: '开始 → 完成'
    };
    const value = String(relation || '');
    return labels[value] || value || '未知关系';
  }

  function lagLabel(lagDays) {
    const value = Number(lagDays) || 0;
    if (value === 0) return '无滞后';
    if (value < 0) return `提前 ${Math.abs(value)} 天`;
    return `滞后 ${value} 天`;
  }

  return {
    filterTasks,
    hasRelationFacts,
    lagLabel,
    metrics,
    relationLabel
  };
});
