(function attachRepoMetrics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.RepoMetrics = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRepoMetrics() {
  function calculateRepoGroupMetrics(repos = [], groups = []) {
    const currentPaths = new Set(
      repos.map(repo => repo?.path).filter(path => typeof path === 'string' && path)
    );
    const groupedCurrentPaths = new Set();
    const groupCounts = new Map();

    for (const group of groups) {
      const paths = new Set(Array.isArray(group?.repoPaths) ? group.repoPaths : []);
      let count = 0;
      for (const repoPath of paths) {
        if (!currentPaths.has(repoPath)) continue;
        count++;
        groupedCurrentPaths.add(repoPath);
      }
      groupCounts.set(group?.id, count);
    }

    return {
      allCount: currentPaths.size,
      currentPaths,
      groupedCurrentPaths,
      groupCounts,
      ungroupedCount: Math.max(0, currentPaths.size - groupedCurrentPaths.size)
    };
  }

  return { calculateRepoGroupMetrics };
}));
