(function exposeFileTransferController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileTransferController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileTransferControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.presentation = options.presentation || root?.FileTransfers || null;
      this.contentQuery = options.contentQuery || root?.ContentQuery || null;
      this.document = options.document || root?.document || null;
      this.scheduleInterval = options.setInterval || root?.setInterval?.bind(root) || setInterval;
      this.clearScheduledInterval = options.clearInterval || root?.clearInterval?.bind(root) || clearInterval;
      this.requestFrame = options.requestAnimationFrame || root?.requestAnimationFrame?.bind(root) || (callback => callback());
    }

    transferProgressHtml(preview, status) {
      const presentation = this.presentation.progressPresentation(status, preview);
      const bytesTotal = Number(status?.bytesTotal ?? preview?.requiredBytes ?? 0);
      const bytesTransferred = Number(status?.bytesTransferred || 0);
      const amount = bytesTotal > 0
        ? `${this.app.formatFileSize(bytesTransferred)} / ${this.app.formatFileSize(bytesTotal)}`
        : `${presentation.progress}%`;
      return `
        <div class="transfer-progress-panel" data-tone="${presentation.tone}">
          <div class="transfer-progress-heading">
            <strong>${this.app.escapeHtml(presentation.title)}</strong>
            <span>${this.app.escapeHtml(amount)}</span>
          </div>
          <div class="transfer-progress-track ${presentation.indeterminate ? 'indeterminate' : ''}" role="progressbar" aria-label="文件传输进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${presentation.progress}">
            <span style="width:${presentation.progress}%"></span>
          </div>
          <div class="transfer-progress-detail" title="${this.app.escapeHtml(presentation.detail)}">${this.app.escapeHtml(presentation.detail)}</div>
        </div>
      `;
    }

    transferPlanHtml(preview, { includeProgress = false, status = null } = {}) {
      const method = preview.crossVolumeCount > 0
        ? `${preview.crossVolumeCount} 项跨卷`
        : (preview.mode === 'move' ? '同卷原子移动' : '安全复制');
      const fourthValue = preview.operationType === 'import' ? String(preview.conflictCount || 0) : method;
      const fourthLabel = preview.operationType === 'import' ? '同名改名' : '执行方式';
      const available = preview.availableBytes == null ? '不需要' : this.app.formatFileSize(preview.availableBytes);
      const itemRows = preview.items.map(item => {
        const conflictLabel = this.presentation.conflictActionLabel(item.conflictAction);
        return `
        <li class="external-import-item">
          <span class="external-import-item-icon" aria-hidden="true">${item.type === 'directory' ? '📁' : (item.type === 'symlink' ? '🔗' : '📄')}</span>
          <span class="external-import-item-text">
            <strong>${this.app.escapeHtml(item.targetName)}</strong>
            <span title="${this.app.escapeHtml(item.source)}">${this.app.escapeHtml(item.sourceParent)} → ${this.app.escapeHtml(preview.destinationVolumeName)}</span>
          </span>
          <span class="transfer-kind-badge">${this.app.escapeHtml(conflictLabel || this.presentation.transferKindLabel(item.transferKind))}</span>
        </li>
      `;
      }).join('');
      const validations = preview.validations.map(item => `
        <li class="${item.passed ? '' : 'failed'}"><span aria-hidden="true">${item.passed ? '✓' : '!'}</span>${this.app.escapeHtml(item.message)}</li>
      `).join('');
      const crossVolumeNote = preview.crossVolumeCount > 0
        ? `<div class="transfer-plan-note"><span aria-hidden="true">↗</span><span>跨卷移动会先在“${this.app.escapeHtml(preview.destinationVolumeName)}”生成并校验隐藏临时副本；准备阶段取消不会删除来源，进入提交阶段后才会删除来源。</span></div>`
        : '';
      const conflictControls = preview.conflictCount > 0 ? `
        <div class="transfer-conflict-controls">
          <label for="transfer-conflict-policy">同名冲突</label>
          <select id="transfer-conflict-policy" ${this.state.transferApplying || status ? 'disabled' : ''}>
            <option value="keep-both" ${preview.conflictPolicy === 'keep-both' ? 'selected' : ''}>保留两者（推荐）</option>
            <option value="replace" ${preview.conflictPolicy === 'replace' ? 'selected' : ''}>替换现有项目</option>
            <option value="skip" ${preview.conflictPolicy === 'skip' ? 'selected' : ''}>跳过冲突项目</option>
          </select>
          <span>此选择应用到本批次的全部冲突。替换操作不提供撤销。</span>
        </div>
      ` : '';
      const structureRiskItems = preview.items.flatMap(item => item.skipped ? [] : (item.structureRisks || []).map(risk => `
        <li><strong>${this.app.escapeHtml(item.sourceName)}</strong><span>${this.app.escapeHtml(risk)}</span></li>
      `)).join('');
      const structureRiskControls = preview.requiresStructureRiskAcknowledgement ? `
        <div class="transfer-structure-risk" role="alert">
          <strong>这次移动可能改变项目或仓库结构</strong>
          <ul>${structureRiskItems}</ul>
          <label>
            <input id="transfer-structure-risk-ack" type="checkbox" ${this.state.transferContext?.riskAcknowledged ? 'checked' : ''} ${this.state.transferApplying || status ? 'disabled' : ''}>
            <span>我已检查目标位置，并确认继续移动这些项目身份或 Git 结构</span>
          </label>
        </div>
      ` : '';
      return `
        ${includeProgress ? this.transferProgressHtml(preview, status) : ''}
        <div class="external-import-summary transfer-summary">
          <div class="external-import-stat"><strong>${preview.itemCount}</strong><span>顶层项目</span></div>
          <div class="external-import-stat"><strong>${this.app.escapeHtml(this.app.formatFileSize(preview.totalBytes))}</strong><span>递归总大小</span></div>
          <div class="external-import-stat"><strong>${this.app.escapeHtml(available)}</strong><span>目标卷可用</span></div>
          <div class="external-import-stat"><strong>${this.app.escapeHtml(fourthValue)}</strong><span>${fourthLabel}</span></div>
        </div>
        ${conflictControls}
        ${structureRiskControls}
        <div class="external-import-destination">
          <span>${preview.mode === 'move' ? '移动到' : '复制到'}</span>
          <strong>${this.app.escapeHtml(preview.destinationName)}</strong>
          <code title="${this.app.escapeHtml(preview.destination)}">${this.app.escapeHtml(preview.destination)}</code>
        </div>
        ${crossVolumeNote}
        <ul class="external-import-list">${itemRows}</ul>
        <ul class="external-import-validations">${validations}</ul>
      `;
    }

    async executeTransferWithProgress(preview, applyAction, onStatus) {
      let polling = false;
      const poll = async () => {
        if (polling) return;
        polling = true;
        try {
          const status = await this.bridge.fileOps.getTransferStatus(preview.operationId);
          if (status) onStatus(status);
        } catch (_) {
        } finally {
          polling = false;
        }
      };
      const timer = this.scheduleInterval(poll, 160);
      try {
        const promise = applyAction();
        await poll();
        const result = await promise;
        await poll();
        return result;
      } finally {
        this.clearScheduledInterval(timer);
        await poll();
      }
    }

    async openTransferReview(sourcePaths, destinationDirectory, mode, context = {}) {
      if (this.state.fileOperationBusy || this.state.transferApplying || this.state.externalImportApplying) {
        this.app._showStatusMessage('另一个文件操作正在进行，请稍后重试', 'error');
        return;
      }
      const modal = this.document.getElementById('transfer-review-modal');
      const body = this.document.getElementById('transfer-review-body');
      if (!modal || !body) return;
      this.state.transferPreview = null;
      this.state.transferStatus = null;
      this.state.transferError = null;
      this.state.transferApplying = false;
      this.state.transferContext = {
        ...context,
        sourcePaths: [...sourcePaths],
        destinationDirectory,
        mode,
        conflictPolicy: 'keep-both',
        riskAcknowledged: false
      };
      modal.style.display = 'flex';
      body.innerHTML = '<div class="external-import-loading"><span class="loading-spinner" aria-hidden="true"></span><span>正在递归统计内容、识别目标卷并检查可用空间…</span></div>';
      this.document.getElementById('transfer-review-feedback').textContent = '只读检查，尚未写入任何内容';
      const applyButton = this.document.getElementById('transfer-review-apply-btn');
      applyButton.disabled = true;
      applyButton.textContent = '确认';
      try {
        this.state.transferPreview = await this.bridge.fileOps.previewTransfer(
          sourcePaths,
          destinationDirectory,
          mode,
          { conflictPolicy: 'keep-both' }
        );
      } catch (error) {
        this.state.transferError = error?.message || String(error);
      }
      this.renderTransferReview();
      this.requestFrame(() => this.document.getElementById('transfer-review-cancel-btn')?.focus());
    }

    async changeTransferConflictPolicy(conflictPolicy) {
      if (this.state.transferApplying) return;
      const context = this.state.transferContext;
      const body = this.document.getElementById('transfer-review-body');
      if (!context || !body) return;
      context.conflictPolicy = conflictPolicy;
      context.riskAcknowledged = false;
      this.state.transferPreview = null;
      this.state.transferStatus = null;
      this.state.transferError = null;
      body.innerHTML = '<div class="external-import-loading"><span class="loading-spinner" aria-hidden="true"></span><span>正在按新冲突策略重新检查目标…</span></div>';
      this.document.getElementById('transfer-review-apply-btn').disabled = true;
      try {
        this.state.transferPreview = await this.bridge.fileOps.previewTransfer(
          context.sourcePaths,
          context.destinationDirectory,
          context.mode,
          { conflictPolicy }
        );
      } catch (error) {
        this.state.transferError = error?.message || String(error);
      }
      this.renderTransferReview();
    }

    setStructureRiskAcknowledged(acknowledged) {
      if (!this.state.transferContext || this.state.transferApplying) return;
      this.state.transferContext.riskAcknowledged = Boolean(acknowledged);
      this.renderTransferReview();
    }

    renderTransferReview() {
      const body = this.document.getElementById('transfer-review-body');
      const title = this.document.getElementById('transfer-review-title');
      const description = this.document.getElementById('transfer-review-description');
      const applyButton = this.document.getElementById('transfer-review-apply-btn');
      const cancelButton = this.document.getElementById('transfer-review-cancel-btn');
      const closeButton = this.document.getElementById('transfer-review-close-btn');
      const feedback = this.document.getElementById('transfer-review-feedback');
      if (!body || !title || !description || !applyButton || !cancelButton || !closeButton || !feedback) return;
      const preview = this.state.transferPreview;
      const status = this.state.transferStatus;
      const error = this.state.transferError;
      const presentation = this.presentation.progressPresentation(status, preview);

      title.textContent = preview?.mode === 'move' ? '检查移动计划' : '检查复制计划';
      description.textContent = '确认卷、空间与提交方式后再执行';
      closeButton.disabled = this.state.transferApplying;
      cancelButton.textContent = this.state.transferApplying ? (status?.cancelRequested ? '正在取消…' : '取消传输') : '取消';
      cancelButton.disabled = this.state.transferApplying && !presentation.cancellable;
      const structureRiskConfirmed = !preview?.requiresStructureRiskAcknowledgement || Boolean(this.state.transferContext?.riskAcknowledged);
      applyButton.disabled = this.state.transferApplying || !preview?.canApply || !structureRiskConfirmed || Boolean(error) || Boolean(status);
      applyButton.textContent = preview?.mode === 'move' ? '确认移动' : '确认复制';

      if (error && !preview) {
        body.innerHTML = `<div class="external-import-error"><span aria-hidden="true">⚠</span><strong>无法建立传输计划</strong><span>${this.app.escapeHtml(error)}</span></div>`;
        feedback.textContent = '未写入任何内容';
        return;
      }
      if (!preview) return;
      const inlineError = error && !status
        ? `<div class="transfer-progress-panel" data-tone="danger"><div class="transfer-progress-heading"><strong>传输计划已失效</strong></div><div class="transfer-progress-detail" title="${this.app.escapeHtml(error)}">${this.app.escapeHtml(error)}</div></div>`
        : '';
      body.innerHTML = inlineError + this.transferPlanHtml(preview, { includeProgress: this.state.transferApplying || Boolean(status), status });
      if (status?.state === 'failed' || status?.state === 'needs-review' || error) {
        feedback.textContent = status?.error || error || '传输失败';
        cancelButton.disabled = false;
        cancelButton.textContent = '关闭';
      } else if (status?.state === 'cancelled') {
        feedback.textContent = '来源保持不变，临时项已清理';
        cancelButton.disabled = false;
        cancelButton.textContent = '关闭';
      } else if (this.state.transferApplying) {
        feedback.textContent = presentation.cancellable ? '准备阶段可安全取消' : '正在提交，请勿关闭应用';
      } else {
        feedback.textContent = preview.canApply
          ? (preview.replaceCount > 0 ? '确认前尚未写入；替换时会先保留旧目标备份' : '确认前尚未写入；不会覆盖现有内容')
          : '空间不足，未写入任何内容';
      }
    }

    async applyReviewedTransfer() {
      const preview = this.state.transferPreview;
      if (!preview || !preview.canApply || this.state.transferApplying || this.state.fileOperationBusy) return;
      this.state.transferApplying = true;
      this.state.transferStatus = null;
      this.state.transferError = null;
      this.renderTransferReview();
      const operationLabel = preview.mode === 'move' ? '移动' : '复制';
      const success = await this.app.runFileOperation(async () => {
        try {
          return await this.executeTransferWithProgress(
            preview,
            () => this.bridge.fileOps.applyTransfer({
              operationId: preview.operationId,
              previewToken: preview.previewToken,
              sourcePaths: preview.items.map(item => item.source),
              destinationDirectory: preview.destination,
              mode: preview.mode,
              conflictPolicy: preview.conflictPolicy,
              structureRiskAcknowledged: Boolean(this.state.transferContext?.riskAcknowledged)
            }),
            status => {
              this.state.transferStatus = status;
              this.renderTransferReview();
            }
          );
        } catch (error) {
          this.state.transferError = error?.message || String(error);
          throw error;
        }
      }, result => result?.undoable
        ? `已${operationLabel} ${result.items.length} 项，可撤销`
        : `已完成${operationLabel}：${result?.items?.length || 0} 项写入，${result?.skippedCount || 0} 项跳过`);
      this.state.transferApplying = false;
      if (success) {
        if (this.state.transferContext?.clearClipboardOnSuccess) this.state.fileClipboard = null;
        this.closeTransferReview();
        this.app.updateFileActionBar();
      } else {
        this.state.transferStatus = await this.bridge.fileOps.getTransferStatus(preview.operationId).catch(() => this.state.transferStatus);
        this.renderTransferReview();
      }
    }

    async handleTransferReviewCancel() {
      if (!this.state.transferApplying) {
        this.closeTransferReview();
        return;
      }
      const status = this.state.transferStatus;
      if (!status?.cancellable || status.cancelRequested) return;
      try {
        this.state.transferStatus = await this.bridge.fileOps.cancelTransfer(status.operationId);
        this.renderTransferReview();
      } catch (error) {
        this.app._showStatusMessage(error?.message || String(error), 'error');
      }
    }

    closeTransferReview() {
      if (this.state.transferApplying) return;
      const modal = this.document.getElementById('transfer-review-modal');
      if (modal) modal.style.display = 'none';
      this.state.transferPreview = null;
      this.state.transferStatus = null;
      this.state.transferError = null;
      this.state.transferContext = null;
      this.document.querySelector('.workspace-tab.active')?.focus();
    }

    async openExternalImportPreview(sourcePaths, destinationDirectory) {
      if (this.state.fileOperationBusy || this.state.externalImportApplying) {
        this.app._showStatusMessage('另一个文件操作正在进行，请稍后重试', 'error');
        return;
      }
      const modal = this.document.getElementById('external-import-modal');
      const body = this.document.getElementById('external-import-body');
      const applyButton = this.document.getElementById('external-import-apply-btn');
      const feedback = this.document.getElementById('external-import-feedback');
      if (!modal || !body || !applyButton || !feedback) return;

      this.state.externalImportPreview = null;
      this.state.externalImportApplying = false;
      this.state.externalImportError = null;
      this.state.externalImportStatus = null;
      modal.style.display = 'flex';
      body.innerHTML = '<div class="external-import-loading"><span class="loading-spinner" aria-hidden="true"></span><span>正在检查来源、目标和同名冲突…</span></div>';
      feedback.textContent = '只做安全检查，尚未复制任何内容';
      applyButton.disabled = true;
      applyButton.textContent = '确认导入';

      try {
        this.state.externalImportPreview = await this.bridge.fileOps.previewImport(sourcePaths, destinationDirectory);
      } catch (error) {
        this.state.externalImportError = error?.message || String(error);
      }
      this.renderExternalImportPreview();
      this.requestFrame(() => this.document.getElementById('external-import-cancel-btn')?.focus());
    }

    renderExternalImportPreview() {
      const body = this.document.getElementById('external-import-body');
      const applyButton = this.document.getElementById('external-import-apply-btn');
      const feedback = this.document.getElementById('external-import-feedback');
      if (!body || !applyButton || !feedback) return;

      const preview = this.state.externalImportPreview;
      const error = this.state.externalImportError;
      const status = this.state.externalImportStatus;
      const presentation = this.presentation.progressPresentation(status, preview);
      const cancelButton = this.document.getElementById('external-import-cancel-btn');
      const closeButton = this.document.getElementById('external-import-close-btn');
      applyButton.disabled = !preview?.canApply || Boolean(error) || this.state.externalImportApplying || Boolean(status);
      applyButton.textContent = this.state.externalImportApplying ? '正在导入…' : '确认导入';
      if (cancelButton) {
        cancelButton.textContent = this.state.externalImportApplying
          ? (status?.cancelRequested ? '正在取消…' : '取消传输')
          : (status ? '关闭' : '取消');
        cancelButton.disabled = this.state.externalImportApplying && !presentation.cancellable;
      }
      if (closeButton) closeButton.disabled = this.state.externalImportApplying;

      if (error && !preview) {
        body.innerHTML = `<div class="external-import-error"><span aria-hidden="true">⚠</span><strong>无法导入</strong><span>${this.app.escapeHtml(error)}</span></div>`;
        feedback.textContent = '未复制任何内容；请取消后重新拖入';
        return;
      }
      if (!preview) return;

      const inlineError = error && !status
        ? `<div class="transfer-progress-panel" data-tone="danger"><div class="transfer-progress-heading"><strong>导入计划已失效</strong></div><div class="transfer-progress-detail" title="${this.app.escapeHtml(error)}">${this.app.escapeHtml(error)}</div></div>`
        : '';
      body.innerHTML = inlineError + this.transferPlanHtml(preview, {
        includeProgress: this.state.externalImportApplying || Boolean(status),
        status
      });
      if (status?.state === 'failed' || status?.state === 'needs-review' || error) {
        feedback.textContent = status?.error || error || '导入失败';
      } else if (status?.state === 'cancelled') {
        feedback.textContent = '来源保持不变，临时项已清理';
      } else if (this.state.externalImportApplying) {
        feedback.textContent = presentation.cancellable ? '准备阶段可安全取消' : '正在提交，请勿关闭应用';
      } else {
        feedback.textContent = preview.canApply
          ? '只复制，不移动来源；确认前尚未写入'
          : '目标卷空间不足，未写入任何内容';
      }
    }

    async applyExternalImport() {
      const preview = this.state.externalImportPreview;
      if (!preview || this.state.externalImportApplying || this.state.fileOperationBusy) return;
      this.state.externalImportApplying = true;
      this.state.externalImportError = null;
      this.state.externalImportStatus = null;
      this.renderExternalImportPreview();
      const targets = preview.items.map(item => item.target);
      const success = await this.app.runFileOperation(
        async () => {
          try {
            return await this.executeTransferWithProgress(
              preview,
              () => this.bridge.fileOps.applyImport({
                operationId: preview.operationId,
                previewToken: preview.previewToken,
                sourcePaths: preview.items.map(item => item.source),
                destinationDirectory: preview.destination
              }),
              status => {
                this.state.externalImportStatus = status;
                this.renderExternalImportPreview();
              }
            );
          } catch (error) {
            this.state.externalImportError = error?.message || String(error);
            throw error;
          }
        },
        `已导入 ${preview.itemCount} 项；来源保持不变，可按 ⌘Z 撤销`
      );
      this.state.externalImportApplying = false;
      if (!success) {
        this.state.externalImportStatus = await this.bridge.fileOps.getTransferStatus(preview.operationId).catch(() => this.state.externalImportStatus);
        this.renderExternalImportPreview();
        return;
      }

      this.closeExternalImportModal();
      const normalize = value => String(value || '').replace(/[\\/]+$/, '');
      if (normalize(this.state.currentPath) !== normalize(preview.destination)) return;
      if (targets.some(target => !this.state.visibleItems.some(item => item.path === target))) {
        this.state.contentQuery = this.contentQuery.queryForPreset('current-all');
        this.app.captureActiveWorkspaceTab();
        await this.app.persistWorkspaceTabs();
        this.app.updateDirectoryTypeFilterUI();
        await this.app.renderContent();
      }
      const visibleTargets = targets.filter(target => this.state.visibleItems.some(item => item.path === target));
      this.state.selectedPaths = new Set(visibleTargets);
      this.state.selectionAnchorPath = visibleTargets[0] || null;
      this.app.syncFileSelectionUI();
      this.app.updateFileActionBar();
      this.app.showFileSelectionDetail(this.app.getSelectedFileItems());
      if (visibleTargets[0]) {
        this.document.querySelector(`[data-path="${this.app.cssEscape(visibleTargets[0])}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }

    closeExternalImportModal() {
      if (this.state.externalImportApplying) return;
      const modal = this.document.getElementById('external-import-modal');
      if (modal) modal.style.display = 'none';
      this.state.externalImportPreview = null;
      this.state.externalImportError = null;
      this.state.externalImportStatus = null;
      this.document.querySelector('.workspace-tab.active')?.focus();
    }

    async handleExternalImportCancel() {
      if (!this.state.externalImportApplying) {
        this.closeExternalImportModal();
        return;
      }
      const status = this.state.externalImportStatus;
      if (!status?.cancellable || status.cancelRequested) return;
      try {
        this.state.externalImportStatus = await this.bridge.fileOps.cancelTransfer(status.operationId);
        this.renderExternalImportPreview();
      } catch (error) {
        this.app._showStatusMessage(error?.message || String(error), 'error');
      }
    }
  }

  return { Controller };
});
