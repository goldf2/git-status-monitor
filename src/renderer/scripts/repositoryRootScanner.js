(function exposeRepositoryRootScanner(root, factory) {
  const pathApi = root?.SidebarTreeController
    || (typeof require === 'function' ? require('./sidebarTreeController') : null);
  const api = factory(pathApi);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RepositoryRootScanner = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRepositoryRootScannerApi(pathApi) {
  const normalizePath = pathApi?.normalizePath || (value => String(value || ''));
  const pathIsWithin = pathApi?.pathIsWithin || ((candidate, parent) => candidate === parent);

  class Scanner {
    constructor(options = {}) {
      this.bridge = options.bridge;
      this.platform = options.platform || this.bridge?.platform || '';
    }

    async scan(rawRoots, existingRepos = [], options = {}) {
      const roots = (Array.isArray(rawRoots) ? rawRoots : []).filter(root => root?.path);
      if (!roots.length) {
        return {
          repos: [],
          availableRoots: [],
          unavailableRoots: [],
          complete: true
        };
      }

      let inspectionFailed = false;
      let inspection = { directories: [] };
      try {
        inspection = await this.bridge.fs.inspectWorkspaceDirectories(roots.map(root => root.path));
      } catch (_error) {
        inspectionFailed = true;
      }
      const availability = new Map((inspection?.directories || []).map(entry => [
        normalizePath(entry.path, this.platform),
        entry.available === true
      ]));
      const availableRoots = inspectionFailed
        ? []
        : roots.filter(root => availability.get(normalizePath(root.path, this.platform)) === true);
      const unavailableRoots = roots.filter(root => !availableRoots.includes(root));

      const scanResults = await Promise.all(availableRoots.map(async root => {
        try {
          const repos = await this.bridge.fs.findGitRepos(root.path, options);
          return { root, repos: Array.isArray(repos) ? repos : [], failed: false };
        } catch (_error) {
          return { root, repos: [], failed: true };
        }
      }));
      const failedRoots = scanResults.filter(result => result.failed).map(result => result.root);
      const completedRoots = scanResults.filter(result => !result.failed);
      const effectiveUnavailable = [...unavailableRoots, ...failedRoots];

      const seen = new Set();
      const repos = [];
      const addRepo = repo => {
        const key = normalizePath(repo?.path, this.platform);
        if (!key || seen.has(key)) return;
        seen.add(key);
        repos.push(repo);
      };
      completedRoots.forEach(result => result.repos.forEach(addRepo));
      (Array.isArray(existingRepos) ? existingRepos : [])
        .filter(repo => effectiveUnavailable.some(root => pathIsWithin(repo?.path, root.path, this.platform)))
        .forEach(addRepo);

      return {
        repos,
        availableRoots: completedRoots.map(result => result.root),
        unavailableRoots: effectiveUnavailable,
        complete: effectiveUnavailable.length === 0
      };
    }
  }

  return { Scanner, pathIsWithin };
});
