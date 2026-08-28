(function exposeRepositoryDetailController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RepositoryDetailController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createRepositoryDetailControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge;
      this.document = options.document || root?.document || null;
      this.terminal = options.terminal || root?.Terminal || null;
      this.selectionRequestId = 0;
    }

    cancel() {
      this.selectionRequestId += 1;
    }

    async select(repoPath) {
      const requestId = ++this.selectionRequestId;
      try {
        const [info, status, readme, tags, controlFiles, markdownDocs, savedSelections, savedDocSelections, localProject] = await Promise.all([
          this.bridge.fs.getFileInfo(repoPath),
          this.bridge.git.getStatus(repoPath, { autoFetch: false }),
          this.bridge.fs.getReadmePreview(repoPath),
          this.bridge.tags.getRepoTags(repoPath),
          this.bridge.fs.listProjectControlFiles(repoPath),
          this.bridge.fs.listMarkdownDocuments(repoPath),
          this.bridge.config.get('projectControlSelections'),
          this.bridge.config.get('markdownDocumentSelections'),
          this.bridge.localProjects.describe(repoPath).catch(() => ({ isProject: false, project: null }))
        ]);
        const groups = this.app._findRepoGroups(repoPath);
        const [projectControl, projectDocs] = await Promise.all([
          this.app.loadProjectControl(repoPath, controlFiles, savedSelections?.[repoPath]),
          this.app.loadMarkdownDocuments(repoPath, markdownDocs, savedDocSelections?.[repoPath])
        ]);
        if (requestId !== this.selectionRequestId) return false;

        this.state.controlSlot = 'progress';
        this.state.documentMode = 'preview';
        this.state.selectedRepo = {
          ...info,
          gitStatus: status,
          readme,
          tags,
          groups,
          projectControl,
          projectDocs,
          localProject
        };
        this.terminal?.setCwd?.(repoPath);
        await this.render();
        return true;
      } catch (error) {
        if (requestId !== this.selectionRequestId) return false;
        this.state.selectedRepo = null;
        const missing = this.app.isMissingProjectPathError(error);
        this.showError(
          missing ? '项目目录不存在' : '项目读取失败',
          repoPath,
          missing
            ? '该仓库路径可能已移动或删除，请重新扫描或从仓库列表中清理。'
            : (error.message || String(error))
        );
        return false;
      }
    }

    showError(title, pathValue, message) {
      const empty = this._element('detail-empty');
      const content = this._element('detail-content');
      if (content) content.style.display = 'none';
      if (!empty) return;
      empty.style.display = 'flex';
      empty.innerHTML = `
        <div class="detail-empty-icon">⚠</div>
        <div class="detail-empty-text">${this.app.escapeHtml(title)}</div>
        <div class="detail-empty-path">${this.app.escapeHtml(pathValue || '')}</div>
        <div class="detail-empty-subtext">${this.app.escapeHtml(message || '')}</div>
      `;
    }

    updateSections() {
      this.document.querySelectorAll('.detail-content [data-section-id]').forEach(section => {
        const id = section.dataset.sectionId;
        const visible = this.state.detailSections[id] !== false;
        section.style.display = visible ? '' : 'none';
      });
    }

    applySectionOrder() {
      if (!this.state.detailSectionOrder) return;
      const container = this.document.querySelector('.detail-content');
      if (!container) return;
      const sections = {};
      container.querySelectorAll('[data-section-id]').forEach(section => {
        sections[section.dataset.sectionId] = section;
      });
      this.state.detailSectionOrder.forEach(id => {
        if (sections[id]) container.appendChild(sections[id]);
      });
    }

    async saveSectionOrder() {
      const order = [];
      this.document.querySelectorAll('.detail-content [data-section-id]').forEach(section => {
        order.push(section.dataset.sectionId);
      });
      this.state.detailSectionOrder = order;
      await this.bridge.config.set('detailSectionOrder', order);
    }

    setupSectionDrag() {
      const sections = this.document.querySelectorAll('.detail-section[data-section-id]');
      let draggedSection = null;

      sections.forEach(section => {
        if (section.dataset.dragInit) return;
        section.dataset.dragInit = '1';

        const heading = section.querySelector('h4, .section-toggle');
        if (heading && !heading.querySelector('.drag-handle')) {
          const handle = this.document.createElement('span');
          handle.className = 'drag-handle';
          handle.textContent = '⋮⋮';
          handle.title = '拖拽排序';
          heading.insertBefore(handle, heading.firstChild);
        }

        section.addEventListener('mousedown', event => {
          if (event.target.classList.contains('drag-handle')) section.draggable = true;
        });
        section.addEventListener('dragstart', event => {
          draggedSection = section;
          section.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', '');
        });
        section.addEventListener('dragend', () => {
          section.classList.remove('dragging');
          section.draggable = false;
          draggedSection = null;
          this.saveSectionOrder();
        });
        section.addEventListener('dragover', event => {
          event.preventDefault();
          if (!draggedSection || draggedSection === section) return;
          const rect = section.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (event.clientY < midY) section.parentNode.insertBefore(draggedSection, section);
          else section.parentNode.insertBefore(draggedSection, section.nextSibling);
        });
      });
    }

    async render() {
      const repo = this.state.selectedRepo;
      if (!repo) return false;

      this._element('detail-empty').style.display = 'none';
      this._element('detail-content').style.display = 'flex';
      this._element('detail-name').textContent = repo.name;
      this._element('detail-path').textContent = repo.path;

      const projectSettingsButton = this._element('detail-project-settings');
      if (projectSettingsButton) {
        projectSettingsButton.style.display = '';
        projectSettingsButton.textContent = repo.localProject?.isProject ? '项目设置' : '设为项目…';
      }
      const relationshipButton = this._element('detail-relationship-board');
      if (relationshipButton) {
        const projectId = repo.localProject?.isProject ? repo.localProject.project?.projectId : '';
        relationshipButton.style.display = '';
        relationshipButton.dataset.relationshipKind = projectId ? 'project' : 'repository';
        relationshipButton.dataset.relationshipRef = projectId || '';
        relationshipButton.dataset.relationshipPath = repo.path || '';
      }

      this.updateSections();
      this.applySectionOrder();
      this.setupSectionDrag();

      const toggleButton = this._element('toggle-assignments-btn');
      if (toggleButton) {
        toggleButton.textContent = this.state.showAllAssignments ? '隐藏未选' : '显示全部';
        toggleButton.classList.toggle('active', !this.state.showAllAssignments);
      }

      const tags = repo.tags || [];
      const isFavorite = this.app.isFavoritePath(repo.path);
      const favoriteButton = this._element('detail-fav-btn');
      favoriteButton.classList.toggle('active', isFavorite);
      favoriteButton.textContent = isFavorite ? '★' : '☆';
      favoriteButton.title = isFavorite ? '从侧栏收藏夹移除' : '添加到侧栏收藏夹';

      const status = repo.gitStatus || {};
      const statusMap = {
        clean: { label: '已同步', cls: 'clean' },
        dirty: { label: '未提交', cls: 'dirty' },
        ahead: { label: '未推送', cls: 'ahead' },
        behind: { label: '需拉取', cls: 'behind' }
      };
      const statusInfo = statusMap[status.overallStatus || 'clean'] || statusMap.clean;
      const upstreamText = this.app.escapeHtml(status.upstream || (status.hasRemote ? '未设置跟踪分支' : '未添加远端'));
      const remoteUrlText = this.app.escapeHtml(status.remoteUrl || '');

      this._element('detail-status').innerHTML = `
        <span class="detail-status-badge ${statusInfo.cls}">${statusInfo.label}</span>
        ${status.branch ? `<span class="detail-status-badge" style="background:rgba(0,0,0,0.06);color:#1d1d1f;">${this.app.escapeHtml(status.branch)}</span>` : ''}
      `;

      const readme = repo.readme || {};
      this._element('detail-readme').innerHTML = `
        <div class="detail-readme-title">${this.app.escapeHtml(readme.title || repo.name)}</div>
        <div>${this.app.escapeHtml(readme.description || '暂无描述')}</div>
      `;

      this.app.renderMarkdownDocuments();
      this.app.renderProjectProgress();

      this._element('detail-git-info').innerHTML = `
        <div class="git-stats-row">
          <div class="git-stat ${status.modified > 0 ? 'dirty' : ''}">
            <span class="git-stat-value">${status.modified || 0}</span>
            <span class="git-stat-label">修改</span>
          </div>
          <div class="git-stat ${status.ahead > 0 ? 'ahead' : ''}">
            <span class="git-stat-value">${status.ahead || 0}</span>
            <span class="git-stat-label">未推送</span>
          </div>
          <div class="git-stat ${status.behind > 0 ? 'behind' : ''}">
            <span class="git-stat-value">${status.behind || 0}</span>
            <span class="git-stat-label">需拉取</span>
          </div>
          <div class="git-stat ${!status.hasRemote ? 'no-remote' : ''}">
            <span class="git-stat-value">${status.hasRemote ? '已添加' : '未添加'}</span>
            <span class="git-stat-label">远程仓库</span>
          </div>
        </div>
        <div class="git-remote-row">
          <span class="git-info-label">同步远端</span>
          <div class="git-remote-value">
            <span>${upstreamText}</span>
            ${status.remoteUrl ? `<span class="git-remote-url" title="${remoteUrlText}">${remoteUrlText}</span>` : ''}
          </div>
        </div>
        ${status.lastCommit ? `
          <div class="detail-last-commit">
            <div class="last-commit-hash">${this.app.escapeHtml(status.lastCommit.hash)}</div>
            <div class="last-commit-message">${this.app.escapeHtml(status.lastCommit.message)}</div>
            <div class="last-commit-meta">
              <span>${this.app.escapeHtml(status.lastCommit.author)}</span>
              <span>${this.app.formatTime(status.lastCommit.timestamp)}</span>
            </div>
          </div>
        ` : ''}
      `;

      this._renderGroups(repo);
      this._renderTags(repo, tags);
      return true;
    }

    _renderGroups(repo) {
      const groupsElement = this._element('detail-groups');
      const repoGroups = repo.groups || [];
      const repoGroupIds = new Set(repoGroups.map(group => group.id));
      const allGroups = this.state.groups.groups || [];
      const visibleGroups = (this.state.showAllAssignments || repoGroupIds.size === 0)
        ? allGroups
        : allGroups.filter(group => repoGroupIds.has(group.id));
      if (!visibleGroups.length) {
        groupsElement.innerHTML = '<div style="font-size:12px;color:#86868b;">暂无分类,点击下方按钮新建</div>';
        return;
      }

      groupsElement.innerHTML = visibleGroups.map(group => {
        const assigned = repoGroupIds.has(group.id);
        const color = this.app.safeColor(group.color);
        const style = assigned
          ? `background:${color};color:#fff;border:1px solid ${color};`
          : 'background:rgba(0,0,0,0.04);color:#86868b;border:1px solid rgba(0,0,0,0.1);';
        return `<span class="detail-tag toggle" data-group-id="${this.app.escapeHtml(group.id)}" style="${style}" title="${assigned ? '点击移除' : '点击加入'}">${this.app.escapeHtml(group.name)}</span>`;
      }).join('');
      groupsElement.querySelectorAll('.detail-tag.toggle[data-group-id]').forEach(element => {
        element.addEventListener('click', async () => {
          const groupId = element.dataset.groupId;
          if (repoGroupIds.has(groupId)) await this.bridge.groups.removeRepo(groupId, repo.path);
          else await this.bridge.groups.addRepo(groupId, repo.path);
          this.state.groups = await this.bridge.groups.get();
          repo.groups = this.app._findRepoGroups(repo.path);
          this.app._syncRepoGroupsInState(repo.path, repo.groups);
          await this.render();
          this.app.renderSidebarGroups();
          this.app.renderContent();
        });
      });
    }

    _renderTags(repo, tags) {
      const tagsElement = this._element('detail-tags');
      const repoTagIds = new Set(tags.map(tag => tag.id));
      const allTags = this.state.tags.tags || [];
      const visibleTags = this.state.showAllAssignments
        ? allTags
        : allTags.filter(tag => repoTagIds.has(tag.id));
      if (!visibleTags.length) {
        tagsElement.innerHTML = '<div style="font-size:12px;color:#86868b;">暂无标签,点击下方按钮新建</div>';
        return;
      }

      tagsElement.innerHTML = visibleTags.map(tag => {
        const assigned = repoTagIds.has(tag.id);
        const color = this.app.safeColor(tag.color);
        const style = assigned
          ? `background:${color};color:#fff;border:1px solid ${color};`
          : 'background:rgba(0,0,0,0.04);color:#86868b;border:1px solid rgba(0,0,0,0.1);';
        return `<span class="detail-tag toggle" data-tag-id="${this.app.escapeHtml(tag.id)}" style="${style}" title="${assigned ? '点击移除' : '点击赋值'}">${this.app.escapeHtml(tag.name)}</span>`;
      }).join('');
      tagsElement.querySelectorAll('.detail-tag.toggle[data-tag-id]').forEach(element => {
        element.addEventListener('click', async () => {
          const tagId = element.dataset.tagId;
          if (repoTagIds.has(tagId)) await this.bridge.tags.removeRepo(tagId, repo.path);
          else await this.bridge.tags.addRepo(tagId, repo.path);
          this.state.tags = await this.bridge.tags.get();
          repo.tags = await this.bridge.tags.getRepoTags(repo.path);
          await this.render();
          this.app.renderSidebarTags();
          this.app.renderContent();
        });
      });
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return { Controller };
});
