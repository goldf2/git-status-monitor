const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

class DeveloperToolService {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.environment = options.environment || process.env;
  }

  _commandPath(command) {
    try {
      const locator = this.platform === 'win32' ? 'where.exe' : 'which';
      return execFileSync(locator, [command], { encoding: 'utf8', timeout: 3000 })
        .split(/\r?\n/)
        .map(value => value.trim())
        .find(Boolean) || null;
    } catch (_) {
      return null;
    }
  }

  _existingFile(candidatePath) {
    if (!candidatePath) return null;
    try {
      return fs.statSync(candidatePath).isFile() ? path.resolve(candidatePath) : null;
    } catch (_) {
      return null;
    }
  }

  _addTool(tools, seen, id, name, candidatePath, kind) {
    const resolved = this._existingFile(candidatePath) || this._commandPath(candidatePath);
    if (!resolved) return;
    const key = this.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    tools.push({ id, name, path: resolved, kind, installed: true });
  }

  discover() {
    const terminals = [];
    const editors = [];
    const terminalPaths = new Set();
    const editorPaths = new Set();
    if (this.platform === 'win32') {
      this._addTool(terminals, terminalPaths, 'windows-terminal', 'Windows Terminal', 'wt.exe', 'terminal');
      this._addTool(terminals, terminalPaths, 'powershell-7', 'PowerShell 7', 'pwsh.exe', 'terminal');
      this._addTool(terminals, terminalPaths, 'windows-powershell', 'Windows PowerShell', 'powershell.exe', 'terminal');
      this._addTool(terminals, terminalPaths, 'command-prompt', '命令提示符', 'cmd.exe', 'terminal');

      this._addTool(editors, editorPaths, 'vscode-path', 'Visual Studio Code', 'code.exe', 'editor');
      this._addTool(editors, editorPaths, 'vscode-exe', 'Visual Studio Code', path.join(this.environment.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'), 'editor');
      this._addTool(editors, editorPaths, 'vscode-system', 'Visual Studio Code', path.join(this.environment.ProgramFiles || '', 'Microsoft VS Code', 'Code.exe'), 'editor');
      this._addTool(editors, editorPaths, 'pycharm-path', 'PyCharm', 'pycharm64.exe', 'editor');
      this._addTool(editors, editorPaths, 'pycharm-command', 'PyCharm', 'pycharm.exe', 'editor');
    } else if (this.platform === 'darwin') {
      terminals.push({ id: 'terminal-app', name: 'Terminal', path: '/usr/bin/open', kind: 'terminal', installed: true });
      this._addTool(editors, editorPaths, 'vscode-path', 'Visual Studio Code', 'code', 'editor');
      this._addTool(editors, editorPaths, 'pycharm-path', 'PyCharm', 'pycharm', 'editor');
    } else {
      this._addTool(terminals, terminalPaths, 'system-terminal', '系统终端', 'x-terminal-emulator', 'terminal');
      this._addTool(editors, editorPaths, 'vscode-path', 'Visual Studio Code', 'code', 'editor');
      this._addTool(editors, editorPaths, 'pycharm-path', 'PyCharm', 'pycharm', 'editor');
    }
    const gitPath = this._commandPath(this.platform === 'win32' ? 'git.exe' : 'git');
    return {
      platform: this.platform,
      terminals,
      editors,
      git: { installed: Boolean(gitPath), path: gitPath },
      needsTerminalSetting: terminals.length === 0,
      needsEditorSetting: editors.length === 0,
      needsGitSetting: !gitPath
    };
  }

  _resolveTool(preferred, tools) {
    const requested = String(preferred || '').trim();
    if (requested) {
      const discovered = tools.find(tool => tool.id === requested || tool.path === requested);
      if (discovered) return discovered;
      const customPath = this._existingFile(requested);
      if (customPath) return { id: 'custom', name: path.basename(customPath), path: customPath, installed: true };
    }
    return tools[0] || null;
  }

  _spawn(executable, args, cwd) {
    const child = spawn(executable, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  }

  openTerminal(workingDirectory, preferred) {
    const cwd = path.resolve(String(workingDirectory || ''));
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('终端工作目录不可用');
    const tool = this._resolveTool(preferred, this.discover().terminals);
    if (!tool) return { opened: false, reason: 'terminal-not-found' };
    if (this.platform === 'darwin' && tool.id === 'terminal-app') {
      this._spawn(tool.path, ['-a', 'Terminal', cwd], cwd);
    } else if (this.platform === 'win32' && tool.id === 'windows-terminal') {
      this._spawn(tool.path, ['-d', cwd], cwd);
    } else if (this.platform === 'win32' && tool.id.includes('powershell')) {
      this._spawn(tool.path, ['-NoExit'], cwd);
    } else if (this.platform === 'win32' && tool.id === 'command-prompt') {
      this._spawn(tool.path, ['/K'], cwd);
    } else {
      this._spawn(tool.path, [], cwd);
    }
    return { opened: true, tool: { id: tool.id, name: tool.name, path: tool.path } };
  }

  openEditor(targetPath, preferred) {
    const target = path.resolve(String(targetPath || ''));
    if (!fs.existsSync(target)) throw new Error('待打开路径不存在');
    const tool = this._resolveTool(preferred, this.discover().editors);
    if (!tool) return { opened: false, reason: 'editor-not-found' };
    this._spawn(tool.path, [target], fs.statSync(target).isDirectory() ? target : path.dirname(target));
    return { opened: true, tool: { id: tool.id, name: tool.name, path: tool.path } };
  }
}

module.exports = new DeveloperToolService();
module.exports.DeveloperToolService = DeveloperToolService;
