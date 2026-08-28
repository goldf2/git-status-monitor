(function exposeRepoStatusBatch(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RepoStatusBatch = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRepoStatusBatchApi() {
  function defaultGitStatus() {
    return {
      isGitRepo: true,
      branch: '',
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      overallStatus: 'clean'
    };
  }

  function createState(repositories, requestId, previousItems = []) {
    const previousByPath = new Map((Array.isArray(previousItems) ? previousItems : [])
      .filter(item => item?.path)
      .map(item => [item.path, item]));
    const items = (Array.isArray(repositories) ? repositories : []).map(repo => {
      const previous = previousByPath.get(repo.path);
      return {
        ...repo,
        gitStatus: previous?.gitStatus || defaultGitStatus(),
        tags: Array.isArray(previous?.tags) ? previous.tags : [],
        readme: previous?.readme || repo.readme || null,
        groups: Array.isArray(previous?.groups) ? previous.groups : []
      };
    });
    return {
      requestId,
      items,
      indexByPath: new Map(items.map((item, index) => [item.path, index])),
      progress: { completed: 0, total: items.length, running: 0, cancelled: false, done: false }
    };
  }

  function applyProgress(state, progress) {
    if (!state || !progress || progress.requestId !== state.requestId) return false;
    state.progress = {
      completed: Math.max(0, Number(progress.completed) || 0),
      total: Math.max(0, Number(progress.total) || 0),
      running: Math.max(0, Number(progress.running) || 0),
      cancelled: progress.cancelled === true,
      done: progress.done === true
    };
    const latest = progress.latest;
    if (!latest?.path || !latest.status) return true;
    const index = state.indexByPath.get(latest.path);
    if (index === undefined) return true;
    state.items[index] = { ...state.items[index], gitStatus: latest.status };
    return true;
  }

  function applyResults(state, requestId, results) {
    if (!state || requestId !== state.requestId) return false;
    for (const result of Array.isArray(results) ? results : []) {
      if (!result?.path || !result.status) continue;
      const index = state.indexByPath.get(result.path);
      if (index === undefined) continue;
      state.items[index] = { ...state.items[index], gitStatus: result.status };
    }
    return true;
  }

  function applyMetadata(state, requestId, repoPath, metadata = {}) {
    if (!state || requestId !== state.requestId) return false;
    const index = state.indexByPath.get(repoPath);
    if (index === undefined) return false;
    state.items[index] = {
      ...state.items[index],
      tags: Array.isArray(metadata.tags) ? metadata.tags : state.items[index].tags,
      readme: metadata.readme || state.items[index].readme,
      groups: Array.isArray(metadata.groups) ? metadata.groups : state.items[index].groups
    };
    return true;
  }

  function formatProgress(progress = {}) {
    const completed = Math.max(0, Number(progress.completed) || 0);
    const total = Math.max(0, Number(progress.total) || 0);
    if (progress.cancelling) return '正在取消 Git 状态读取…';
    if (progress.cancelled && progress.done) return `已取消，保留已读取的 ${completed}/${total} 个仓库`;
    if (progress.done) return `已更新 ${completed} 个仓库的 Git 状态`;
    return `正在读取 Git 状态 ${completed}/${total}`;
  }

  return {
    createState,
    applyProgress,
    applyResults,
    applyMetadata,
    formatProgress
  };
});
