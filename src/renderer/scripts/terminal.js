/**
 * 内嵌终端模块
 * - 点击 Git 操作按钮预填命令,用户按 Enter 执行
 * - 支持命令历史(上/下方向键)
 * - 执行后自动刷新仓库状态(若为 git 命令)
 */
const Terminal = {
  cwd: '',
  history: [],
  historyIndex: -1,
  isRunning: false,

  /**
   * 初始化终端事件监听
   */
  init() {
    const input = document.getElementById('terminal-input');
    const clearBtn = document.getElementById('terminal-clear-btn');
    const externalBtn = document.getElementById('terminal-external-btn');

    if (!input) return;

    input.addEventListener('keydown', (e) => this._handleKeydown(e));

    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }
    if (externalBtn) {
      externalBtn.addEventListener('click', () => this.openExternal());
    }
  },

  /**
   * 设置终端工作目录(选中仓库时调用)
   */
  setCwd(cwd) {
    this.cwd = cwd || '';
    const cwdEl = document.getElementById('terminal-cwd');
    if (cwdEl && this.cwd) {
      // 显示简短路径(末 2 段)
      const parts = this.cwd.replace(/\\/g, '/').split('/').filter(Boolean);
      const short = parts.length > 2 ? '.../' + parts.slice(-2).join('/') : parts.join('/');
      cwdEl.textContent = `(${short})`;
      cwdEl.title = this.cwd;
    } else if (cwdEl) {
      cwdEl.textContent = '';
    }
  },

  /**
   * 预填命令到输入框(不执行),并聚焦
   */
  fillCommand(command) {
    const input = document.getElementById('terminal-input');
    if (!input) {
      console.error('[Terminal] terminal-input 元素未找到');
      return;
    }
    // 确保详情面板可见
    const detailContent = document.getElementById('detail-content');
    const detailEmpty = document.getElementById('detail-empty');
    if (detailContent) detailContent.style.display = 'flex';
    if (detailEmpty) detailEmpty.style.display = 'none';

    // 展开终端 section(若已折叠)
    const section = document.querySelector('.detail-section[data-section-id="terminal"]');
    if (section && section.classList.contains('collapsed')) {
      section.classList.remove('collapsed');
    }
    // 滚动终端区域到可见范围
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    input.value = command;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  },

  /**
   * 处理键盘输入
   */
  _handleKeydown(e) {
    if (this.isRunning) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      this._executeCommand(e.target.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._navigateHistory(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._navigateHistory(1);
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.clear();
    }
  },

  /**
   * 浏览命令历史
   */
  _navigateHistory(direction) {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + direction));
    const input = document.getElementById('terminal-input');
    if (this.historyIndex === -1) {
      input.value = '';
    } else {
      input.value = this.history[this.history.length - 1 - this.historyIndex];
    }
  },

  /**
   * 执行命令
   */
  async _executeCommand(command) {
    command = command.trim();
    if (!command) return;
    if (!this.cwd) {
      this._appendOutput('错误: 未指定工作目录,请先选择一个仓库', 'stderr');
      return;
    }

    // 记录历史
    this.history.push(command);
    if (this.history.length > 50) this.history.shift();
    this.historyIndex = -1;

    // 显示命令行
    this._appendOutput(`$ ${command}`, 'cmd-line');

    // 清空输入框
    const input = document.getElementById('terminal-input');
    input.value = '';
    input.disabled = true;
    this.isRunning = true;

    try {
      const result = await window.gitFinder.terminal.execute(command, this.cwd);

      // 显示输出
      if (result.stdout) {
        this._appendOutput(result.stdout, 'stdout');
      }
      if (result.stderr) {
        this._appendOutput(result.stderr, 'stderr');
      }
      // 显示退出码
      if (result.exitCode === 0) {
        this._appendOutput(`[退出码: 0]`, 'exit-ok');
      } else {
        this._appendOutput(`[退出码: ${result.exitCode}]`, 'exit-err');
      }

      // 若为 git 命令,刷新仓库状态
      if (this._isGitCommand(command)) {
        await this._refreshRepo();
      }
    } catch (e) {
      this._appendOutput(`执行异常: ${e.message}`, 'stderr');
    } finally {
      input.disabled = false;
      input.focus();
      this.isRunning = false;
    }
  },

  /**
   * 判断是否为 git 命令
   */
  _isGitCommand(command) {
    return /^\s*git\s+/i.test(command);
  },

  /**
   * 刷新仓库状态(执行 git 命令后调用)
   */
  async _refreshRepo() {
    try {
      // 刷新详情面板
      if (typeof App !== 'undefined' && App.selectRepo && AppState.selectedRepo) {
        await App.selectRepo(AppState.selectedRepo.path);
      }
      // 刷新内容区
      if (typeof App !== 'undefined' && App.renderContent) {
        await App.renderContent();
      }
    } catch (e) {
      // 静默失败,不影响终端使用
    }
  },

  /**
   * 追加输出到终端
   */
  _appendOutput(text, className) {
    const output = document.getElementById('terminal-output');
    if (!output) return;

    const line = document.createElement('div');
    line.className = className || 'stdout';
    line.textContent = text;
    output.appendChild(line);

    // 自动滚动到底部
    output.scrollTop = output.scrollHeight;
  },

  /**
   * 清空终端输出
   */
  clear() {
    const output = document.getElementById('terminal-output');
    if (output) output.innerHTML = '';
  },

  /**
   * 在外部终端打开
   */
  async openExternal() {
    if (!this.cwd) {
      this._appendOutput('错误: 未指定工作目录', 'stderr');
      return;
    }
    try {
      const preferred = await window.gitFinder.config.get('preferredTerminal');
      const result = await window.gitFinder.terminal.openExternal(this.cwd, preferred);
      if (!result?.opened) this._appendOutput('未找到可用终端，请在设置中选择程序', 'stderr');
    } catch (e) {
      this._appendOutput(`打开外部终端失败: ${e.message}`, 'stderr');
    }
  }
};
