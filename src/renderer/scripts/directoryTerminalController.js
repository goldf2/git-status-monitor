(function exposeDirectoryTerminalController(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryTerminalController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryTerminalControllerApi() {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge;
    }

    targetPath() {
      const items = this.app.getSelectedFileItems();
      if (items.length === 1) return items[0]?.path || '';
      if (items.length > 1) return '';
      if (!this.app.isDirectoryBrowsingContext() || this.app.isGlobalSearchActive()) return '';
      return String(this.state.currentPath || '');
    }

    async open() {
      const targetPath = this.targetPath();
      if (!targetPath) {
        this.app._showStatusMessage('请选择一个文件或文件夹，或进入要打开终端的目录', 'warning');
        return false;
      }

      this.app.closeToolbarMenus();
      try {
        const preferred = await this.bridge.config.get('preferredTerminal');
        const result = await this.bridge.terminal.openForPath(targetPath, preferred);
        if (result?.opened) {
          this.app._showStatusMessage(`已使用 ${result.tool?.name || '终端'} 打开`, 'success');
          return true;
        }
        if (result?.reason === 'terminal-not-found') {
          this.app._showStatusMessage('未找到可用终端，请先在设置中选择程序', 'error');
          await this.app.openDeveloperToolSettings();
          return false;
        }
        this.app._showStatusMessage(result?.reason || '无法在该位置打开终端', 'error');
        return false;
      } catch (error) {
        this.app._showStatusMessage(`打开终端失败：${error?.message || error}`, 'error');
        return false;
      }
    }
  }

  return { Controller };
});
