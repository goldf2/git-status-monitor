/**
 * Git 操作模块
 * - pull / push / fetch 由终端预填，保留用户确认边界
 * - commit 支持整文件与受控行级审查
 * - amend 先预览、再确认，渲染层不接收或上传任意补丁
 */
const GitOps = {
  _currentCommitRepo: null,
  _review: null,
  _selectedPath: '',
  _selectedStaged: false,
  _currentDiff: null,
  _selectedLineIds: new Set(),
  _linePreview: null,
  _diffScopeBase: '',
  _amendEnabled: false,
  _amendContext: null,
  _amendPreview: null,
  _messageBeforeAmend: '',
  _amendDidPrefill: false,
  _busy: false,
  _loadToken: 0,
  _diffLoadToken: 0,
  _amendLoadToken: 0,

  pull(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git pull');
    } catch (error) {
      console.error('[GitOps.pull]', error);
    }
  },

  push(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git push');
    } catch (error) {
      console.error('[GitOps.push]', error);
    }
  },

  fetch(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git fetch');
    } catch (error) {
      console.error('[GitOps.fetch]', error);
    }
  },

  async openCommitModal(repoPath) {
    this._currentCommitRepo = repoPath;
    this._review = null;
    this._selectedPath = '';
    this._selectedStaged = false;
    this._currentDiff = null;
    this._selectedLineIds.clear();
    this._linePreview = null;
    this._resetAmendState();
    this._setBusy(false);
    document.getElementById('commit-repo-path').textContent = repoPath;
    document.getElementById('commit-message').value = '';
    document.getElementById('commit-modal').style.display = 'flex';
    this._setFeedback('');
    document.getElementById('commit-message').focus();
    await this._loadCommitFiles(repoPath);
  },

  async _loadCommitFiles(repoPath = this._currentCommitRepo) {
    if (!repoPath) return;
    const token = ++this._loadToken;
    this._renderLoading();
    try {
      const review = await window.gitFinder.git.getWorkingTree(repoPath);
      if (token !== this._loadToken || repoPath !== this._currentCommitRepo) return;
      if (!review.success) throw new Error(review.error || '无法读取 Git 工作区');
      this._review = review;
      this._chooseSelectionAfterReload();
      this._renderReview();
      if (this._selectedPath) await this._loadSelectedDiff();
      else this._renderEmptyDiff('没有需要审查的变更。');
    } catch (error) {
      if (token !== this._loadToken) return;
      this._review = null;
      this._renderReviewError(error.message || String(error));
    }
  },

  _chooseSelectionAfterReload() {
    const files = this._review?.files || [];
    const previous = files.find(file => file.path === this._selectedPath);
    if (previous) {
      if (this._selectedStaged && previous.staged) return;
      if (!this._selectedStaged && previous.unstaged) return;
      this._selectedStaged = previous.staged;
      return;
    }
    const firstStaged = files.find(file => file.staged);
    const firstUnstaged = files.find(file => file.unstaged);
    const first = firstStaged || firstUnstaged;
    this._selectedPath = first?.path || '';
    this._selectedStaged = Boolean(firstStaged);
  },

  _renderLoading() {
    document.getElementById('commit-review-summary').className = 'commit-review-summary';
    document.getElementById('commit-review-summary').textContent = '正在读取工作区…';
    document.getElementById('commit-files').innerHTML = '<div class="commit-empty-state">正在加载变更…</div>';
    this._renderEmptyDiff('正在准备文件差异…');
    this._syncReviewControls();
  },

  _renderReview() {
    const review = this._review;
    const summary = document.getElementById('commit-review-summary');
    const parts = [`${review.stagedCount} 个已暂存`, `${review.unstagedCount} 个未暂存`];
    if (review.conflictCount) parts.push(`${review.conflictCount} 个冲突`);
    if (review.limited) parts.push(`共 ${review.totalCount} 个变更，仅显示前 1000 个`);
    summary.textContent = parts.join(' · ');
    summary.className = `commit-review-summary${review.conflictCount || review.limited ? ' warning' : ''}`;

    const stagedFiles = review.files.filter(file => file.staged);
    const unstagedFiles = review.files.filter(file => file.unstaged);
    const sections = [];
    if (stagedFiles.length) sections.push(this._renderFileSection('本次提交', stagedFiles, true));
    if (unstagedFiles.length) sections.push(this._renderFileSection('尚未暂存', unstagedFiles, false));
    document.getElementById('commit-files').innerHTML = sections.join('')
      || '<div class="commit-empty-state">工作区干净，没有可提交的变更。</div>';
    this._syncReviewControls();
  },

  _renderFileSection(title, files, staged) {
    const rows = files.map(file => {
      const active = file.path === this._selectedPath && staged === this._selectedStaged;
      const symbol = file.conflict ? '!' : (file.untracked ? '?' : (staged ? file.indexStatus : file.worktreeStatus));
      const rename = file.originalPath
        ? `<span class="commit-file-rename">${this._escapeHtml(file.originalPath)} →</span>`
        : '';
      const action = staged ? 'unstage' : 'stage';
      const actionLabel = staged ? '取消' : '暂存';
      return `
        <div class="commit-file-item${active ? ' active' : ''}">
          <button class="commit-file-open" type="button" data-review-file="${this._escapeHtml(file.path)}" data-review-staged="${staged}">
            <span class="commit-file-status status-${this._escapeHtml(file.kind)}" aria-label="${this._escapeHtml(file.kind)}">${this._escapeHtml(symbol)}</span>
            <span class="commit-file-name" title="${this._escapeHtml(file.path)}">${rename}${this._escapeHtml(file.path)}</span>
          </button>
          <button class="commit-file-action ${staged ? 'unstage' : ''}" type="button" data-git-file-action="${action}" data-file-path="${this._escapeHtml(file.path)}" ${this._busy ? 'disabled' : ''}>${actionLabel}</button>
        </div>`;
    }).join('');
    return `
      <div class="commit-file-section">
        <div class="commit-file-section-title"><span>${title}</span><span>${files.length}</span></div>
        ${rows}
      </div>`;
  },

  async _selectFile(filePath, staged) {
    this._selectedPath = filePath;
    this._selectedStaged = staged;
    this._invalidateLinePreview(true);
    this._renderReview();
    await this._loadSelectedDiff();
  },

  async _loadSelectedDiff() {
    const repoPath = this._currentCommitRepo;
    const filePath = this._selectedPath;
    const staged = this._selectedStaged;
    if (!repoPath || !filePath) return;
    const loadToken = ++this._diffLoadToken;
    const title = document.getElementById('commit-diff-title');
    const scope = document.getElementById('commit-diff-scope');
    const content = document.getElementById('commit-diff-content');
    this._invalidateLinePreview(true);
    this._currentDiff = null;
    title.textContent = filePath;
    scope.textContent = staged ? '已暂存差异' : '未暂存差异';
    content.className = 'commit-diff-content';
    content.textContent = '正在加载差异…';

    try {
      const result = await window.gitFinder.git.getFileDiff(repoPath, filePath, { staged });
      if (loadToken !== this._diffLoadToken
        || repoPath !== this._currentCommitRepo
        || filePath !== this._selectedPath
        || staged !== this._selectedStaged) return;
      if (!result.success) throw new Error(result.error || '无法读取文件差异');
      this._renderDiff(result);
    } catch (error) {
      if (loadToken !== this._diffLoadToken) return;
      this._currentDiff = null;
      content.textContent = `差异加载失败：${error.message || String(error)}`;
      this._syncLineControls();
    }
  },

  _renderDiff(result) {
    const content = document.getElementById('commit-diff-content');
    this._currentDiff = result;
    this._selectedLineIds.clear();
    this._linePreview = null;
    this._diffScopeBase = result.staged ? '已暂存差异' : '未暂存差异';
    content.replaceChildren();
    this._hideLinePreview();
    if (!result.diff) {
      content.textContent = '当前层没有可显示的文本差异，文件可能是二进制内容或变更已被另一层包含。';
      this._syncLineControls();
      return;
    }

    const parser = window.GitPatchSelection?.parseUnifiedDiff;
    const parsed = typeof parser === 'function' ? parser(result.diff) : null;
    const selectable = result.lineSelection?.supported && parsed?.supported;
    const allowedIds = new Set((result.lineSelection?.lines || []).map(line => line.id));
    const fragment = document.createDocumentFragment();
    if (selectable) {
      parsed.preamble.forEach(line => this._appendDiffRow(fragment, { raw: line, type: 'meta' }));
      parsed.hunks.forEach(hunk => {
        this._appendDiffRow(fragment, { raw: hunk.header, type: 'hunk' });
        hunk.body.forEach(row => this._appendDiffRow(fragment, {
          raw: row.raw,
          type: row.type,
          id: allowedIds.has(row.id) ? row.id : '',
          oldLine: row.oldLine,
          newLine: row.newLine
        }));
      });
    } else {
      result.diff.split('\n').forEach(line => this._appendDiffRow(fragment, {
        raw: line || ' ',
        type: this._diffLineClass(line)
      }));
    }
    content.appendChild(fragment);
    this._syncLineControls();
  },

  _appendDiffRow(fragment, { raw, type = '', id = '', oldLine = null, newLine = null }) {
    const row = document.createElement('div');
    row.className = `commit-diff-line ${this._diffLineClass(raw)}${id ? ' selectable' : ''}`.trim();
    if (type === 'addition') row.classList.add('addition');
    if (type === 'deletion') row.classList.add('deletion');
    if (type === 'hunk') row.classList.add('hunk');
    if (type === 'meta') row.classList.add('meta');

    const selector = document.createElement(id ? 'label' : 'span');
    selector.className = 'commit-diff-selector';
    if (id) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.lineId = id;
      const lineKind = type === 'addition' ? '新增' : '删除';
      checkbox.setAttribute('aria-label', `${this._selectedStaged ? '取消暂存' : '暂存'}第 ${oldLine || newLine || ''} 行${lineKind}内容`);
      selector.appendChild(checkbox);
    }
    row.appendChild(selector);

    for (const value of [oldLine, newLine]) {
      const number = document.createElement('span');
      number.className = 'commit-diff-line-number';
      number.textContent = Number.isInteger(value) ? String(value) : '';
      row.appendChild(number);
    }
    const code = document.createElement('span');
    code.className = 'commit-diff-code';
    code.textContent = raw || ' ';
    row.appendChild(code);
    fragment.appendChild(row);
  },

  _diffLineClass(line) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
    if (line.startsWith('+')) return 'addition';
    if (line.startsWith('-')) return 'deletion';
    if (line.startsWith('@@')) return 'hunk';
    return '';
  },

  _renderEmptyDiff(message) {
    this._currentDiff = null;
    this._selectedLineIds.clear();
    this._linePreview = null;
    this._diffScopeBase = '';
    document.getElementById('commit-diff-title').textContent = '选择文件查看差异';
    document.getElementById('commit-diff-scope').textContent = '';
    document.getElementById('commit-diff-content').textContent = message;
    this._hideLinePreview();
    this._syncLineControls();
  },

  _renderReviewError(message) {
    const summary = document.getElementById('commit-review-summary');
    summary.className = 'commit-review-summary error';
    summary.textContent = `读取失败：${message}`;
    document.getElementById('commit-files').innerHTML = '<div class="commit-empty-state">无法读取工作区。</div>';
    this._renderEmptyDiff('请确认仓库仍位于受管开发目录内。');
    this._syncReviewControls();
  },

  _toggleLineSelection(lineId, checked) {
    if (!lineId || this._linePreview) return;
    if (checked) this._selectedLineIds.add(lineId);
    else this._selectedLineIds.delete(lineId);
    this._syncLineControls();
  },

  async previewSelectedLines() {
    if (this._busy || !this._currentDiff || !this._selectedLineIds.size) return;
    const repoPath = this._currentCommitRepo;
    const filePath = this._selectedPath;
    const staged = this._selectedStaged;
    this._setBusy(true);
    this._setFeedback(staged ? '正在校验所选取消暂存行…' : '正在校验所选暂存行…');
    try {
      const result = await window.gitFinder.git.previewLineSelection(repoPath, filePath, {
        staged,
        diffFingerprint: this._currentDiff.fingerprint,
        lineIds: [...this._selectedLineIds]
      });
      if (!result.success) throw new Error(result.error || '无法预览所选行');
      if (repoPath !== this._currentCommitRepo || filePath !== this._selectedPath || staged !== this._selectedStaged) return;
      this._linePreview = result;
      this._renderLinePreview(result);
      this._setFeedback('预览已完成；应用时会再次校验文件与索引。', 'success');
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  _renderLinePreview(preview) {
    const panel = document.getElementById('commit-line-preview');
    const verb = preview.staged ? '取消暂存' : '暂存';
    document.getElementById('commit-line-preview-title').textContent = `将${verb} ${preview.selectedLineCount} 行`;
    document.getElementById('commit-line-preview-summary').textContent = `新增 ${preview.additionCount} 行 · 删除 ${preview.deletionCount} 行 · ${preview.hunkCount} 个差异区块`;
    document.getElementById('commit-line-apply-btn').textContent = `确认${verb}所选行`;
    panel.hidden = false;
    this._syncLineControls();
  },

  _hideLinePreview() {
    const panel = document.getElementById('commit-line-preview');
    if (panel) panel.hidden = true;
  },

  _invalidateLinePreview(clearSelection = false) {
    this._linePreview = null;
    if (clearSelection) this._selectedLineIds.clear();
    this._hideLinePreview();
    this._syncLineControls();
  },

  async applySelectedLines() {
    if (this._busy || !this._linePreview) return;
    const preview = this._linePreview;
    const repoPath = this._currentCommitRepo;
    this._setBusy(true);
    this._setFeedback(preview.staged ? '正在取消暂存所选行…' : '正在暂存所选行…');
    try {
      const result = await window.gitFinder.git.applyLineSelection(repoPath, {
        previewId: preview.previewId,
        token: preview.token
      });
      if (!result.success) throw new Error(result.error || '行级 Git 操作失败');
      this._invalidateAmendPreview();
      this._setFeedback(preview.staged ? '已取消暂存所选行。' : '已将所选行加入本次提交。', 'success');
      await this._loadCommitFiles();
      if (this._amendEnabled) await this._loadAmendContext(false);
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  _syncLineControls() {
    const button = document.getElementById('commit-line-preview-btn');
    if (!button) return;
    const supported = Boolean(this._currentDiff?.lineSelection?.supported);
    button.hidden = !supported;
    button.disabled = this._busy || !this._selectedLineIds.size || Boolean(this._linePreview);
    button.textContent = this._linePreview
      ? '预览已生成'
      : (this._selectedStaged ? '预览取消所选行' : '预览暂存所选行');
    document.querySelectorAll('#commit-diff-content input[data-line-id]').forEach(input => {
      input.disabled = this._busy || Boolean(this._linePreview);
      input.checked = this._selectedLineIds.has(input.dataset.lineId);
    });

    const scope = document.getElementById('commit-diff-scope');
    if (!scope || !this._currentDiff) return;
    const suffix = supported
      ? `可选择 ${this._currentDiff.lineSelection.lines.length} 行 · 已选 ${this._selectedLineIds.size} 行`
      : (this._currentDiff.lineSelection?.reason || (this._currentDiff.truncated ? '差异已截断' : ''));
    scope.textContent = [this._diffScopeBase, suffix].filter(Boolean).join(' · ');
  },

  async _mutateFiles(action, filePaths) {
    if (this._busy || !this._currentCommitRepo || !filePaths.length) return;
    this._setBusy(true);
    this._setFeedback(action === 'stage' ? '正在暂存所选文件…' : '正在取消暂存…');
    try {
      const result = action === 'stage'
        ? await window.gitFinder.git.stageFiles(this._currentCommitRepo, filePaths)
        : await window.gitFinder.git.unstageFiles(this._currentCommitRepo, filePaths);
      if (!result.success) throw new Error(result.error || 'Git 操作失败');
      this._invalidateAmendPreview();
      this._setFeedback(action === 'stage' ? '已更新本次提交范围。' : '已从本次提交中移除。', 'success');
      await this._loadCommitFiles();
      if (this._amendEnabled) await this._loadAmendContext(false);
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  _resetAmendState() {
    this._amendEnabled = false;
    this._amendContext = null;
    this._amendPreview = null;
    this._messageBeforeAmend = '';
    this._amendDidPrefill = false;
    const toggle = document.getElementById('commit-amend-toggle');
    const context = document.getElementById('commit-amend-context');
    const preview = document.getElementById('commit-amend-preview');
    if (toggle) toggle.checked = false;
    if (context) {
      context.hidden = true;
      context.textContent = '';
    }
    if (preview) {
      preview.hidden = true;
      preview.textContent = '';
    }
  },

  async toggleAmend(enabled) {
    const message = document.getElementById('commit-message');
    if (enabled) {
      this._messageBeforeAmend = message.value;
      this._amendDidPrefill = false;
    }
    this._amendEnabled = Boolean(enabled);
    this._invalidateAmendPreview();
    if (!this._amendEnabled) {
      if (this._amendDidPrefill && message.value === this._amendContext?.head?.message) {
        message.value = this._messageBeforeAmend;
      }
      this._messageBeforeAmend = '';
      this._amendDidPrefill = false;
      this._amendContext = null;
      const context = document.getElementById('commit-amend-context');
      context.hidden = true;
      context.textContent = '';
      this._syncReviewControls();
      return;
    }
    await this._loadAmendContext(true);
  },

  async _loadAmendContext(prefillMessage) {
    const repoPath = this._currentCommitRepo;
    if (!repoPath || !this._amendEnabled) return;
    const token = ++this._amendLoadToken;
    const element = document.getElementById('commit-amend-context');
    element.hidden = false;
    element.className = 'commit-amend-context';
    element.textContent = '正在读取最近提交与远程状态…';
    this._amendContext = null;
    this._syncReviewControls();
    try {
      const context = await window.gitFinder.git.getAmendContext(repoPath);
      if (token !== this._amendLoadToken || repoPath !== this._currentCommitRepo || !this._amendEnabled) return;
      if (!context.success) throw new Error(context.error || '无法读取最近提交');
      this._amendContext = context;
      this._renderAmendContext(context);
      const message = document.getElementById('commit-message');
      if (prefillMessage && !message.value.trim()) {
        message.value = context.head.message;
        this._amendDidPrefill = true;
      }
    } catch (error) {
      if (token !== this._amendLoadToken) return;
      this._amendContext = null;
      element.className = 'commit-amend-context error';
      element.textContent = error.message || String(error);
    }
    this._syncReviewControls();
  },

  _renderAmendContext(context) {
    const element = document.getElementById('commit-amend-context');
    const state = [];
    state.push(`${context.stagedCount} 个已暂存文件`);
    if (context.published.likely) state.push('远程引用已包含此提交');
    if (context.unsafeOperations.length) state.push(`进行中：${context.unsafeOperations.join('、')}`);
    element.className = `commit-amend-context${context.canAmend ? '' : ' warning'}`;
    element.innerHTML = `
      <div><strong>将修订 ${this._escapeHtml(context.head.shortHash)}</strong> · ${this._escapeHtml(context.head.message || '无提交信息')}</div>
      <div>${this._escapeHtml(state.join(' · '))}</div>`;
  },

  _invalidateAmendPreview() {
    this._amendPreview = null;
    const panel = document.getElementById('commit-amend-preview');
    if (panel) {
      panel.hidden = true;
      panel.textContent = '';
    }
    this._syncReviewControls();
  },

  async _previewAmend(message) {
    if (!this._amendContext) {
      this._setFeedback('最近提交信息仍在读取，请稍候。', 'error');
      return;
    }
    this._setBusy(true);
    this._setFeedback('正在校验 HEAD、索引与远程引用…');
    try {
      const preview = await window.gitFinder.git.previewAmend(this._currentCommitRepo, message);
      if (!preview.success) throw new Error(preview.error || '无法预览 amend');
      this._amendPreview = preview;
      this._renderAmendPreview(preview);
      this._setFeedback('amend 预览已完成；确认前不会改写提交。', 'success');
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  _renderAmendPreview(preview) {
    const panel = document.getElementById('commit-amend-preview');
    const changes = [];
    if (preview.messageChanged) changes.push('修改提交信息');
    if (preview.contentChanged) changes.push(`纳入 ${preview.stagedCount} 个已暂存文件`);
    const warning = preview.requiresPublishedConfirmation
      ? `<div class="commit-amend-published-warning">
          <strong>该提交可能已经发布</strong>
          <div>${this._escapeHtml(preview.publishedRefs.join('、'))}</div>
          <label><input id="commit-amend-published-ack" type="checkbox"> 我理解 amend 会改写提交历史，后续推送可能需要安全强推</label>
        </div>`
      : '';
    panel.innerHTML = `
      <div class="commit-amend-preview-heading">
        <div><strong>确认改写 ${this._escapeHtml(preview.head.shortHash)}</strong><div>${this._escapeHtml(changes.join(' · '))}</div></div>
        <button class="btn btn-tiny" id="commit-amend-preview-cancel-btn" type="button">返回编辑</button>
      </div>
      ${warning}`;
    panel.hidden = false;
    this._syncReviewControls();
  },

  async _applyAmend() {
    const preview = this._amendPreview;
    if (!preview) return;
    const acknowledgePublished = !preview.requiresPublishedConfirmation
      || document.getElementById('commit-amend-published-ack')?.checked === true;
    this._setBusy(true);
    this._setFeedback('正在改写最近提交…');
    try {
      const result = await window.gitFinder.git.applyAmend(this._currentCommitRepo, {
        previewId: preview.previewId,
        token: preview.token,
        acknowledgePublished
      });
      if (!result.success) throw new Error(result.error || 'amend 失败');
      document.getElementById('commit-modal').style.display = 'none';
      if (typeof App !== 'undefined') {
        App._showStatusMessage(`已安全修订最近提交 ${String(result.head || '').slice(0, 7)}`, 'success');
        await window.gitFinder.git.clearCache();
        await App.selectRepo(this._currentCommitRepo);
        await App.renderContent();
      }
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  async confirmCommit() {
    if (this._busy) return;
    const repoPath = this._currentCommitRepo;
    const message = document.getElementById('commit-message').value.trim();
    if (!message) {
      this._setFeedback('请输入提交信息。', 'error');
      document.getElementById('commit-message').focus();
      return;
    }

    if (this._amendEnabled) {
      if (this._amendPreview) await this._applyAmend();
      else await this._previewAmend(message);
      return;
    }
    if (!this._review?.stagedCount) {
      this._setFeedback('请先暂存本次需要提交的文件。', 'error');
      return;
    }
    if (this._review.conflictCount) {
      this._setFeedback('仍有冲突文件，解决并暂存后才能提交。', 'error');
      return;
    }

    this._setBusy(true);
    this._setFeedback(`正在提交 ${this._review.stagedCount} 个文件…`);
    try {
      const result = await window.gitFinder.git.commit(repoPath, message);
      if (!result.success) throw new Error(result.error || '提交失败');
      document.getElementById('commit-modal').style.display = 'none';
      if (typeof App !== 'undefined') {
        App._showStatusMessage(`已提交 ${this._review.stagedCount} 个已暂存文件`, 'success');
        await window.gitFinder.git.clearCache();
        await App.selectRepo(repoPath);
        await App.renderContent();
      }
    } catch (error) {
      this._setFeedback(error.message || String(error), 'error');
    } finally {
      this._setBusy(false);
    }
  },

  _setBusy(busy) {
    this._busy = busy;
    const message = document.getElementById('commit-message');
    const amendToggle = document.getElementById('commit-amend-toggle');
    if (message) message.disabled = busy;
    if (amendToggle) amendToggle.disabled = busy;
    this._syncReviewControls();
    this._syncLineControls();
    if (this._review) this._renderReview();
  },

  _syncReviewControls() {
    const review = this._review;
    const stageAll = document.getElementById('commit-stage-all-btn');
    const unstageAll = document.getElementById('commit-unstage-all-btn');
    const confirm = document.getElementById('confirm-commit-btn');
    const footer = document.getElementById('commit-scope-footer');
    if (stageAll) stageAll.disabled = this._busy || !review?.files?.some(file => file.unstaged);
    if (unstageAll) unstageAll.disabled = this._busy || !review?.files?.some(file => file.staged);
    if (!confirm || !footer) return;

    if (this._amendEnabled) {
      const contextReady = Boolean(this._amendContext?.canAmend);
      const message = document.getElementById('commit-message')?.value || '';
      const messageValid = Boolean(message.trim()) && message.length <= 2000;
      const publishedAck = !this._amendPreview?.requiresPublishedConfirmation
        || document.getElementById('commit-amend-published-ack')?.checked === true;
      confirm.textContent = this._amendPreview ? '确认执行 amend' : '预览 amend';
      confirm.disabled = this._busy || !contextReady || !messageValid || (Boolean(this._amendPreview) && !publishedAck);
      footer.textContent = this._amendPreview
        ? `将改写 ${this._amendPreview.head.shortHash}；应用前会再次校验 HEAD 与索引`
        : (this._amendContext
          ? `修订 ${this._amendContext.head.shortHash} · ${this._amendContext.stagedCount} 个已暂存文件`
          : '正在读取最近提交…');
      return;
    }

    confirm.textContent = '提交已暂存内容';
    confirm.disabled = this._busy || !review?.stagedCount || Boolean(review?.conflictCount);
    footer.textContent = review?.stagedCount
      ? `本次将提交 ${review.stagedCount} 个文件${review.conflictCount ? ` · 仍有 ${review.conflictCount} 个冲突` : ''}`
      : '尚未选择提交文件';
  },

  _setFeedback(message, type = '') {
    const element = document.getElementById('commit-review-feedback');
    if (!element) return;
    element.textContent = message;
    element.className = `commit-review-feedback ${type}`.trim();
  },

  _escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-commit-btn')?.addEventListener('click', () => GitOps.confirmCommit());
  document.getElementById('commit-stage-all-btn')?.addEventListener('click', () => {
    const paths = [...new Set((GitOps._review?.files || []).filter(file => file.unstaged).map(file => file.path))];
    GitOps._mutateFiles('stage', paths);
  });
  document.getElementById('commit-unstage-all-btn')?.addEventListener('click', () => {
    const paths = [...new Set((GitOps._review?.files || []).filter(file => file.staged).map(file => file.path))];
    GitOps._mutateFiles('unstage', paths);
  });
  document.getElementById('commit-files')?.addEventListener('click', event => {
    const action = event.target.closest('[data-git-file-action]');
    if (action) {
      GitOps._mutateFiles(action.dataset.gitFileAction, [action.dataset.filePath]);
      return;
    }
    const file = event.target.closest('[data-review-file]');
    if (file) GitOps._selectFile(file.dataset.reviewFile, file.dataset.reviewStaged === 'true');
  });
  document.getElementById('commit-diff-content')?.addEventListener('change', event => {
    const input = event.target.closest('input[data-line-id]');
    if (input) GitOps._toggleLineSelection(input.dataset.lineId, input.checked);
  });
  document.getElementById('commit-line-preview-btn')?.addEventListener('click', () => GitOps.previewSelectedLines());
  document.getElementById('commit-line-preview-cancel-btn')?.addEventListener('click', () => GitOps._invalidateLinePreview(false));
  document.getElementById('commit-line-apply-btn')?.addEventListener('click', () => GitOps.applySelectedLines());
  document.getElementById('commit-amend-toggle')?.addEventListener('change', event => GitOps.toggleAmend(event.target.checked));
  document.getElementById('commit-amend-preview')?.addEventListener('click', event => {
    if (event.target.closest('#commit-amend-preview-cancel-btn')) GitOps._invalidateAmendPreview();
  });
  document.getElementById('commit-amend-preview')?.addEventListener('change', event => {
    if (event.target.matches('#commit-amend-published-ack')) GitOps._syncReviewControls();
  });
  document.getElementById('commit-message')?.addEventListener('input', () => {
    if (GitOps._amendEnabled) GitOps._amendDidPrefill = false;
    if (GitOps._amendPreview) GitOps._invalidateAmendPreview();
    GitOps._syncReviewControls();
  });
  document.getElementById('commit-message')?.addEventListener('keydown', event => {
    if (event.metaKey && event.key === 'Enter') {
      event.preventDefault();
      GitOps.confirmCommit();
    }
  });
  document.getElementById('commit-modal')?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (GitOps._linePreview) {
      GitOps._invalidateLinePreview(false);
      return;
    }
    if (GitOps._amendPreview) {
      GitOps._invalidateAmendPreview();
      return;
    }
    document.getElementById('commit-modal').style.display = 'none';
  });
});
