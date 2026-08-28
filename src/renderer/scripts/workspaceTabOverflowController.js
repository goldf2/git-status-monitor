(function exposeWorkspaceTabOverflowController(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorkspaceTabOverflowController = api;
})(typeof window !== 'undefined' ? window : globalThis, function createWorkspaceTabOverflowControllerApi(root) {
  class Controller {
    constructor(options = {}) {
      this.document = options.document || root?.document || null;
      this.window = options.window || root || null;
      this.container = null;
      this.leftButton = null;
      this.rightButton = null;
      this.mounted = false;
      this._onScroll = () => this.refresh();
      this._onResize = () => this.refresh({ remeasure: true });
      this._onLeft = () => this.scroll(-1);
      this._onRight = () => this.scroll(1);
    }

    mount() {
      if (this.mounted) return true;
      this.container = this.document?.getElementById?.('workspace-tabs') || null;
      this.leftButton = this.document?.getElementById?.('workspace-tabs-left') || null;
      this.rightButton = this.document?.getElementById?.('workspace-tabs-right') || null;
      if (!this.container || !this.leftButton || !this.rightButton) return false;
      this.container.addEventListener('scroll', this._onScroll, { passive: true });
      this.leftButton.addEventListener('click', this._onLeft);
      this.rightButton.addEventListener('click', this._onRight);
      this.window?.addEventListener?.('resize', this._onResize);
      this.mounted = true;
      this.refresh({ remeasure: true });
      return true;
    }

    afterRender() {
      if (!this.mounted && !this.mount()) return false;
      this.refresh({ remeasure: true });
      this._activeTab()?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      this.refresh();
      return true;
    }

    refresh({ remeasure = false } = {}) {
      if (!this.container || !this.leftButton || !this.rightButton) return false;
      if (remeasure) {
        this.leftButton.hidden = true;
        this.rightButton.hidden = true;
      }
      const overflow = this.container.scrollWidth > this.container.clientWidth + 1;
      this.leftButton.hidden = !overflow;
      this.rightButton.hidden = !overflow;
      if (!overflow) {
        this.container.scrollLeft = 0;
        this._setActiveDirection(false, false);
        return false;
      }

      const maximum = Math.max(0, this.container.scrollWidth - this.container.clientWidth);
      this.leftButton.disabled = this.container.scrollLeft <= 1;
      this.rightButton.disabled = this.container.scrollLeft >= maximum - 1;
      const bounds = this.container.getBoundingClientRect();
      const activeBounds = this._activeTab()?.getBoundingClientRect?.();
      this._setActiveDirection(
        Boolean(activeBounds && activeBounds.left < bounds.left + 1),
        Boolean(activeBounds && activeBounds.right > bounds.right - 1)
      );
      return true;
    }

    scroll(direction) {
      if (!this.container || ![-1, 1].includes(direction)) return false;
      const bounds = this.container.getBoundingClientRect();
      const active = this._activeTab();
      const activeBounds = active?.getBoundingClientRect?.();
      const activeInDirection = direction < 0
        ? Boolean(activeBounds && activeBounds.left < bounds.left + 1)
        : Boolean(activeBounds && activeBounds.right > bounds.right - 1);
      if (activeInDirection) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } else {
        const distance = Math.max(160, Math.round(this.container.clientWidth * 0.72));
        this.container.scrollBy({ left: distance * direction, behavior: 'smooth' });
      }
      return true;
    }

    dispose() {
      if (!this.mounted) return;
      this.container?.removeEventListener?.('scroll', this._onScroll);
      this.leftButton?.removeEventListener?.('click', this._onLeft);
      this.rightButton?.removeEventListener?.('click', this._onRight);
      this.window?.removeEventListener?.('resize', this._onResize);
      this.mounted = false;
    }

    _activeTab() {
      return this.container?.querySelector?.('.workspace-tab.active') || null;
    }

    _setActiveDirection(left, right) {
      this.leftButton?.classList?.toggle('contains-active-tab', left);
      this.rightButton?.classList?.toggle('contains-active-tab', right);
    }
  }

  return { Controller };
});
