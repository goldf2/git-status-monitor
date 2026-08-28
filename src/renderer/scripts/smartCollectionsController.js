(function exposeSmartCollectionsController(root, factory) {
  const smartCollections = typeof module !== 'undefined' && module.exports
    ? require('./smartCollections')
    : root?.SmartCollections;
  const api = factory(smartCollections, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SmartCollectionsController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSmartCollectionsControllerApi(SmartCollections, root) {
  const LIFECYCLE_LABELS = {
    inbox: '待整理', planned: '已规划', active: '开发中', validation: '验证中', deployed: '已部署',
    maintenance: '维护中', paused: '暂停', frozen: '已冻结', abandoned: '已废弃', archived: '已归档'
  };
  const STATUS_LABELS = {
    clean: '已同步', dirty: '未提交', ahead: '未推送', behind: '需拉取', 'no-remote': '无远程'
  };

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder;
      this.contentQuery = options.contentQuery || root?.ContentQuery;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.restoreFocus = null;
      this.editingId = null;
      this.menuCollectionId = null;
      this.menuRestoreFocus = null;
      this.draggedId = null;
      this.busy = false;
      this.bound = false;
    }

    element(id) {
      return this.document?.getElementById(id) || null;
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.element('content-filter-save-collection')?.addEventListener('click', () => this.open());
      this.element('smart-collection-close-btn')?.addEventListener('click', () => this.close());
      this.element('smart-collection-cancel-btn')?.addEventListener('click', () => this.close());
      this.element('smart-collection-save-btn')?.addEventListener('click', () => this.save());
      this.element('smart-collection-name')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.save();
      });
      this.element('smart-collection-context-menu')?.addEventListener('click', async event => {
        const action = event.target.closest?.('[data-smart-collection-action]')?.dataset.smartCollectionAction;
        const id = this.menuCollectionId;
        if (!action || !id) return;
        const restoreFocus = this.menuRestoreFocus;
        this.closeMenu();
        if (action === 'rename') this.openRename(id, { restoreFocus });
        if (action === 'move-up') await this.move(id, -1);
        if (action === 'move-down') await this.move(id, 1);
        if (action === 'remove') await this.remove(id);
      });
      this.document?.addEventListener('contextmenu', event => {
        const item = event.target.closest?.('.smart-collection-item[data-smart-collection-id]');
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        this.openMenu(item.dataset.smartCollectionId, event.clientX, event.clientY, {
          restoreFocus: item.querySelector?.('.smart-collection-open') || null
        });
      });
      this.document?.addEventListener('click', event => {
        if (event.target.closest?.('#smart-collection-context-menu, .smart-collection-more')) return;
        this.closeMenu();
      });
      this.document?.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (this.isOpen()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.close();
        } else if (!this.element('smart-collection-context-menu')?.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeMenu({ restoreFocus: true });
        }
      });
      this.window?.addEventListener?.('blur', () => this.closeMenu());
    }

    async load() {
      const raw = await this.bridge.config.get('smartCollections').catch(() => null);
      const normalized = SmartCollections.normalizeStore(raw);
      this.state.smartCollections = normalized.collections;
      this.render();
      if (raw !== null && JSON.stringify(raw) !== JSON.stringify(normalized)) {
        await this.bridge.config.set('smartCollections', normalized).catch(() => null);
      }
      return normalized;
    }

    currentContext() {
      const repositoryCollection = this.contentQuery.collectionKind(this.state.contentQuery) === 'repositories';
      const searchText = this.state.searchScope === 'current' ? this.state.searchQuery : '';
      return {
        query: this.state.contentQuery,
        searchText,
        searchFields: searchText
          ? ['name', 'readme'].filter(field => this.state.filterEnabled?.[field] === true)
          : [],
        repositoryTagIds: repositoryCollection ? this.state.selectedTags : []
      };
    }

    suggestedName() {
      const context = this.currentContext();
      const query = this.contentQuery.normalize(context.query);
      const kind = this.contentQuery.collectionKind(query);
      const parts = [];
      if (query.lifecycles.length === 1) parts.push(LIFECYCLE_LABELS[query.lifecycles[0]] || query.lifecycles[0]);
      if (query.gitStatuses.length === 1) parts.push(STATUS_LABELS[query.gitStatuses[0]] || query.gitStatuses[0]);
      if (query.repositoryCategory !== 'all') {
        const group = (this.state.groups?.groups || []).find(item => item.id === query.repositoryCategory);
        parts.push(query.repositoryCategory === 'ungrouped' ? '未分类' : (group?.name || '指定分类'));
      }
      if (context.repositoryTagIds.length === 1) {
        const tag = (this.state.tags?.tags || []).find(item => item.id === context.repositoryTagIds[0]);
        if (tag?.name) parts.push(tag.name);
      }
      if (context.searchText) parts.push(`“${context.searchText.slice(0, 18)}”`);
      parts.push(kind === 'projects' ? '项目' : (kind === 'project-repositories' ? '项目仓库' : '仓库'));
      return parts.join(' · ').slice(0, SmartCollections.MAX_NAME_LENGTH);
    }

    describe(collection) {
      const query = this.contentQuery.normalize(collection.query);
      const kind = this.contentQuery.collectionKind(query);
      const details = [kind === 'projects' ? '所有项目' : (kind === 'project-repositories' ? '所有项目中的 Git 仓库' : '所有 Git 仓库')];
      if (query.lifecycles.length) details.push(query.lifecycles.map(value => LIFECYCLE_LABELS[value] || value).join('、'));
      if (query.gitStatuses.length) details.push(query.gitStatuses.map(value => STATUS_LABELS[value] || value).join('、'));
      if (query.repositoryCategory !== 'all') {
        const group = (this.state.groups?.groups || []).find(item => item.id === query.repositoryCategory);
        details.push(query.repositoryCategory === 'ungrouped' ? '未分类' : `分类：${group?.name || '已移除分类'}`);
      }
      if (query.modifiedWithinDays !== null) details.push(`最近 ${query.modifiedWithinDays} 天修改`);
      if (query.modifiedFrom || query.modifiedTo) {
        details.push(`修改日期：${query.modifiedFrom || '最早'} 至 ${query.modifiedTo || '现在'}`);
      }
      if (collection.repositoryTagIds.length) details.push(`${collection.repositoryTagIds.length} 个标签`);
      if (collection.searchText) details.push(`搜索：${collection.searchText}`);
      return details.join(' · ');
    }

    updateControls() {
      const button = this.element('content-filter-save-collection');
      if (button) {
        const savable = this.state.currentMode === 'tree' && SmartCollections.isSavableQuery(this.state.contentQuery);
        button.disabled = !savable;
        button.title = savable ? '命名并固定当前全局筛选' : '请先选择“所有项目”或“所有 Git 仓库”';
      }
      this.render();
    }

    isOpen() {
      return this.element('smart-collection-modal')?.style.display === 'flex';
    }

    open() {
      if (!SmartCollections.isSavableQuery(this.state.contentQuery)) {
        this.app._showStatusMessage('请先选择“所有项目”或“所有 Git 仓库”，再保存智能集合', 'info');
        return;
      }
      const modal = this.element('smart-collection-modal');
      const input = this.element('smart-collection-name');
      if (!modal || !input) return;
      this.closeMenu();
      this.app.closeToolbarMenus();
      this.restoreFocus = this.document?.activeElement || null;
      this.editingId = null;
      this.setFeedback('');
      input.value = this.suggestedName();
      const title = this.element('smart-collection-title');
      const description = this.element('smart-collection-description');
      const saveButton = this.element('smart-collection-save-btn');
      if (title) title.textContent = '存为智能集合';
      if (description) description.textContent = '只保存本机筛选条件，不复制文件，也不会修改 Git 或项目配置。';
      if (saveButton) saveButton.textContent = '保存集合';
      const summary = this.element('smart-collection-summary');
      if (summary) summary.textContent = this.describe({ ...this.currentContext(), name: input.value });
      modal.inert = false;
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      this.window?.requestAnimationFrame?.(() => {
        input.focus();
        input.select?.();
      });
    }

    openRename(id, { restoreFocus = null } = {}) {
      const collection = (this.state.smartCollections || []).find(item => item.id === id);
      const modal = this.element('smart-collection-modal');
      const input = this.element('smart-collection-name');
      if (!collection || !modal || !input) return;
      this.closeMenu();
      this.app.closeToolbarMenus();
      this.restoreFocus = restoreFocus || this.document?.activeElement || null;
      this.editingId = collection.id;
      this.setFeedback('');
      input.value = collection.name;
      const title = this.element('smart-collection-title');
      const description = this.element('smart-collection-description');
      const saveButton = this.element('smart-collection-save-btn');
      if (title) title.textContent = '重命名智能集合';
      if (description) description.textContent = '只修改本机快捷入口名称，不改变筛选条件或任何文件。';
      if (saveButton) saveButton.textContent = '保存名称';
      const summary = this.element('smart-collection-summary');
      if (summary) summary.textContent = this.describe(collection);
      modal.inert = false;
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      this.window?.requestAnimationFrame?.(() => {
        input.focus();
        input.select?.();
      });
    }

    close({ restoreFocus = true } = {}) {
      const modal = this.element('smart-collection-modal');
      if (!modal) return;
      const active = this.document?.activeElement;
      if (active && modal.contains?.(active)) active.blur?.();
      modal.inert = true;
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
      if (restoreFocus) this.restoreFocus?.focus?.();
      this.restoreFocus = null;
      this.editingId = null;
    }

    setFeedback(message, tone = '') {
      const feedback = this.element('smart-collection-feedback');
      if (!feedback) return;
      feedback.textContent = message;
      feedback.dataset.tone = tone;
    }

    async persist(store) {
      await this.bridge.config.set('smartCollections', store);
      this.state.smartCollections = store.collections;
      this.render();
    }

    async save() {
      if (this.busy) return;
      const input = this.element('smart-collection-name');
      const editingId = this.editingId;
      const current = { version: SmartCollections.VERSION, collections: this.state.smartCollections };
      const result = editingId
        ? SmartCollections.rename(current, editingId, input?.value)
        : SmartCollections.create(current, { ...this.currentContext(), name: input?.value });
      if (!result.ok) {
        this.setFeedback(result.error, 'error');
        input?.focus?.();
        return;
      }
      if (editingId && !result.changed) {
        this.close();
        return;
      }
      this.busy = true;
      const button = this.element('smart-collection-save-btn');
      if (button) button.disabled = true;
      try {
        await this.persist(result.store);
        this.close();
        this.app._showStatusMessage(
          editingId ? `已重命名智能集合为“${result.collection.name}”` : `已保存智能集合“${result.collection.name}”`,
          'success'
        );
      } catch (error) {
        this.setFeedback(`保存失败：${error?.message || String(error)}`, 'error');
      } finally {
        this.busy = false;
        if (button) button.disabled = false;
      }
    }

    openMenu(id, x, y, { restoreFocus = null } = {}) {
      const collections = Array.isArray(this.state.smartCollections) ? this.state.smartCollections : [];
      const index = collections.findIndex(item => item.id === id);
      const menu = this.element('smart-collection-context-menu');
      if (index < 0 || !menu) return;
      this.app.closeToolbarMenus();
      this.menuCollectionId = id;
      this.menuRestoreFocus = restoreFocus;
      const up = menu.querySelector?.('[data-smart-collection-action="move-up"]');
      const down = menu.querySelector?.('[data-smart-collection-action="move-down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === collections.length - 1;
      menu.hidden = false;
      const width = menu.offsetWidth || 176;
      const height = menu.offsetHeight || 150;
      const viewportWidth = this.window?.innerWidth || 1200;
      const viewportHeight = this.window?.innerHeight || 800;
      menu.style.left = `${Math.max(8, Math.min(Number(x) || 8, viewportWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(Number(y) || 8, viewportHeight - height - 8))}px`;
      const row = this.element('smart-collections-list')?.querySelector?.(`[data-smart-collection-id="${id}"]`);
      row?.querySelector?.('.smart-collection-more')?.setAttribute('aria-expanded', 'true');
      this.window?.requestAnimationFrame?.(() => menu.querySelector?.('.finder-menu-item:not(:disabled)')?.focus?.());
    }

    closeMenu({ restoreFocus = false } = {}) {
      const menu = this.element('smart-collection-context-menu');
      if (!menu) return;
      menu.hidden = true;
      menu.style.left = '';
      menu.style.top = '';
      this.element('smart-collections-list')?.querySelectorAll?.('.smart-collection-more')
        .forEach(button => button.setAttribute('aria-expanded', 'false'));
      if (restoreFocus) this.menuRestoreFocus?.focus?.();
      this.menuCollectionId = null;
      this.menuRestoreFocus = null;
    }

    async commitOrder(orderedIds) {
      if (this.busy) return;
      const current = { version: SmartCollections.VERSION, collections: this.state.smartCollections };
      const result = SmartCollections.reorder(current, orderedIds);
      if (!result.changed) {
        this.render();
        return;
      }
      this.busy = true;
      try {
        await this.persist(result.store);
        this.app._showStatusMessage('已调整智能集合顺序', 'success');
      } catch (error) {
        this.render();
        this.app._showStatusMessage(`调整智能集合顺序失败：${error?.message || String(error)}`, 'error');
      } finally {
        this.busy = false;
      }
    }

    async move(id, offset) {
      const ids = (this.state.smartCollections || []).map(item => item.id);
      const index = ids.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await this.commitOrder(ids);
    }

    async reorderByDrop(sourceId, targetId, after) {
      const ids = (this.state.smartCollections || []).map(item => item.id);
      if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return;
      const withoutSource = ids.filter(id => id !== sourceId);
      const targetIndex = withoutSource.indexOf(targetId);
      withoutSource.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
      await this.commitOrder(withoutSource);
    }

    clearDragIndicators() {
      this.element('smart-collections-list')?.querySelectorAll?.('.smart-collection-item')
        .forEach(item => item.classList.remove('dragging', 'drop-before', 'drop-after'));
    }

    apply(collection) {
      const value = SmartCollections.normalizeCollection(collection);
      if (!value) return;
      this.state.selectedTags = [...value.repositoryTagIds];
      this.state.searchQuery = value.searchText;
      this.state.searchScope = 'current';
      this.state.filterEnabled.name = value.searchFields.includes('name');
      this.state.filterEnabled.readme = value.searchFields.includes('readme');
      const input = this.element('search-input');
      if (input) input.value = value.searchText;
      this.app.renderSidebarTags();
      this.app.setContentQuery(value.query);
      this.render();
      this.app._showStatusMessage(`已应用智能集合“${value.name}”`, 'success');
    }

    async remove(id) {
      if (this.busy) return;
      this.closeMenu();
      const current = { version: SmartCollections.VERSION, collections: this.state.smartCollections };
      const result = SmartCollections.remove(current, id);
      if (!result.removed) return;
      const removed = this.state.smartCollections.find(item => item.id === id);
      this.busy = true;
      try {
        await this.persist(result.store);
        this.app._showStatusMessage(`已移除智能集合“${removed?.name || ''}”`, 'success');
      } catch (error) {
        this.app._showStatusMessage(`移除智能集合失败：${error?.message || String(error)}`, 'error');
      } finally {
        this.busy = false;
      }
    }

    render() {
      const section = this.element('smart-collections-sidebar-section');
      const container = this.element('smart-collections-list');
      if (!section || !container) return;
      const collections = Array.isArray(this.state.smartCollections) ? this.state.smartCollections : [];
      section.hidden = collections.length === 0;
      if (!collections.length) {
        container.replaceChildren?.();
        return;
      }
      const context = this.currentContext();
      container.innerHTML = collections.map(collection => {
        const active = this.state.currentMode === 'tree' && SmartCollections.matchesContext(collection, context);
        return `<div class="smart-collection-item${active ? ' active' : ''}" data-smart-collection-id="${this.app.escapeHtml(collection.id)}" draggable="true" title="拖动可调整顺序">
          <button class="smart-collection-open" type="button" title="${this.app.escapeHtml(this.describe(collection))}" aria-current="${active ? 'page' : 'false'}">
            <span class="smart-collection-icon" aria-hidden="true">⌕</span>
            <span class="smart-collection-name">${this.app.escapeHtml(collection.name)}</span>
          </button>
          <button class="smart-collection-more" type="button" aria-label="管理智能集合 ${this.app.escapeHtml(collection.name)}" aria-haspopup="menu" aria-expanded="false" title="更多操作">•••</button>
        </div>`;
      }).join('');
      container.querySelectorAll('.smart-collection-open').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.closest('[data-smart-collection-id]')?.dataset.smartCollectionId;
          const collection = collections.find(item => item.id === id);
          if (collection) this.apply(collection);
        });
      });
      container.querySelectorAll('.smart-collection-more').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          const id = button.closest('[data-smart-collection-id]')?.dataset.smartCollectionId;
          if (!id) return;
          const menu = this.element('smart-collection-context-menu');
          if (!menu?.hidden && this.menuCollectionId === id) {
            this.closeMenu({ restoreFocus: true });
            return;
          }
          const rect = button.getBoundingClientRect();
          this.openMenu(id, rect.left, rect.bottom + 4, { restoreFocus: button });
        });
      });
      container.querySelectorAll('.smart-collection-item').forEach(item => {
        item.addEventListener('dragstart', event => {
          if (event.target.closest?.('.smart-collection-more')) {
            event.preventDefault();
            return;
          }
          this.closeMenu();
          this.draggedId = item.dataset.smartCollectionId;
          item.classList.add('dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', this.draggedId);
          }
        });
        item.addEventListener('dragover', event => {
          if (!this.draggedId || this.draggedId === item.dataset.smartCollectionId) return;
          event.preventDefault();
          const rect = item.getBoundingClientRect();
          const after = event.clientY >= rect.top + rect.height / 2;
          item.classList.toggle('drop-before', !after);
          item.classList.toggle('drop-after', after);
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
        item.addEventListener('drop', event => {
          if (!this.draggedId) return;
          event.preventDefault();
          const rect = item.getBoundingClientRect();
          const sourceId = this.draggedId;
          const targetId = item.dataset.smartCollectionId;
          const after = event.clientY >= rect.top + rect.height / 2;
          this.clearDragIndicators();
          this.draggedId = null;
          this.reorderByDrop(sourceId, targetId, after);
        });
        item.addEventListener('dragend', () => {
          this.draggedId = null;
          this.clearDragIndicators();
        });
      });
    }
  }

  return { Controller };
});
