const { execSync, exec } = require('child_process');
const path = require('path');

class GitService {
  constructor() {
    this.statusCache = new Map();
    this.cacheTimeout = 30000;
  }

  _execGit(repoPath, command, { timeout = 30000 } = {}) {
    try {
      const result = execSync(`git ${command}`, {
        cwd: repoPath,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: result.trim() };
    } catch (e) {
      return { success: false, error: e.stderr ? e.stderr.trim() : e.message };
    }
  }

  _execGitAsync(repoPath, command, { timeout = 60000 } = {}) {
    return new Promise((resolve) => {
      const child = exec(`git ${command}`, {
        cwd: repoPath,
        timeout,
        encoding: 'utf-8'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  isGitRepo(repoPath) {
    const result = this._execGit(repoPath, 'rev-parse --is-inside-work-tree', { timeout: 5000 });
    return result.success && result.output === 'true';
  }

  async getStatus(repoPath, { autoFetch = false } = {}) {
    const cacheKey = repoPath + (autoFetch ? '_fetch' : '');
    const cached = this.statusCache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheTimeout) {
      return cached.data;
    }

    const status = {
      isGitRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      modified: 0,
      staged: 0,
      untracked: 0,
      hasRemote: false,
      lastCommit: null,
      remoteUrl: ''
    };

    try {
      const isGit = await this._isGitRepoAsync(repoPath);
      status.isGitRepo = isGit;
      if (!isGit) return status;

      const branchResult = await this._execGitAsync(repoPath, 'rev-parse --abbrev-ref HEAD', { timeout: 5000 });
      if (branchResult.success) {
        status.branch = branchResult.output;
      }

      const statusResult = await this._execGitAsync(repoPath, 'status --porcelain', { timeout: 5000 });
      if (statusResult.success) {
        const lines = statusResult.output.split('\n').filter(l => l.trim());
        lines.forEach(line => {
          if (line.startsWith('??')) {
            status.untracked++;
          } else if (line[0] !== ' ' && line[0] !== '?') {
            status.staged++;
          }
          if (line[1] !== ' ' && line[1] !== '?') {
            status.modified++;
          }
        });
      }

      const remoteResult = await this._execGitAsync(repoPath, 'remote', { timeout: 5000 });
      if (remoteResult.success && remoteResult.output) {
        status.hasRemote = true;
        const remotes = remoteResult.output.split('\n');
        if (remotes.length > 0) {
          const urlResult = await this._execGitAsync(repoPath, `remote get-url ${remotes[0]}`, { timeout: 5000 });
          if (urlResult.success) {
            status.remoteUrl = urlResult.output;
          }
        }
      }

      if (status.hasRemote && status.branch && autoFetch) {
        await this._execGitAsync(repoPath, 'fetch', { timeout: 15000 });
      }

      if (status.hasRemote && status.branch) {
        const aheadBehind = await this._execGitAsync(
          repoPath,
          `rev-list --left-right --count HEAD...origin/${status.branch}`,
          { timeout: 5000 }
        );
        if (aheadBehind.success) {
          const parts = aheadBehind.output.split('\t');
          if (parts.length === 2) {
            status.ahead = parseInt(parts[0]) || 0;
            status.behind = parseInt(parts[1]) || 0;
          }
        }
      }

      const logResult = await this._execGitAsync(repoPath, 'log -1 --format="%h|%s|%at|%an"', { timeout: 5000 });
      if (logResult.success && logResult.output) {
        const parts = logResult.output.split('|');
        if (parts.length >= 4) {
          status.lastCommit = {
            hash: parts[0],
            message: parts[1],
            timestamp: parseInt(parts[2]),
            author: parts[3]
          };
        }
      }

      status.overallStatus = this._calcOverallStatus(status);

      this.statusCache.set(cacheKey, { time: Date.now(), data: status });
    } catch (e) {
      console.error('git status error:', e.message);
    }

    return status;
  }

  async _isGitRepoAsync(repoPath) {
    try {
      const result = await this._execGitAsync(repoPath, 'rev-parse --is-inside-work-tree', { timeout: 5000 });
      return result.success && result.output === 'true';
    } catch {
      return false;
    }
  }

  _calcOverallStatus(status) {
    if (status.modified > 0 || status.staged > 0 || status.untracked > 0) {
      return 'dirty';
    }
    if (status.ahead > 0) {
      return 'ahead';
    }
    if (status.behind > 0) {
      return 'behind';
    }
    return 'clean';
  }

  async pull(repoPath) {
    this._clearCache(repoPath);
    return await this._execGitAsync(repoPath, 'pull', { timeout: 60000 });
  }

  async push(repoPath) {
    this._clearCache(repoPath);
    return await this._execGitAsync(repoPath, 'push', { timeout: 60000 });
  }

  async fetch(repoPath) {
    this._clearCache(repoPath);
    return await this._execGitAsync(repoPath, 'fetch', { timeout: 30000 });
  }

  async commit(repoPath, message) {
    this._clearCache(repoPath);
    const addResult = this._execGit(repoPath, 'add .', { timeout: 10000 });
    if (!addResult.success) {
      return { success: false, error: addResult.error };
    }
    return await this._execGitAsync(repoPath, `commit -m "${message.replace(/"/g, '\\"')}"`, { timeout: 30000 });
  }

  getLog(repoPath, limit = 20) {
    const result = this._execGit(repoPath, `log -${limit} --format="%h|%s|%at|%an"`, { timeout: 5000 });
    if (!result.success) return [];

    return result.output.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0] || '',
        message: parts[1] || '',
        timestamp: parseInt(parts[2]) || 0,
        author: parts[3] || ''
      };
    });
  }

  getDiff(repoPath) {
    const result = this._execGit(repoPath, 'diff --stat', { timeout: 5000 });
    if (!result.success) return { files: [], stats: null };

    const lines = result.output.split('\n').filter(l => l.trim());
    const statsLine = lines.pop();
    const files = lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        file: parts[0] || '',
        changes: parts[1] || ''
      };
    });

    return { files, stats: statsLine || null };
  }

  getStagedDiff(repoPath) {
    const result = this._execGit(repoPath, 'diff --cached --stat', { timeout: 5000 });
    if (!result.success) return { files: [], stats: null };

    const lines = result.output.split('\n').filter(l => l.trim());
    const statsLine = lines.pop();
    const files = lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        file: parts[0] || '',
        changes: parts[1] || ''
      };
    });

    return { files, stats: statsLine || null };
  }

  getRemotes(repoPath) {
    const result = this._execGit(repoPath, 'remote -v', { timeout: 5000 });
    if (!result.success) return [];

    const remotes = new Map();
    result.output.split('\n').filter(l => l.trim()).forEach(line => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const urlType = parts[1].trim().split(' ');
        const url = urlType[0];
        const type = urlType[1] || 'fetch';

        if (!remotes.has(name)) {
          remotes.set(name, { name, fetchUrl: '', pushUrl: '' });
        }
        const remote = remotes.get(name);
        if (type.includes('fetch')) remote.fetchUrl = url;
        if (type.includes('push')) remote.pushUrl = url;
      }
    });

    return Array.from(remotes.values());
  }

  addRemote(repoPath, name, url) {
    this._clearCache(repoPath);
    return this._execGit(repoPath, `remote add ${name} "${url}"`, { timeout: 5000 });
  }

  setRemoteUrl(repoPath, name, url) {
    this._clearCache(repoPath);
    return this._execGit(repoPath, `remote set-url ${name} "${url}"`, { timeout: 5000 });
  }

  removeRemote(repoPath, name) {
    this._clearCache(repoPath);
    return this._execGit(repoPath, `remote remove ${name}`, { timeout: 5000 });
  }

  getBranches(repoPath) {
    const result = this._execGit(repoPath, 'branch -a', { timeout: 5000 });
    if (!result.success) return [];

    return result.output.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes('HEAD'))
      .map(l => ({
        name: l.replace('* ', '').replace('remotes/origin/', ''),
        isCurrent: l.startsWith('* '),
        isRemote: l.startsWith('remotes/')
      }));
  }

  checkoutBranch(repoPath, branchName) {
    this._clearCache(repoPath);
    return this._execGit(repoPath, `checkout ${branchName}`, { timeout: 10000 });
  }

  batchStatus(repoPaths, { autoFetch = false } = {}) {
    return repoPaths.map(p => ({
      path: p,
      status: this.getStatus(p, { autoFetch })
    }));
  }

  _clearCache(repoPath) {
    this.statusCache.delete(repoPath);
    this.statusCache.delete(repoPath + '_fetch');
  }

  clearAllCache() {
    this.statusCache.clear();
  }
}

module.exports = new GitService();
