(function exposeFileActionBarController(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileActionBarController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileActionBarControllerApi() {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.document = options.document || null;
    }

    update() {
      const count = this.state.selectedPaths.size;
      const clipboardCount = this.state.fileClipboard?.paths?.length || 0;
      const busy = this.state.fileOperationBusy;
      const summary = this._element('file-selection-summary');
      if (summary) {
        summary.textContent = count
          ? `已选择 ${count} 项`
          : (clipboardCount ? `剪贴板中有 ${clipboardCount} 项` : '未选择项目');
      }

      const preview = this._element('file-preview');
      const copy = this._element('file-copy');
      const copyPath = this._element('file-copy-path');
      const cut = this._element('file-cut');
      const paste = this._element('file-paste');
      const getInfo = this._element('file-get-info');
      const duplicate = this._element('file-duplicate');
      const rename = this._element('file-rename');
      const move = this._element('file-move');
      const openEditor = this._element('file-open-editor');
      const fileLabels = this._element('file-labels');
      const favorite = this._element('file-favorite');
      const projectSettings = this._element('file-project-settings');
      const trash = this._element('file-trash');
      const createDirectory = this._element('file-new-folder');
      const createFile = this._element('file-new-file');

      if (preview) preview.disabled = busy || count !== 1;
      if (copy) copy.disabled = busy || count === 0;
      if (copyPath) copyPath.disabled = busy || count === 0;
      if (cut) cut.disabled = busy || count === 0;
      if (duplicate) duplicate.disabled = busy || count === 0 || !this.app.isDirectoryBrowsingContext();
      if (getInfo) getInfo.disabled = busy || count !== 1;
      if (paste) {
        paste.disabled = busy
          || !clipboardCount
          || !this.app.isDirectoryBrowsingContext()
          || this.app.isGlobalSearchActive()
          || !this.state.currentPath;
        this._setLabel(paste, clipboardCount > 1 ? `粘贴 ${clipboardCount} 项` : '粘贴');
      }
      if (rename) {
        rename.disabled = busy || count === 0;
        this._setLabel(rename, count > 1 ? `重命名 ${count} 个项目…` : '重命名');
      }
      if (move) move.disabled = busy || count === 0;
      if (openEditor) openEditor.disabled = busy || count !== 1;
      if (fileLabels) fileLabels.disabled = busy || count === 0;
      if (trash) trash.disabled = busy || count === 0;

      const selectedItems = this.app.getSelectedFileItems();
      const singleDirectory = selectedItems.length === 1 && selectedItems[0].type === 'directory';
      if (favorite) {
        favorite.disabled = busy || !singleDirectory;
        const isFavorite = singleDirectory && this.app.isFavoritePath(selectedItems[0].path);
        this._setLabel(favorite, isFavorite ? '从收藏夹移除' : '添加到收藏夹');
      }
      if (projectSettings) {
        projectSettings.disabled = busy || !singleDirectory;
        const isProject = singleDirectory && selectedItems[0].isProject;
        this._setLabel(projectSettings, isProject ? '项目设置…' : '设为项目…');
      }

      const createDisabled = busy
        || !this.app.isDirectoryBrowsingContext()
        || this.app.isGlobalSearchActive()
        || !this.state.currentPath;
      if (createDirectory) createDirectory.disabled = createDisabled;
      if (createFile) createFile.disabled = createDisabled;

      const undo = this._element('file-undo');
      const undoable = this.state.fileOperationHistory.find(operation => operation.undoable && !operation.undoneAt);
      if (undo) undo.disabled = busy || !undoable;
      const redo = this._element('file-redo');
      const redoable = [...this.state.fileOperationHistory]
        .filter(operation => operation.undoable && operation.undoneAt && operation.redoable && !operation.redoInvalidatedAt)
        .sort((left, right) => Number(right.undoneAt) - Number(left.undoneAt))[0];
      if (redo) redo.disabled = busy || !redoable;

      const createTrigger = this._element('file-create-menu-trigger');
      if (createTrigger) createTrigger.disabled = [createDirectory, createFile]
        .every(button => !button || button.disabled);
      const history = this._element('file-history');
      if (history) history.disabled = false;
      const actionTrigger = this._element('file-actions-menu-trigger');
      const actionItems = [
        copy, copyPath, cut, paste, getInfo, duplicate, rename, move, openEditor, fileLabels,
        favorite, projectSettings, trash, undo, redo, history
      ].filter(Boolean);
      if (actionTrigger) actionTrigger.disabled = !actionItems.some(button => !button.disabled);
      if (this.document.querySelector?.('[data-menu-trigger][aria-expanded="true"]:disabled')) {
        this.app.closeToolbarMenus();
      }
    }

    _setLabel(element, value) {
      const label = element?.querySelector?.('span');
      if (label) label.textContent = value;
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return { Controller };
});
