const GitOps = {
  async pull(repoPath) {
    const status = this._getStatus();
    status.text = `正在拉取 ${repoPath}...`;
    status.show();

    try {
      const result = await window.gitFinder.git.pull(repoPath);
      if (result.success) {
        status.success('拉取成功');
      } else {
        status.error('拉取失败: ' + (result.error || '未知错误'));
      }
    } catch (e) {
      status.error('拉取失败: ' + e.message);
    }

    await this._refreshRepo(repoPath);
  },

  async push(repoPath) {
    const status = this._getStatus();
    status.text = `正在推送 ${repoPath}...`;
    status.show();

    try {
      const result = await window.gitFinder.git.push(repoPath);
      if (result.success) {
        status.success('推送成功');
      } else {
        status.error('推送失败: ' + (result.error || '未知错误'));
      }
    } catch (e) {
      status.error('推送失败: ' + e.message);
    }

    await this._refreshRepo(repoPath);
  },

  async fetch(repoPath) {
    const status = this._getStatus();
    status.text = `正在获取远程信息...`;
    status.show();

    try {
      const result = await window.gitFinder.git.fetch(repoPath);
      if (result.success) {
        status.success('Fetch 成功');
      } else {
        status.error('Fetch 失败: ' + (result.error || '未知错误'));
      }
    } catch (e) {
      status.error('Fetch 失败: ' + e.message);
    }

    await this._refreshRepo(repoPath);
  },

  openCommitModal(repoPath) {
    this._currentCommitRepo = repoPath;
    document.getElementById('commit-modal').style.display = 'flex';
    document.getElementById('commit-message').value = '';
    document.getElementById('commit-message').focus();
    this._loadCommitFiles(repoPath);
  },

  async _loadCommitFiles(repoPath) {
    const container = document.getElementById('commit-files');
    container.innerHTML = '<div style="text-align:center;padding:10px;color:#86868b;"><div class="loading-spinner" style="margin:0 auto 8px;"></div>加载中...</div>';

    try {
      const diff = await window.gitFinder.git.getDiff(repoPath);
      const stagedDiff = await window.gitFinder.git.getStagedDiff(repoPath);

      let html = '';

      if (stagedDiff.files && stagedDiff.files.length > 0) {
        html += '<div style="font-size:11px;color:#86868b;margin-bottom:4px;margin-top:8px;">已暂存</div>';
        html += stagedDiff.files.map(f => `
          <div class="commit-file-item">
            <span class="commit-file-status M">M</span>
            <span>${f.file}</span>
          </div>
        `).join('');
      }

      if (diff.files && diff.files.length > 0) {
        html += '<div style="font-size:11px;color:#86868b;margin-bottom:4px;margin-top:8px;">未暂存</div>';
        html += diff.files.map(f => `
          <div class="commit-file-item">
            <span class="commit-file-status M">M</span>
            <span>${f.file}</span>
          </div>
        `).join('');
      }

      const untracked = await this._getUntrackedFiles(repoPath);
      if (untracked.length > 0) {
        html += '<div style="font-size:11px;color:#86868b;margin-bottom:4px;margin-top:8px;">未跟踪</div>';
        html += untracked.map(f => `
          <div class="commit-file-item">
            <span class="commit-file-status ?">?</span>
            <span>${f}</span>
          </div>
        `).join('');
      }

      if (!html) {
        html = '<div style="text-align:center;padding:10px;color:#86868b;">没有可提交的变更</div>';
      }

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:10px;color:#FF3B30;">加载失败: ${e.message}</div>`;
    }
  },

  async _getUntrackedFiles(repoPath) {
    try {
      const status = await window.gitFinder.git.getStatus(repoPath);
      return [];
    } catch (e) {
      return [];
    }
  },

  async confirmCommit() {
    const repoPath = this._currentCommitRepo;
    const message = document.getElementById('commit-message').value.trim();

    if (!message) {
      alert('请输入提交信息');
      return;
    }

    const status = this._getStatus();
    status.text = '正在提交...';
    status.show();

    try {
      const result = await window.gitFinder.git.commit(repoPath, message);
      if (result.success) {
        status.success('提交成功');
        document.getElementById('commit-modal').style.display = 'none';
      } else {
        status.error('提交失败: ' + (result.error || '未知错误'));
      }
    } catch (e) {
      status.error('提交失败: ' + e.message);
    }

    await this._refreshRepo(repoPath);
  },

  async _refreshRepo(repoPath) {
    await window.gitFinder.git.clearCache();

    if (AppState.selectedRepo && AppState.selectedRepo.path === repoPath) {
      await App.selectRepo(repoPath);
    }

    App.renderContent();
  },

  _getStatus() {
    const el = document.getElementById('status-center');
    return {
      text: '',
      show() {
        el.textContent = this.text;
      },
      success(msg) {
        el.textContent = msg;
        el.style.color = '#34C759';
        setTimeout(() => {
          el.textContent = '';
          el.style.color = '';
        }, 3000);
      },
      error(msg) {
        el.textContent = msg;
        el.style.color = '#FF3B30';
        setTimeout(() => {
          el.textContent = '';
          el.style.color = '';
        }, 5000);
      }
    };
  },

  _currentCommitRepo: null
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-commit-btn')?.addEventListener('click', () => {
    GitOps.confirmCommit();
  });
});
