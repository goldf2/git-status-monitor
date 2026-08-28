const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const RelationshipGraphModel = require('../../shared/relationshipGraphModel');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FILE_NAME = 'relationship-boards.json';

function resolveDefaultBaseDirectory() {
  try {
    const { app } = require('electron');
    const userData = app?.getPath?.('userData');
    if (userData) return userData;
  } catch (_) {}
  return path.join(os.homedir(), '.gitfinder');
}

class RelationshipBoardService {
  constructor(options = {}) {
    this.baseDirectory = path.resolve(options.baseDirectory || resolveDefaultBaseDirectory());
    this.filePath = path.join(this.baseDirectory, FILE_NAME);
    this.now = options.now || (() => new Date());
  }

  _ensureBaseDirectory() {
    if (!fs.existsSync(this.baseDirectory)) {
      fs.mkdirSync(this.baseDirectory, { recursive: true, mode: 0o700 });
    }
    const stat = fs.lstatSync(this.baseDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('关系白板配置目录必须是普通文件夹');
    }
  }

  _assertReadableFile() {
    const stat = fs.lstatSync(this.filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('关系白板配置必须是普通文件');
    if (stat.size > MAX_FILE_BYTES) throw new Error('关系白板配置超过 2 MB 安全限制');
    return stat;
  }

  _corruptBackupPath() {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    return path.join(this.baseDirectory, `relationship-boards.corrupt-${stamp}.json`);
  }

  _backupCorruptFile() {
    const backupPath = this._corruptBackupPath();
    fs.copyFileSync(this.filePath, backupPath, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(backupPath, 0o600); } catch (_) {}
    return backupPath;
  }

  _writeAtomic(value) {
    this._ensureBaseDirectory();
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('关系白板配置超过 2 MB 安全限制');
    }
    const temporaryPath = path.join(
      this.baseDirectory,
      `.${FILE_NAME}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    let handle = null;
    try {
      handle = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(handle, serialized, 'utf8');
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      fs.renameSync(temporaryPath, this.filePath);
      try {
        const directoryHandle = fs.openSync(this.baseDirectory, 'r');
        try { fs.fsyncSync(directoryHandle); } finally { fs.closeSync(directoryHandle); }
      } catch (_) {}
    } finally {
      if (handle !== null) {
        try { fs.closeSync(handle); } catch (_) {}
      }
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }

  load() {
    this._ensureBaseDirectory();
    if (!fs.existsSync(this.filePath)) {
      const initial = RelationshipGraphModel.defaultStore();
      this._writeAtomic(initial);
      return { store: initial, recovered: false, backupPath: null, repairs: [] };
    }

    this._assertReadableFile();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Number(parsed?.schemaVersion) !== RelationshipGraphModel.VERSION) {
        throw new Error(`暂不支持白板数据版本：${parsed?.schemaVersion ?? '未知'}`);
      }
    } catch (error) {
      const backupPath = this._backupCorruptFile();
      const initial = RelationshipGraphModel.defaultStore();
      this._writeAtomic(initial);
      return {
        store: initial,
        recovered: true,
        backupPath,
        repairs: [error?.message || String(error)]
      };
    }

    const normalized = RelationshipGraphModel.normalizeStore(parsed);
    let backupPath = null;
    if (normalized.issues.length) {
      backupPath = this._backupCorruptFile();
      this._writeAtomic(normalized.value);
    }
    return {
      store: normalized.value,
      recovered: normalized.issues.length > 0,
      backupPath,
      repairs: normalized.issues
    };
  }

  save(rawStore) {
    const store = RelationshipGraphModel.assertValidStore(rawStore);
    this._writeAtomic(store);
    return { store, saved: true };
  }

  createImportBackup() {
    this._ensureBaseDirectory();
    if (!fs.existsSync(this.filePath)) this._writeAtomic(RelationshipGraphModel.defaultStore());
    this._assertReadableFile();
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const suffix = crypto.randomBytes(4).toString('hex');
    const backupPath = path.join(this.baseDirectory, `relationship-boards.import-backup-${stamp}-${suffix}.json`);
    fs.copyFileSync(this.filePath, backupPath, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(backupPath, 0o600); } catch (_) {}
    return backupPath;
  }
}

let defaultService = null;

function getDefaultService() {
  if (!defaultService) defaultService = new RelationshipBoardService();
  return defaultService;
}

module.exports = {
  load: () => getDefaultService().load(),
  save: rawStore => getDefaultService().save(rawStore),
  createImportBackup: () => getDefaultService().createImportBackup()
};
module.exports.RelationshipBoardService = RelationshipBoardService;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
module.exports.FILE_NAME = FILE_NAME;
module.exports.resolveDefaultBaseDirectory = resolveDefaultBaseDirectory;
