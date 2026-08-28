(function exposeContentFilterController(root, factory) {
  const contentQuery = typeof module !== 'undefined' && module.exports
    ? require('./contentQuery')
    : root?.ContentQuery;
  const api = factory(contentQuery, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ContentFilterController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createContentFilterControllerApi(ContentQuery, root) {
  function parseExtensions(value) {
    return String(value || '')
      .split(/[\s,;，；]+/)
      .map(extension => extension.trim())
      .filter(Boolean);
  }

  const SIZE_UNITS = Object.freeze({
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  });

  function parseDateDraft(value) {
    const date = String(value || '').trim();
    if (!date) return { ok: true, value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return { ok: false, error: '请输入有效的修改日期' };
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      return { ok: false, error: '请输入有效的修改日期' };
    }
    return { ok: true, value: date };
  }

  function parseSizeDraft(value, unit) {
    const text = String(value ?? '').trim();
    if (!text) return { ok: true, value: null };
    const amount = Number(text);
    const multiplier = SIZE_UNITS[unit] || 1;
    const bytes = amount * multiplier;
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(bytes)) {
      return { ok: false, error: '文件大小必须换算为安全范围内的完整字节数' };
    }
    return { ok: true, value: bytes };
  }

  function formatSizeDraft(bytes) {
    if (bytes === null || bytes === undefined) return { value: '', unit: 'b' };
    const value = Number(bytes);
    if (!Number.isSafeInteger(value) || value < 0) return { value: '', unit: 'b' };
    const unit = ['tb', 'gb', 'mb', 'kb']
      .find(candidate => value >= SIZE_UNITS[candidate] && value % SIZE_UNITS[candidate] === 0) || 'b';
    const amount = value / SIZE_UNITS[unit];
    return { value: String(amount), unit };
  }

  function scopeLabel(query) {
    const kind = ContentQuery.collectionKind(query);
    if (kind === 'file-labels') return '所有受管位置 · 文件标签';
    if (kind === 'projects') return '所有受管位置 · 项目';
    if (kind === 'repositories') return '所有受管位置 · Git 仓库';
    if (kind === 'project-repositories') return '所有受管位置 · 项目 + Git 仓库';
    return '当前目录';
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.restoreFocus = null;
      this.bound = false;
    }

    element(id) {
      return this.document?.getElementById(id) || null;
    }

    lifecycleInputs() {
      return [...(this.document?.querySelectorAll('input[name="content-filter-lifecycle"]') || [])];
    }

    gitStatusInputs() {
      return [...(this.document?.querySelectorAll('input[name="content-filter-git-status"]') || [])];
    }

    fileLabelInputs() {
      return [...(this.document?.querySelectorAll('input[name="content-filter-file-label"]') || [])];
    }

    renderFileLabelInputs() {
      const container = this.element('content-filter-file-labels');
      if (!container || typeof this.document?.createElement !== 'function') return;
      container.replaceChildren();
      const labels = Array.isArray(this.state.fileLabels?.labels) ? this.state.fileLabels.labels : [];
      if (!labels.length) {
        const empty = this.document.createElement('span');
        empty.className = 'content-filter-empty-labels';
        empty.textContent = '尚未创建文件标签，可在“操作 → 分配标签…”中新建。';
        container.appendChild(empty);
        return;
      }
      for (const fileLabel of labels) {
        const label = this.document.createElement('label');
        const input = this.document.createElement('input');
        const dot = this.document.createElement('span');
        const name = this.document.createElement('span');
        input.type = 'checkbox';
        input.name = 'content-filter-file-label';
        input.value = fileLabel.id;
        dot.className = 'file-label-dot';
        dot.style.setProperty('--file-label-color', fileLabel.color);
        name.textContent = fileLabel.name;
        label.append(input, dot, name);
        container.appendChild(label);
      }
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.element('content-filter-more')?.addEventListener('click', () => this.open());
      this.element('content-filter-close-btn')?.addEventListener('click', () => this.close());
      this.element('content-filter-cancel-btn')?.addEventListener('click', () => this.close());
      this.element('content-filter-reset-btn')?.addEventListener('click', () => this.resetDraft());
      this.element('content-filter-apply-btn')?.addEventListener('click', () => this.apply());
      this.lifecycleInputs().forEach(input => input.addEventListener('change', () => this.updateDraftAvailability()));
      this.gitStatusInputs().forEach(input => input.addEventListener('change', () => this.updateDraftAvailability()));
      this.element('content-filter-file-labels')?.addEventListener('change', () => this.updateDraftAvailability());
      this.element('content-filter-extensions')?.addEventListener('input', () => this.updateDraftAvailability());
      this.element('content-filter-modified')?.addEventListener('change', event => {
        if (event.target.value) {
          const from = this.element('content-filter-modified-from');
          const to = this.element('content-filter-modified-to');
          if (from) from.value = '';
          if (to) to.value = '';
        }
        this.updateDraftAvailability();
      });
      ['content-filter-modified-from', 'content-filter-modified-to'].forEach(id => {
        this.element(id)?.addEventListener('input', event => {
          if (event.target.value) {
            const relative = this.element('content-filter-modified');
            if (relative) relative.value = '';
          }
          this.updateDraftAvailability();
        });
      });
      this.element('content-filter-size')?.addEventListener('change', event => {
        if (event.target.value !== 'any') {
          const minimum = this.element('content-filter-size-min');
          const maximum = this.element('content-filter-size-max');
          if (minimum) minimum.value = '';
          if (maximum) maximum.value = '';
        }
        this.updateDraftAvailability();
      });
      ['content-filter-size-min', 'content-filter-size-max'].forEach(id => {
        this.element(id)?.addEventListener('input', event => {
          if (event.target.value !== '') {
            const preset = this.element('content-filter-size');
            if (preset) preset.value = 'any';
          }
          this.updateDraftAvailability();
        });
      });
      ['content-filter-size-min-unit', 'content-filter-size-max-unit'].forEach(id => {
        this.element(id)?.addEventListener('change', () => this.updateDraftAvailability());
      });
      this.document?.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !this.isOpen()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      });
    }

    isOpen() {
      const modal = this.element('content-filter-modal');
      return modal?.style.display === 'flex';
    }

    populate(query = this.state.contentQuery) {
      const value = ContentQuery.normalize(query);
      this.renderFileLabelInputs();
      const selected = new Set(value.lifecycles);
      this.lifecycleInputs().forEach(input => { input.checked = selected.has(input.value); });
      const selectedGitStatuses = new Set(value.gitStatuses);
      this.gitStatusInputs().forEach(input => { input.checked = selectedGitStatuses.has(input.value); });
      const selectedFileLabels = new Set(value.fileLabelIds);
      this.fileLabelInputs().forEach(input => { input.checked = selectedFileLabels.has(input.value); });
      const extensions = this.element('content-filter-extensions');
      const modified = this.element('content-filter-modified');
      const modifiedFrom = this.element('content-filter-modified-from');
      const modifiedTo = this.element('content-filter-modified-to');
      const size = this.element('content-filter-size');
      const sizeMin = this.element('content-filter-size-min');
      const sizeMinUnit = this.element('content-filter-size-min-unit');
      const sizeMax = this.element('content-filter-size-max');
      const sizeMaxUnit = this.element('content-filter-size-max-unit');
      if (extensions) extensions.value = value.extensions.join(', ');
      if (modified) modified.value = value.modifiedWithinDays === null ? '' : String(value.modifiedWithinDays);
      if (modifiedFrom) modifiedFrom.value = value.modifiedFrom || '';
      if (modifiedTo) modifiedTo.value = value.modifiedTo || '';
      if (size) size.value = value.sizeRange;
      const minimumDraft = formatSizeDraft(value.minSizeBytes);
      const maximumDraft = formatSizeDraft(value.maxSizeBytes);
      if (sizeMin) sizeMin.value = minimumDraft.value;
      if (sizeMinUnit) sizeMinUnit.value = minimumDraft.unit;
      if (sizeMax) sizeMax.value = maximumDraft.value;
      if (sizeMaxUnit) sizeMaxUnit.value = maximumDraft.unit;
      const scope = this.element('content-filter-scope');
      if (scope) scope.textContent = `筛选范围：${scopeLabel(value)}`;
      this.setFeedback('');
      this.updateDraftAvailability();
    }

    updateDraftAvailability() {
      const query = ContentQuery.normalize(this.state.contentQuery);
      const collectionKind = ContentQuery.collectionKind(query);
      const lifecycleSection = this.element('content-filter-lifecycle-section');
      const gitSection = this.element('content-filter-git-section');
      const fileSection = this.element('content-filter-file-section');
      const fileLabelSection = this.element('content-filter-file-label-section');
      const fileLabelHint = this.element('content-filter-file-label-hint');
      const fileHint = this.element('content-filter-file-hint');
      const gitHint = this.element('content-filter-git-hint');
      const lifecycleSelected = this.lifecycleInputs().some(input => input.checked);
      const extensions = parseExtensions(this.element('content-filter-extensions')?.value);
      const sizeRange = this.element('content-filter-size')?.value || 'any';
      const exactSizeSelected = ['content-filter-size-min', 'content-filter-size-max']
        .some(id => String(this.element(id)?.value || '').trim() !== '');
      const fileSpecificSelected = extensions.length > 0 || sizeRange !== 'any' || exactSizeSelected;
      const fileLabelCollection = collectionKind === 'file-labels';
      const lifecycleUnavailable = collectionKind === 'repositories' || fileLabelCollection || fileSpecificSelected;
      const gitUnavailable = collectionKind !== 'repositories';
      const fileUnavailable = (query.scope !== 'current' && !fileLabelCollection) || lifecycleSelected;

      if (lifecycleSection) lifecycleSection.disabled = lifecycleUnavailable;
      if (gitSection) gitSection.disabled = gitUnavailable;
      if (fileSection) fileSection.disabled = fileUnavailable;
      if (fileLabelSection) fileLabelSection.disabled = query.scope !== 'current' && !fileLabelCollection;
      if (fileLabelHint) fileLabelHint.textContent = fileLabelCollection
        ? '这是当前聚合范围；至少保留一个标签，多选之间为“或”。'
        : (query.scope === 'current'
            ? '显示带有任一所选本机标签的文件或文件夹；多选之间为“或”。'
            : '文件标签按具体路径保存在本机；可从左侧“文件标签”进入跨目录聚合。');
      if (gitHint) {
        gitHint.textContent = gitUnavailable
          ? '为避免普通目录浏览自动读取仓库状态，请在“所有 Git 仓库”范围中使用此条件。'
          : '与主界面仓库状态筛选栏同步；综合状态多选为“或”，“无远程”为“且”。';
      }
      if (fileHint) {
        fileHint.textContent = query.scope !== 'current' && !fileLabelCollection
          ? '文件扩展名和大小只适用于当前目录；项目与仓库聚合不会递归读取全部文件。'
          : (lifecycleSelected ? '已选择项目生命周期；项目文件夹与文件条件不能同时成立。' : '扩展名和大小仅适用于当前目录中的文件。');
      }
      if (collectionKind === 'repositories') {
        this.setFeedback('Git 状态按当前标签页保存；项目生命周期在当前目录或所有项目中使用。');
      } else if (fileSpecificSelected) {
        this.setFeedback('文件条件已启用，项目生命周期暂不可同时选择。');
      } else if (lifecycleSelected) {
        this.setFeedback('生命周期条件会自动限定为项目文件夹。');
      } else {
        this.setFeedback('');
      }
    }

    setFeedback(message) {
      const feedback = this.element('content-filter-feedback');
      if (feedback) feedback.textContent = message;
    }

    open() {
      const modal = this.element('content-filter-modal');
      if (!modal) return;
      const otherModalVisible = [...(this.document?.querySelectorAll('.modal-overlay') || [])]
        .some(overlay => {
          if (overlay === modal) return false;
          const display = this.window?.getComputedStyle
            ? this.window.getComputedStyle(overlay).display
            : overlay.style?.display;
          return display !== 'none';
        });
      if (otherModalVisible) return;
      this.app.closeToolbarMenus();
      this.app.closeQuickLook();
      this.restoreFocus = this.document?.activeElement || null;
      this.populate();
      modal.inert = false;
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      this.window?.requestAnimationFrame?.(() => {
        const firstEnabled = this.lifecycleInputs().find(input => !input.disabled)
          || this.element('content-filter-modified');
        firstEnabled?.focus?.();
      });
    }

    close({ restoreFocus = true } = {}) {
      const modal = this.element('content-filter-modal');
      if (!modal) return;
      const active = this.document?.activeElement;
      if (active && modal.contains?.(active)) active.blur?.();
      modal.inert = true;
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
      if (restoreFocus) this.restoreFocus?.focus?.();
      this.restoreFocus = null;
    }

    resetDraft() {
      const current = ContentQuery.normalize(this.state.contentQuery);
      const preservedFileLabelIds = ContentQuery.collectionKind(current) === 'file-labels'
        ? new Set(current.fileLabelIds)
        : new Set();
      this.lifecycleInputs().forEach(input => { input.checked = false; });
      this.gitStatusInputs().forEach(input => { input.checked = false; });
      this.fileLabelInputs().forEach(input => { input.checked = preservedFileLabelIds.has(input.value); });
      const extensions = this.element('content-filter-extensions');
      const modified = this.element('content-filter-modified');
      const modifiedFrom = this.element('content-filter-modified-from');
      const modifiedTo = this.element('content-filter-modified-to');
      const size = this.element('content-filter-size');
      const sizeMin = this.element('content-filter-size-min');
      const sizeMinUnit = this.element('content-filter-size-min-unit');
      const sizeMax = this.element('content-filter-size-max');
      const sizeMaxUnit = this.element('content-filter-size-max-unit');
      if (extensions) extensions.value = '';
      if (modified) modified.value = '';
      if (modifiedFrom) modifiedFrom.value = '';
      if (modifiedTo) modifiedTo.value = '';
      if (size) size.value = 'any';
      if (sizeMin) sizeMin.value = '';
      if (sizeMinUnit) sizeMinUnit.value = 'b';
      if (sizeMax) sizeMax.value = '';
      if (sizeMaxUnit) sizeMaxUnit.value = 'b';
      this.updateDraftAvailability();
      this.setFeedback('高级条件已在此窗口中重置；点击“应用筛选”后生效。');
    }

    readDraft() {
      const current = ContentQuery.normalize(this.state.contentQuery);
      const collectionKind = ContentQuery.collectionKind(current);
      const fileLabelCollection = collectionKind === 'file-labels';
      const lifecycleAllowed = collectionKind !== 'repositories' && !fileLabelCollection;
      const gitStatusAllowed = collectionKind === 'repositories';
      const lifecycles = lifecycleAllowed
        ? this.lifecycleInputs().filter(input => input.checked).map(input => input.value)
        : current.lifecycles;
      const fileAllowed = (current.scope === 'current' || fileLabelCollection) && lifecycles.length === 0;
      const extensions = fileAllowed ? parseExtensions(this.element('content-filter-extensions')?.value) : current.extensions;
      const modifiedFrom = parseDateDraft(this.element('content-filter-modified-from')?.value);
      const modifiedTo = parseDateDraft(this.element('content-filter-modified-to')?.value);
      if (!modifiedFrom.ok || !modifiedTo.ok) {
        return { ok: false, error: modifiedFrom.error || modifiedTo.error, field: !modifiedFrom.ok ? 'content-filter-modified-from' : 'content-filter-modified-to' };
      }
      if (modifiedFrom.value && modifiedTo.value && modifiedFrom.value > modifiedTo.value) {
        return { ok: false, error: '起始修改日期不能晚于结束日期', field: 'content-filter-modified-from' };
      }
      const minimumSize = fileAllowed
        ? parseSizeDraft(this.element('content-filter-size-min')?.value, this.element('content-filter-size-min-unit')?.value)
        : { ok: true, value: current.minSizeBytes };
      const maximumSize = fileAllowed
        ? parseSizeDraft(this.element('content-filter-size-max')?.value, this.element('content-filter-size-max-unit')?.value)
        : { ok: true, value: current.maxSizeBytes };
      if (!minimumSize.ok || !maximumSize.ok) {
        return { ok: false, error: minimumSize.error || maximumSize.error, field: !minimumSize.ok ? 'content-filter-size-min' : 'content-filter-size-max' };
      }
      if (minimumSize.value !== null && maximumSize.value !== null && minimumSize.value > maximumSize.value) {
        return { ok: false, error: '最小文件大小不能大于最大文件大小', field: 'content-filter-size-min' };
      }
      const normalizedMinimumSize = minimumSize.value === 0 ? null : minimumSize.value;
      const exactSize = normalizedMinimumSize !== null || maximumSize.value !== null;
      const sizeRange = fileAllowed && !exactSize ? (this.element('content-filter-size')?.value || 'any') : 'any';
      const gitStatuses = gitStatusAllowed
        ? this.gitStatusInputs().filter(input => input.checked).map(input => input.value)
        : current.gitStatuses;
      const fileLabelIds = current.scope === 'current' || fileLabelCollection
        ? this.fileLabelInputs().filter(input => input.checked).map(input => input.value)
        : [];
      if (fileLabelCollection && !fileLabelIds.length) {
        return { ok: false, error: '文件标签聚合至少需要保留一个标签', field: 'content-filter-file-labels' };
      }
      const fileSpecific = extensions.length > 0 || sizeRange !== 'any' || exactSize;
      const query = ContentQuery.normalize({
        ...current,
        baseType: lifecycles.length ? 'directory' : (fileSpecific ? 'file' : current.baseType),
        projectOnly: lifecycles.length ? true : (fileSpecific ? false : current.projectOnly),
        repositoryOnly: fileSpecific ? false : current.repositoryOnly,
        lifecycles,
        gitStatuses,
        fileLabelIds,
        extensions,
        modifiedWithinDays: modifiedFrom.value || modifiedTo.value
          ? null
          : (this.element('content-filter-modified')?.value || null),
        modifiedFrom: modifiedFrom.value,
        modifiedTo: modifiedTo.value,
        sizeRange,
        minSizeBytes: normalizedMinimumSize,
        maxSizeBytes: maximumSize.value
      });
      return { ok: true, query };
    }

    apply() {
      const draft = this.readDraft();
      if (!draft.ok) {
        this.setFeedback(draft.error);
        this.element(draft.field)?.focus?.();
        return false;
      }
      this.state.contentQuery = draft.query;
      this.state.searchScope = this.state.contentQuery.scope === 'all' ? 'current' : this.state.searchScope;
      this.close();
      this.app.captureActiveWorkspaceTab();
      this.app.renderWorkspaceTabs();
      this.app.scheduleWorkspaceTabsPersist();
      this.app.updateModeUI();
      this.app.updateBreadcrumbs();
      this.app.renderContent();
      return true;
    }
  }

  return { Controller, formatSizeDraft, parseDateDraft, parseExtensions, parseSizeDraft, scopeLabel };
});
