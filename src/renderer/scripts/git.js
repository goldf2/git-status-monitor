/**
 * Git 操作模块
 * - 所有 Git 操作通过内嵌终端执行(预填命令 + 用户确认)
 * - 点击按钮 → 终端预填命令 → 用户按 Enter 执行 → 自动刷新
 */
const GitOps = {
  /**
   * 拉取:预填 git pull 命令到终端
   */
  pull(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git pull');
    } catch (e) {
      console.error('[GitOps.pull]', e);
    }
  },

  /**
   * 推送:预填 git push 命令到终端
   */
  push(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git push');
    } catch (e) {
      console.error('[GitOps.push]', e);
    }
  },

  /**
   * Fetch:预填 git fetch 命令到终端
   */
  fetch(repoPath) {
    try {
      if (typeof Terminal === 'undefined') {
        console.error('[GitOps] Terminal 未定义');
        return;
      }
      Terminal.setCwd(repoPath);
      Terminal.fillCommand('git fetch');
    } catch (e) {
      console.error('[GitOps.fetch]', e);
    }
  },

  /**
   * 打开提交弹窗
   */
  openCommitModal(repoPath) {
    this._currentCommitRepo = repoPath;
    document.getElementById('commit-modal').style.display = 'flex';
    document.getElementById('commit-message').value = '';
    document.getElementById('commit-message').focus();
    this._loadCommitFiles(repoPath);
  },

  /**
   * 加载提交文件列表
   */
  async _loadCommitFiles(repoPath) {
    const container = document.getElementById('commit-files');
    container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-tertiary);"><div class="loading-spinner" style="margin:0 auto 8px;"></div>加载中...</div>';

    try {
      const diff = await window.gitFinder.git.getDiff(repoPath);
      const stagedDiff = await window.gitFinder.git.getStagedDiff(repoPath);

      let html = '';

      if (stagedDiff.files && stagedDiff.files.length > 0) {
        html += '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;margin-top:8px;">已暂存</div>';
        html += stagedDiff.files.map(f => `
          <div class="commit-file-item">
            <span class="commit-file-status M">M</span>
            <span>${f.file}</span>
          </div>
        `).join('');
      }

      if (diff.files && diff.files.length > 0) {
        html += '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;margin-top:8px;">未暂存</div>';
        html += diff.files.map(f => `
          <div class="commit-file-item">
            <span class="commit-file-status M">M</span>
            <span>${f.file}</span>
          </div>
        `).join('');
      }

      if (!html) {
        html = '<div style="text-align:center;padding:10px;color:var(--text-tertiary);">没有可提交的变更</div>';
      }

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:10px;color:#FF3B30;">加载失败: ${e.message}</div>`;
    }
  },

  /**
   * 确认提交:预填 git add . && git commit -m "..." 命令到终端
   */
  confirmCommit() {
    const repoPath = this._currentCommitRepo;
    const message = document.getElementById('commit-message').value.trim();

    if (!message) {
      alert('请输入提交信息');
      return;
    }

    // 关闭弹窗
    document.getElementById('commit-modal').style.display = 'none';

    // 预填命令到终端:使用 git add . (符合项目约束,不使用 git add -A)
    // 转义双引号
    const escapedMsg = message.replace(/"/g, '\\"');
    Terminal.setCwd(repoPath);
    Terminal.fillCommand(`git add . && git commit -m "${escapedMsg}"`);
  },

  _currentCommitRepo: null
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-commit-btn')?.addEventListener('click', () => {
    GitOps.confirmCommit();
  });
});
