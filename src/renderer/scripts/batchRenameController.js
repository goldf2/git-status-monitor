(function exposeBatchRenameController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BatchRenameController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createBatchRenameControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.app = options.app;
      this.state = options.state;
      this.bridge = options.bridge || root?.gitFinder || null;
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.model = options.model || root?.BatchRename || null;
      this.items = [];
      this.preview = null;
      this.previewGeneration = 0;
      this.previewFrame = null;
      this.applying = false;
      this.lastFocusedElement = null;
    }

    bind() {
      this.modal = this.document?.getElementById('batch-rename-modal');
      this.form = this.document?.getElementById('batch-rename-form');
      this.mode = this.document?.getElementById('batch-rename-mode');
      this.applyButton = this.document?.getElementById('batch-rename-apply-btn');
      this.cancelButton = this.document?.getElementById('batch-rename-cancel-btn');
      this.closeButton = this.document?.getElementById('batch-rename-close-btn');
      this.risk = this.document?.getElementById('batch-rename-risk');
      this.riskCheck = this.document?.getElementById('batch-rename-risk-check');
      if (!this.modal || !this.form || !this.mode || !this.model) return;

      this.mode.addEventListener('change', () => {
        this.updateModeFields();
        this.schedulePreview();
      });
      this.form.querySelectorAll('input, select').forEach(control => {
        if (control === this.mode || control === this.riskCheck) return;
        control.addEventListener('input', () => this.schedulePreview());
        control.addEventListener('change', () => this.schedulePreview());
      });
      this.riskCheck?.addEventListener('change', () => this.updateApplyState());
      this.form.addEventListener('submit', event => {
        event.preventDefault();
        this.apply();
      });
      this.cancelButton?.addEventListener('click', () => this.close());
      this.closeButton?.addEventListener('click', () => this.close());
      this.document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !this.isOpen() || this.applying) return;
        event.preventDefault();
        this.close();
      });
      this.updateModeFields();
    }

    isOpen() {
      return Boolean(this.modal && this.modal.style.display !== 'none');
    }

    open(items) {
      if (!this.modal || this.applying || !Array.isArray(items) || items.length < 2) return false;
      this.items = items.map(item => ({ path: item.path, name: item.name, type: item.type }));
      this.preview = null;
      this.previewGeneration += 1;
      this.lastFocusedElement = this.document.activeElement;
      this.form.reset();
      this.mode.value = 'replace';
      this.document.getElementById('batch-rename-start').value = '1';
      this.document.getElementById('batch-rename-width').value = '1';
      this.document.getElementById('batch-rename-title').textContent = `重命名 ${items.length} 个项目`;
      this.document.getElementById('batch-rename-preview').innerHTML = '';
      this.document.getElementById('batch-rename-summary').hidden = true;
      this.risk.hidden = true;
      this.riskCheck.checked = false;
      this.setFeedback('输入规则后将显示预览。', 'neutral');
      this.setFooterStatus('尚未生成可执行预览');
      this.updateModeFields();
      this.updateApplyState();
      this.modal.style.display = 'flex';
      this.modal.setAttribute('aria-hidden', 'false');
      this.modal.removeAttribute('inert');
      this.window?.requestAnimationFrame?.(() => this.document.getElementById('batch-rename-search')?.focus());
      return true;
    }

    close() {
      if (!this.modal || this.applying) return;
      this.previewGeneration += 1;
      this.preview = null;
      this.items = [];
      this.modal.style.display = 'none';
      this.modal.setAttribute('aria-hidden', 'true');
      this.modal.setAttribute('inert', '');
      this.lastFocusedElement?.focus?.();
      this.lastFocusedElement = null;
    }

    updateModeFields() {
      const activeMode = this.mode?.value || 'replace';
      this.form?.querySelectorAll('[data-batch-mode]').forEach(group => {
        group.hidden = group.dataset.batchMode !== activeMode;
      });
    }

    readOptions() {
      return this.model.normalizeOptions({
        mode: this.mode?.value,
        searchText: this.document.getElementById('batch-rename-search')?.value,
        replacementText: this.document.getElementById('batch-rename-replacement')?.value,
        text: this.document.getElementById('batch-rename-text')?.value,
        placement: this.document.getElementById('batch-rename-placement')?.value,
        formatName: this.document.getElementById('batch-rename-format-name')?.value,
        startAt: this.document.getElementById('batch-rename-start')?.value,
        counterWidth: this.document.getElementById('batch-rename-width')?.value
      });
    }

    schedulePreview() {
      this.preview = null;
      this.risk.hidden = true;
      this.riskCheck.checked = false;
      this.updateApplyState();
      if (this.previewFrame !== null) return;
      const schedule = this.window?.requestAnimationFrame?.bind(this.window)
        || (callback => this.window?.setTimeout?.(callback, 0));
      this.previewFrame = schedule(() => {
        this.previewFrame = null;
        this.requestPreview();
      });
    }

    async requestPreview() {
      if (!this.isOpen() || this.applying) return;
      const options = this.readOptions();
      const validation = this.model.validateOptions(options);
      if (!validation.ok) {
        this.previewGeneration += 1;
        this.document.getElementById('batch-rename-preview').innerHTML = '';
        this.document.getElementById('batch-rename-summary').hidden = true;
        this.setFeedback(validation.error, 'neutral');
        this.setFooterStatus('完善规则后生成预览');
        return;
      }
      const generation = ++this.previewGeneration;
      this.modal.setAttribute('aria-busy', 'true');
      this.setFeedback('正在检查名称、占用情况和项目结构…', 'loading');
      this.setFooterStatus('正在生成零写入预览');
      try {
        const preview = await this.bridge.fileOps.previewBatchRename(
          this.items.map(item => item.path),
          validation.options
        );
        if (generation !== this.previewGeneration || !this.isOpen()) return;
        this.preview = preview;
        this.renderPreview();
      } catch (error) {
        if (generation !== this.previewGeneration || !this.isOpen()) return;
        this.preview = null;
        this.document.getElementById('batch-rename-preview').innerHTML = '';
        this.document.getElementById('batch-rename-summary').hidden = true;
        this.setFeedback(error?.message || String(error), 'error');
        this.setFooterStatus('无法生成预览');
      } finally {
        if (generation === this.previewGeneration) this.modal.removeAttribute('aria-busy');
        this.updateApplyState();
      }
    }

    renderPreview() {
      const preview = this.preview;
      if (!preview) return;
      const escape = value => this.app.escapeHtml(String(value ?? ''));
      const summary = this.document.getElementById('batch-rename-summary');
      summary.hidden = false;
      summary.innerHTML = `
        <span><strong>${preview.changedCount}</strong> 将更改</span>
        <span><strong>${preview.unchangedCount}</strong> 保持不变</span>
        <span class="${preview.invalidCount ? 'invalid' : ''}"><strong>${preview.invalidCount}</strong> 冲突或无效</span>
      `;
      const visibleItems = preview.items.slice(0, 100);
      this.document.getElementById('batch-rename-preview').innerHTML = visibleItems.map(item => `
        <li class="${item.validationError ? 'invalid' : (item.changed ? 'changed' : 'unchanged')}">
          <code title="${escape(item.oldName)}">${escape(item.oldName)}</code>
          <span aria-hidden="true">→</span>
          <code title="${escape(item.newName || item.oldName)}">${escape(item.newName || item.oldName)}</code>
          <small>${escape(item.validationError || (item.changed ? '将重命名' : '保持不变'))}</small>
        </li>
      `).join('') + (preview.items.length > visibleItems.length
        ? `<li class="batch-rename-more">另有 ${preview.items.length - visibleItems.length} 项已检查</li>`
        : '');

      this.risk.hidden = !preview.requiresStructureRiskAcknowledgement;
      this.riskCheck.checked = false;
      if (preview.invalidCount > 0) {
        this.setFeedback(`${preview.invalidCount} 个项目存在冲突或无效名称；文件尚未修改。`, 'error');
      } else if (preview.changedCount === 0) {
        this.setFeedback('当前规则不会改变任何名称。', 'neutral');
      } else if (preview.requiresStructureRiskAcknowledgement) {
        this.setFeedback(`检测到 ${preview.structureRiskCount} 项项目或 Git 结构风险，请检查后确认。`, 'warning');
      } else {
        this.setFeedback(`预览已检查：${preview.summary}。`, 'success');
      }
      this.setFooterStatus(preview.canApply
        ? `将重命名 ${preview.changedCount} 个项目；可在完成后撤销`
        : '解决冲突后才能重命名');
      this.updateApplyState();
    }

    updateApplyState() {
      if (!this.applyButton) return;
      const riskAccepted = !this.preview?.requiresStructureRiskAcknowledgement || this.riskCheck?.checked === true;
      this.applyButton.disabled = this.applying || !this.preview?.canApply || !riskAccepted;
      this.cancelButton.disabled = this.applying;
      this.closeButton.disabled = this.applying;
    }

    setBusy(value) {
      this.applying = value;
      this.form?.querySelectorAll('input, select').forEach(control => {
        control.disabled = value;
      });
      this.applyButton.textContent = value ? '正在重命名…' : '重命名';
      this.updateApplyState();
    }

    async apply() {
      if (this.applying || !this.preview?.canApply || this.applyButton?.disabled) return false;
      const preview = this.preview;
      this.setBusy(true);
      this.setFooterStatus('正在执行完整批次；失败时会回滚全部项目');
      const success = await this.app.runFileOperation(
        () => this.bridge.fileOps.applyBatchRename({
          operationId: preview.operationId,
          previewToken: preview.previewToken,
          sourcePaths: this.items.map(item => item.path),
          options: preview.options,
          structureRiskAcknowledged: this.riskCheck?.checked === true
        }),
        operation => `已重命名 ${operation?.itemCount || preview.changedCount} 个项目，可撤销`
      );
      this.setBusy(false);
      if (success) {
        this.close();
      } else {
        this.setFooterStatus('执行未完成；请检查提示后重新生成预览');
        this.requestPreview();
      }
      return success;
    }

    setFeedback(message, tone = 'neutral') {
      const feedback = this.document?.getElementById('batch-rename-feedback');
      if (!feedback) return;
      feedback.textContent = message;
      feedback.dataset.tone = tone;
    }

    setFooterStatus(message) {
      const status = this.document?.getElementById('batch-rename-footer-status');
      if (status) status.textContent = message;
    }
  }

  return { Controller };
});
