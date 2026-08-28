(function exposeFileSelectionDetailController(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileSelectionDetailController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileSelectionDetailControllerApi() {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.document = options.document || null;
      this.fileBrowser = options.fileBrowser;
    }

    show(items = []) {
      this.app.cancelRepoSelection?.();
      this.state.selectedRepo = null;
      const empty = this._element('detail-empty');
      const content = this._element('detail-content');
      if (!empty || !content) return;
      content.style.display = 'none';
      empty.style.display = 'flex';
      if (!items.length) {
        empty.innerHTML = '<div class="detail-empty-icon">📋</div><div class="detail-empty-text">选择文件或仓库查看详情</div>';
        return;
      }
      if (items.length > 1) {
        empty.innerHTML = `<div class="detail-empty-icon">✓</div><div class="detail-empty-text">已选择 ${items.length} 项</div><div class="detail-empty-subtext">可以批量移动或移到废纸篓</div>`;
        return;
      }

      const item = items[0];
      const lifecycle = this.fileBrowser.projectLifecycleLabel(item);
      const favorite = item.type === 'directory' && this.app.isFavoritePath(item.path);
      const summary = this.app.getFileItemSummary(item) || (item.isProject ? '本地项目' : '双击打开');
      empty.innerHTML = `
        <div class="detail-empty-icon detail-empty-icon-semantic">${this.app.getItemKindIconHtml(item, 'detail-empty-kind-icon')}</div>
        <div class="detail-empty-text">${this.app.escapeHtml(item.name)}</div>
        <div class="detail-empty-path">${this.app.escapeHtml(item.path)}</div>
        <div class="detail-empty-subtext">${this.app.escapeHtml(lifecycle ? `${lifecycle} · ${summary}` : summary)}</div>
        ${item.type === 'directory' ? `<div class="detail-empty-actions">
          <button class="btn btn-small" data-detail-action="toggle-favorite" data-path="${this.app.escapeHtml(item.path)}">${favorite ? '从收藏夹移除' : '添加到收藏夹'}</button>
          <button class="btn btn-small" data-app-action="file-project-settings" data-project-path="${this.app.escapeHtml(item.path)}">${item.isProject ? '项目设置' : '设为项目…'}</button>
          ${item.isProject || item.isGitRepo ? `<button class="btn btn-small" data-detail-action="show-relationship-resource" data-relationship-kind="${item.isProject ? 'project' : 'repository'}" data-relationship-ref="${this.app.escapeHtml(item.isProject ? item.project?.projectId || '' : '')}" data-relationship-path="${this.app.escapeHtml(item.path)}">关系白板</button>` : ''}
        </div>` : ''}
      `;
      empty.querySelector('[data-detail-action="toggle-favorite"]')?.addEventListener('click', event => {
        this.app.toggleFavoritePath(event.currentTarget.dataset.path);
      });
      empty.querySelector('[data-detail-action="show-relationship-resource"]')?.addEventListener('click', event => {
        const button = event.currentTarget;
        this.app.showResourceInRelationshipBoard({
          kind: button.dataset.relationshipKind,
          refId: button.dataset.relationshipRef,
          path: button.dataset.relationshipPath
        });
      });
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return { Controller };
});
