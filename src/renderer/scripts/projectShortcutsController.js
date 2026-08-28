(function exposeProjectShortcutsController(root, factory) {
  const projectShortcuts = typeof module !== 'undefined' && module.exports
    ? require('../../shared/projectShortcuts')
    : root?.ProjectShortcuts;
  const api = factory(projectShortcuts, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectShortcutsController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProjectShortcutsControllerApi(ProjectShortcuts, root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder;
      this.document = options.document || root?.document || null;
      this.platform = options.platform || this.bridge?.platform || '';
      this.localProjectsListPromise = null;
      this.bound = false;
    }

    element(id) {
      return this.document?.getElementById(id) || null;
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.element('project-shortcuts-list')?.addEventListener('click', event => {
        const pinButton = event.target.closest?.('[data-project-shortcut-pin]');
        if (pinButton) {
          event.stopPropagation();
          this.togglePinned(pinButton.dataset.projectShortcutPin);
          return;
        }
        if (event.target.closest?.('[data-project-shortcut-all]')) {
          this.app.applyContentPreset('all-projects');
          return;
        }
        const projectButton = event.target.closest?.('[data-project-shortcut-id]');
        if (projectButton) this.open(projectButton.dataset.projectShortcutId);
      });
    }

    async load() {
      const [rawStore, rawPreferences] = await Promise.all([
        this.bridge.config.get('projectShortcuts').catch(() => null),
        this.bridge.config.get('projectShortcutPreferences').catch(() => null)
      ]);
      this.state.projectShortcuts = ProjectShortcuts.normalizeStore(rawStore);
      this.state.projectShortcutPreferences = ProjectShortcuts.normalizePreferences(rawPreferences);
      this.render();
      return this.state.projectShortcuts;
    }

    async loadLocalProjects(forceRefresh = false) {
      if (!forceRefresh && this.state.localProjects.length) return this.state.localProjects;
      if (this.localProjectsListPromise) return this.localProjectsListPromise;
      this.localProjectsListPromise = this.bridge.localProjects.list()
        .then(projects => {
          this.state.localProjects = Array.isArray(projects) ? projects : [];
          return this.state.localProjects;
        })
        .finally(() => { this.localProjectsListPromise = null; });
      return this.localProjectsListPromise;
    }

    async refresh(forceRefresh = false) {
      const projects = await this.loadLocalProjects(forceRefresh);
      const merged = ProjectShortcuts.mergeKnownProjects(this.state.projectShortcuts, projects);
      if (!ProjectShortcuts.storesEqual(merged, this.state.projectShortcuts)) {
        this.state.projectShortcuts = merged;
        await this.bridge.config.set('projectShortcuts', merged);
      }
      await this.recordVisit(this.state.currentPath);
      this.render();
      return projects;
    }

    async recordVisit(directoryPath) {
      if (!directoryPath || !this.state.localProjects.length) return false;
      const project = ProjectShortcuts.findProjectForPath(
        this.state.localProjects,
        directoryPath,
        this.platform
      );
      if (!project) {
        this.render();
        return false;
      }
      const next = ProjectShortcuts.touchProject(this.state.projectShortcuts, project);
      if (ProjectShortcuts.storesEqual(next, this.state.projectShortcuts)) {
        this.render();
        return false;
      }
      this.state.projectShortcuts = next;
      this.render();
      await this.bridge.config.set('projectShortcuts', next);
      return true;
    }

    async togglePinned(projectId) {
      const display = ProjectShortcuts.resolveDisplay(this.state.projectShortcuts, this.state.localProjects);
      const entry = [...display.pinned, ...display.recent].find(item => item.projectId === projectId);
      const project = entry?.project || entry;
      if (!project?.projectId) return false;
      const currentlyPinned = display.pinned.some(item => item.projectId === projectId);
      const next = ProjectShortcuts.setPinned(this.state.projectShortcuts, project, !currentlyPinned);
      this.state.projectShortcuts = next;
      this.render();
      await this.bridge.config.set('projectShortcuts', next);
      this.app._showStatusMessage(currentlyPinned ? '已从项目快捷入口取消固定' : '已固定到项目快捷入口', 'success');
      return true;
    }

    async open(projectId) {
      let project = this.state.localProjects.find(item => item.projectId === projectId);
      if (!project) {
        await this.refresh(true);
        project = this.state.localProjects.find(item => item.projectId === projectId);
      }
      if (!project?.path) {
        this.app._showStatusMessage('项目位置不可用；可取消固定或重新添加所在受管目录', 'warning');
        return false;
      }
      this.app.openLocalProject(project.path);
      return true;
    }

    async savePreferences(value) {
      const preferences = ProjectShortcuts.normalizePreferences(value);
      this.state.projectShortcutPreferences = preferences;
      this.render();
      await this.bridge.config.set('projectShortcutPreferences', preferences);
      return preferences;
    }

    async clearRecent() {
      const current = ProjectShortcuts.normalizeStore(this.state.projectShortcuts);
      if (!current.recent.length) return false;
      const next = ProjectShortcuts.normalizeStore({ ...current, recent: [] });
      this.state.projectShortcuts = next;
      this.render();
      await this.bridge.config.set('projectShortcuts', next);
      return true;
    }

    render() {
      const section = this.element('project-shortcuts-sidebar-section');
      const container = this.element('project-shortcuts-list');
      if (!section || !container) return;
      const preferences = ProjectShortcuts.normalizePreferences(this.state.projectShortcutPreferences);
      const display = ProjectShortcuts.resolveDisplay(this.state.projectShortcuts, this.state.localProjects);
      const recent = preferences.showRecent ? display.recent.slice(0, preferences.recentLimit) : [];
      const hasProjects = this.state.localProjects.length > 0 || display.pinned.length > 0;
      section.hidden = !preferences.visible || !hasProjects;
      if (section.hidden) {
        container.innerHTML = '';
        return;
      }
      const activeProject = ProjectShortcuts.findProjectForPath(
        this.state.localProjects,
        this.state.currentPath,
        this.platform
      );
      const renderEntry = (entry, pinned) => {
        const project = entry.project;
        const available = entry.available && project?.path;
        const active = available && activeProject?.projectId === entry.projectId && !this.app.isContentCollection();
        const item = project
          ? { type: 'directory', isProject: true, isGitRepo: project.rootIsGitRepo === true, project }
          : { type: 'directory', isProject: true, isGitRepo: false, project: { color: 'gray' } };
        const name = project?.name || entry.name || '未命名项目';
        const title = available ? project.path : `${name} · 项目位置不可用`;
        return `
          <div class="project-shortcut-row ${active ? 'active' : ''} ${available ? '' : 'is-unavailable'}">
            <button class="sidebar-item project-shortcut-open" data-project-shortcut-id="${this.app.escapeHtml(entry.projectId)}" type="button" title="${this.app.escapeHtml(title)}" aria-disabled="${available ? 'false' : 'true'}">
              ${this.app.getItemKindIconHtml(item, 'sidebar-kind-icon')}
              <span class="sidebar-item-name">${this.app.escapeHtml(name)}</span>
              ${available ? '' : '<span class="project-shortcut-status">不可用</span>'}
            </button>
            <button class="project-shortcut-pin ${pinned ? 'active' : ''}" data-project-shortcut-pin="${this.app.escapeHtml(entry.projectId)}" type="button" title="${pinned ? '取消固定' : '固定到项目区'}" aria-label="${pinned ? '取消固定' : '固定'} ${this.app.escapeHtml(name)}">${pinned ? '●' : '○'}</button>
          </div>`;
      };
      const allProjectsActive = this.app.contentCollectionKind() === 'projects';
      container.innerHTML = `
        <button class="sidebar-item project-shortcut-all ${allProjectsActive ? 'active' : ''}" data-project-shortcut-all type="button" title="显示所有受管位置中的项目">
          <span class="sidebar-icon project-shortcut-all-icon" aria-hidden="true">▦</span>
          <span class="sidebar-item-name">所有项目</span>
          <span class="badge">${this.state.localProjects.length}</span>
        </button>
        ${display.pinned.length ? `<div class="project-shortcut-heading">已固定</div>${display.pinned.map(entry => renderEntry(entry, true)).join('')}` : ''}
        ${recent.length ? `<div class="project-shortcut-heading">最近</div>${recent.map(entry => renderEntry(entry, false)).join('')}` : ''}`;
    }
  }

  return { Controller };
});
