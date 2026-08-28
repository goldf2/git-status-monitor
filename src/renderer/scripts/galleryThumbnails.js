(function exposeGalleryThumbnails(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GalleryThumbnails = api;
})(typeof window !== 'undefined' ? window : globalThis, function createGalleryThumbnailsApi() {
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
  const SAFE_THUMBNAIL_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i;

  function itemExtension(item) {
    const name = String(item?.name || item?.path || '').toLowerCase();
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex) : '';
  }

  function isThumbnailCandidate(item) {
    return item?.type === 'file' && IMAGE_EXTENSIONS.has(itemExtension(item));
  }

  function cacheKey(item) {
    return [
      String(item?.path || ''),
      Math.max(0, Number(item?.size) || 0),
      String(item?.modifiedTime || '')
    ].join('\0');
  }

  class ThumbnailCache {
    constructor(limit = 128) {
      this.limit = Math.max(1, Number(limit) || 128);
      this.entries = new Map();
    }

    get(item) {
      const key = cacheKey(item);
      const dataUrl = this.entries.get(key);
      if (!dataUrl) return '';
      this.entries.delete(key);
      this.entries.set(key, dataUrl);
      return dataUrl;
    }

    set(item, dataUrl) {
      if (!SAFE_THUMBNAIL_DATA_URL.test(String(dataUrl || ''))) return false;
      const key = cacheKey(item);
      this.entries.delete(key);
      this.entries.set(key, dataUrl);
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
      return true;
    }

    clear() {
      this.entries.clear();
    }

    get size() {
      return this.entries.size;
    }
  }

  class Loader {
    constructor(getThumbnail, options = {}) {
      if (typeof getThumbnail !== 'function') throw new TypeError('getThumbnail 必须是函数');
      this.getThumbnail = getThumbnail;
      this.maxConcurrent = Math.max(1, Math.min(8, Number(options.maxConcurrent) || 4));
      this.cache = options.cache || new ThumbnailCache(options.cacheLimit);
      this.generation = 0;
      this.active = 0;
      this.queue = [];
      this.enqueued = new Set();
      this.observer = null;
    }

    disconnect() {
      this.generation += 1;
      this.observer?.disconnect();
      this.observer = null;
      this.queue = [];
      this.enqueued.clear();
    }

    observe(container, items, context = {}) {
      this.disconnect();
      if (!container) return;
      const generation = this.generation;
      const itemByPath = new Map((Array.isArray(items) ? items : [])
        .filter(isThumbnailCandidate)
        .map(item => [item.path, item]));
      const elements = [...container.querySelectorAll('.finder-gallery-item')]
        .filter(element => itemByPath.has(element.dataset.path));
      const strip = container.querySelector('.finder-gallery-strip');
      const isCurrent = typeof context.isCurrent === 'function' ? context.isCurrent : () => true;

      const enqueue = element => {
        if (generation !== this.generation || !isCurrent()) return;
        if (this.enqueued.has(element)) return;
        const item = itemByPath.get(element.dataset.path);
        if (!item) return;
        const cachedDataUrl = this.cache.get(item);
        if (cachedDataUrl) {
          this._apply(element, item, cachedDataUrl);
          return;
        }
        this.enqueued.add(element);
        element.querySelector('.finder-gallery-item-visual')?.setAttribute('data-thumbnail-state', 'loading');
        this.queue.push({ element, item, generation, isCurrent });
        this._pump(generation);
      };

      const view = container.ownerDocument?.defaultView;
      if (strip && typeof view?.IntersectionObserver === 'function') {
        const observer = new view.IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            enqueue(entry.target);
          });
        }, { root: strip, rootMargin: '0px 180px', threshold: 0.01 });
        this.observer = observer;
        elements.forEach(element => observer.observe(element));
      } else {
        elements.forEach(enqueue);
      }
    }

    _isCurrent(job) {
      return job.generation === this.generation
        && job.element?.isConnected !== false
        && job.element?.dataset?.path === job.item?.path
        && job.isCurrent();
    }

    _pump(generation) {
      if (generation !== this.generation) return;
      while (this.active < this.maxConcurrent && this.queue.length) {
        const job = this.queue.shift();
        this.active += 1;
        Promise.resolve()
          .then(async () => {
            if (!this._isCurrent(job)) return;
            const result = await this.getThumbnail(job.item.path);
            if (!this._isCurrent(job)) return;
            if (result?.kind !== 'thumbnail' || !this.cache.set(job.item, result.dataUrl)) {
              job.element.querySelector('.finder-gallery-item-visual')?.setAttribute('data-thumbnail-state', 'unavailable');
              return;
            }
            this._apply(job.element, job.item, result.dataUrl);
          })
          .catch(() => {
            if (this._isCurrent(job)) {
              job.element.querySelector('.finder-gallery-item-visual')?.setAttribute('data-thumbnail-state', 'unavailable');
            }
          })
          .finally(() => {
            this.active -= 1;
            this._pump(this.generation);
          });
      }
    }

    _apply(element, item, dataUrl) {
      if (!SAFE_THUMBNAIL_DATA_URL.test(String(dataUrl || ''))) return false;
      const visual = element?.querySelector('.finder-gallery-item-visual');
      const documentRef = element?.ownerDocument;
      if (!visual || !documentRef) return false;
      const image = documentRef.createElement('img');
      image.className = 'finder-gallery-item-thumbnail';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.src = dataUrl;
      visual.replaceChildren(image);
      visual.setAttribute('data-thumbnail-state', 'ready');
      visual.title = `${String(item?.name || '图片')} 缩略图`;
      return true;
    }
  }

  return {
    IMAGE_EXTENSIONS,
    SAFE_THUMBNAIL_DATA_URL,
    isThumbnailCandidate,
    cacheKey,
    ThumbnailCache,
    Loader
  };
});
