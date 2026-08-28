(function exposeDirectorySelectionController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectorySelectionController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectorySelectionControllerApi(root) {
  function itemPaths(items) {
    return (Array.isArray(items) ? items : []).map(item => item?.path).filter(Boolean);
  }

  function resolveFocusPath(items, focusPath, anchorPath, selectedPaths = []) {
    const paths = itemPaths(items);
    const visible = new Set(paths);
    if (visible.has(focusPath)) return focusPath;
    if (visible.has(anchorPath)) return anchorPath;
    const selectedPath = [...selectedPaths].find(pathValue => visible.has(pathValue));
    return selectedPath || paths[0] || null;
  }

  function rangePaths(orderedPaths, anchorPath, targetPath) {
    const paths = Array.isArray(orderedPaths) ? orderedPaths : [];
    const anchorIndex = paths.indexOf(anchorPath);
    const targetIndex = paths.indexOf(targetPath);
    if (targetIndex < 0) return [];
    if (anchorIndex < 0) return [targetPath];
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return paths.slice(start, end + 1);
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.document = options.document || root?.document || null;
      this.fileBrowser = options.fileBrowser || root?.FileBrowser || null;
      this.progressiveRenderer = options.progressiveRenderer || root?.ProgressiveDirectoryRender || null;
    }

    reconcileFileKeyboardFocus(items = this.state.visibleItems) {
      this.state.fileKeyboardFocusPath = resolveFocusPath(
        items,
        this.state.fileKeyboardFocusPath,
        this.state.selectionAnchorPath,
        this.state.selectedPaths
      );
      return this.state.fileKeyboardFocusPath;
    }

    bindCardEvents(container) {
      this.bindCardElements([...container.querySelectorAll('.repo-card, .repo-list-item')]);
    }

    bindCardElements(elements) {
      elements.forEach(element => {
        this.app.bindFileDragSource(element);
        element.addEventListener('click', event => {
          const path = element.dataset.path;
          const isGit = element.dataset.isGit === 'true';
          if (this.app.isFileBrowsingContext()) {
            this.handleFileSelectionClick(event, element);
            this.state.fileKeyboardFocusPath = path;
            element.focus({ preventScroll: true });
            const selectedItems = this.app.getSelectedFileItems();
            if (isGit && selectedItems.length === 1 && selectedItems[0].path === path) this.app.selectRepo(path);
            else this.app.showFileSelectionDetail(selectedItems);
          } else {
            this.document.querySelectorAll('.repo-card.selected, .repo-list-item.selected')
              .forEach(item => item.classList.remove('selected'));
            element.classList.add('selected');
            if (isGit) this.app.selectRepo(path);
          }
        });

        element.addEventListener('focus', () => {
          if (!this.app.isFileBrowsingContext()) return;
          this.state.fileKeyboardFocusPath = element.dataset.path;
          if (this.state.selectedPaths.size === 0) {
            this.state.selectedPaths = new Set([element.dataset.path]);
            this.state.selectionAnchorPath = element.dataset.path;
            this.app.showFileSelectionDetail(this.app.getSelectedFileItems());
            this.app.updateFileActionBar();
            this.app.updateStatusBar();
          }
          this.syncFileSelectionUI();
        });

        element.addEventListener('dblclick', () => {
          if (!this.app.isFileBrowsingContext()) return;
          this.app.activateFileItem({ path: element.dataset.path, type: element.dataset.type });
        });
      });
    }

    handleVirtualizedListKeyboardNavigation(event) {
      if (!['list', 'card'].includes(this.state.cardStyle) || !this.app.directoryVirtualizer) return false;
      const supportedKeys = this.state.cardStyle === 'list'
        ? ['ArrowUp', 'ArrowDown', 'Home', 'End']
        : ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!supportedKeys.includes(event.key)) return false;
      const orderedPaths = this.state.fileDisplayOrder;
      if (!orderedPaths.length) return false;
      const activePath = event.target?.closest?.('#content-area .repo-card, #content-area .repo-list-item')?.dataset.path
        || this.state.fileKeyboardFocusPath
        || [...this.state.selectedPaths][0]
        || orderedPaths[0];
      const currentIndex = Math.max(0, orderedPaths.indexOf(activePath));
      let targetIndex = currentIndex;
      const itemsPerRow = this.state.cardStyle === 'card'
        ? Math.max(1, Number(this.app.directoryVirtualizer.itemsPerRow?.()) || 1)
        : 1;
      if (event.key === 'ArrowLeft') targetIndex = Math.max(0, currentIndex - 1);
      if (event.key === 'ArrowRight') targetIndex = Math.min(orderedPaths.length - 1, currentIndex + 1);
      if (event.key === 'ArrowUp') targetIndex = Math.max(0, currentIndex - itemsPerRow);
      if (event.key === 'ArrowDown') targetIndex = Math.min(orderedPaths.length - 1, currentIndex + itemsPerRow);
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = orderedPaths.length - 1;
      const targetPath = orderedPaths[targetIndex];

      this.applyKeyboardSelection(orderedPaths, activePath, targetPath, event.shiftKey);
      this.app.directoryVirtualizer.ensureIndex(targetIndex);
      this.finishKeyboardSelection(targetPath);
      this.document.querySelector(`#content-area [data-path="${this.app.cssEscape(targetPath)}"]`)
        ?.focus({ preventScroll: true });
      return true;
    }

    handleFileKeyboardNavigation(event) {
      if (this.handleVirtualizedListKeyboardNavigation(event)) return true;
      const elements = [...this.document.querySelectorAll('#content-area .repo-card, #content-area .repo-list-item')];
      if (!elements.length) return false;
      const activeElement = event.target?.closest?.('#content-area .repo-card, #content-area .repo-list-item')
        || this.document.activeElement?.closest?.('#content-area .repo-card, #content-area .repo-list-item');
      if (!activeElement) return false;

      const currentPath = activeElement.dataset.path || this.state.fileKeyboardFocusPath;
      if (this.state.cardStyle === 'column' && event.key === 'ArrowRight' && !event.shiftKey) {
        const item = this.state.visibleItems.find(candidate => candidate.path === currentPath);
        if (item?.type === 'directory') this.app.activateFileItem(item);
        return item?.type === 'directory';
      }
      if (this.state.cardStyle === 'column' && event.key === 'ArrowLeft' && !event.shiftKey) {
        this.app.goUp();
        return true;
      }
      const currentIndex = Math.max(0, elements.findIndex(element => element.dataset.path === currentPath));
      const rects = elements.map(element => element.getBoundingClientRect());
      const targetIndex = this.fileBrowser.nextFileNavigationIndex(
        rects,
        currentIndex,
        event.key,
        this.state.cardStyle
      );
      if (targetIndex === null) return false;

      const targetElement = elements[targetIndex];
      const targetPath = targetElement.dataset.path;
      const orderedPaths = elements.map(element => element.dataset.path);
      this.applyKeyboardSelection(orderedPaths, currentPath, targetPath, event.shiftKey);
      this.finishKeyboardSelection(targetPath);
      if (this.state.cardStyle === 'gallery') {
        const item = this.state.visibleItems.find(candidate => candidate.path === targetPath);
        if (item) this.app.renderGalleryPreview(item);
      }
      targetElement.focus({ preventScroll: true });
      targetElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    applyKeyboardSelection(orderedPaths, currentPath, targetPath, extendRange) {
      if (extendRange) {
        const anchorPath = orderedPaths.includes(this.state.selectionAnchorPath)
          ? this.state.selectionAnchorPath
          : (orderedPaths.includes(currentPath) ? currentPath : targetPath);
        this.state.selectedPaths = new Set(rangePaths(orderedPaths, anchorPath, targetPath));
        this.state.selectionAnchorPath = anchorPath;
      } else {
        this.state.selectedPaths = new Set([targetPath]);
        this.state.selectionAnchorPath = targetPath;
      }
      this.state.fileKeyboardFocusPath = targetPath;
    }

    finishKeyboardSelection(targetPath) {
      this.syncFileSelectionUI();
      this.app.updateFileActionBar();
      this.app.updateStatusBar();
      const selectedItems = this.app.getSelectedFileItems();
      if (selectedItems.length === 1 && selectedItems[0].isGitRepo) this.app.selectRepo(targetPath);
      else this.app.showFileSelectionDetail(selectedItems);
    }

    handleFileSelectionClick(event, element) {
      const itemPath = element.dataset.path;
      const orderedElements = [...element.parentElement.parentElement.querySelectorAll('.repo-card, .repo-list-item')];
      const renderedPaths = orderedElements.map(item => item.dataset.path);
      const orderedPaths = this.progressiveRenderer.resolveDisplayOrder(
        this.state.visibleItems.map(item => item.path),
        this.state.fileDisplayOrder,
        renderedPaths,
        itemPath
      );
      const toggle = event.metaKey || event.ctrlKey;

      if (event.shiftKey && this.state.selectionAnchorPath && orderedPaths.includes(this.state.selectionAnchorPath)) {
        const selectedRange = rangePaths(orderedPaths, this.state.selectionAnchorPath, itemPath);
        if (!toggle) this.state.selectedPaths.clear();
        selectedRange.forEach(pathValue => this.state.selectedPaths.add(pathValue));
      } else if (toggle) {
        if (this.state.selectedPaths.has(itemPath)) this.state.selectedPaths.delete(itemPath);
        else this.state.selectedPaths.add(itemPath);
        this.state.selectionAnchorPath = itemPath;
      } else {
        this.state.selectedPaths = new Set([itemPath]);
        this.state.selectionAnchorPath = itemPath;
      }

      this.syncFileSelectionUI();
      this.app.updateFileActionBar();
      this.app.updateStatusBar();
    }

    syncFileSelectionUI() {
      this.reconcileFileKeyboardFocus();
      this.document.querySelectorAll('#content-area .repo-card, #content-area .repo-list-item')
        .forEach(element => this.syncFileItemElement(element));
    }

    syncFileItemElement(element) {
      const selected = this.app.isFileBrowsingContext() && this.state.selectedPaths.has(element.dataset.path);
      element.classList.toggle('selected', selected);
      element.setAttribute('aria-selected', selected ? 'true' : 'false');
      element.tabIndex = element.dataset.path === this.state.fileKeyboardFocusPath ? 0 : -1;
    }

    clearFileSelection() {
      this.state.selectedPaths.clear();
      this.state.selectionAnchorPath = null;
      this.syncFileSelectionUI();
      this.app.updateFileActionBar();
      if (this.app.isFileBrowsingContext()) this.app.showFileSelectionDetail([]);
    }

    selectAllVisibleFiles() {
      this.state.selectedPaths = new Set(this.state.visibleItems.map(item => item.path));
      this.state.selectionAnchorPath = this.state.visibleItems[0]?.path || null;
      this.reconcileFileKeyboardFocus();
      this.syncFileSelectionUI();
      this.app.updateFileActionBar();
      this.app.showFileSelectionDetail(this.app.getSelectedFileItems());
      this.app.updateStatusBar();
    }

    ensureFileItemVisible(itemPath) {
      if (!itemPath || !['list', 'card'].includes(this.state.cardStyle) || !this.app.directoryVirtualizer) return false;
      const index = this.state.fileDisplayOrder.indexOf(itemPath);
      if (index < 0) return false;
      this.app.directoryVirtualizer.ensureIndex(index);
      return true;
    }
  }

  return { Controller, rangePaths, resolveFocusPath };
});
