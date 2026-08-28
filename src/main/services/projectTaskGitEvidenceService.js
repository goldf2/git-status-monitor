const fs = require('node:fs');
const path = require('node:path');

const projectTaskProjectionService = require('./projectTaskProjectionService');
const gitService = require('./gitService');
const configService = require('./configService');

const MAX_WORKING_TREE_FILES = 12;
const MAX_RECENT_COMMITS = 12;
const DEFAULT_CACHE_TTL_MS = 30000;

function isPathInside(candidatePath, parentPath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class ProjectTaskGitEvidenceService {
  constructor(options = {}) {
    this.projectTaskProjectionService = options.projectTaskProjectionService || projectTaskProjectionService;
    this.gitService = options.gitService || gitService;
    this.configService = options.configService || configService;
    this.now = options.now || (() => new Date());
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache = new Map();
  }

  async getTaskEvidence(taskKey, { forceRefresh = false } = {}) {
    if (typeof taskKey !== 'string' || !taskKey.trim() || taskKey.length > 300 || taskKey.includes('\0')) {
      return this._failure('任务标识无效');
    }

    const normalizedTaskKey = taskKey.trim();
    const cached = this.cache.get(normalizedTaskKey);
    const now = this.now();
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!forceRefresh && cached && nowMs - cached.cachedAt < this.cacheTtlMs) {
      return cached.data;
    }

    const portfolio = await this.projectTaskProjectionService.getPortfolio();
    if (!portfolio?.success) {
      return this._failure(portfolio?.error || '无法读取任务投影');
    }

    const task = (portfolio.tasks || []).find(item => item?.key === normalizedTaskKey);
    if (!task) {
      return this._failure('任务不存在或不在当前只读投影中');
    }

    const repositories = await this._mapWithConcurrency(
      Array.isArray(task.repositories) ? task.repositories : [],
      2,
      repository => this._readRepositoryEvidence(repository, task, forceRefresh)
    );
    const generatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
    const result = {
      success: true,
      readOnly: true,
      generatedAt,
      task: {
        key: task.key,
        projectId: task.projectId,
        projectName: task.projectName,
        taskId: task.taskId,
        title: task.title
      },
      repositories
    };

    this.cache.set(normalizedTaskKey, { cachedAt: nowMs, data: result });
    return result;
  }

  async _readRepositoryEvidence(repository, task, forceRefresh) {
    const identity = {
      id: repository?.id || '',
      name: repository?.name || repository?.id || '未命名仓库',
      path: repository?.path || '',
      relation: repository?.relation || '',
      notes: repository?.notes || ''
    };

    if (!repository?.available || !repository?.path) {
      return { ...identity, success: false, error: '关联仓库当前不可用' };
    }

    let repoPath;
    try {
      repoPath = this._assertManagedRepoPath(repository.path);
    } catch (error) {
      return { ...identity, success: false, error: error.message };
    }

    try {
      const status = await this.gitService.getStatus(repoPath, {
        autoFetch: false,
        forceRefresh: Boolean(forceRefresh)
      });
      if (!status?.isGitRepo) {
        return { ...identity, path: repoPath, success: false, error: '关联目录不是 Git 仓库' };
      }

      const workingTree = this.gitService.getWorkingTree(repoPath);
      const recentCommits = this.gitService.getLog(repoPath, MAX_RECENT_COMMITS) || [];
      const declaredHashes = this._getDeclaredCommitHashes(task.evidence);
      const taskIdPattern = task.taskId
        ? new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(task.taskId)}($|[^A-Za-z0-9])`, 'i')
        : null;
      const normalizedCommits = recentCommits.slice(0, MAX_RECENT_COMMITS).map(commit => ({
        hash: String(commit?.hash || ''),
        message: String(commit?.message || ''),
        timestamp: Number(commit?.timestamp) || 0,
        author: String(commit?.author || '')
      }));
      const matchedCommits = normalizedCommits.flatMap(commit => {
        if (taskIdPattern?.test(commit.message)) {
          return [{ ...commit, attribution: 'task-id' }];
        }
        const commitHash = commit.hash.toLowerCase();
        const declared = commitHash.length >= 7 && [...declaredHashes].some(hash =>
          commitHash.startsWith(hash) || hash.startsWith(commitHash)
        );
        return declared ? [{ ...commit, attribution: 'declared-hash' }] : [];
      });

      return {
        ...identity,
        path: repoPath,
        success: true,
        git: {
          isGitRepo: true,
          branch: String(status.branch || ''),
          overallStatus: String(status.overallStatus || 'clean'),
          ahead: Number(status.ahead) || 0,
          behind: Number(status.behind) || 0,
          hasRemote: Boolean(status.hasRemote),
          upstream: String(status.upstream || ''),
          lastCommit: status.lastCommit ? {
            hash: String(status.lastCommit.hash || ''),
            message: String(status.lastCommit.message || ''),
            timestamp: Number(status.lastCommit.timestamp) || 0,
            author: String(status.lastCommit.author || '')
          } : null,
          workingTree: this._normalizeWorkingTree(workingTree),
          recentCommits: normalizedCommits,
          matchedCommits,
          attributionRule: 'exact-task-id-or-declared-hash'
        }
      };
    } catch (error) {
      return { ...identity, path: repoPath, success: false, error: error.message || '读取 Git 实况失败' };
    }
  }

  _normalizeWorkingTree(workingTree) {
    if (!workingTree?.success) {
      return {
        success: false,
        error: workingTree?.error || '读取工作区失败',
        stagedCount: 0,
        unstagedCount: 0,
        conflictCount: 0,
        totalCount: 0,
        limited: false,
        files: []
      };
    }

    const files = Array.isArray(workingTree.files) ? workingTree.files : [];
    return {
      success: true,
      stagedCount: Number(workingTree.stagedCount) || 0,
      unstagedCount: Number(workingTree.unstagedCount) || 0,
      conflictCount: Number(workingTree.conflictCount) || 0,
      totalCount: Number(workingTree.totalCount) || 0,
      limited: Boolean(workingTree.limited || files.length > MAX_WORKING_TREE_FILES),
      files: files.slice(0, MAX_WORKING_TREE_FILES).map(file => ({
        path: String(file?.path || ''),
        kind: String(file?.kind || ''),
        staged: Boolean(file?.staged),
        unstaged: Boolean(file?.unstaged),
        untracked: Boolean(file?.untracked),
        conflict: Boolean(file?.conflict)
      }))
    };
  }

  _getDeclaredCommitHashes(evidence) {
    const hashes = new Set();
    for (const item of Array.isArray(evidence) ? evidence : []) {
      const reference = typeof item?.reference === 'string' ? item.reference : '';
      for (const match of reference.matchAll(/\b[0-9a-f]{7,40}\b/gi)) {
        hashes.add(match[0].toLowerCase());
      }
    }
    return hashes;
  }

  _assertManagedRepoPath(candidatePath) {
    if (typeof candidatePath !== 'string' || !path.isAbsolute(candidatePath)) {
      throw new Error('关联仓库路径无效');
    }
    if (!fs.existsSync(candidatePath)) {
      throw new Error('关联仓库路径不存在');
    }

    const roots = (this.configService.getTreeRoots?.() || [])
      .map(root => typeof root === 'string' ? root : root?.path)
      .filter(root => typeof root === 'string' && path.isAbsolute(root) && fs.existsSync(root));
    const lexicalRoot = roots.find(root => isPathInside(candidatePath, path.resolve(root)));
    if (!lexicalRoot) {
      throw new Error('关联仓库不在受管目录中');
    }

    const realpath = fs.realpathSync.native || fs.realpathSync;
    const realRoot = realpath(path.resolve(lexicalRoot));
    const realCandidate = realpath(path.resolve(candidatePath));
    if (!isPathInside(realCandidate, realRoot)) {
      throw new Error('关联仓库通过符号链接离开了受管目录');
    }
    if (!fs.statSync(realCandidate).isDirectory()) {
      throw new Error('关联仓库路径不是目录');
    }
    return realCandidate;
  }

  async _mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const currentIndex = index++;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });
    await Promise.all(workers);
    return results;
  }

  _failure(error) {
    return { success: false, readOnly: true, repositories: [], error };
  }
}

module.exports = new ProjectTaskGitEvidenceService();
module.exports.ProjectTaskGitEvidenceService = ProjectTaskGitEvidenceService;
