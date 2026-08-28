(function exposeFileOperationDialogController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileOperationDialogController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileOperationDialogControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.requestAnimationFrame = options.requestAnimationFrame
        || root?.requestAnimationFrame?.bind(root)
        || (callback => callback());
      this.resolveRequest = null;
      this.returnFocus = null;
      this.returnFocusId = '';
      this.bound = false;
    }

    bind() {
      if (this.bound || !this.document) return;
      this.bound = true;
      this._element('file-operation-confirm-btn')?.addEventListener('click', () => this.submit());
      this._element('file-operation-input')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault?.();
          event.stopPropagation?.();
          this.submit();
        } else if (event.key === 'Escape') {
          event.preventDefault?.();
          event.stopPropagation?.();
          this.close(null);
        }
      });
      this.document.querySelectorAll?.('#file-operation-modal [data-modal="file-operation-modal"]')
        .forEach(button => button.addEventListener('click', () => this.close(null)));
    }

    open(options = {}) {
      const {
        title,
        label = '名称',
        value = '',
        confirmLabel = '确定',
        hint = '',
        selectBaseName = false,
        returnFocusId = ''
      } = options;
      const modal = this._element('file-operation-modal');
      const input = this._element('file-operation-input');
      if (!modal || !input) return Promise.resolve(null);
      if (this.resolveRequest) this.close(null, { restoreFocus: false });

      const active = this.document.activeElement;
      this.returnFocus = modal.contains?.(active) ? null : active;
      this.returnFocusId = returnFocusId;
      this._element('file-operation-title').textContent = title || '';
      this._element('file-operation-label').textContent = label;
      this._element('file-operation-confirm-btn').textContent = confirmLabel;
      const hintElement = this._element('file-operation-hint');
      hintElement.textContent = hint;
      hintElement.classList.remove('error');
      input.value = value;
      modal.removeAttribute('inert');
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      this.requestAnimationFrame(() => {
        input.focus();
        const extensionIndex = selectBaseName ? input.value.lastIndexOf('.') : -1;
        if (extensionIndex > 0) input.setSelectionRange(0, extensionIndex);
        else input.select();
      });
      return new Promise(resolve => {
        this.resolveRequest = resolve;
      });
    }

    submit() {
      const input = this._element('file-operation-input');
      const hint = this._element('file-operation-hint');
      const value = input?.value.trim() || '';
      if (!value) {
        hint.textContent = '名称不能为空';
        hint.classList.add('error');
        input?.focus();
        return false;
      }
      this.close(value);
      return true;
    }

    close(value, { restoreFocus = true } = {}) {
      const modal = this._element('file-operation-modal');
      if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
      }
      const resolve = this.resolveRequest;
      this.resolveRequest = null;
      if (resolve) resolve(value);
      if (restoreFocus) this._restoreFocus();
      this.returnFocus = null;
      this.returnFocusId = '';
      return Boolean(resolve);
    }

    _restoreFocus() {
      const target = this._canRestoreFocus(this.returnFocus)
        ? this.returnFocus
        : this._element(this.returnFocusId);
      target?.focus?.();
    }

    _canRestoreFocus(element) {
      if (!element?.isConnected || typeof element.focus !== 'function') return false;
      try {
        const style = this.window?.getComputedStyle?.(element);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
        if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
      } catch (_) {
        return false;
      }
      return true;
    }

    _element(id) {
      return this.document?.getElementById?.(id) || null;
    }
  }

  return { Controller };
});
