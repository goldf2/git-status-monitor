(function exposeFileLabelController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileLabelController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileLabelControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.paths = [];
      this.assignments = {};
      this.restoreFocus = null;
      this.bound = false;
    }

    element(id) {
      return this.document?.getElementById(id) || null;
    }

    async load() {
      this.state.fileLabels = await this.bridge.fileLabels.get();
      this.renderSidebar();
      return this.state.fileLabels;
    }

    async enrichItems(items) {
      const candidates = Array.isArray(items) ? items : [];
      if (!candidates.length) return candidates;
      const assignments = {};
      for (let index = 0; index < candidates.length; index += 1000) {
        Object.assign(assignments, await this.bridge.fileLabels.getForPaths(
          candidates.slice(index, index + 1000).map(item => item.path)
        ));
      }
      for (const item of candidates) item.fileLabels = assignments[item.path] || [];
      return candidates;
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.element('file-label-close-btn')?.addEventListener('click', () => this.close());
      this.element('file-label-cancel-btn')?.addEventListener('click', () => this.close());
      this.element('file-label-apply-btn')?.addEventListener('click', () => this.apply());
      this.element('file-label-create-btn')?.addEventListener('click', () => this.create());
      this.element('manage-file-labels-sidebar-btn')?.addEventListener('click', () => this.open([]));
      this.element('file-label-create-name')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.create();
        }
      });
      this.element('file-label-list')?.addEventListener('change', event => {
        const checkbox = event.target.closest?.('[data-file-label-assignment]');
        if (checkbox) {
          checkbox.indeterminate = false;
          checkbox.dataset.touched = 'true';
          return;
        }
        const color = event.target.closest?.('[data-file-label-color]');
        if (color) this.updateColor(color.dataset.fileLabelColor, color.value);
      });
      this.element('file-label-list')?.addEventListener('click', event => {
        const rename = event.target.closest?.('[data-file-label-rename]');
        const remove = event.target.closest?.('[data-file-label-delete]');
        if (rename) this.rename(rename.dataset.fileLabelRename);
        if (remove) this.remove(remove.dataset.fileLabelDelete);
      });
      this.element('file-label-modal')?.addEventListener('click', event => {
        if (event.target === event.currentTarget) this.close();
      });
      this.document?.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !this.isOpen()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      });
    }

    isOpen() {
      return this.element('file-label-modal')?.style.display === 'flex';
    }

    setFeedback(message, type = '') {
      const feedback = this.element('file-label-feedback');
      if (!feedback) return;
      feedback.textContent = message || '';
      feedback.dataset.type = type;
    }

    safeColor(value) {
      const color = String(value || '').toLowerCase();
      return /^#[0-9a-f]{6}$/u.test(color) ? color : '#0a84ff';
    }

    assignmentCounts() {
      const model = this.window?.FileLabels || root?.FileLabels;
      if (typeof model?.assignmentCounts === 'function') return model.assignmentCounts(this.state.fileLabels);
      const counts = Object.fromEntries((this.state.fileLabels?.labels || []).map(label => [label.id, 0]));
      for (const ids of Object.values(this.state.fileLabels?.assignments || {})) {
        for (const id of ids) if (Object.hasOwn(counts, id)) counts[id] += 1;
      }
      return counts;
    }

    renderSidebar() {
      const container = this.element('file-labels-sidebar-list');
      if (!container) return;
      const labels = Array.isArray(this.state.fileLabels?.labels) ? this.state.fileLabels.labels : [];
      if (!labels.length) {
        container.innerHTML = '<div class="file-label-sidebar-empty">尚未创建标签。标签可用于文件和文件夹，并只保存在本机。</div>';
        return;
      }
      const query = this.window?.ContentQuery?.normalize?.(this.state.contentQuery);
      const activeIds = this.window?.ContentQuery?.collectionKind?.(query) === 'file-labels'
        ? new Set(query.fileLabelIds)
        : new Set();
      const counts = this.assignmentCounts();
      container.innerHTML = labels.map(label => {
        const id = this.app.escapeHtml(label.id);
        const name = this.app.escapeHtml(label.name);
        const color = this.safeColor(label.color);
        const active = activeIds.has(label.id);
        return `<button class="sidebar-item file-label-sidebar-item${active ? ' active' : ''}" data-file-label-sidebar="${id}" type="button" aria-pressed="${active}" title="显示所有受管位置中标记为“${name}”的项目">
          <span class="file-label-sidebar-dot" style="--file-label-color:${color}" aria-hidden="true"></span>
          <span class="sidebar-item-name">${name}</span>
          <span class="badge">${Number(counts[label.id] || 0)}</span>
        </button>`;
      }).join('');
      container.querySelectorAll('[data-file-label-sidebar]').forEach(button => {
        button.addEventListener('click', () => this.app.openFileLabelCollection(button.dataset.fileLabelSidebar));
      });
    }

    syncCollectionPresentation({ renderContent = false } = {}) {
      this.renderSidebar();
      this.app.renderWorkspaceTabs?.();
      this.app.updateModeUI?.();
      this.app.updateBreadcrumbs?.();
      if (renderContent) this.app.renderContent?.();
    }

    captureAssignmentDraft() {
      const draft = {};
      for (const checkbox of this.element('file-label-list')?.querySelectorAll('[data-file-label-assignment]') || []) {
        if (checkbox.dataset.touched === 'true') {
          draft[checkbox.dataset.fileLabelAssignment] = checkbox.checked;
        }
      }
      return draft;
    }

    restoreAssignmentDraft(draft) {
      for (const [labelId, checked] of Object.entries(draft || {})) {
        const checkbox = this.element('file-label-list')?.querySelector?.(`[data-file-label-assignment="${labelId}"]`);
        if (!checkbox) continue;
        checkbox.indeterminate = false;
        checkbox.checked = checked;
        checkbox.dataset.touched = 'true';
      }
    }

    pruneLabelFromQueries(labelId) {
      const contentQuery = this.window?.ContentQuery;
      if (!contentQuery) return;
      const prune = query => contentQuery.normalize({
        ...contentQuery.normalize(query),
        fileLabelIds: contentQuery.normalize(query).fileLabelIds.filter(id => id !== labelId)
      });
      this.state.contentQuery = prune(this.state.contentQuery);
      const session = this.state.workspaceSession;
      for (const tab of [...(session?.tabs || []), ...(session?.closedTabs || [])]) {
        tab.contentQuery = prune(tab.contentQuery);
      }
      this.app.captureActiveWorkspaceTab?.();
      this.app.scheduleWorkspaceTabsPersist?.();
    }

    render() {
      const list = this.element('file-label-list');
      const title = this.element('file-label-title');
      const description = this.element('file-label-description');
      const apply = this.element('file-label-apply-btn');
      if (!list) return;
      const labels = Array.isArray(this.state.fileLabels?.labels) ? this.state.fileLabels.labels : [];
      if (title) title.textContent = this.paths.length ? '为所选项目分配标签' : '管理文件标签';
      if (description) description.textContent = this.paths.length
        ? `已选择 ${this.paths.length} 项。混合状态不会在未修改时被覆盖。`
        : '标签只保存在本机，可用于文件和文件夹，不会写入项目或 Git 仓库。';
      if (apply) apply.hidden = this.paths.length === 0;
      if (!labels.length) {
        list.innerHTML = '<div class="file-label-empty">尚未创建文件标签。可在下方输入名称并选择颜色。</div>';
        return;
      }
      const selectedCount = this.paths.length;
      list.innerHTML = labels.map(label => {
        const assignedCount = this.paths.reduce((count, filePath) => (
          count + Number((this.assignments[filePath] || []).some(item => item.id === label.id))
        ), 0);
        const checked = selectedCount > 0 && assignedCount === selectedCount;
        const mixed = assignedCount > 0 && assignedCount < selectedCount;
        const color = this.safeColor(label.color);
        return `<div class="file-label-row" data-file-label-row="${this.app.escapeHtml(label.id)}">
          <label class="file-label-assignment-control">
            <input type="checkbox" data-file-label-assignment="${this.app.escapeHtml(label.id)}"${checked ? ' checked' : ''}${selectedCount ? '' : ' disabled'}>
            <span class="file-label-dot" style="--file-label-color:${color}"></span>
            <strong>${this.app.escapeHtml(label.name)}</strong>
            <small>${selectedCount ? (mixed ? `${assignedCount}/${selectedCount} 项` : (checked ? '全部已分配' : '未分配')) : '本机标签'}</small>
          </label>
          <input class="file-label-color" data-file-label-color="${this.app.escapeHtml(label.id)}" type="color" value="${color}" aria-label="修改 ${this.app.escapeHtml(label.name)} 的颜色">
          <button class="file-label-row-action" data-file-label-rename="${this.app.escapeHtml(label.id)}" type="button">重命名</button>
          <button class="file-label-row-action file-label-row-danger" data-file-label-delete="${this.app.escapeHtml(label.id)}" type="button">删除</button>
        </div>`;
      }).join('');
      for (const checkbox of list.querySelectorAll('[data-file-label-assignment]')) {
        const labelId = checkbox.dataset.fileLabelAssignment;
        const assignedCount = this.paths.reduce((count, filePath) => (
          count + Number((this.assignments[filePath] || []).some(item => item.id === labelId))
        ), 0);
        checkbox.indeterminate = assignedCount > 0 && assignedCount < selectedCount;
        checkbox.dataset.touched = 'false';
      }
    }

    async open(items = []) {
      const modal = this.element('file-label-modal');
      if (!modal) return;
      const otherModalVisible = [...(this.document?.querySelectorAll('.modal-overlay') || [])]
        .some(overlay => overlay !== modal && this.window?.getComputedStyle?.(overlay).display !== 'none');
      if (otherModalVisible) return;
      this.app.closeToolbarMenus();
      this.app.closeQuickLook();
      this.restoreFocus = this.document?.activeElement || null;
      this.paths = [...new Set((Array.isArray(items) ? items : []).map(item => item?.path).filter(Boolean))];
      this.setFeedback('');
      try {
        await this.load();
        this.assignments = this.paths.length ? await this.bridge.fileLabels.getForPaths(this.paths) : {};
        this.render();
        modal.inert = false;
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'flex';
        this.window?.requestAnimationFrame?.(() => (
          this.element('file-label-list')?.querySelector?.('input:not(:disabled)') || this.element('file-label-create-name')
        )?.focus?.());
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }

    close() {
      const modal = this.element('file-label-modal');
      if (!modal) return;
      const active = this.document?.activeElement;
      if (active && modal.contains?.(active)) active.blur?.();
      modal.inert = true;
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
      this.restoreFocus?.focus?.();
      this.restoreFocus = null;
      this.paths = [];
      this.assignments = {};
    }

    async create() {
      const nameInput = this.element('file-label-create-name');
      const colorInput = this.element('file-label-create-color');
      const name = String(nameInput?.value || '').trim();
      if (!name) {
        this.setFeedback('请输入标签名称。', 'error');
        nameInput?.focus?.();
        return;
      }
      const draft = this.captureAssignmentDraft();
      try {
        await this.bridge.fileLabels.create(name, colorInput?.value || '#0a84ff');
        if (nameInput) nameInput.value = '';
        await this.load();
        this.render();
        this.restoreAssignmentDraft(draft);
        this.setFeedback(`已创建标签“${name}”。`, 'success');
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }

    async rename(labelId) {
      const label = this.state.fileLabels?.labels?.find(item => item.id === labelId);
      if (!label) return;
      const name = this.window?.prompt?.('重命名文件标签', label.name);
      if (name === null) return;
      const draft = this.captureAssignmentDraft();
      try {
        await this.bridge.fileLabels.update(labelId, { name });
        await this.load();
        this.render();
        this.restoreAssignmentDraft(draft);
        this.syncCollectionPresentation();
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }

    async updateColor(labelId, color) {
      const draft = this.captureAssignmentDraft();
      try {
        await this.bridge.fileLabels.update(labelId, { color });
        await this.load();
        this.render();
        this.restoreAssignmentDraft(draft);
        this.syncCollectionPresentation();
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }

    async remove(labelId) {
      const label = this.state.fileLabels?.labels?.find(item => item.id === labelId);
      if (!label || !this.window?.confirm?.(`删除文件标签“${label.name}”？\n\n所有文件和文件夹上的此标签也会移除。`)) return;
      const activeCollection = this.window?.ContentQuery?.collectionKind?.(this.state.contentQuery) === 'file-labels'
        && this.window.ContentQuery.normalize(this.state.contentQuery).fileLabelIds.includes(labelId);
      const draft = this.captureAssignmentDraft();
      delete draft[labelId];
      try {
        await this.bridge.fileLabels.delete(labelId);
        await this.load();
        this.pruneLabelFromQueries(labelId);
        this.assignments = this.paths.length ? await this.bridge.fileLabels.getForPaths(this.paths) : {};
        this.render();
        this.restoreAssignmentDraft(draft);
        this.syncCollectionPresentation({ renderContent: activeCollection });
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }

    async apply() {
      if (!this.paths.length) return;
      const addIds = [];
      const removeIds = [];
      for (const checkbox of this.element('file-label-list')?.querySelectorAll('[data-file-label-assignment]') || []) {
        if (checkbox.dataset.touched !== 'true') continue;
        if (checkbox.checked) addIds.push(checkbox.dataset.fileLabelAssignment);
        else removeIds.push(checkbox.dataset.fileLabelAssignment);
      }
      if (!addIds.length && !removeIds.length) {
        this.close();
        return;
      }
      try {
        await this.bridge.fileLabels.updateAssignments(this.paths, { addIds, removeIds });
        await this.load();
        this.close();
        await this.app.renderContent();
      } catch (error) {
        this.setFeedback(error?.message || String(error), 'error');
      }
    }
  }

  return { Controller };
});
