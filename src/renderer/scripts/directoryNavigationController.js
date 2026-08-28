(function exposeDirectoryNavigationController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryNavigationController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryNavigationControllerApi(root) {
  function isWindowsPath(pathValue, platform = '') {
    const value = String(pathValue || '');
    return platform === 'win32' || /^[A-Za-z]:[\\/]/.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(value);
  }

  function windowsSeparator(pathValue) {
    return String(pathValue || '').includes('\\') ? '\\' : '/';
  }

  function getParentPath(pathValue, platform = '') {
    const value = String(pathValue || '');
    if (!value) return null;
    if (isWindowsPath(value, platform)) {
      const separator = windowsSeparator(value);
      const normalized = value.replace(/[\\/]+/g, separator);
      const driveMatch = normalized.match(/^([A-Za-z]:)(?:[\\/](.*))?$/);
      if (driveMatch) {
        const rest = String(driveMatch[2] || '').split(/[\\/]/).filter(Boolean);
        if (!rest.length) return null;
        rest.pop();
        return rest.length ? `${driveMatch[1]}${separator}${rest.join(separator)}` : `${driveMatch[1]}${separator}`;
      }
      if (/^[\\/]{2}/.test(value)) {
        const parts = value.replace(/^[\\/]+/, '').split(/[\\/]/).filter(Boolean);
        if (parts.length <= 2) return null;
        parts.pop();
        return `${separator}${separator}${parts.join(separator)}`;
      }
      return null;
    }

    const normalized = value.replace(/\/+$/, '') || '/';
    if (normalized === '/' || !normalized.startsWith('/')) return null;
    const lastSeparator = normalized.lastIndexOf('/');
    return lastSeparator <= 0 ? '/' : normalized.slice(0, lastSeparator);
  }

  function breadcrumbParts(pathValue, platform = '') {
    const value = String(pathValue || '');
    if (!value) return [];
    if (isWindowsPath(value, platform)) {
      const separator = windowsSeparator(value);
      const driveMatch = value.match(/^([A-Za-z]:)[\\/]?(.*)$/);
      if (driveMatch) {
        const result = [{ name: driveMatch[1], absPath: `${driveMatch[1]}${separator}` }];
        const parts = String(driveMatch[2] || '').split(/[\\/]/).filter(Boolean);
        parts.forEach((name, index) => {
          result.push({
            name,
            absPath: `${driveMatch[1]}${separator}${parts.slice(0, index + 1).join(separator)}`
          });
        });
        return result;
      }
      if (/^[\\/]{2}/.test(value)) {
        const parts = value.replace(/^[\\/]+/, '').split(/[\\/]/).filter(Boolean);
        if (parts.length < 2) return [];
        const rootName = `${parts[0]}${separator}${parts[1]}`;
        const rootPath = `${separator}${separator}${rootName}`;
        const result = [{ name: rootName, absPath: rootPath }];
        parts.slice(2).forEach((name, index) => {
          result.push({
            name,
            absPath: `${rootPath}${separator}${parts.slice(2, index + 3).join(separator)}`
          });
        });
        return result;
      }
      return [];
    }

    if (value === '/') return [{ name: '/', absPath: '/' }];
    if (!value.startsWith('/')) return [];
    const parts = value.split('/').filter(Boolean);
    return parts.map((name, index) => ({
      name,
      absPath: `/${parts.slice(0, index + 1).join('/')}`
    }));
  }

  function locationName(pathValue, platform = '') {
    const parts = breadcrumbParts(pathValue, platform);
    return parts.at(-1)?.name || '/';
  }

  function pathsEqual(left, right, platform = '') {
    const normalize = value => {
      const original = String(value || '');
      let result = original.replace(/[\\/]+$/, '');
      if (!result && original) result = original[0];
      if (platform === 'win32') result = result.replace(/\//g, '\\').toLowerCase();
      return result;
    };
    return normalize(left) === normalize(right);
  }

  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.workspaceTabs = options.workspaceTabs || root?.WorkspaceTabs || null;
      this.contentQuery = options.contentQuery || root?.ContentQuery || null;
      this.document = options.document || root?.document || null;
      this.platform = options.platform || this.bridge?.platform || '';
      this.isManagedPath = options.isManagedPath
        || (pathValue => this.app?.isManagedPath?.(pathValue) === true);
    }

    navigateTo(pathValue, replace = false) {
      const path = String(pathValue || '');
      if (!path) {
        this.app.showEmptyState();
        return false;
      }
      if (!this._isManagedPath(path)) {
        this.app._showStatusMessage?.('无法前往：路径不在受管开发目录中', 'warning');
        return false;
      }

      const samePath = pathsEqual(path, this.state.currentPath, this.platform);
      if (replace) {
        if (this.state.historyIndex >= 0 && this.state.history.length) {
          this.state.history[this.state.historyIndex] = path;
        } else {
          this.state.history = [path];
          this.state.historyIndex = 0;
        }
      } else if (!samePath) {
        this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        this.state.history.push(path);
        if (this.state.history.length > this.workspaceTabs.MAX_HISTORY) this.state.history.shift();
        this.state.historyIndex = this.state.history.length - 1;
      }

      this.applyPath(path);
      return true;
    }

    goBack() {
      if (this._navigationBlocked()) return false;
      const targetIndex = this._historyTargetIndex(-1);
      if (targetIndex < 0) return false;
      this.state.historyIndex = targetIndex;
      this.applyPath(this.state.history[this.state.historyIndex]);
      return true;
    }

    goForward() {
      if (this._navigationBlocked()) return false;
      const targetIndex = this._historyTargetIndex(1);
      if (targetIndex < 0) return false;
      this.state.historyIndex = targetIndex;
      this.applyPath(this.state.history[this.state.historyIndex]);
      return true;
    }

    goUp() {
      if (this._navigationBlocked()) return false;
      const parent = this._managedParentPath(this.state.currentPath);
      return parent ? this.navigateTo(parent) : false;
    }

    getParentPath(pathValue) {
      return getParentPath(pathValue, this.platform);
    }

    applyPath(path) {
      this.app.closeQuickLook();
      this.app.clearFileSelection();
      if (this.contentQuery?.isCollection(this.state.contentQuery)) {
        this.state.contentQuery = this.contentQuery.queryForPreset('current-all');
        this.state.searchScope = 'current';
      }
      this.state.currentPath = path;
      this.app.applyDirectoryViewPreference(path, 'tree');
      this.app.captureActiveWorkspaceTab();
      this.app.renderWorkspaceTabs();
      this.app.scheduleWorkspaceTabsPersist();
      this.bridge.config.set('lastPath', path).catch(() => {});
      this.updateBreadcrumbs();
      this.app.renderContent();
      this.updateNavButtons();
      this.app._syncTreeToCurrentPath();
      this.app.recordProjectVisit?.(path);
    }

    updateBreadcrumbs() {
      const container = this.document.getElementById('current-path');
      if (!container) return;
      if (this.state.currentMode === 'settings') {
        container.textContent = '应用设置';
        return;
      }
      if (this.state.currentMode === 'tasks') {
        container.textContent = '';
        return;
      }
      if (this.state.currentMode === 'relationships') {
        container.textContent = '关系白板';
        return;
      }
      const collectionKind = this.state.currentMode === 'tree'
        ? this.contentQuery?.collectionKind(this.state.contentQuery)
        : '';
      if (collectionKind === 'projects') {
        container.textContent = '所有受管位置 · 项目';
        return;
      }
      if (collectionKind === 'repositories') {
        container.textContent = '所有受管位置 · Git 仓库';
        return;
      }
      if (collectionKind === 'project-repositories') {
        container.textContent = '所有受管位置 · 项目 + Git 仓库';
        return;
      }
      if (collectionKind === 'file-labels') {
        const selectedIds = new Set(this.contentQuery?.normalize(this.state.contentQuery)?.fileLabelIds || []);
        const names = (this.state.fileLabels?.labels || [])
          .filter(label => selectedIds.has(label.id))
          .map(label => label.name);
        container.textContent = `所有受管位置 · 文件标签${names.length ? ` · ${names.join(' + ')}` : ''}`;
        return;
      }
      if (this.state.currentMode !== 'tree' || !this.state.currentPath) {
        container.textContent = '';
        return;
      }

      let parts = breadcrumbParts(this.state.currentPath, this.platform);
      if (!parts.length) {
        container.textContent = '';
        return;
      }
      if (parts.length === 1 && parts[0].name === '/') {
        container.innerHTML = '<span class="crumb-item crumb-current">/</span>';
        return;
      }
      if (parts.length > 4) {
        parts = [parts[0], { name: '…', absPath: null, ellipsis: true }, ...parts.slice(-2)];
      }
      const html = parts.map((part, index) => {
        const separator = index > 0 ? '<span class="crumb-sep">›</span>' : '';
        if (part.ellipsis) return `${separator}<span class="crumb-ellipsis">…</span>`;
        const name = this.app.escapeHtml(part.name);
        const path = this.app.escapeHtml(part.absPath);
        const isLast = index === parts.length - 1;
        if (isLast) {
          return `${separator}<span class="crumb-item crumb-current" title="${path}">${name}</span>`;
        }
        return this._isManagedPath(part.absPath)
          ? `${separator}<a class="crumb-item crumb-link" data-path="${path}" title="${path}">${name}</a>`
          : `${separator}<span class="crumb-item crumb-context" title="${path}" aria-disabled="true">${name}</span>`;
      }).join('');
      container.innerHTML = html;
      container.querySelectorAll('.crumb-link').forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          const targetPath = link.dataset.path;
          if (targetPath && !pathsEqual(targetPath, this.state.currentPath, this.platform)) this.navigateTo(targetPath);
        });
      });
    }

    updateNavButtons() {
      const blockedMode = this._navigationBlocked()
        || this.contentQuery?.isCollection(this.state.contentQuery) === true;
      const back = this.document.getElementById('btn-back');
      const forward = this.document.getElementById('btn-forward');
      const up = this.document.getElementById('btn-up');
      if (!back || !forward || !up) return;
      const previousIndex = this._historyTargetIndex(-1);
      const nextIndex = this._historyTargetIndex(1);
      back.disabled = blockedMode || previousIndex < 0;
      forward.disabled = blockedMode || nextIndex < 0;
      const rawParentPath = this.getParentPath(this.state.currentPath);
      const parentPath = this._managedParentPath(this.state.currentPath);
      up.disabled = blockedMode || !parentPath;
      const previousPath = previousIndex >= 0 ? this.state.history[previousIndex] : '';
      const nextPath = nextIndex >= 0 ? this.state.history[nextIndex] : '';
      back.title = previousPath ? `后退到 ${locationName(previousPath, this.platform)} (⌘[)` : '没有上一位置 (⌘[)';
      forward.title = nextPath ? `前进到 ${locationName(nextPath, this.platform)} (⌘])` : '没有下一位置 (⌘])';
      up.title = parentPath
        ? `前往 ${locationName(parentPath, this.platform)} (⌘↑)`
        : (rawParentPath ? '已到达受管根目录 (⌘↑)' : '没有上级目录 (⌘↑)');
    }

    _isManagedPath(pathValue) {
      try {
        return this.isManagedPath(pathValue) === true;
      } catch (_error) {
        return false;
      }
    }

    _managedParentPath(pathValue) {
      const parentPath = this.getParentPath(pathValue);
      return parentPath && this._isManagedPath(parentPath) ? parentPath : null;
    }

    _historyTargetIndex(direction) {
      const step = direction < 0 ? -1 : 1;
      for (
        let index = this.state.historyIndex + step;
        index >= 0 && index < this.state.history.length;
        index += step
      ) {
        if (this._isManagedPath(this.state.history[index])) return index;
      }
      return -1;
    }

    _navigationBlocked() {
      return ['tasks', 'settings', 'relationships'].includes(this.state.currentMode);
    }
  }

  return {
    Controller,
    breadcrumbParts,
    getParentPath,
    isWindowsPath,
    locationName,
    pathsEqual
  };
});
