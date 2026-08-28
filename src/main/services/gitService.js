const { execFileSync, execFile } = require('child_process');
const fs = require('node:fs');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const { parseUnifiedDiff, buildSelectionPatch } = require('../../shared/gitPatchSelection');

const MAX_REVIEW_FILES = 1000;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_BATCH_REPOS = 1000;
const DEFAULT_BATCH_CONCURRENCY = 6;
const MAX_BATCH_CONCURRENCY = 12;
const BATCH_HISTORY_TTL = 60 * 1000;
const GIT_PREVIEW_TTL = 2 * 60 * 1000;
const MAX_PREVIEW_HISTORY = 100;

class GitService {
  constructor() {
    this.statusCache = new Map();
    this.cacheTimeout = 30000;
    this.statusBatches = new Map();
    this.lineSelectionPreviews = new Map();
    this.amendPreviews = new Map();
  }

  _execGit(repoPath, args, {
    timeout = 30000,
    trim = true,
    maxBuffer = 5 * 1024 * 1024,
    allowedExitCodes = []
  } = {}) {
    try {
      const result = execFileSync('git', args, {
        cwd: repoPath,
        timeout,
        encoding: 'utf-8',
        maxBuffer,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: trim ? result.trim() : result };
    } catch (e) {
      if (allowedExitCodes.includes(e.status)) {
        const output = typeof e.stdout === 'string' ? e.stdout : String(e.stdout || '');
        return { success: true, output: trim ? output.trim() : output };
      }
      return { success: false, error: e.stderr ? e.stderr.trim() : e.message };
    }
  }

  _execGitAsync(repoPath, args, { timeout = 60000, trim = true, signal } = {}) {
    if (signal?.aborted) {
      return Promise.resolve({ success: false, cancelled: true, error: '操作已取消' });
    }
    return new Promise((resolve) => {
      execFile('git', args, {
        cwd: repoPath,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        signal
      }, (error, stdout = '', stderr = '') => {
        if (!error) {
          resolve({ success: true, output: trim ? stdout.trim() : stdout });
          return;
        }
        if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
          resolve({ success: false, cancelled: true, error: '操作已取消' });
          return;
        }
        resolve({
          success: false,
          error: stderr.trim() || error.message
        });
      });
    });
  }

  _execGitWithInput(repoPath, args, input, { timeout = 15000 } = {}) {
    try {
      const output = execFileSync('git', args, {
        cwd: repoPath,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        input,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: output.trim() };
    } catch (error) {
      return {
        success: false,
        error: error.stderr ? String(error.stderr).trim() : error.message
      };
    }
  }

  isGitRepo(repoPath) {
    const result = this._execGit(repoPath, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
    return result.success && result.output === 'true';
  }

  async getStatus(repoPath, { autoFetch = false, forceRefresh = false, signal } = {}) {
    this._throwIfStatusCancelled(signal);
    const cacheKey = repoPath + (autoFetch ? '_fetch' : '');
    const cached = this.statusCache.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.time < this.cacheTimeout) {
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
      remoteUrl: '',
      upstream: '',
      upstreamRemote: ''
    };

    try {
      const isGit = await this._isGitRepoAsync(repoPath, signal);
      status.isGitRepo = isGit;
      if (!isGit) return status;

      const branchResult = await this._execGitAsync(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000, signal });
      this._throwIfGitResultCancelled(branchResult, signal);
      if (branchResult.success) {
        status.branch = branchResult.output;
      }

      const statusResult = await this._execGitAsync(repoPath, ['status', '--porcelain'], { timeout: 5000, trim: false, signal });
      this._throwIfGitResultCancelled(statusResult, signal);
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

      const remoteResult = await this._execGitAsync(repoPath, ['remote'], { timeout: 5000, signal });
      this._throwIfGitResultCancelled(remoteResult, signal);
      if (remoteResult.success && remoteResult.output) {
        status.hasRemote = true;
        const upstreamResult = await this._execGitAsync(
          repoPath,
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
          { timeout: 5000, signal }
        );
        this._throwIfGitResultCancelled(upstreamResult, signal);
        if (upstreamResult.success) {
          status.upstream = upstreamResult.output;
          status.upstreamRemote = upstreamResult.output.split('/')[0];
        }

        const remoteName = status.upstreamRemote || remoteResult.output.split('\n')[0];
        if (remoteName) {
          const urlResult = await this._execGitAsync(repoPath, ['remote', 'get-url', remoteName], { timeout: 5000, signal });
          this._throwIfGitResultCancelled(urlResult, signal);
          if (urlResult.success) {
            status.remoteUrl = urlResult.output;
          }
        }
      }

      if (status.hasRemote && status.branch && autoFetch) {
        const fetchResult = await this._execGitAsync(repoPath, ['fetch'], { timeout: 15000, signal });
        this._throwIfGitResultCancelled(fetchResult, signal);
      }

      if (status.upstream) {
        const aheadBehind = await this._execGitAsync(
          repoPath,
          ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
          { timeout: 5000, signal }
        );
        this._throwIfGitResultCancelled(aheadBehind, signal);
        if (aheadBehind.success) {
          const parts = aheadBehind.output.split('\t');
          if (parts.length === 2) {
            status.ahead = parseInt(parts[0]) || 0;
            status.behind = parseInt(parts[1]) || 0;
          }
        }
      }

      const logResult = await this._execGitAsync(repoPath, ['log', '-1', '--format=%h|%s|%at|%an'], { timeout: 5000, signal });
      this._throwIfGitResultCancelled(logResult, signal);
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
      if (this._isStatusCancellation(e)) throw e;
      console.error('git status error:', e.message);
    }

    return status;
  }

  async _isGitRepoAsync(repoPath, signal) {
    try {
      const result = await this._execGitAsync(repoPath, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000, signal });
      this._throwIfGitResultCancelled(result, signal);
      return result.success && result.output === 'true';
    } catch (error) {
      if (this._isStatusCancellation(error)) throw error;
      return false;
    }
  }

  _statusCancellationError() {
    const error = new Error('Git 状态读取已取消');
    error.code = 'GIT_STATUS_CANCELLED';
    return error;
  }

  _isStatusCancellation(error) {
    return error?.code === 'GIT_STATUS_CANCELLED' || error?.name === 'AbortError';
  }

  _throwIfStatusCancelled(signal) {
    if (signal?.aborted) throw this._statusCancellationError();
  }

  _throwIfGitResultCancelled(result, signal) {
    if (result?.cancelled || signal?.aborted) throw this._statusCancellationError();
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
    return await this._execGitAsync(repoPath, ['pull'], { timeout: 60000 });
  }

  async push(repoPath) {
    this._clearCache(repoPath);
    return await this._execGitAsync(repoPath, ['push'], { timeout: 60000 });
  }

  async fetch(repoPath) {
    this._clearCache(repoPath);
    return await this._execGitAsync(repoPath, ['fetch'], { timeout: 30000 });
  }

  async commit(repoPath, message) {
    this._clearCache(repoPath);
    if (!this._isValidCommitMessage(message)) {
      return { success: false, error: '提交信息不能为空且不能超过 2000 个字符' };
    }
    const review = this.getWorkingTree(repoPath);
    if (!review.success) return review;
    if (review.conflictCount > 0) {
      return { success: false, error: '存在冲突文件，请先解决冲突再提交' };
    }
    if (review.stagedCount === 0) {
      return { success: false, error: '没有已暂存文件，请先选择本次提交范围' };
    }
    const result = await this._execGitAsync(repoPath, ['commit', '-m', message.trim()], { timeout: 30000 });
    this._clearCache(repoPath);
    return result;
  }

  getWorkingTree(repoPath) {
    const statusResult = this._execGit(
      repoPath,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { timeout: 10000, trim: false }
    );
    if (!statusResult.success) {
      return { success: false, error: statusResult.error, files: [] };
    }

    const files = this._parsePorcelainStatus(statusResult.output);
    const limited = files.length > MAX_REVIEW_FILES;
    const visibleFiles = limited ? files.slice(0, MAX_REVIEW_FILES) : files;
    return {
      success: true,
      files: visibleFiles,
      stagedCount: files.filter(file => file.staged).length,
      unstagedCount: files.filter(file => file.unstaged).length,
      conflictCount: files.filter(file => file.conflict).length,
      totalCount: files.length,
      limited
    };
  }

  getFileDiff(repoPath, filePath, { staged = false } = {}) {
    let normalizedPath;
    try {
      [normalizedPath] = this._normalizeFilePaths(repoPath, [filePath]);
    } catch (error) {
      return { success: false, error: error.message, diff: '' };
    }

    const review = this.getWorkingTree(repoPath);
    if (!review.success) return { ...review, diff: '' };
    const file = review.files.find(item => item.path === normalizedPath);
    if (!file) {
      return { success: false, error: '该文件不在当前变更列表中', diff: '' };
    }

    let result;
    if (!staged && file.untracked) {
      result = this._execGit(
        repoPath,
        ['diff', '--no-index', '--no-ext-diff', '--text', '--unified=3', '--', '/dev/null', normalizedPath],
        { timeout: 10000, trim: false, allowedExitCodes: [1], maxBuffer: MAX_DIFF_BYTES * 2 }
      );
    } else {
      const args = ['diff'];
      if (staged) args.push('--cached');
      args.push('--no-ext-diff', '--unified=3', '--', this._literalPathspec(normalizedPath));
      result = this._execGit(repoPath, args, { timeout: 10000, trim: false, maxBuffer: MAX_DIFF_BYTES * 2 });
    }

    if (!result.success) return { success: false, error: result.error, diff: '' };
    const limitedDiff = this._limitDiff(result.output);
    const fingerprint = this._hash(result.output);
    const lineSelection = this._describeLineSelection(file, Boolean(staged), limitedDiff);
    return {
      success: true,
      path: normalizedPath,
      staged: Boolean(staged),
      diff: limitedDiff.text,
      truncated: limitedDiff.truncated,
      fingerprint,
      lineSelection
    };
  }

  previewLineSelection(repoPath, filePath, options = {}) {
    const staged = options?.staged === true;
    if (typeof options?.diffFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.diffFingerprint)) {
      return { success: false, error: '差异身份无效，请重新打开文件差异' };
    }
    if (!Array.isArray(options?.lineIds) || options.lineIds.length === 0 || options.lineIds.length > 2000) {
      return { success: false, error: '请选择有效的变更行' };
    }

    const current = this.getFileDiff(repoPath, filePath, { staged });
    if (!current.success) return current;
    if (current.fingerprint !== options.diffFingerprint) {
      return { success: false, error: '文件差异已变化，请重新预览后再操作' };
    }
    if (!current.lineSelection?.supported) {
      return { success: false, error: current.lineSelection?.reason || '该文件不支持行级操作' };
    }

    let selection;
    try {
      selection = buildSelectionPatch(current.diff, options.lineIds);
    } catch (error) {
      return { success: false, error: error.message };
    }
    const applyArgs = this._lineApplyArgs(staged, true);
    const checked = this._execGitWithInput(repoPath, applyArgs, selection.patch);
    if (!checked.success) {
      return { success: false, error: `所选行无法安全应用：${checked.error}` };
    }

    this._prunePreviewMap(this.lineSelectionPreviews);
    const previewId = randomUUID();
    const token = randomUUID();
    const preview = {
      previewId,
      token,
      repoPath: path.resolve(repoPath),
      filePath: current.path,
      staged,
      diffFingerprint: current.fingerprint,
      lineIds: [...new Set(options.lineIds)].sort(),
      patchHash: this._hash(selection.patch),
      createdAt: Date.now(),
      applied: false,
      result: null,
      summary: {
        selectedLineCount: selection.selectedLineCount,
        additionCount: selection.additionCount,
        deletionCount: selection.deletionCount,
        hunkCount: selection.hunkCount
      }
    };
    this.lineSelectionPreviews.set(previewId, preview);
    return {
      success: true,
      previewId,
      token,
      expiresAt: preview.createdAt + GIT_PREVIEW_TTL,
      path: current.path,
      staged,
      action: staged ? 'unstage' : 'stage',
      ...preview.summary
    };
  }

  applyLineSelection(repoPath, request = {}) {
    this._prunePreviewMap(this.lineSelectionPreviews);
    const preview = this.lineSelectionPreviews.get(request?.previewId);
    const validationError = this._validatePreviewRequest(preview, request?.token, repoPath);
    if (validationError) return { success: false, error: validationError };
    if (preview.applied) return { ...preview.result, alreadyApplied: true };

    const current = this.getFileDiff(repoPath, preview.filePath, { staged: preview.staged });
    if (!current.success || current.fingerprint !== preview.diffFingerprint) {
      return { success: false, error: '文件差异已变化，请重新预览后再操作' };
    }

    let selection;
    try {
      selection = buildSelectionPatch(current.diff, preview.lineIds);
    } catch (error) {
      return { success: false, error: `文件差异已变化，请重新预览：${error.message}` };
    }
    if (this._hash(selection.patch) !== preview.patchHash) {
      return { success: false, error: '所选补丁已变化，请重新预览后再操作' };
    }

    const checked = this._execGitWithInput(repoPath, this._lineApplyArgs(preview.staged, true), selection.patch);
    if (!checked.success) return { success: false, error: `应用前校验失败：${checked.error}` };
    const applied = this._execGitWithInput(repoPath, this._lineApplyArgs(preview.staged, false), selection.patch);
    if (!applied.success) return { success: false, error: `行级 Git 操作失败：${applied.error}` };

    this._clearCache(repoPath);
    preview.applied = true;
    preview.result = {
      success: true,
      alreadyApplied: false,
      path: preview.filePath,
      staged: preview.staged,
      action: preview.staged ? 'unstage' : 'stage',
      ...preview.summary
    };
    return preview.result;
  }

  getAmendContext(repoPath) {
    const snapshot = this._readAmendSnapshot(repoPath);
    return snapshot.success ? snapshot.context : snapshot;
  }

  previewAmend(repoPath, message) {
    if (!this._isValidCommitMessage(message)) {
      return { success: false, error: '提交信息不能为空且不能超过 2000 个字符' };
    }
    const snapshot = this._readAmendSnapshot(repoPath);
    if (!snapshot.success) return snapshot;
    const context = snapshot.context;
    if (context.conflictCount > 0) return { success: false, error: '存在冲突文件，请先解决冲突再 amend' };
    if (context.limited) return { success: false, error: '工作区变更超过审查上限，无法安全 amend' };
    if (context.unsafeOperations.length) {
      return { success: false, error: `检测到进行中的 Git 操作：${context.unsafeOperations.join('、')}` };
    }

    const normalizedMessage = message.trim();
    const messageChanged = normalizedMessage !== context.head.message;
    const contentChanged = context.stagedCount > 0;
    if (!messageChanged && !contentChanged) {
      return { success: false, error: '提交信息和已暂存内容均未变化，无需 amend' };
    }

    this._prunePreviewMap(this.amendPreviews);
    const previewId = randomUUID();
    const token = randomUUID();
    const preview = {
      previewId,
      token,
      repoPath: path.resolve(repoPath),
      message: normalizedMessage,
      fingerprint: snapshot.fingerprint,
      createdAt: Date.now(),
      applied: false,
      result: null,
      requiresPublishedConfirmation: context.published.likely,
      publishedRefs: context.published.refs,
      summary: {
        head: context.head,
        stagedCount: context.stagedCount,
        stagedPaths: context.stagedPaths,
        messageChanged,
        contentChanged
      }
    };
    this.amendPreviews.set(previewId, preview);
    return {
      success: true,
      previewId,
      token,
      expiresAt: preview.createdAt + GIT_PREVIEW_TTL,
      requiresPublishedConfirmation: preview.requiresPublishedConfirmation,
      publishedRefs: preview.publishedRefs,
      nextMessage: normalizedMessage,
      ...preview.summary
    };
  }

  async applyAmend(repoPath, request = {}) {
    this._prunePreviewMap(this.amendPreviews);
    const preview = this.amendPreviews.get(request?.previewId);
    const validationError = this._validatePreviewRequest(preview, request?.token, repoPath);
    if (validationError) return { success: false, error: validationError };
    if (preview.applied) return { ...preview.result, alreadyApplied: true };

    const snapshot = this._readAmendSnapshot(repoPath);
    if (!snapshot.success
      || snapshot.context.conflictCount > 0
      || snapshot.context.limited
      || snapshot.context.unsafeOperations.length
      || snapshot.fingerprint !== preview.fingerprint) {
      return { success: false, error: 'HEAD、索引或 Git 操作状态已变化，请重新预览 amend' };
    }
    if (preview.requiresPublishedConfirmation && request?.acknowledgePublished !== true) {
      return { success: false, error: '该 HEAD 可能已经发布，必须明确确认后才能 amend' };
    }

    const result = await this._execGitAsync(repoPath, ['commit', '--amend', '-m', preview.message], { timeout: 30000 });
    if (!result.success) return result;
    this._clearCache(repoPath);
    const nextHead = this._execGit(repoPath, ['rev-parse', 'HEAD'], { timeout: 5000 });
    preview.applied = true;
    preview.result = {
      success: true,
      output: result.output,
      alreadyApplied: false,
      previousHead: preview.summary.head.hash,
      head: nextHead.success ? nextHead.output : '',
      stagedCount: preview.summary.stagedCount,
      messageChanged: preview.summary.messageChanged,
      contentChanged: preview.summary.contentChanged
    };
    return preview.result;
  }

  _readAmendSnapshot(repoPath) {
    const headResult = this._execGit(repoPath, ['rev-parse', '--verify', 'HEAD'], { timeout: 5000 });
    if (!headResult.success) return { success: false, error: '当前仓库还没有可 amend 的 HEAD 提交' };
    const headDetails = this._execGit(
      repoPath,
      ['show', '-s', '--format=%h%x00%an%x00%at%x00%P%x00%B', 'HEAD'],
      { timeout: 5000, trim: false }
    );
    if (!headDetails.success) return { success: false, error: headDetails.error };

    const review = this.getWorkingTree(repoPath);
    if (!review.success) return review;
    const gitDirResult = this._execGit(repoPath, ['rev-parse', '--absolute-git-dir'], { timeout: 5000 });
    if (!gitDirResult.success) return { success: false, error: gitDirResult.error };
    const unsafeOperations = this._detectUnsafeGitOperations(gitDirResult.output);
    const publishedResult = this._execGit(
      repoPath,
      ['for-each-ref', '--format=%(refname:short)', '--contains', 'HEAD', 'refs/remotes'],
      { timeout: 5000 }
    );
    const publishedRefs = publishedResult.success
      ? [...new Set(publishedResult.output.split('\n').map(value => value.trim()).filter(Boolean))]
      : [];
    const indexResult = this._execGit(repoPath, ['ls-files', '-s', '-z'], { timeout: 10000, trim: false });
    if (!indexResult.success) return { success: false, error: indexResult.error };

    const fields = headDetails.output.split('\0');
    const message = fields.slice(4).join('\0').replace(/\n+$/, '');
    const head = {
      hash: headResult.output,
      shortHash: fields[0] || headResult.output.slice(0, 7),
      author: fields[1] || '',
      timestamp: Number.parseInt(fields[2], 10) || 0,
      parentHashes: (fields[3] || '').split(' ').filter(Boolean),
      message
    };
    const stagedPaths = review.files.filter(file => file.staged).map(file => file.path);
    const context = {
      success: true,
      head,
      stagedCount: review.stagedCount,
      stagedPaths,
      conflictCount: review.conflictCount,
      limited: review.limited,
      unsafeOperations,
      published: {
        likely: publishedRefs.length > 0,
        refs: publishedRefs
      },
      canAmend: review.conflictCount === 0 && !review.limited && unsafeOperations.length === 0
    };
    const fingerprint = this._hash([
      head.hash,
      indexResult.output,
      unsafeOperations.join('\0'),
      publishedRefs.join('\0')
    ].join('\0\0'));
    return { success: true, context, fingerprint };
  }

  _detectUnsafeGitOperations(gitDir) {
    const markers = [
      ['MERGE_HEAD', '合并提交'],
      ['CHERRY_PICK_HEAD', 'cherry-pick'],
      ['REVERT_HEAD', 'revert'],
      ['BISECT_LOG', 'bisect'],
      ['rebase-merge', 'rebase'],
      ['rebase-apply', 'rebase'],
      ['sequencer', 'sequencer'],
      ['index.lock', '索引锁']
    ];
    return [...new Set(markers
      .filter(([marker]) => fs.existsSync(path.join(gitDir, marker)))
      .map(([, label]) => label))];
  }

  stageFiles(repoPath, filePaths) {
    let normalizedPaths;
    try {
      normalizedPaths = this._normalizeFilePaths(repoPath, filePaths);
    } catch (error) {
      return { success: false, error: error.message };
    }
    const result = this._execGit(
      repoPath,
      ['add', '--', ...normalizedPaths.map(filePath => this._literalPathspec(filePath))],
      { timeout: 15000 }
    );
    this._clearCache(repoPath);
    return result;
  }

  unstageFiles(repoPath, filePaths) {
    let normalizedPaths;
    try {
      normalizedPaths = this._normalizeFilePaths(repoPath, filePaths);
    } catch (error) {
      return { success: false, error: error.message };
    }
    const pathspecs = normalizedPaths.map(filePath => this._literalPathspec(filePath));
    const hasHead = this._execGit(repoPath, ['rev-parse', '--verify', 'HEAD'], { timeout: 5000 }).success;
    const args = hasHead
      ? ['restore', '--staged', '--', ...pathspecs]
      : ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...pathspecs];
    const result = this._execGit(repoPath, args, { timeout: 15000 });
    this._clearCache(repoPath);
    return result;
  }

  _parsePorcelainStatus(output) {
    if (!output) return [];
    const records = output.split('\0');
    const files = [];
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!record || record.length < 4) continue;
      const indexStatus = record[0];
      const worktreeStatus = record[1];
      const filePath = record.slice(3);
      const renamedOrCopied = indexStatus === 'R' || indexStatus === 'C';
      const originalPath = renamedOrCopied ? (records[++index] || '') : '';
      const code = `${indexStatus}${worktreeStatus}`;
      const untracked = code === '??';
      const conflict = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code);
      files.push({
        path: filePath,
        originalPath,
        indexStatus,
        worktreeStatus,
        staged: !untracked && indexStatus !== ' ' && indexStatus !== '?',
        unstaged: untracked || (worktreeStatus !== ' ' && worktreeStatus !== '?'),
        untracked,
        conflict,
        kind: this._statusKind(code)
      });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
  }

  _statusKind(code) {
    if (code === '??') return 'untracked';
    if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)) return 'conflict';
    if (code.includes('R')) return 'renamed';
    if (code.includes('C')) return 'copied';
    if (code.includes('A')) return 'added';
    if (code.includes('D')) return 'deleted';
    if (code.includes('T')) return 'typechange';
    return 'modified';
  }

  _normalizeFilePaths(repoPath, filePaths) {
    if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
      throw new Error('仓库路径无效');
    }
    if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > MAX_REVIEW_FILES) {
      throw new Error('请选择有效的变更文件');
    }
    const repoRoot = path.resolve(repoPath);
    return [...new Set(filePaths.map(filePath => {
      if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
        throw new Error('变更文件路径无效');
      }
      const candidate = path.resolve(repoRoot, filePath);
      const relative = path.relative(repoRoot, candidate);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('变更文件不能位于仓库目录之外');
      }
      return relative.split(path.sep).join('/');
    }))];
  }

  _literalPathspec(filePath) {
    return `:(literal)${filePath}`;
  }

  _describeLineSelection(file, staged, limitedDiff) {
    if (limitedDiff.truncated) {
      return { supported: false, reason: '差异已截断，请使用整文件操作', lines: [] };
    }
    if (file.conflict) return { supported: false, reason: '冲突文件需先完成冲突处理', lines: [] };
    if (staged && !file.staged) return { supported: false, reason: '该文件没有已暂存差异', lines: [] };
    if (!staged && !file.unstaged) return { supported: false, reason: '该文件没有未暂存差异', lines: [] };
    if (file.kind !== 'modified') {
      const reasons = {
        untracked: '未跟踪文件请使用整文件暂存',
        added: '新增文件请使用整文件操作',
        deleted: '删除文件请使用整文件操作',
        renamed: '重命名文件请使用整文件操作',
        copied: '复制文件请使用整文件操作',
        typechange: '类型变化请使用整文件操作'
      };
      return { supported: false, reason: reasons[file.kind] || '该变更请使用整文件操作', lines: [] };
    }
    const parsed = parseUnifiedDiff(limitedDiff.text);
    return {
      supported: parsed.supported,
      reason: parsed.reason,
      lines: parsed.supported ? parsed.changedLines : []
    };
  }

  _lineApplyArgs(staged, check) {
    const args = ['apply', '--cached'];
    if (check) args.push('--check');
    args.push('--recount', '--unidiff-zero');
    if (staged) args.push('--reverse');
    args.push('-');
    return args;
  }

  _validatePreviewRequest(preview, token, repoPath) {
    if (!preview) return '预览已失效，请重新预览';
    if (!this._tokensEqual(preview.token, token)) return '预览凭证无效';
    if (Date.now() - preview.createdAt > GIT_PREVIEW_TTL) return '预览已过期，请重新预览';
    if (typeof repoPath !== 'string' || path.resolve(repoPath) !== preview.repoPath) return '预览与当前仓库不匹配';
    return '';
  }

  _tokensEqual(expected, received) {
    if (typeof expected !== 'string' || typeof received !== 'string') return false;
    const left = Buffer.from(expected);
    const right = Buffer.from(received);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  _prunePreviewMap(previews) {
    const cutoff = Date.now() - GIT_PREVIEW_TTL;
    for (const [previewId, preview] of previews) {
      if (preview.createdAt < cutoff) previews.delete(previewId);
    }
    if (previews.size < MAX_PREVIEW_HISTORY) return;
    const oldest = [...previews.values()].sort((left, right) => left.createdAt - right.createdAt);
    while (previews.size >= MAX_PREVIEW_HISTORY && oldest.length) {
      previews.delete(oldest.shift().previewId);
    }
  }

  _hash(value) {
    return createHash('sha256').update(value || '', 'utf8').digest('hex');
  }

  _isValidCommitMessage(message) {
    return typeof message === 'string' && Boolean(message.trim()) && message.length <= 2000;
  }

  _limitDiff(diff) {
    const bytes = Buffer.from(diff || '', 'utf8');
    if (bytes.length <= MAX_DIFF_BYTES) return { text: diff || '', truncated: false };
    return {
      text: `${bytes.subarray(0, MAX_DIFF_BYTES).toString('utf8')}\n\n…差异过大，仅显示前 1 MB…`,
      truncated: true
    };
  }

  getLog(repoPath, limit = 20) {
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 200);
    const result = this._execGit(repoPath, ['log', '-n', String(safeLimit), '--format=%h|%s|%at|%an'], { timeout: 5000 });
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
    const result = this._execGit(repoPath, ['diff', '--stat'], { timeout: 5000 });
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
    const result = this._execGit(repoPath, ['diff', '--cached', '--stat'], { timeout: 5000 });
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
    const result = this._execGit(repoPath, ['remote', '-v'], { timeout: 5000 });
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
    if (!this._isValidRemoteName(name) || typeof url !== 'string' || !url.trim()) {
      return { success: false, error: '远程仓库名称或 URL 无效' };
    }
    return this._execGit(repoPath, ['remote', 'add', name, url], { timeout: 5000 });
  }

  setRemoteUrl(repoPath, name, url) {
    this._clearCache(repoPath);
    if (!this._isValidRemoteName(name) || typeof url !== 'string' || !url.trim()) {
      return { success: false, error: '远程仓库名称或 URL 无效' };
    }
    return this._execGit(repoPath, ['remote', 'set-url', name, url], { timeout: 5000 });
  }

  removeRemote(repoPath, name) {
    this._clearCache(repoPath);
    if (!this._isValidRemoteName(name)) {
      return { success: false, error: '远程仓库名称无效' };
    }
    return this._execGit(repoPath, ['remote', 'remove', name], { timeout: 5000 });
  }

  getBranches(repoPath) {
    const result = this._execGit(repoPath, ['branch', '-a'], { timeout: 5000 });
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
    if (!this._isValidBranchName(branchName)) {
      return { success: false, error: '分支名称无效' };
    }
    return this._execGit(repoPath, ['checkout', branchName], { timeout: 10000 });
  }

  _normalizeBatchRepoPaths(repoPaths) {
    if (!Array.isArray(repoPaths)) throw new TypeError('仓库路径必须是数组');
    if (repoPaths.length > MAX_BATCH_REPOS) {
      throw new Error(`单次最多读取 ${MAX_BATCH_REPOS} 个仓库的 Git 状态`);
    }
    const unique = [];
    const seen = new Set();
    for (const repoPath of repoPaths) {
      if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
        throw new Error('批量 Git 状态只接受绝对路径');
      }
      const normalized = path.normalize(repoPath);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
    }
    return unique;
  }

  _normalizeBatchRequestId(value) {
    if (value === undefined || value === null || value === '') return randomUUID();
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw new Error('批量 Git 状态请求 ID 无效');
    }
    return value;
  }

  _batchSnapshot(operation, latest = null) {
    return {
      requestId: operation.requestId,
      total: operation.total,
      completed: operation.completed,
      running: operation.running,
      pending: Math.max(0, operation.total - operation.completed - operation.running),
      cancelled: operation.cancelled,
      done: operation.done,
      startedAt: operation.startedAt,
      finishedAt: operation.finishedAt || null,
      ...(latest ? { latest } : {})
    };
  }

  _emitBatchProgress(operation, latest = null) {
    if (typeof operation.onProgress !== 'function') return;
    try {
      operation.onProgress(this._batchSnapshot(operation, latest));
    } catch (_) {
      // 进度回调不得影响 Git 状态采集。
    }
  }

  _pruneBatchHistory() {
    const expiry = Date.now() - BATCH_HISTORY_TTL;
    for (const [requestId, operation] of this.statusBatches) {
      if (operation.done && Number(operation.finishedAt || 0) < expiry) this.statusBatches.delete(requestId);
    }
    if (this.statusBatches.size <= 50) return;
    const completed = [...this.statusBatches.values()]
      .filter(operation => operation.done)
      .sort((left, right) => Number(left.finishedAt || 0) - Number(right.finishedAt || 0));
    while (this.statusBatches.size > 50 && completed.length) {
      this.statusBatches.delete(completed.shift().requestId);
    }
  }

  async batchStatus(repoPaths, options = {}) {
    const paths = this._normalizeBatchRepoPaths(repoPaths);
    const requestId = this._normalizeBatchRequestId(options.requestId);
    this._pruneBatchHistory();
    const existing = this.statusBatches.get(requestId);
    if (existing && !existing.done) throw new Error('同一批量 Git 状态请求正在运行');

    const concurrency = Math.max(1, Math.min(
      MAX_BATCH_CONCURRENCY,
      Number.isInteger(Number(options.concurrency)) ? Number(options.concurrency) : DEFAULT_BATCH_CONCURRENCY
    ));
    const controller = new AbortController();
    const operation = {
      requestId,
      controller,
      total: paths.length,
      completed: 0,
      running: 0,
      cancelled: false,
      done: false,
      startedAt: Date.now(),
      finishedAt: null,
      results: new Array(paths.length),
      onProgress: options.onProgress
    };
    this.statusBatches.set(requestId, operation);
    this._emitBatchProgress(operation);

    let nextIndex = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex++;
        if (index >= paths.length) break;
        const repoPath = paths[index];
        operation.running += 1;
        try {
          const status = await this.getStatus(repoPath, {
            autoFetch: options.autoFetch === true,
            forceRefresh: options.forceRefresh === true,
            signal: controller.signal
          });
          const result = { path: repoPath, status };
          operation.results[index] = result;
          operation.completed += 1;
          operation.running -= 1;
          this._emitBatchProgress(operation, result);
        } catch (error) {
          operation.running -= 1;
          if (!this._isStatusCancellation(error)) {
            const result = { path: repoPath, status: { isGitRepo: false }, error: error.message || String(error) };
            operation.results[index] = result;
            operation.completed += 1;
            this._emitBatchProgress(operation, result);
          } else {
            this._emitBatchProgress(operation);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
    operation.cancelled = controller.signal.aborted;
    operation.done = true;
    operation.running = 0;
    operation.finishedAt = Date.now();
    this._emitBatchProgress(operation);
    operation.onProgress = null;

    const results = operation.results.filter(Boolean);
    if (options.includeSummary === true) {
      return {
        requestId,
        cancelled: operation.cancelled,
        total: operation.total,
        completed: operation.completed,
        results
      };
    }
    return results;
  }

  getBatchStatusProgress(requestId) {
    const operation = this.statusBatches.get(requestId);
    return operation ? this._batchSnapshot(operation) : null;
  }

  cancelBatchStatus(requestId) {
    const operation = this.statusBatches.get(requestId);
    if (!operation) return { found: false, cancelled: false, requestId };
    if (!operation.done && !operation.controller.signal.aborted) {
      operation.cancelled = true;
      operation.controller.abort();
      this._emitBatchProgress(operation);
    }
    return { found: true, cancelled: operation.cancelled, requestId };
  }

  _isValidRemoteName(name) {
    return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
  }

  _isValidBranchName(name) {
    return typeof name === 'string'
      && name.length > 0
      && name.length <= 255
      && !name.startsWith('-')
      && !name.includes('..')
      && !name.includes('@{')
      && !/[~^:\\?*\[\]\s]/.test(name);
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
