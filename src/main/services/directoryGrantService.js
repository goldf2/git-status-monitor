const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_GRANTS = 64;
const MAX_PATH_LENGTH = 32768;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

class DirectoryGrantService {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    this.platform = options.platform || process.platform;
    this.grants = new Map();
  }

  _pathKey(candidatePath) {
    const normalized = path.normalize(String(candidatePath || ''));
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  _normalizeDirectory(candidatePath) {
    if (typeof candidatePath !== 'string' || !candidatePath || candidatePath.length > MAX_PATH_LENGTH) {
      throw new Error('所选目录路径无效');
    }
    if (candidatePath.includes('\0') || !path.isAbsolute(candidatePath)) throw new Error('所选目录必须使用绝对路径');
    const directoryPath = path.normalize(candidatePath);
    let stat;
    try {
      stat = fs.statSync(directoryPath);
    } catch (_) {
      throw new Error('所选目录不存在或没有读取权限');
    }
    if (!stat.isDirectory()) throw new Error('所选位置不是文件夹');
    return directoryPath;
  }

  _purgeExpired() {
    const now = this.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
    while (this.grants.size >= MAX_GRANTS) {
      this.grants.delete(this.grants.keys().next().value);
    }
  }

  issue(candidatePath) {
    const directoryPath = this._normalizeDirectory(candidatePath);
    this._purgeExpired();
    const token = crypto.randomUUID();
    this.grants.set(token, {
      path: directoryPath,
      pathKey: this._pathKey(directoryPath),
      expiresAt: this.now() + this.ttlMs
    });
    return { path: directoryPath, grantToken: token };
  }

  consume(candidatePath, token) {
    const directoryPath = this._normalizeDirectory(candidatePath);
    this._purgeExpired();
    const normalizedToken = typeof token === 'string' ? token : '';
    const grant = this.grants.get(normalizedToken);
    if (!grant || grant.expiresAt <= this.now() || grant.pathKey !== this._pathKey(directoryPath)) {
      throw new Error('添加目录需要重新通过系统文件夹选择器确认');
    }
    this.grants.delete(normalizedToken);
    return directoryPath;
  }
}

module.exports = new DirectoryGrantService();
module.exports.DirectoryGrantService = DirectoryGrantService;
