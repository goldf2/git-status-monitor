const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_DEBOUNCE_MS = 90;
const MAX_CHANGED_NAMES = 32;

class DirectoryWatchService {
  constructor(options = {}) {
    this.watch = options.watch || ((directoryPath, watchOptions, listener) => fs.watch(directoryPath, watchOptions, listener));
    this.inspectDirectories = options.inspectDirectories || (() => ({ directories: [] }));
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : DEFAULT_DEBOUNCE_MS;
    this.watchers = new Map();
  }

  _ownerKey(ownerId) {
    const value = String(ownerId ?? '');
    if (!value || value.length > 128) throw new Error('目录监听所有者无效');
    return value;
  }

  _assertAvailableDirectory(directoryPath) {
    if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
      throw new Error('目录监听路径必须是绝对路径');
    }
    const inspection = this.inspectDirectories([directoryPath]);
    const entry = (inspection?.directories || []).find(item => item?.path === directoryPath);
    if (!entry?.available) throw new Error('只能监听已添加受管根目录内的可用文件夹');
    return path.normalize(directoryPath);
  }

  _flush(record) {
    if (!record || record.closed) return;
    if (record.timer) {
      this.clearTimer(record.timer);
      record.timer = null;
    }
    const eventTypes = [...record.eventTypes];
    const names = [...record.names];
    record.eventTypes.clear();
    record.names.clear();
    if (!eventTypes.length) return;
    try {
      record.onEvent({
        kind: 'change',
        watchId: record.watchId,
        path: record.path,
        eventTypes,
        names
      });
    } catch (_) {
      // 渲染窗口可能已销毁；回调异常不能影响主进程监听生命周期。
    }
  }

  _queue(record, eventType, fileName) {
    if (!record || record.closed) return;
    record.eventTypes.add(eventType === 'rename' ? 'rename' : 'change');
    const name = Buffer.isBuffer(fileName) ? fileName.toString('utf8') : String(fileName || '');
    if (name && record.names.size < MAX_CHANGED_NAMES) record.names.add(name.slice(0, 1024));
    if (record.timer) this.clearTimer(record.timer);
    record.timer = this.setTimer(() => this._flush(record), this.debounceMs);
  }

  start(ownerId, directoryPath, onEvent) {
    const ownerKey = this._ownerKey(ownerId);
    if (typeof onEvent !== 'function') throw new Error('目录监听回调无效');
    const safePath = this._assertAvailableDirectory(directoryPath);
    this.stop(ownerKey);

    const record = {
      ownerKey,
      watchId: `directory-watch-${randomUUID()}`,
      path: safePath,
      watcher: null,
      timer: null,
      eventTypes: new Set(),
      names: new Set(),
      onEvent,
      closed: false
    };

    try {
      record.watcher = this.watch(safePath, { persistent: false, recursive: false }, (eventType, fileName) => {
        this._queue(record, eventType, fileName);
      });
      record.watcher.on?.('error', error => {
        if (record.closed) return;
        const payload = {
          kind: 'error',
          watchId: record.watchId,
          path: record.path,
          error: String(error?.message || error || '目录监听失败').slice(0, 500)
        };
        this.stop(ownerKey, record.watchId);
        try { onEvent(payload); } catch (_) {}
      });
    } catch (error) {
      record.closed = true;
      if (record.timer) this.clearTimer(record.timer);
      try { record.watcher?.close(); } catch (_) {}
      throw error;
    }

    this.watchers.set(ownerKey, record);
    return { watchId: record.watchId, path: record.path };
  }

  stop(ownerId, watchId = '') {
    const ownerKey = this._ownerKey(ownerId);
    const record = this.watchers.get(ownerKey);
    if (!record || (watchId && record.watchId !== watchId)) return { stopped: false };
    record.closed = true;
    if (record.timer) this.clearTimer(record.timer);
    try { record.watcher?.close(); } catch (_) {}
    this.watchers.delete(ownerKey);
    return { stopped: true, watchId: record.watchId, path: record.path };
  }

  closeAll() {
    for (const ownerKey of [...this.watchers.keys()]) this.stop(ownerKey);
  }
}

module.exports = { DirectoryWatchService, DEFAULT_DEBOUNCE_MS, MAX_CHANGED_NAMES };
