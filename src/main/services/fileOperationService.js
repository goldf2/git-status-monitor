const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const configService = require('./configService');
const BatchRename = require('../../shared/batchRename');

const MAX_IMPORT_ITEMS = 100;
const IMPORT_OPERATION_ID_PATTERN = /^import_[0-9]{10,16}_[a-f0-9-]{8,36}$/;
const TRANSFER_OPERATION_ID_PATTERN = /^transfer_[0-9]{10,16}_[a-f0-9-]{8,36}$/;
const TRANSFER_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_COPY_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFER_STATUS_ITEMS = 30;
const MAX_TRANSFER_JOURNAL_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_RENAME_ITEMS = 200;
const MAX_BATCH_RENAME_JOURNAL_BYTES = 1024 * 1024;
const BATCH_RENAME_OPERATION_ID_PATTERN = /^batchrename_[0-9]{10,16}_[a-f0-9-]{8,36}$/;
const TRANSFER_CONFLICT_POLICIES = new Set(['keep-both', 'skip', 'replace']);

class TransferCancelledError extends Error {
  constructor() {
    super('文件传输已取消；来源保持不变');
    this.code = 'TRANSFER_CANCELLED';
  }
}

class TransferNeedsReviewError extends Error {
  constructor(message) {
    super(message);
    this.code = 'TRANSFER_NEEDS_REVIEW';
  }
}

class FileOperationService {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.configService = options.configService || configService;
    this.historyDir = options.historyDir || this._defaultHistoryDir();
    this.historyFile = path.join(this.historyDir, 'file-operations.json');
    this.transferJournalFile = path.join(this.historyDir, 'active-file-transfer.json');
    this.batchRenameJournalFile = path.join(this.historyDir, 'active-batch-rename.json');
    this.trashDirOverride = options.trashDir ? path.resolve(options.trashDir) : null;
    this.trashDir = this.trashDirOverride || path.join(os.homedir(), '.Trash');
    this.trashDirectoryForSource = typeof options.trashDirectoryForSource === 'function'
      ? options.trashDirectoryForSource
      : sourcePath => this._defaultTrashDirectoryForSource(sourcePath);
    this.history = null;
    this.deviceForPath = options.deviceForPath || ((candidatePath, stat) => (stat || fs.statSync(candidatePath)).dev);
    this.statfs = options.statfs || (candidatePath => fs.promises.statfs(candidatePath));
    this.spaceReserveBytes = Number.isFinite(options.spaceReserveBytes)
      ? Math.max(0, Number(options.spaceReserveBytes))
      : DEFAULT_SPACE_RESERVE_BYTES;
    this.copyChunkBytes = Math.max(1024, Math.min(Number(options.copyChunkBytes) || DEFAULT_COPY_CHUNK_BYTES, 16 * 1024 * 1024));
    this.onTransferProgress = typeof options.onTransferProgress === 'function' ? options.onTransferProgress : null;
    this.hooks = options.hooks && typeof options.hooks === 'object' ? options.hooks : {};
    this.systemTrashItem = typeof options.systemTrashItem === 'function'
      ? options.systemTrashItem
      : async candidatePath => {
        const electron = require('electron');
        if (typeof electron?.shell?.trashItem !== 'function') throw new Error('Windows 系统回收站不可用');
        await electron.shell.trashItem(candidatePath);
      };
    this.activeTransfers = new Map();
    this.activeBatchRenames = new Set();
    this.recoveryStatus = null;
  }

  _defaultHistoryDir() {
    try {
      return require('electron').app.getPath('userData');
    } catch (_) {
      return path.join(os.homedir(), '.gitfinder');
    }
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _pathKey(candidatePath) {
    const resolved = path.resolve(candidatePath);
    return this.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  }

  _reservedTargetHas(reservedTargets, candidatePath) {
    const key = this._pathKey(candidatePath);
    return [...reservedTargets].some(item => this._pathKey(item) === key);
  }

  _managedRoots() {
    return (this.configService.getTreeRoots() || []).map(root => path.resolve(root.path));
  }

  _assertNotProtected(candidatePath) {
    const resolved = path.resolve(candidatePath);
    const protectedPaths = this.platform === 'win32'
      ? [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
      : ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/private/var/db', '/private/var/root', '/private/var/vm'];
    if (protectedPaths.some(protectedPath => this._pathIsWithin(resolved, protectedPath))) {
      throw new Error(`系统保护路径不可操作：${resolved}`);
    }
  }

  _assertManagedPath(candidatePath, { allowRoot = false } = {}) {
    const resolved = path.resolve(String(candidatePath || ''));
    this._assertNotProtected(resolved);
    const roots = this._managedRoots();
    const containingRoot = roots.find(root => this._pathIsWithin(resolved, root));
    if (!containingRoot) throw new Error(`路径不在受管开发目录中：${resolved}`);
    if (!allowRoot && roots.some(root => this._pathIsWithin(root, resolved))) {
      throw new Error('不能直接操作受管根目录或包含它的目录');
    }
    return resolved;
  }

  _assertExistingSource(sourcePath) {
    const source = this._assertManagedPath(sourcePath);
    if (!fs.existsSync(source)) throw new Error(`源路径不存在：${source}`);
    return source;
  }

  _assertDirectory(directoryPath) {
    const directory = this._assertManagedPath(directoryPath, { allowRoot: true });
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error(`目标文件夹不存在：${directory}`);
    }
    const realDirectory = fs.realpathSync.native(directory);
    const realRoots = this._managedRoots().map(root => {
      try { return fs.realpathSync.native(root); } catch (_) { return null; }
    }).filter(Boolean);
    if (!realRoots.some(root => this._pathIsWithin(realDirectory, root))) {
      throw new Error(`目标文件夹通过符号链接离开受管开发目录：${directory}`);
    }
    return directory;
  }

  _assertName(name) {
    const raw = String(name || '');
    const value = raw.trim();
    if (!value || value === '.' || value === '..' || value.includes('\0') || value.includes('/') || value.includes(path.sep)) {
      throw new Error('名称无效');
    }
    const nameLength = this.platform === 'win32' ? value.length : Buffer.byteLength(value, 'utf8');
    if (nameLength > 255) throw new Error('名称超过文件系统限制');
    if (this.platform === 'win32') {
      const baseName = value.split('.')[0].toUpperCase();
      const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;
      if (raw !== value || /[<>:"/\\|?*]/.test(value) || /[. ]$/.test(raw) || reserved.test(baseName)) {
        throw new Error('Windows 文件名无效或使用了系统保留名称');
      }
    }
    return value;
  }

  _sameFile(left, right) {
    try {
      const a = fs.statSync(left);
      const b = fs.statSync(right);
      return a.dev === b.dev && a.ino === b.ino;
    } catch (_) {
      return false;
    }
  }

  _assertTargetAvailable(source, target) {
    if (path.resolve(source) === path.resolve(target)) throw new Error('源路径和目标路径相同');
    if (this._pathIsWithin(target, source)) throw new Error('不能把文件夹移动到自身内部');
    if (fs.existsSync(target) && !this._sameFile(source, target)) throw new Error(`目标已存在：${target}`);
  }

  _normalizeSources(sourcePaths) {
    const sourceMap = new Map();
    for (const sourcePath of sourcePaths || []) {
      const source = this._assertExistingSource(sourcePath);
      if (!sourceMap.has(this._pathKey(source))) sourceMap.set(this._pathKey(source), source);
    }
    const sources = [...sourceMap.values()];
    if (sources.length === 0) throw new Error('请先选择文件或文件夹');
    sources.sort((a, b) => a.length - b.length);
    return sources.filter((source, index) => !sources.slice(0, index).some(parent => this._pathIsWithin(source, parent)));
  }

  _normalizeImportSources(sourcePaths) {
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
      throw new Error('没有可导入的文件或文件夹');
    }
    if (sourcePaths.length > MAX_IMPORT_ITEMS) {
      throw new Error(`一次最多导入 ${MAX_IMPORT_ITEMS} 项`);
    }

    const seen = new Set();
    const sources = [];
    for (const candidate of sourcePaths) {
      if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
        throw new Error('导入来源必须是本机绝对路径');
      }
      const source = path.resolve(candidate);
      if (source === path.parse(source).root) throw new Error('不能导入整个磁盘根目录');
      this._assertNotProtected(source);
      if (!fs.existsSync(source)) throw new Error(`导入来源不存在：${source}`);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error(`不能直接导入符号链接：${source}`);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error(`只支持导入普通文件或文件夹：${source}`);
      const realSource = fs.realpathSync.native(source);
      this._assertNotProtected(realSource);
      const realSourceKey = this._pathKey(realSource);
      if (seen.has(realSourceKey)) continue;
      seen.add(realSourceKey);
      sources.push(source);
    }

    sources.sort((left, right) => left.length - right.length);
    return sources.filter((source, index) => !sources.slice(0, index).some(parent => this._pathIsWithin(source, parent)));
  }

  _loadHistory() {
    if (this.history) return this.history;
    fs.mkdirSync(this.historyDir, { recursive: true });
    if (!fs.existsSync(this.historyFile)) {
      this.history = { version: 1, operations: [] };
      return this.history;
    }
    try {
      this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      if (!Array.isArray(this.history.operations)) throw new Error('invalid history');
    } catch (_) {
      const backup = `${this.historyFile}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.historyFile, backup);
      this.history = { version: 1, operations: [] };
      this._saveHistory();
    }
    return this.history;
  }

  _saveHistory() {
    fs.mkdirSync(this.historyDir, { recursive: true });
    const tempPath = `${this.historyFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.history, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, this.historyFile);
  }

  _record(type, items, extra = {}) {
    const operation = {
      id: `op_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      type,
      items,
      createdAt: Date.now(),
      undoable: true,
      undoneAt: null,
      ...extra
    };
    const previousHistory = this._loadHistory();
    const invalidatedAt = Date.now();
    const previousOperations = previousHistory.operations.map(item => (
      item.undoable && item.undoneAt && !item.redoInvalidatedAt
        ? { ...item, redoInvalidatedAt: invalidatedAt }
        : item
    ));
    const nextHistory = {
      ...previousHistory,
      operations: [operation, ...previousOperations].slice(0, 200)
    };
    this.history = nextHistory;
    try {
      this._saveHistory();
    } catch (error) {
      this.history = previousHistory;
      throw error;
    }
    return operation;
  }

  getHistory(limit = 50) {
    this.getRecoveryStatus();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    return this._loadHistory().operations.slice(0, safeLimit);
  }

  _normalizeTransferOperationId(operationId, operationType) {
    const value = String(operationId || '');
    const pattern = operationType === 'import' ? IMPORT_OPERATION_ID_PATTERN : TRANSFER_OPERATION_ID_PATTERN;
    if (!pattern.test(value)) throw new Error('文件传输操作标识无效');
    return value;
  }

  _createTransferOperationId(operationType) {
    const prefix = operationType === 'import' ? 'import' : 'transfer';
    return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 12)}`;
  }

  _normalizeConflictPolicy(conflictPolicy) {
    const value = String(conflictPolicy || 'keep-both');
    if (!TRANSFER_CONFLICT_POLICIES.has(value)) throw new Error('文件冲突处理策略无效');
    return value;
  }

  _volumeName(candidatePath) {
    const resolved = path.resolve(candidatePath);
    if (process.platform === 'darwin' && resolved.startsWith(`${path.sep}Volumes${path.sep}`)) {
      return resolved.split(path.sep).filter(Boolean)[1] || path.parse(resolved).root;
    }
    return path.parse(resolved).root;
  }

  _defaultTrashDirectoryForSource(sourcePath) {
    if (this.trashDirOverride) return this.trashDirOverride;
    const resolved = path.resolve(sourcePath);
    if (process.platform === 'darwin' && resolved.startsWith(`${path.sep}Volumes${path.sep}`)) {
      const volumeName = resolved.split(path.sep).filter(Boolean)[1];
      if (volumeName) return path.join(path.sep, 'Volumes', volumeName, '.Trashes', String(process.getuid()));
    }
    return this.trashDir;
  }

  _trashDirectoryForExistingSource(sourcePath) {
    const source = path.resolve(sourcePath);
    const configured = String(this.trashDirectoryForSource(source) || '').trim();
    if (!configured || !path.isAbsolute(configured)) throw new Error('无法确定来源卷的废纸篓目录');
    const candidate = path.resolve(configured);
    if (candidate === path.parse(candidate).root) throw new Error('无法确定来源卷的废纸篓目录');
    fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
    const trashStat = fs.lstatSync(candidate);
    if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) {
      throw new Error(`废纸篓路径不是安全的真实目录：${candidate}`);
    }
    const sourceStat = fs.lstatSync(source);
    const sourceDevice = this.deviceForPath(source, sourceStat);
    const trashDevice = this.deviceForPath(candidate, trashStat);
    if (sourceDevice !== trashDevice) {
      throw new Error(`来源卷的废纸篓不可用，未移动任何内容：${source}`);
    }
    return candidate;
  }

  async _availableBytes(directoryPath) {
    const stats = await this.statfs(directoryPath);
    const blocks = Number(stats?.bavail ?? stats?.bfree ?? 0);
    const blockSize = Number(stats?.bsize ?? stats?.frsize ?? 0);
    if (!Number.isFinite(blocks) || !Number.isFinite(blockSize) || blocks < 0 || blockSize <= 0) {
      throw new Error('无法读取目标卷可用空间');
    }
    const available = blocks * blockSize;
    return Number.isSafeInteger(available) ? available : Number.MAX_SAFE_INTEGER;
  }

  async _summarizePath(sourcePath) {
    const revisionHash = crypto.createHash('sha256');
    const contentHash = crypto.createHash('sha256');
    let totalBytes = 0;
    let fileCount = 0;
    let directoryCount = 0;
    let symlinkCount = 0;
    let projectManifestCount = 0;
    let gitMetadataCount = 0;
    let rootStat = null;

    const visit = async (currentPath, relativePath) => {
      const stat = await fs.promises.lstat(currentPath);
      if (!rootStat) rootStat = stat;
      const type = stat.isDirectory() ? 'directory' : (stat.isFile() ? 'file' : (stat.isSymbolicLink() ? 'symlink' : 'other'));
      if (type === 'other') throw new Error(`不支持传输此文件类型：${currentPath}`);
      const linkTarget = type === 'symlink' ? await fs.promises.readlink(currentPath) : '';
      const size = type === 'file' ? stat.size : 0;
      const stableRecord = JSON.stringify([
        relativePath,
        type,
        size,
        type === 'symlink' ? linkTarget : ''
      ]);
      const revisionRecord = JSON.stringify([
        stableRecord,
        stat.dev,
        stat.ino,
        stat.mode,
        stat.size,
        Number(stat.mtimeMs).toFixed(3)
      ]);
      contentHash.update(stableRecord);
      revisionHash.update(revisionRecord);
      const portableRelative = String(relativePath || '').split(path.sep).join('/');
      if (portableRelative === '.gitfinder/project.json' || portableRelative.endsWith('/.gitfinder/project.json')) {
        projectManifestCount += 1;
      }
      if (path.posix.basename(portableRelative) === '.git') gitMetadataCount += 1;

      if (type === 'file') {
        totalBytes += stat.size;
        fileCount += 1;
        return;
      }
      if (type === 'symlink') {
        symlinkCount += 1;
        return;
      }

      directoryCount += 1;
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
        await visit(path.join(currentPath, entry.name), childRelative);
      }
    };

    await visit(sourcePath, '');
    return {
      totalBytes,
      fileCount,
      directoryCount,
      symlinkCount,
      projectManifestCount,
      gitMetadataCount,
      contentFingerprint: contentHash.digest('hex'),
      revisionFingerprint: revisionHash.digest('hex'),
      identity: {
        dev: rootStat.dev,
        ino: rootStat.ino,
        size: rootStat.size,
        mtimeMs: rootStat.mtimeMs,
        mode: rootStat.mode
      }
    };
  }

  _transferPreviewToken(preview) {
    return crypto.createHash('sha256').update(JSON.stringify({
      version: preview.version,
      operationId: preview.operationId,
      operationType: preview.operationType,
      mode: preview.mode,
      conflictPolicy: preview.conflictPolicy,
      destination: preview.destination,
      destinationIdentity: preview.destinationIdentity,
      items: preview.items.map(item => ({
        source: item.source,
        target: item.target,
        transferKind: item.transferKind,
        conflictAction: item.conflictAction,
        hadConflict: item.hadConflict,
        skipped: item.skipped,
        sourceDevice: item.sourceDevice,
        destinationDevice: item.destinationDevice,
        revisionFingerprint: item.revisionFingerprint,
        contentFingerprint: item.contentFingerprint,
        targetRevisionFingerprint: item.targetRevisionFingerprint || null,
        totalBytes: item.totalBytes,
        fileCount: item.fileCount,
        directoryCount: item.directoryCount,
        symlinkCount: item.symlinkCount,
        structureRisks: item.structureRisks
      }))
    })).digest('hex');
  }

  async _buildTransferPreview(sourcePaths, destinationDirectory, operationType, operationId, options = {}) {
    if (!['copy', 'move', 'import'].includes(operationType)) throw new Error('文件传输模式无效');
    const conflictPolicy = this._normalizeConflictPolicy(options.conflictPolicy);
    const destination = this._assertDirectory(destinationDirectory);
    const sources = operationType === 'import'
      ? this._normalizeImportSources(sourcePaths)
      : this._normalizeSources(sourcePaths);
    const destinationStat = await fs.promises.stat(destination);
    const destinationDevice = this.deviceForPath(destination, destinationStat);
    const reservedTargets = new Set();
    const items = [];

    for (const source of sources) {
      const sourceStat = await fs.promises.lstat(source);
      if (sourceStat.isDirectory() && this._pathIsWithin(destination, source)) {
        throw new Error(`不能把文件夹${operationType === 'move' ? '移动' : '复制'}到自身内部`);
      }
      const initialTarget = path.join(destination, path.basename(source));
      const targetExists = fs.existsSync(initialTarget);
      const sameSource = targetExists && this._sameFile(source, initialTarget);
      const reservedConflict = this._reservedTargetHas(reservedTargets, initialTarget);
      const hadConflict = targetExists || reservedConflict;
      const effectivePolicy = sameSource || reservedConflict ? 'keep-both' : conflictPolicy;
      let target = initialTarget;
      let conflictAction = null;
      let skipped = false;
      let targetSummary = null;

      if (hadConflict) {
        conflictAction = effectivePolicy;
        if (effectivePolicy === 'keep-both') {
          target = this._uniqueCopyTarget(source, destination, reservedTargets);
        } else if (effectivePolicy === 'skip') {
          skipped = true;
        } else {
          targetSummary = await this._summarizePath(initialTarget);
        }
      }
      reservedTargets.add(target);

      const summary = await this._summarizePath(source);
      const sourceDevice = this.deviceForPath(source, sourceStat);
      const transferKind = skipped
        ? 'skip'
        : operationType === 'move'
        ? (sourceDevice === destinationDevice ? 'atomic-move' : 'copy-delete')
        : 'copy';
      const structureRisks = [];
      if (operationType === 'move') {
        if (path.basename(source) === '.gitfinder') {
          structureRisks.push('正在移动 .gitfinder 项目身份配置目录');
        } else if (summary.projectManifestCount > 0) {
          structureRisks.push(`包含 ${summary.projectManifestCount} 个项目身份配置`);
        }
        if (path.basename(source) === '.git') {
          structureRisks.push('正在移动 .git 仓库元数据目录');
        } else if (summary.gitMetadataCount > 0) {
          structureRisks.push(`包含 ${summary.gitMetadataCount} 个 Git 仓库结构`);
        }
      }
      items.push({
        source,
        sourceName: path.basename(source),
        sourceParent: path.dirname(source),
        target,
        targetName: path.basename(target),
        type: sourceStat.isDirectory() ? 'directory' : (sourceStat.isSymbolicLink() ? 'symlink' : 'file'),
        size: sourceStat.isFile() ? sourceStat.size : null,
        renamedForConflict: path.basename(target) !== path.basename(source),
        originalTarget: initialTarget,
        hadConflict,
        conflictAction,
        skipped,
        targetRevisionFingerprint: targetSummary?.revisionFingerprint || null,
        targetIdentity: targetSummary?.identity || null,
        structureRisks,
        sourceIdentity: summary.identity,
        sourceDevice,
        destinationDevice,
        transferKind,
        ...summary
      });
    }

    const totalBytes = items.reduce((total, item) => total + item.totalBytes, 0);
    const requiredBytes = items
      .filter(item => item.transferKind !== 'atomic-move' && item.transferKind !== 'skip')
      .reduce((total, item) => total + item.totalBytes, 0);
    const availableBytes = requiredBytes > 0 ? await this._availableBytes(destination) : null;
    const reserveBytes = requiredBytes > 0 ? this.spaceReserveBytes : 0;
    const spaceSufficient = requiredBytes === 0 || availableBytes >= requiredBytes + reserveBytes;
    const executionMode = operationType === 'import' ? 'copy' : operationType;
    const preview = {
      version: 2,
      operationId: this._normalizeTransferOperationId(operationId, operationType),
      operationType,
      mode: executionMode,
      conflictPolicy,
      overwrite: items.some(item => item.conflictAction === 'replace'),
      destination,
      destinationName: path.basename(destination) || destination,
      destinationVolumeName: this._volumeName(destination),
      destinationIdentity: {
        dev: destinationStat.dev,
        ino: destinationStat.ino,
        mtimeMs: destinationStat.mtimeMs,
        device: destinationDevice
      },
      itemCount: items.length,
      fileCount: items.reduce((total, item) => total + item.fileCount, 0),
      directoryCount: items.reduce((total, item) => total + item.directoryCount, 0),
      symlinkCount: items.reduce((total, item) => total + item.symlinkCount, 0),
      keepBothCount: items.filter(item => item.conflictAction === 'keep-both').length,
      replaceCount: items.filter(item => item.conflictAction === 'replace').length,
      skipCount: items.filter(item => item.skipped).length,
      actionableItemCount: items.filter(item => !item.skipped).length,
      conflictCount: items.filter(item => item.hadConflict).length,
      structureRiskCount: items.filter(item => !item.skipped).reduce((total, item) => total + item.structureRisks.length, 0),
      sameVolumeCount: items.filter(item => item.transferKind === 'atomic-move').length,
      crossVolumeCount: items.filter(item => item.transferKind === 'copy-delete').length,
      totalBytes,
      totalFileBytes: totalBytes,
      requiredBytes,
      availableBytes,
      reserveBytes,
      spaceSufficient,
      items
    };
    preview.requiresStructureRiskAcknowledgement = preview.structureRiskCount > 0;
    preview.validations = [
      { key: 'destination', passed: true, message: '目标位于真实受管开发目录内' },
      { key: 'sources', passed: true, message: `${items.length} 个来源已完成递归只读检查` },
      {
        key: 'structure-risk',
        passed: true,
        message: preview.structureRiskCount > 0
          ? `检测到 ${preview.structureRiskCount} 项项目或 Git 结构风险，执行前必须显式确认`
          : '未检测到项目身份或 Git 结构移动风险'
      },
      {
        key: 'mode',
        passed: true,
        message: operationType === 'move'
          ? (preview.crossVolumeCount > 0 ? '跨卷项目会先复制并校验，再删除来源' : '同卷项目使用原子移动')
          : '复制不会修改来源'
      },
      {
        key: 'conflicts',
        passed: true,
        message: preview.replaceCount > 0
          ? `${preview.replaceCount} 个冲突项会先备份旧目标，再事务性替换`
          : (preview.skipCount > 0
            ? `${preview.skipCount} 个冲突项会跳过，不修改来源和目标`
            : '最终目标使用独占提交，不覆盖现有内容')
      },
      {
        key: 'space',
        passed: spaceSufficient,
        message: requiredBytes === 0
          ? '原子移动无需复制空间'
          : (spaceSufficient ? '目标卷可用空间满足本次传输' : '目标卷可用空间不足')
      }
    ];
    preview.canApply = preview.validations.every(validation => validation.passed);
    preview.previewToken = this._transferPreviewToken(preview);
    return preview;
  }

  _publicTransferStatus(status) {
    if (!status) return null;
    return JSON.parse(JSON.stringify({
      operationId: status.operationId,
      operationType: status.operationType,
      mode: status.mode,
      state: status.state,
      phase: status.phase,
      cancellable: status.cancellable,
      cancelRequested: status.cancelRequested,
      bytesTotal: status.bytesTotal,
      bytesTransferred: status.bytesTransferred,
      progress: status.progress,
      itemCount: status.itemCount,
      itemsPrepared: status.itemsPrepared,
      itemsCommitted: status.itemsCommitted,
      currentSource: status.currentSource,
      currentTarget: status.currentTarget,
      startedAt: status.startedAt,
      updatedAt: status.updatedAt,
      completedAt: status.completedAt,
      error: status.error,
      result: status.result
    }));
  }

  _updateTransferStatus(status, changes = {}) {
    Object.assign(status, changes, { updatedAt: Date.now() });
    status.progress = status.bytesTotal > 0
      ? Math.max(0, Math.min(100, Math.round((status.bytesTransferred / status.bytesTotal) * 100)))
      : (status.state === 'completed' ? 100 : 0);
    if (this.onTransferProgress) {
      try { this.onTransferProgress(this._publicTransferStatus(status)); } catch (_) {}
    }
    return status;
  }

  _createTransferStatus(preview) {
    const status = {
      operationId: preview.operationId,
      operationType: preview.operationType,
      mode: preview.mode,
      state: 'running',
      phase: 'preparing',
      cancellable: true,
      cancelRequested: false,
      bytesTotal: preview.requiredBytes * 2,
      bytesTransferred: 0,
      progress: preview.requiredBytes > 0 ? 0 : 100,
      itemCount: preview.itemCount,
      itemsPrepared: 0,
      itemsCommitted: 0,
      currentSource: '',
      currentTarget: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      error: null,
      result: null
    };
    this.activeTransfers.set(preview.operationId, status);
    while (this.activeTransfers.size > MAX_TRANSFER_STATUS_ITEMS) {
      const firstKey = this.activeTransfers.keys().next().value;
      if (!firstKey || firstKey === preview.operationId) break;
      this.activeTransfers.delete(firstKey);
    }
    this._updateTransferStatus(status);
    return status;
  }

  getTransferStatus(operationId) {
    return this._publicTransferStatus(this.activeTransfers.get(String(operationId || '')));
  }

  cancelTransfer(operationId) {
    const status = this.activeTransfers.get(String(operationId || ''));
    if (!status) throw new Error('找不到正在执行的文件传输');
    if (status.state !== 'running') return { ...this._publicTransferStatus(status), cancelAccepted: false };
    if (!status.cancellable) return { ...this._publicTransferStatus(status), cancelAccepted: false };
    this._updateTransferStatus(status, { cancelRequested: true });
    return { ...this._publicTransferStatus(status), cancelAccepted: true };
  }

  _throwIfTransferCancelled(status) {
    if (status.cancelRequested && status.cancellable) throw new TransferCancelledError();
  }

  _normalizeBatchRenameOperationId(operationId) {
    const value = String(operationId || '');
    if (!BATCH_RENAME_OPERATION_ID_PATTERN.test(value)) throw new Error('批量重命名操作标识无效');
    return value;
  }

  _createBatchRenameOperationId() {
    return `batchrename_${Date.now()}_${crypto.randomUUID().slice(0, 12)}`;
  }

  _writeBatchRenameJournal(journal) {
    fs.mkdirSync(this.historyDir, { recursive: true });
    const tempPath = `${this.batchRenameJournalFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, this.batchRenameJournalFile);
    this.recoveryStatus = null;
  }

  _readBatchRenameJournal() {
    if (!fs.existsSync(this.batchRenameJournalFile)) return null;
    try {
      const stat = fs.lstatSync(this.batchRenameJournalFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BATCH_RENAME_JOURNAL_BYTES) {
        throw new Error('invalid journal');
      }
      const journal = JSON.parse(fs.readFileSync(this.batchRenameJournalFile, 'utf8'));
      if (journal?.version !== 1 || journal.operationType !== 'rename') throw new Error('invalid journal');
      this._normalizeBatchRenameOperationId(journal.operationId);
      if (!Array.isArray(journal.items) || journal.items.length < 1 || journal.items.length > MAX_BATCH_RENAME_ITEMS) {
        throw new Error('invalid journal');
      }
      if (journal.previewToken && !TRANSFER_TOKEN_PATTERN.test(String(journal.previewToken))) throw new Error('invalid journal');
      if (journal.items.some(item => !item?.source || !item?.target || !item?.staging)) throw new Error('invalid journal');
      return journal;
    } catch (error) {
      return { version: 1, invalid: true, error: error.message || '批量重命名恢复记录损坏', items: [] };
    }
  }

  _clearBatchRenameJournal(operationId) {
    const journal = this._readBatchRenameJournal();
    if (!journal || (operationId && journal.operationId !== operationId)) return;
    fs.rmSync(this.batchRenameJournalFile, { force: true });
    this.recoveryStatus = null;
  }

  _safeBatchRenameJournalItem(item) {
    try {
      const source = this._assertManagedPath(item.source);
      const target = this._assertManagedPath(item.target);
      const staging = this._assertManagedPath(item.staging);
      return path.dirname(source) === path.dirname(target)
        && path.dirname(source) === path.dirname(staging)
        && path.basename(staging).startsWith('.gitfinder-rename-');
    } catch (_) {
      return false;
    }
  }

  async _rollbackBatchRenameItems(items) {
    const failures = [];
    for (const item of [...items].reverse()) {
      if (!fs.existsSync(item.target)) continue;
      if (fs.existsSync(item.staging)) {
        failures.push({ item, error: new Error('回滚临时路径已被占用') });
        continue;
      }
      try {
        await fs.promises.rename(item.target, item.staging);
        item.state = 'staged';
      } catch (error) {
        failures.push({ item, error });
      }
    }
    for (const item of [...items].reverse()) {
      if (!fs.existsSync(item.staging)) continue;
      if (fs.existsSync(item.source)) {
        failures.push({ item, error: new Error('原路径已被占用') });
        continue;
      }
      try {
        await fs.promises.rename(item.staging, item.source);
        item.state = 'source';
      } catch (error) {
        failures.push({ item, error });
      }
    }
    return failures;
  }

  _recoverBatchRenameJournal(result) {
    const journal = this._readBatchRenameJournal();
    if (!journal) return result;
    result.interruptedBatchRenameId = journal.operationId || null;
    if (journal.invalid) {
      result.needsReview.push({ reason: '批量重命名恢复记录损坏，未自动移动任何文件' });
      return result;
    }
    if (this.activeBatchRenames.has(journal.operationId)) {
      result.activeBatchRename = true;
      return result;
    }
    if (journal.items.some(item => !this._safeBatchRenameJournalItem(item))) {
      result.needsReview.push({ reason: '批量重命名恢复路径未通过安全校验' });
      return result;
    }
    const recorded = this._loadHistory().operations.find(operation => operation.id === journal.operationId);
    if (recorded) {
      if (recorded.type !== 'rename') {
        result.needsReview.push({ reason: '批量重命名恢复记录与操作历史不一致' });
      } else {
        fs.rmSync(this.batchRenameJournalFile, { force: true });
        result.completedOperationId = recorded.id;
        result.recoveredAction = 'finalized-recorded-batch-rename';
      }
      return result;
    }

    const states = journal.items.map(item => ({
      item,
      source: fs.existsSync(item.source),
      staging: fs.existsSync(item.staging),
      target: fs.existsSync(item.target)
    }));
    if (states.some(state => Number(state.source) + Number(state.staging) + Number(state.target) !== 1)) {
      result.needsReview.push({ reason: '批量重命名存在缺失或重复路径，已保留现场' });
      return result;
    }
    const completed = states.every(state => state.target);
    if (completed) {
      try {
        const mappings = journal.items.map(item => ({ from: item.source, to: item.target }));
        this.configService.validateRebindPaths(mappings);
        this.configService.rebindPaths(mappings);
        const operation = this._record('rename', journal.items.map(item => ({ source: item.source, target: item.target })), {
          id: journal.operationId,
          previewToken: journal.previewToken || null,
          batch: true,
          recoveredAt: Date.now()
        });
        fs.rmSync(this.batchRenameJournalFile, { force: true });
        result.completedOperationId = operation.id;
        result.recoveredAction = 'completed-committed-batch-rename';
      } catch (error) {
        result.needsReview.push({ reason: `已完成的批量重命名无法补齐配置或历史：${error.message || String(error)}` });
      }
      return result;
    }

    try {
      for (const state of states.filter(value => value.target).reverse()) {
        fs.renameSync(state.item.target, state.item.staging);
      }
      for (const state of states.filter(value => value.staging || value.target).reverse()) {
        if (fs.existsSync(state.item.staging)) fs.renameSync(state.item.staging, state.item.source);
      }
      fs.rmSync(this.batchRenameJournalFile, { force: true });
      result.recoveredAction = 'rolled-back-interrupted-batch-rename';
    } catch (error) {
      result.needsReview.push({ reason: `中断的批量重命名未能完整回滚：${error.message || String(error)}` });
    }
    return result;
  }

  _writeTransferJournal(journal) {
    fs.mkdirSync(this.historyDir, { recursive: true });
    const tempPath = `${this.transferJournalFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, this.transferJournalFile);
    this.recoveryStatus = null;
  }

  _readTransferJournal() {
    if (!fs.existsSync(this.transferJournalFile)) return null;
    try {
      const journalStat = fs.lstatSync(this.transferJournalFile);
      if (!journalStat.isFile() || journalStat.isSymbolicLink() || journalStat.size > MAX_TRANSFER_JOURNAL_BYTES) {
        throw new Error('invalid journal');
      }
      const journal = JSON.parse(fs.readFileSync(this.transferJournalFile, 'utf8'));
      if (journal?.version !== 1 || !['copy', 'move', 'import'].includes(journal.operationType)) throw new Error('invalid journal');
      this._normalizeTransferOperationId(journal.operationId, journal.operationType);
      if (!journal.destination || !Array.isArray(journal.items) || journal.items.length === 0 || journal.items.length > MAX_IMPORT_ITEMS) {
        throw new Error('invalid journal');
      }
      if (journal.previewToken && !TRANSFER_TOKEN_PATTERN.test(String(journal.previewToken))) throw new Error('invalid journal');
      if (journal.items.some(item => !item?.source || !item?.target || !item?.staging || !item?.transferKind)) {
        throw new Error('invalid journal');
      }
      return journal;
    } catch (error) {
      return { version: 1, invalid: true, error: error.message || '传输恢复记录损坏', items: [] };
    }
  }

  _clearTransferJournal(operationId) {
    const journal = this._readTransferJournal();
    if (!journal || (operationId && journal.operationId !== operationId)) return;
    fs.rmSync(this.transferJournalFile, { force: true });
    this.recoveryStatus = null;
  }

  _safeJournalItem(journal, item) {
    try {
      const destination = this._assertDirectory(journal.destination);
      const target = this._assertManagedPath(item.target);
      const staging = this._assertManagedPath(item.staging);
      const replacementBackup = item.replacementBackup
        ? this._assertManagedPath(item.replacementBackup)
        : null;
      if (journal.operationType !== 'import') this._assertManagedPath(item.source);
      return path.dirname(target) === destination
        && path.dirname(staging) === destination
        && path.basename(staging).startsWith('.gitfinder-partial-')
        && (!replacementBackup
          || (path.dirname(replacementBackup) === destination
            && path.basename(replacementBackup).startsWith('.gitfinder-replaced-')));
    } catch (_) {
      return false;
    }
  }

  getRecoveryStatus() {
    if (this.recoveryStatus) return JSON.parse(JSON.stringify(this.recoveryStatus));
    const journal = this._readTransferJournal();
    const result = {
      checkedAt: Date.now(),
      interruptedOperationId: journal?.operationId || null,
      cleanedStagingPaths: [],
      completedOperationId: null,
      recoveredAction: null,
      configRebound: false,
      needsReview: []
    };
    this._recoverBatchRenameJournal(result);
    if (!journal) {
      if (!result.activeBatchRename) this.recoveryStatus = result;
      return JSON.parse(JSON.stringify(result));
    }
    if (this.activeTransfers.get(journal.operationId)?.state === 'running') {
      result.active = true;
      return JSON.parse(JSON.stringify(result));
    }
    if (journal.invalid) {
      result.needsReview.push({ reason: '传输恢复记录损坏，未自动删除任何文件' });
      this.recoveryStatus = result;
      return JSON.parse(JSON.stringify(result));
    }

    const recordedOperation = this._loadHistory().operations.find(operation => operation.id === journal.operationId);
    if (recordedOperation) {
      if (recordedOperation.type !== journal.operationType) {
        result.needsReview.push({ reason: '传输恢复记录与操作历史类型不一致，已原样保留' });
      } else {
        for (const item of journal.items) {
          if (!this._safeJournalItem(journal, item)) {
            result.needsReview.push({ source: item.source, target: item.target, reason: '恢复记录路径未通过安全校验' });
            continue;
          }
          if (item.replacementBackup && fs.existsSync(item.replacementBackup)) {
            if (!fs.existsSync(item.target)) {
              result.needsReview.push({
                target: item.target,
                replacementBackup: item.replacementBackup,
                reason: '新目标不存在，旧目标备份已原样保留'
              });
            } else {
              fs.rmSync(item.replacementBackup, { recursive: true, force: true });
              result.cleanedStagingPaths.push(item.replacementBackup);
            }
          }
        }
        if (result.needsReview.length === 0) {
          fs.rmSync(this.transferJournalFile, { force: true });
          result.completedOperationId = recordedOperation.id;
          result.recoveredAction = 'finalized-recorded-operation';
        }
      }
      if (result.needsReview.length > 0) {
        journal.phase = 'needs-review';
        journal.recoveryCheckedAt = result.checkedAt;
        this._writeTransferJournal(journal);
      }
      this.recoveryStatus = result;
      return JSON.parse(JSON.stringify(result));
    }

    const states = [];
    for (const item of journal.items) {
      if (!this._safeJournalItem(journal, item)) {
        result.needsReview.push({ source: item.source, target: item.target, reason: '恢复记录路径未通过安全校验' });
        continue;
      }
      const stagingExists = fs.existsSync(item.staging);
      const targetExists = fs.existsSync(item.target);
      const sourceExists = fs.existsSync(item.source);
      if (item.replacementBackup && fs.existsSync(item.replacementBackup)) {
        result.needsReview.push({
          source: item.source,
          target: item.target,
          replacementBackup: item.replacementBackup,
          reason: '替换操作曾备份旧目标，需要人工确认新旧内容'
        });
      }
      states.push({ item, stagingExists, targetExists, sourceExists });
      if (stagingExists && !targetExists && sourceExists) {
        fs.rmSync(item.staging, { recursive: true, force: true });
        result.cleanedStagingPaths.push(item.staging);
      } else if (stagingExists && targetExists) {
        result.needsReview.push({ source: item.source, target: item.target, staging: item.staging, reason: '临时项和最终目标同时存在' });
      } else if (stagingExists && !sourceExists) {
        result.needsReview.push({ source: item.source, target: item.target, staging: item.staging, reason: '来源不存在且临时项可能是唯一副本，已原样保留' });
      }
    }

    if (result.needsReview.length === 0 && states.length === journal.items.length) {
      const untouched = states.every(state => state.sourceExists && !state.targetExists);
      const completed = journal.operationType === 'move'
        ? states.every(state => !state.sourceExists && state.targetExists && !state.stagingExists)
        : states.every(state => state.sourceExists && state.targetExists && !state.stagingExists);

      if (untouched) {
        fs.rmSync(this.transferJournalFile, { force: true });
        result.recoveredAction = 'discarded-uncommitted-transfer';
      } else if (completed) {
        try {
          if (journal.operationType === 'move') {
            this.configService.rebindPaths(journal.items.map(item => ({ from: item.source, to: item.target })));
            result.configRebound = true;
          }
          const operation = this._record(journal.operationType, journal.items.map(item => ({
            source: item.source,
            target: item.target
          })), {
            id: journal.operationId,
            previewToken: journal.previewToken || null,
            destination: journal.destination,
            conflictCount: Number(journal.conflictCount) || 0,
            transfer: journal.transfer && typeof journal.transfer === 'object' ? journal.transfer : undefined,
            recoveredAt: Date.now()
          });
          fs.rmSync(this.transferJournalFile, { force: true });
          result.completedOperationId = operation.id;
          result.recoveredAction = 'completed-committed-transfer';
        } catch (error) {
          result.needsReview.push({ reason: `已完成文件无法补齐配置或操作历史：${error.message || String(error)}` });
        }
      } else {
        for (const state of states) {
          let reason = '批量传输只完成了部分项目，已原样保留';
          if (!state.sourceExists && !state.targetExists) reason = '来源和最终目标均不存在';
          else if (state.sourceExists && state.targetExists) reason = '来源和目标均存在';
          result.needsReview.push({ source: state.item.source, target: state.item.target, reason });
        }
      }
    }

    if (result.needsReview.length > 0) {
      journal.phase = 'needs-review';
      journal.recoveryCheckedAt = result.checkedAt;
      this._writeTransferJournal(journal);
    }
    this.recoveryStatus = result;
    return JSON.parse(JSON.stringify(result));
  }

  _stagingPath(preview, item, index) {
    const fingerprint = crypto.createHash('sha256')
      .update(`${preview.operationId}\0${item.target}\0${index}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(preview.destination, `.gitfinder-partial-${fingerprint}`);
  }

  _replacementBackupPath(preview, item, index) {
    const fingerprint = crypto.createHash('sha256')
      .update(`${preview.operationId}\0${item.target}\0replace\0${index}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(preview.destination, `.gitfinder-replaced-${fingerprint}`);
  }

  async _copyFileChunked(source, target, stat, status) {
    let sourceHandle;
    let targetHandle;
    const sourceHash = crypto.createHash('sha256');
    try {
      sourceHandle = await fs.promises.open(source, 'r');
      targetHandle = await fs.promises.open(target, 'wx', stat.mode);
      const buffer = Buffer.allocUnsafe(this.copyChunkBytes);
      let readPosition = 0;
      while (true) {
        this._throwIfTransferCancelled(status);
        const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, readPosition);
        if (bytesRead === 0) break;
        let written = 0;
        while (written < bytesRead) {
          const result = await targetHandle.write(buffer, written, bytesRead - written, readPosition + written);
          written += result.bytesWritten;
        }
        sourceHash.update(buffer.subarray(0, bytesRead));
        readPosition += bytesRead;
        this._updateTransferStatus(status, {
          bytesTransferred: status.bytesTransferred + bytesRead,
          currentSource: source,
          currentTarget: target
        });
      }
      this._throwIfTransferCancelled(status);
      await targetHandle.sync();
      if (typeof this.hooks.afterCopyFile === 'function') await this.hooks.afterCopyFile({ source, target });
      const targetHash = await this._hashTransferredFile(target, status);
      if (targetHash !== sourceHash.digest('hex')) {
        throw new Error(`文件字节校验失败：${source}`);
      }
    } catch (error) {
      await fs.promises.rm(target, { force: true }).catch(() => {});
      throw error;
    } finally {
      if (sourceHandle) await sourceHandle.close().catch(() => {});
      if (targetHandle) await targetHandle.close().catch(() => {});
    }
    await fs.promises.chmod(target, stat.mode).catch(() => {});
    await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
  }

  async _hashTransferredFile(target, status) {
    const hash = crypto.createHash('sha256');
    const handle = await fs.promises.open(target, 'r');
    const buffer = Buffer.allocUnsafe(this.copyChunkBytes);
    let readPosition = 0;
    try {
      while (true) {
        this._throwIfTransferCancelled(status);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, readPosition);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
        readPosition += bytesRead;
        this._updateTransferStatus(status, {
          bytesTransferred: status.bytesTransferred + bytesRead,
          currentSource: target,
          currentTarget: target
        });
      }
    } finally {
      await handle.close().catch(() => {});
    }
    return hash.digest('hex');
  }

  async _copyPathForTransfer(source, target, status) {
    this._throwIfTransferCancelled(status);
    const stat = await fs.promises.lstat(source);
    if (stat.isSymbolicLink()) {
      await this._copySymbolicLink(source, target);
      return;
    }
    if (stat.isFile()) {
      await this._copyFileChunked(source, target, stat, status);
      return;
    }
    if (!stat.isDirectory()) throw new Error(`不支持传输此文件类型：${source}`);

    await fs.promises.mkdir(target, { mode: stat.mode });
    try {
      const entries = await fs.promises.readdir(source, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        await this._copyPathForTransfer(path.join(source, entry.name), path.join(target, entry.name), status);
      }
      await fs.promises.chmod(target, stat.mode).catch(() => {});
      await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async _copySymbolicLink(source, target) {
    const linkTarget = await fs.promises.readlink(source);
    let linkType;
    if (this.platform === 'win32') {
      try {
        linkType = (await fs.promises.stat(source)).isDirectory() ? 'junction' : 'file';
      } catch (_) {
        linkType = 'file';
      }
    }
    try {
      await fs.promises.symlink(linkTarget, target, linkType);
    } catch (error) {
      if (this.platform === 'win32' && (error?.code === 'EPERM' || error?.code === 'EACCES')) {
        throw new Error(`Windows 无权创建符号链接；请启用开发者模式或调整目标权限：${source}`);
      }
      throw error;
    }
  }

  async _cleanupPreparedItems(preparedItems) {
    for (const item of [...preparedItems].reverse()) {
      if (item.staging) await fs.promises.rm(item.staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  async _prepareTransfer(preview, status, journal) {
    const preparedItems = [];
    for (let index = 0; index < preview.items.length; index += 1) {
      const item = preview.items[index];
      if (item.skipped || item.transferKind === 'atomic-move') continue;
      this._throwIfTransferCancelled(status);
      const staging = this._stagingPath(preview, item, index);
      if (fs.existsSync(staging)) throw new Error(`传输临时路径已存在：${staging}`);
      const prepared = { ...item, staging, state: 'copying' };
      preparedItems.push(prepared);
      journal.items = preview.items.flatMap((previewItem, previewIndex) => {
        if (previewItem.skipped) return [];
        const current = preparedItems.find(candidate => candidate.source === previewItem.source);
        const existing = journal.items.find(candidate => candidate.source === previewItem.source);
        return [{
          ...existing,
          source: previewItem.source,
          target: previewItem.target,
          transferKind: previewItem.transferKind,
          staging: current?.staging || this._stagingPath(preview, previewItem, previewIndex),
          state: current?.state || 'pending'
        }];
      });
      this._writeTransferJournal(journal);
      this._updateTransferStatus(status, { currentSource: item.source, currentTarget: item.target });
      await this._copyPathForTransfer(item.source, staging, status);
      this._throwIfTransferCancelled(status);

      const currentSource = await this._summarizePath(item.source);
      if (currentSource.revisionFingerprint !== item.revisionFingerprint) {
        throw new Error(`来源在传输期间发生变化：${item.source}`);
      }
      const staged = await this._summarizePath(staging);
      if (staged.contentFingerprint !== item.contentFingerprint
          || staged.totalBytes !== item.totalBytes
          || staged.fileCount !== item.fileCount
          || staged.directoryCount !== item.directoryCount
          || staged.symlinkCount !== item.symlinkCount) {
        throw new Error(`目标临时副本校验失败：${item.target}`);
      }
      prepared.state = 'prepared';
      const journalItem = journal.items.find(candidate => candidate.source === item.source);
      if (journalItem) journalItem.state = 'prepared';
      this._writeTransferJournal(journal);
      this._updateTransferStatus(status, { itemsPrepared: status.itemsPrepared + 1 });
    }
    return preparedItems;
  }

  async _rollbackCommittedTransfer(preview, committedItems, preparedItems) {
    const failures = [];
    for (const item of [...committedItems].reverse()) {
      try {
        if (preview.operationType === 'move') {
          const sourceExists = fs.existsSync(item.source);
          const targetExists = fs.existsSync(item.target);
          if (!sourceExists && targetExists) {
            await this._movePath(item.target, item.source);
          } else if (sourceExists && targetExists && item.transferKind !== 'atomic-move') {
            await fs.promises.rm(item.target, { recursive: true, force: true });
          }
        } else if (fs.existsSync(item.target)) {
          await fs.promises.rm(item.target, { recursive: true, force: true });
        }
        if (item.replacementBackup && fs.existsSync(item.replacementBackup)) {
          if (fs.existsSync(item.target)) throw new Error(`替换目标仍存在，无法恢复旧内容：${item.target}`);
          await fs.promises.rename(item.replacementBackup, item.target);
        }
      } catch (error) {
        failures.push({ source: item.source, target: item.target, error: error.message || String(error) });
      }
    }
    await this._cleanupPreparedItems(preparedItems);
    return failures;
  }

  _reverseTransferMappings(preview) {
    return [...preview.items]
      .filter(item => !item.skipped)
      .reverse()
      .map(item => ({ from: item.target, to: item.source }));
  }

  async _rollbackMoveRebind(preview) {
    if (preview.operationType !== 'move') return null;
    try {
      this.configService.rebindPaths(this._reverseTransferMappings(preview));
      return null;
    } catch (error) {
      return { error: error.message || String(error) };
    }
  }

  async _commitTransfer(preview, preparedItems, status, journal) {
    const preparedBySource = new Map(preparedItems.map(item => [item.source, item]));
    const committedItems = [];
    const replacementBackups = [];
    this._updateTransferStatus(status, {
      phase: 'committing',
      cancellable: false,
      cancelRequested: false,
      currentSource: '',
      currentTarget: ''
    });
    journal.phase = 'committing';
    this._writeTransferJournal(journal);
    if (typeof this.hooks.beforeCommit === 'function') await this.hooks.beforeCommit(preview);

    try {
      for (let index = 0; index < preview.items.length; index += 1) {
        const item = preview.items[index];
        if (item.skipped) continue;
        let replacementBackup = null;
        if (item.conflictAction === 'replace') {
          if (!fs.existsSync(item.target)) throw new Error(`待替换目标已不存在：${item.target}`);
          const currentTarget = await this._summarizePath(item.target);
          if (currentTarget.revisionFingerprint !== item.targetRevisionFingerprint) {
            throw new Error(`待替换目标在确认后发生变化：${item.target}`);
          }
          replacementBackup = this._replacementBackupPath(preview, item, index);
          if (fs.existsSync(replacementBackup)) throw new Error(`替换备份路径已存在：${replacementBackup}`);
          await fs.promises.rename(item.target, replacementBackup);
          replacementBackups.push({ target: item.target, replacementBackup });
          const journalItem = journal.items.find(candidate => candidate.source === item.source);
          if (journalItem) {
            journalItem.replacementBackup = replacementBackup;
            journalItem.state = 'target-backed-up';
          }
          this._writeTransferJournal(journal);
        } else if (fs.existsSync(item.target)) {
          throw new Error(`目标已存在：${item.target}`);
        }
        if (typeof this.hooks.beforeTargetCommit === 'function') await this.hooks.beforeTargetCommit(item);
        if (item.transferKind === 'atomic-move') {
          await fs.promises.rename(item.source, item.target);
        } else {
          const prepared = preparedBySource.get(item.source);
          if (!prepared || !fs.existsSync(prepared.staging)) throw new Error(`传输临时副本不存在：${item.target}`);
          await fs.promises.rename(prepared.staging, item.target);
          prepared.state = 'target-committed';
        }
        committedItems.push({ ...item, replacementBackup });
        const journalItem = journal.items.find(candidate => candidate.source === item.source);
        if (journalItem) journalItem.state = 'target-committed';
        this._writeTransferJournal(journal);
        this._updateTransferStatus(status, {
          itemsCommitted: committedItems.length,
          currentSource: item.source,
          currentTarget: item.target
        });
      }

      if (preview.operationType === 'move') {
        for (const item of preview.items.filter(candidate => candidate.transferKind === 'copy-delete')) {
          if (typeof this.hooks.beforeDeleteSource === 'function') await this.hooks.beforeDeleteSource(item);
          await fs.promises.rm(item.source, { recursive: true });
          const journalItem = journal.items.find(candidate => candidate.source === item.source);
          if (journalItem) journalItem.state = 'source-deleted';
          this._writeTransferJournal(journal);
        }
      }

      return committedItems;
    } catch (error) {
      const rollbackFailures = await this._rollbackCommittedTransfer(preview, committedItems, preparedItems);
      for (const replacement of replacementBackups.reverse()) {
        if (!fs.existsSync(replacement.replacementBackup)) continue;
        try {
          if (fs.existsSync(replacement.target)) throw new Error('新目标仍存在');
          await fs.promises.rename(replacement.replacementBackup, replacement.target);
        } catch (rollbackError) {
          rollbackFailures.push({
            target: replacement.target,
            replacementBackup: replacement.replacementBackup,
            error: rollbackError.message || String(rollbackError)
          });
        }
      }
      if (rollbackFailures.length > 0) {
        journal.phase = 'needs-review';
        journal.rollbackFailures = rollbackFailures;
        this._writeTransferJournal(journal);
        throw new TransferNeedsReviewError(`文件传输未能完整回滚，请检查来源与目标：${error.message || String(error)}`);
      }
      throw error;
    }
  }

  async _applyPlannedTransfer(request, expectedOperationType) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('文件传输请求无效');
    const operationType = expectedOperationType || String(request.mode || '');
    if (!['copy', 'move', 'import'].includes(operationType)) throw new Error('文件传输模式无效');
    const operationId = this._normalizeTransferOperationId(request.operationId, operationType);
    const conflictPolicy = this._normalizeConflictPolicy(request.conflictPolicy);
    const previewToken = String(request.previewToken || '');
    if (!TRANSFER_TOKEN_PATTERN.test(previewToken)) throw new Error('文件传输预览凭据无效');

    const existing = this._loadHistory().operations.find(operation => operation.id === operationId);
    if (existing) {
      if (existing.type !== operationType || existing.previewToken !== previewToken) {
        throw new Error('文件传输操作标识已被其他操作使用');
      }
      return { ...existing, idempotent: true };
    }
    const running = [...this.activeTransfers.values()].find(status => status.state === 'running');
    if (running) throw new Error('另一个文件传输正在进行');

    const preview = await this._buildTransferPreview(
      request.sourcePaths,
      request.destinationDirectory,
      operationType,
      operationId,
      { conflictPolicy }
    );
    if (preview.previewToken !== previewToken) {
      throw new Error('文件传输预览已过期，请重新检查后确认');
    }
    if (!preview.spaceSufficient) {
      throw new Error('目标卷可用空间不足，未写入任何内容');
    }
    if (preview.requiresStructureRiskAcknowledgement && request.structureRiskAcknowledged !== true) {
      throw new Error('移动项目或 Git 结构前必须显式确认风险');
    }
    const actionableItems = preview.items.filter(item => !item.skipped);
    if (operationType === 'move' && actionableItems.length > 0) {
      this.configService.validateRebindPaths(actionableItems.map(item => ({ from: item.source, to: item.target })));
    }
    if (actionableItems.length === 0) {
      return this._record(operationType, [], {
        id: operationId,
        previewToken,
        destination: preview.destination,
        conflictPolicy,
        conflictCount: preview.conflictCount,
        skippedCount: preview.skipCount,
        undoable: false
      });
    }

    const status = this._createTransferStatus(preview);
    const journal = {
      version: 1,
      operationId,
      operationType,
      destination: preview.destination,
      previewToken,
      conflictPolicy,
      conflictCount: preview.conflictCount,
      transfer: {
        totalBytes: preview.totalBytes,
        requiredBytes: preview.requiredBytes,
        fileCount: preview.fileCount,
        directoryCount: preview.directoryCount,
        sameVolumeCount: preview.sameVolumeCount,
        crossVolumeCount: preview.crossVolumeCount
      },
      phase: 'preparing',
      createdAt: Date.now(),
      items: preview.items.flatMap((item, index) => item.skipped ? [] : [{
        source: item.source,
        target: item.target,
        transferKind: item.transferKind,
        staging: this._stagingPath(preview, item, index),
        state: item.transferKind === 'atomic-move' ? 'pending-atomic-move' : 'pending'
      }])
    };
    let preparedItems = [];
    let committedItems = [];
    this._writeTransferJournal(journal);

    try {
      preparedItems = await this._prepareTransfer(preview, status, journal);
      this._throwIfTransferCancelled(status);
      committedItems = await this._commitTransfer(preview, preparedItems, status, journal);

      if (operationType === 'move') {
        try {
          this.configService.rebindPaths(actionableItems.map(item => ({ from: item.source, to: item.target })));
        } catch (error) {
          const rollbackFailures = await this._rollbackCommittedTransfer(preview, committedItems, preparedItems);
          const rebindRollbackFailure = await this._rollbackMoveRebind(preview);
          if (rollbackFailures.length > 0 || rebindRollbackFailure) {
            journal.phase = 'needs-review';
            journal.rollbackFailures = rollbackFailures;
            journal.rebindRollbackFailure = rebindRollbackFailure;
            this._writeTransferJournal(journal);
            throw new TransferNeedsReviewError(`路径关联更新失败且文件未能完整回滚：${error.message || String(error)}`);
          }
          throw error;
        }
      }

      let operation;
      try {
        operation = this._record(operationType, actionableItems.map(item => ({ source: item.source, target: item.target })), {
          id: operationId,
          previewToken,
          destination: preview.destination,
          conflictPolicy,
          conflictCount: preview.conflictCount,
          skippedCount: preview.skipCount,
          replaceCount: preview.replaceCount,
          undoable: preview.replaceCount === 0,
          transfer: {
            totalBytes: preview.totalBytes,
            requiredBytes: preview.requiredBytes,
            fileCount: preview.fileCount,
            directoryCount: preview.directoryCount,
            sameVolumeCount: preview.sameVolumeCount,
            crossVolumeCount: preview.crossVolumeCount
          }
        });
      } catch (error) {
        const rollbackFailures = await this._rollbackCommittedTransfer(preview, committedItems, preparedItems);
        const rebindRollbackFailure = await this._rollbackMoveRebind(preview);
        if (rollbackFailures.length > 0 || rebindRollbackFailure) {
          journal.phase = 'needs-review';
          journal.rollbackFailures = rollbackFailures;
          journal.rebindRollbackFailure = rebindRollbackFailure;
          this._writeTransferJournal(journal);
          throw new TransferNeedsReviewError(`操作记录写入失败且文件未能完整回滚：${error.message || String(error)}`);
        }
        throw error;
      }

      for (const item of committedItems) {
        if (!item.replacementBackup || !fs.existsSync(item.replacementBackup)) continue;
        try {
          await fs.promises.rm(item.replacementBackup, { recursive: true });
        } catch (error) {
          journal.phase = 'needs-review';
          journal.cleanupFailure = {
            replacementBackup: item.replacementBackup,
            error: error.message || String(error)
          };
          this._writeTransferJournal(journal);
          throw new TransferNeedsReviewError(`替换已完成，但旧目标备份未能清理：${item.replacementBackup}`);
        }
      }

      this._clearTransferJournal(operationId);
      this._updateTransferStatus(status, {
        state: 'completed',
        phase: 'completed',
        cancellable: false,
        bytesTransferred: preview.requiredBytes * 2,
        currentSource: '',
        currentTarget: '',
        completedAt: Date.now(),
        result: operation
      });
      return operation;
    } catch (error) {
      if (error.code !== 'TRANSFER_NEEDS_REVIEW') {
        await this._cleanupPreparedItems(preparedItems);
        this._clearTransferJournal(operationId);
      }
      const cancelled = error.code === 'TRANSFER_CANCELLED';
      const needsReview = error.code === 'TRANSFER_NEEDS_REVIEW';
      this._updateTransferStatus(status, {
        state: cancelled ? 'cancelled' : (needsReview ? 'needs-review' : 'failed'),
        phase: cancelled ? 'cancelled' : (needsReview ? 'needs-review' : 'failed'),
        cancellable: false,
        completedAt: Date.now(),
        error: error.message || String(error)
      });
      throw error;
    }
  }

  async _movePath(source, target) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.promises.rename(source, target);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      try {
        await fs.promises.cp(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        await fs.promises.rm(source, { recursive: true });
      } catch (copyError) {
        await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
        throw copyError;
      }
    }
  }

  async _executeMoves(items) {
    const completed = [];
    try {
      for (const item of items) {
        await this._movePath(item.source, item.target);
        completed.push(item);
      }
    } catch (error) {
      for (const item of completed.reverse()) {
        try { await this._movePath(item.target, item.source); } catch (_) {}
      }
      throw error;
    }
  }

  _assertRenameMappingsAvailable(items) {
    const sourceKeys = new Set(items.map(item => this._batchRenamePathKey(item.source)));
    for (const item of items) {
      if (!fs.existsSync(item.target) || this._sameFile(item.source, item.target)) continue;
      if (!sourceKeys.has(this._batchRenamePathKey(item.target))) {
        throw new Error(`重命名目标已存在：${item.target}`);
      }
    }
  }

  async _executeRenameMappings(items) {
    const operationId = this._createBatchRenameOperationId();
    const stagedItems = items.map((item, index) => ({
      ...item,
      staging: this._batchRenameStagingPath(operationId, item, index),
      state: 'source'
    }));
    for (const item of stagedItems) {
      if (fs.existsSync(item.staging)) throw new Error(`重命名临时路径已存在：${item.staging}`);
    }
    try {
      for (const item of stagedItems) {
        await fs.promises.rename(item.source, item.staging);
        item.state = 'staged';
      }
      for (const item of stagedItems) {
        if (fs.existsSync(item.target)) throw new Error(`重命名目标已存在：${item.target}`);
        await fs.promises.rename(item.staging, item.target);
        item.state = 'target';
      }
    } catch (error) {
      const rollbackFailures = await this._rollbackBatchRenameItems(stagedItems);
      if (rollbackFailures.length > 0) {
        throw new TransferNeedsReviewError(`重命名失败且未能完整回滚：${error.message || String(error)}`);
      }
      throw error;
    }
  }

  async _copyPathNoOverwrite(source, target) {
    const stat = await fs.promises.lstat(source);
    if (stat.isSymbolicLink()) {
      await this._copySymbolicLink(source, target);
      return;
    }
    if (stat.isFile()) {
      try {
        await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if (error?.code !== 'EEXIST') await fs.promises.rm(target, { force: true }).catch(() => {});
        throw error;
      }
      await fs.promises.chmod(target, stat.mode).catch(() => {});
      await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
      return;
    }
    if (!stat.isDirectory()) throw new Error(`不支持复制此文件类型：${source}`);

    await fs.promises.mkdir(target, { mode: stat.mode });
    try {
      const entries = await fs.promises.readdir(source, { withFileTypes: true });
      for (const entry of entries) {
        await this._copyPathNoOverwrite(path.join(source, entry.name), path.join(target, entry.name));
      }
      await fs.promises.chmod(target, stat.mode).catch(() => {});
      await fs.promises.utimes(target, stat.atime, stat.mtime).catch(() => {});
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async _executeCopies(items) {
    const completed = [];
    for (const item of items) {
      try {
        await this._copyPathNoOverwrite(item.source, item.target);
        completed.push(item);
      } catch (error) {
        for (const copied of completed.reverse()) {
          await fs.promises.rm(copied.target, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
    }
  }

  _uniqueCopyTarget(source, destination, reservedTargets = new Set()) {
    const initialTarget = path.join(destination, path.basename(source));
    if (!fs.existsSync(initialTarget) && !this._reservedTargetHas(reservedTargets, initialTarget)) return initialTarget;

    const sourceStat = fs.lstatSync(source);
    const extension = sourceStat.isFile() ? path.extname(source) : '';
    const stem = path.basename(source, extension);
    let sequence = 1;
    let target;
    do {
      const suffix = sequence === 1 ? ' 副本' : ` 副本 ${sequence}`;
      target = path.join(destination, `${stem}${suffix}${extension}`);
      sequence += 1;
    } while (fs.existsSync(target) || this._reservedTargetHas(reservedTargets, target));
    return target;
  }

  async previewTransfer(sourcePaths, destinationDirectory, mode, options = {}) {
    if (!['copy', 'move'].includes(mode)) throw new Error('文件传输模式无效');
    return this._buildTransferPreview(
      sourcePaths,
      destinationDirectory,
      mode,
      this._createTransferOperationId(mode),
      options
    );
  }

  async applyTransfer(request = {}) {
    return this._applyPlannedTransfer(request, String(request?.mode || ''));
  }

  async copy(sourcePaths, destinationDirectory) {
    const preview = await this.previewTransfer(sourcePaths, destinationDirectory, 'copy');
    return this.applyTransfer({
      operationId: preview.operationId,
      previewToken: preview.previewToken,
      sourcePaths: preview.items.map(item => item.source),
      destinationDirectory: preview.destination,
      mode: 'copy',
      conflictPolicy: preview.conflictPolicy
    });
  }

  async previewImport(sourcePaths, destinationDirectory, options = {}) {
    return this._buildTransferPreview(
      sourcePaths,
      destinationDirectory,
      'import',
      this._createTransferOperationId('import'),
      options
    );
  }

  async applyImport(request = {}) {
    return this._applyPlannedTransfer(request, 'import');
  }

  async move(sourcePaths, destinationDirectory) {
    const preview = await this.previewTransfer(sourcePaths, destinationDirectory, 'move');
    return this.applyTransfer({
      operationId: preview.operationId,
      previewToken: preview.previewToken,
      sourcePaths: preview.items.map(item => item.source),
      destinationDirectory: preview.destination,
      mode: 'move',
      conflictPolicy: preview.conflictPolicy
    });
  }

  _normalizeBatchRenameSources(sourcePaths) {
    if (!Array.isArray(sourcePaths) || sourcePaths.length < 2) throw new Error('请至少选择 2 个项目');
    if (sourcePaths.length > MAX_BATCH_RENAME_ITEMS) throw new Error(`一次最多重命名 ${MAX_BATCH_RENAME_ITEMS} 个项目`);
    const seen = new Set();
    const sources = [];
    for (const candidate of sourcePaths) {
      const source = this._assertExistingSource(candidate);
      const key = this._pathKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
    if (sources.length < 2) throw new Error('请至少选择 2 个不同项目');
    for (const source of sources) {
      const nested = sources.find(other => other !== source && this._pathIsWithin(source, other));
      if (nested) throw new Error('不能同时批量重命名父文件夹和其内部项目');
    }
    return sources;
  }

  _batchRenameSourceIdentity(source) {
    const stat = fs.lstatSync(source);
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode
    };
  }

  _batchRenameStructureRisks(source, stat) {
    if (!stat.isDirectory()) return [];
    const risks = [];
    if (path.basename(source) === '.gitfinder') risks.push('正在重命名 .gitfinder 项目身份目录');
    if (path.basename(source) === '.git') risks.push('正在重命名 .git 仓库元数据目录');
    if (fs.existsSync(path.join(source, '.gitfinder', 'project.json'))) risks.push('正在重命名项目根目录');
    if (fs.existsSync(path.join(source, '.git'))) risks.push('正在重命名 Git 仓库根目录');
    const nestedRepositories = typeof this.configService.listActive === 'function'
      ? this.configService.listActive().filter(repo => repo?.path && this._pathIsWithin(repo.path, source)).length
      : 0;
    if (nestedRepositories > 1) risks.push(`包含 ${nestedRepositories} 个已登记 Git 仓库`);
    return [...new Set(risks)];
  }

  _batchRenamePreviewToken(preview) {
    return crypto.createHash('sha256').update(JSON.stringify({
      version: preview.version,
      operationId: preview.operationId,
      options: preview.options,
      items: preview.items.map(item => ({
        source: item.source,
        target: item.target,
        oldName: item.oldName,
        newName: item.newName,
        changed: item.changed,
        identity: item.identity,
        validationError: item.validationError,
        structureRisks: item.structureRisks
      }))
    })).digest('hex');
  }

  _batchRenameStagingPath(operationId, item, index) {
    const fingerprint = crypto.createHash('sha256')
      .update(`${operationId}\0${item.source}\0${item.target}\0${index}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(path.dirname(item.source), `.gitfinder-rename-${fingerprint}`);
  }

  _batchRenamePathKey(candidatePath) {
    const resolved = path.resolve(candidatePath);
    return ['darwin', 'win32'].includes(this.platform)
      ? resolved.toLocaleLowerCase('en-US')
      : resolved;
  }

  async _buildBatchRenamePreview(sourcePaths, rawOptions, operationId) {
    const id = this._normalizeBatchRenameOperationId(operationId);
    const validation = BatchRename.validateOptions(rawOptions);
    if (!validation.ok) throw new Error(validation.error);
    const options = validation.options;
    const sources = this._normalizeBatchRenameSources(sourcePaths);
    const items = sources.map((source, index) => {
      const stat = fs.lstatSync(source);
      const oldName = path.basename(source);
      let newName = '';
      let target = null;
      let validationError = '';
      try {
        newName = this._assertName(BatchRename.transformName({
          name: oldName,
          isFile: stat.isFile()
        }, options, index));
        target = path.join(path.dirname(source), newName);
      } catch (error) {
        validationError = error.message || String(error);
      }
      return {
        source,
        target,
        oldName,
        newName,
        type: stat.isDirectory() ? 'directory' : (stat.isSymbolicLink() ? 'symlink' : 'file'),
        changed: Boolean(target && newName !== oldName),
        identity: this._batchRenameSourceIdentity(source),
        validationError,
        structureRisks: this._batchRenameStructureRisks(source, stat)
      };
    });

    const sourceOwners = new Map(items.map(item => [this._batchRenamePathKey(item.source), item]));
    const targetGroups = new Map();
    for (const item of items.filter(value => value.changed && value.target)) {
      const key = this._batchRenamePathKey(item.target);
      if (!targetGroups.has(key)) targetGroups.set(key, []);
      targetGroups.get(key).push(item);
    }
    for (const group of targetGroups.values()) {
      if (group.length > 1) {
        for (const item of group) item.validationError = `多个项目将使用同一名称“${item.newName}”`;
      }
    }
    for (const item of items.filter(value => value.changed && value.target && !value.validationError)) {
      if (!fs.existsSync(item.target) || this._sameFile(item.source, item.target)) continue;
      const owner = sourceOwners.get(this._batchRenamePathKey(item.target));
      if (!owner || !owner.changed || owner.validationError) item.validationError = `目标已存在：${item.newName}`;
    }

    const changedItems = items.filter(item => item.changed);
    const invalidItems = items.filter(item => item.validationError);
    const structureRiskCount = changedItems.reduce((total, item) => total + item.structureRisks.length, 0);
    const preview = {
      version: 1,
      operationId: id,
      options,
      summary: BatchRename.describeOptions(options),
      itemCount: items.length,
      changedCount: changedItems.length,
      unchangedCount: items.length - changedItems.length,
      invalidCount: invalidItems.length,
      structureRiskCount,
      requiresStructureRiskAcknowledgement: structureRiskCount > 0,
      items,
      validations: [
        { key: 'selection', passed: items.length >= 2, message: `已检查 ${items.length} 个受管项目` },
        { key: 'changes', passed: changedItems.length > 0, message: changedItems.length > 0 ? `将重命名 ${changedItems.length} 个项目` : '当前规则不会改变任何名称' },
        { key: 'names', passed: invalidItems.length === 0, message: invalidItems.length > 0 ? `${invalidItems.length} 个名称无效或发生冲突` : '新名称唯一且未占用现有项目' },
        { key: 'structure-risk', passed: true, message: structureRiskCount > 0 ? `检测到 ${structureRiskCount} 项项目或 Git 结构风险` : '未检测到项目或 Git 结构风险' }
      ]
    };
    preview.canApply = preview.validations.every(item => item.passed);
    preview.previewToken = this._batchRenamePreviewToken(preview);
    return preview;
  }

  async previewBatchRename(sourcePaths, options = {}) {
    return this._buildBatchRenamePreview(sourcePaths, options, this._createBatchRenameOperationId());
  }

  async applyBatchRename(request = {}) {
    const operationId = this._normalizeBatchRenameOperationId(request.operationId);
    const previewToken = String(request.previewToken || '');
    if (!TRANSFER_TOKEN_PATTERN.test(previewToken)) throw new Error('批量重命名预览凭据无效');
    const existing = this._loadHistory().operations.find(operation => operation.id === operationId);
    if (existing) {
      if (existing.type !== 'rename' || existing.previewToken !== previewToken || existing.batch !== true) {
        throw new Error('批量重命名操作标识已被其他操作使用');
      }
      return { ...existing, idempotent: true };
    }
    if (this.activeBatchRenames.size > 0) throw new Error('另一个批量重命名正在进行');
    const preview = await this._buildBatchRenamePreview(request.sourcePaths, request.options, operationId);
    if (preview.previewToken !== previewToken) throw new Error('批量重命名预览已过期，请重新检查');
    if (!preview.canApply) {
      const failed = preview.validations.find(item => !item.passed);
      throw new Error(failed?.message || '当前批量重命名计划不可执行');
    }
    if (preview.requiresStructureRiskAcknowledgement && request.structureRiskAcknowledged !== true) {
      throw new Error('重命名项目或 Git 结构前必须显式确认风险');
    }
    const changedItems = preview.items.filter(item => item.changed);
    const mappings = changedItems.map(item => ({ from: item.source, to: item.target }));
    this.configService.validateRebindPaths(mappings);
    const journal = {
      version: 1,
      operationId,
      operationType: 'rename',
      previewToken,
      options: preview.options,
      phase: 'staging',
      createdAt: Date.now(),
      items: changedItems.map((item, index) => ({
        source: item.source,
        target: item.target,
        staging: this._batchRenameStagingPath(operationId, item, index),
        state: 'source'
      }))
    };
    for (const item of journal.items) {
      if (fs.existsSync(item.staging)) throw new Error(`批量重命名临时路径已存在：${item.staging}`);
    }

    this.activeBatchRenames.add(operationId);
    let configApplied = false;
    let fullyRolledBack = false;
    try {
      this._writeBatchRenameJournal(journal);
      for (let index = 0; index < journal.items.length; index += 1) {
        const item = journal.items[index];
        await fs.promises.rename(item.source, item.staging);
        item.state = 'staged';
        this._writeBatchRenameJournal(journal);
        await this.hooks.afterBatchRenameStage?.(item, index, journal);
      }
      journal.phase = 'committing';
      this._writeBatchRenameJournal(journal);
      for (let index = 0; index < journal.items.length; index += 1) {
        const item = journal.items[index];
        await fs.promises.rename(item.staging, item.target);
        item.state = 'target';
        this._writeBatchRenameJournal(journal);
        await this.hooks.afterBatchRenameCommit?.(item, index, journal);
      }
      await this.hooks.beforeBatchRenameConfig?.(journal);
      this.configService.rebindPaths(mappings);
      configApplied = true;
      journal.phase = 'config-rebound';
      this._writeBatchRenameJournal(journal);
      await this.hooks.beforeBatchRenameRecord?.(journal);
      let operation;
      try {
        operation = this._record('rename', mappings.map(mapping => ({ source: mapping.from, target: mapping.to })), {
          id: operationId,
          previewToken,
          batch: true,
          batchOptions: preview.options,
          itemCount: mappings.length,
          structureRiskCount: preview.structureRiskCount
        });
      } catch (error) {
        const rollbackFailures = await this._rollbackBatchRenameItems(journal.items);
        try {
          this.configService.rebindPaths([...mappings].reverse().map(mapping => ({ from: mapping.to, to: mapping.from })));
          configApplied = false;
        } catch (rollbackError) {
          rollbackFailures.push({ error: rollbackError });
        }
        if (rollbackFailures.length > 0) {
          journal.phase = 'needs-review';
          journal.error = error.message || String(error);
          this._writeBatchRenameJournal(journal);
          throw new TransferNeedsReviewError(`批量重命名历史写入失败且未能完整回滚：${error.message || String(error)}`);
        }
        this._clearBatchRenameJournal(operationId);
        fullyRolledBack = true;
        throw error;
      }
      this._clearBatchRenameJournal(operationId);
      return operation;
    } catch (error) {
      if (error.code === 'TRANSFER_NEEDS_REVIEW') throw error;
      const rollbackFailures = fullyRolledBack ? [] : await this._rollbackBatchRenameItems(journal.items);
      if (configApplied) {
        try {
          this.configService.rebindPaths([...mappings].reverse().map(mapping => ({ from: mapping.to, to: mapping.from })));
        } catch (rollbackError) {
          rollbackFailures.push({ error: rollbackError });
        }
      }
      if (rollbackFailures.length > 0) {
        journal.phase = 'needs-review';
        journal.error = error.message || String(error);
        this._writeBatchRenameJournal(journal);
        throw new TransferNeedsReviewError(`批量重命名失败且未能完整回滚：${error.message || String(error)}`);
      }
      this._clearBatchRenameJournal(operationId);
      throw error;
    } finally {
      this.activeBatchRenames.delete(operationId);
    }
  }

  async rename(sourcePath, nextName) {
    const source = this._assertExistingSource(sourcePath);
    const target = path.join(path.dirname(source), this._assertName(nextName));
    this._assertTargetAvailable(source, target);
    const mappings = [{ from: source, to: target }];
    this.configService.validateRebindPaths(mappings);
    await this._movePath(source, target);
    try {
      this.configService.rebindPaths(mappings);
    } catch (error) {
      try {
        await this._movePath(target, source);
      } catch (_) {
        throw new TransferNeedsReviewError(`路径关联更新失败且重命名未能回滚：${error.message || String(error)}`);
      }
      throw error;
    }
    try {
      return this._record('rename', [{ source, target }]);
    } catch (error) {
      const rollbackFailures = [];
      try { await this._movePath(target, source); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      try { this.configService.rebindPaths([{ from: target, to: source }]); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      if (rollbackFailures.length > 0) {
        throw new TransferNeedsReviewError(`重命名历史写入失败且未能完整回滚：${error.message || String(error)}`);
      }
      throw error;
    }
  }

  _uniqueTrashTarget(source, reservedTargets = new Set()) {
    const trashDirectory = this._trashDirectoryForExistingSource(source);
    const extension = path.extname(source);
    const stem = path.basename(source, extension);
    let target = path.join(trashDirectory, path.basename(source));
    let sequence = 2;
    while (fs.existsSync(target) || this._reservedTargetHas(reservedTargets, target)) {
      target = path.join(trashDirectory, `${stem} ${sequence}${extension}`);
      sequence += 1;
    }
    return target;
  }

  async trash(sourcePaths) {
    const sources = this._normalizeSources(sourcePaths);
    if (this.platform === 'win32' && !this.trashDirOverride) {
      const items = [];
      let configSnapshot = null;
      try {
        for (const source of sources) {
          await this.systemTrashItem(source);
          if (fs.existsSync(source)) throw new Error(`系统回收站未移除来源：${source}`);
          items.push({ source, target: null });
        }
        configSnapshot = this.configService.archivePaths(sources);
        return this._record('trash', items, {
          systemTrash: true,
          configSnapshot,
          undoable: false
        });
      } catch (error) {
        const completedPaths = items.map(item => item.source);
        if (completedPaths.length > 0 && !configSnapshot) {
          try { configSnapshot = this.configService.archivePaths(completedPaths); } catch (_) {}
        }
        if (items.length > 0) {
          try {
            this._record('trash', items, {
              systemTrash: true,
              configSnapshot,
              undoable: false,
              incomplete: items.length !== sources.length
            });
          } catch (_) {}
          throw new TransferNeedsReviewError(`已将 ${items.length} 项移入 Windows 回收站，但批量操作未完整结束：${error.message || String(error)}`);
        }
        throw error;
      }
    }
    const reservedTargets = new Set();
    const items = sources.map(source => {
      const target = this._uniqueTrashTarget(source, reservedTargets);
      reservedTargets.add(target);
      return { source, target };
    });
    await this._executeMoves(items);
    let configSnapshot;
    try {
      configSnapshot = this.configService.archivePaths(sources);
    } catch (error) {
      await this._executeMoves(items.map(item => ({ source: item.target, target: item.source })).reverse());
      throw error;
    }
    try {
      return this._record('trash', items, { configSnapshot });
    } catch (error) {
      const rollbackFailures = [];
      try {
        await this._executeMoves(items.map(item => ({ source: item.target, target: item.source })).reverse());
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      try {
        this.configService.restoreArchivedPaths(sources, configSnapshot || {});
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      if (rollbackFailures.length > 0) {
        throw new TransferNeedsReviewError(`废纸篓历史写入失败且未能完整回滚：${error.message || String(error)}`);
      }
      throw error;
    }
  }

  async createDirectory(parentPath, name) {
    const parent = this._assertDirectory(parentPath);
    const target = path.join(parent, this._assertName(name));
    if (fs.existsSync(target)) throw new Error(`目标已存在：${target}`);
    await fs.promises.mkdir(target);
    try {
      return this._record('create-directory', [{ source: null, target }]);
    } catch (error) {
      try {
        await fs.promises.rmdir(target);
      } catch (_) {
        throw new TransferNeedsReviewError(`新建目录历史写入失败且目录未能清理：${error.message || String(error)}`);
      }
      throw error;
    }
  }

  async createFile(parentPath, name) {
    const parent = this._assertDirectory(parentPath);
    const target = path.join(parent, this._assertName(name));
    let handle;
    try {
      handle = await fs.promises.open(target, 'wx', 0o600);
      const stat = await handle.stat();
      await handle.close();
      handle = null;
      try {
        return this._record('create-file', [{
          source: null,
          target,
          identity: { dev: stat.dev, ino: stat.ino }
        }]);
      } catch (error) {
        try {
          await fs.promises.unlink(target);
        } catch (_) {
          throw new TransferNeedsReviewError(`新建文件历史写入失败且文件未能清理：${error.message || String(error)}`);
        }
        throw error;
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error?.code === 'EEXIST') throw new Error(`目标已存在：${target}`);
      throw error;
    }
  }

  async _pathIdentity(candidatePath) {
    const stat = await fs.promises.lstat(candidatePath);
    return { dev: stat.dev, ino: stat.ino };
  }

  async _assertRedoIdentity(candidatePath, expectedIdentity) {
    if (!expectedIdentity) throw new Error('旧版撤销记录缺少文件身份，不支持安全重做');
    const currentIdentity = await this._pathIdentity(candidatePath);
    if (currentIdentity.dev !== expectedIdentity.dev || currentIdentity.ino !== expectedIdentity.ino) {
      throw new Error(`待重做路径已被其他内容替换：${candidatePath}`);
    }
    return currentIdentity;
  }

  async _prepareRedoState(operation) {
    operation.redoInvalidatedAt = null;
    operation.redoneAt = null;
    operation.redoable = true;
    operation.redoUnavailableReason = null;

    if (operation.type === 'create-directory' || operation.type === 'create-file') return;
    if (operation.type === 'copy' || operation.type === 'import') {
      operation.undoTrashItems = await Promise.all((operation.undoTrashItems || []).map(async item => ({
        ...item,
        identity: await this._pathIdentity(item.target)
      })));
      if (operation.undoTrashItems.length !== operation.items.length) {
        operation.redoable = false;
        operation.redoUnavailableReason = '撤销副本记录不完整，不支持安全重做';
      }
      return;
    }

    if (operation.type === 'move' || operation.type === 'rename' || operation.type === 'trash') {
      operation.redoIdentities = await Promise.all(operation.items.map(async item => ({
        path: item.source,
        identity: await this._pathIdentity(item.source)
      })));
      if (operation.type === 'move') {
        const crossesVolume = operation.items.some(item => {
          const sourceStat = fs.lstatSync(item.source);
          const targetParent = path.dirname(item.target);
          const targetParentStat = fs.statSync(targetParent);
          return this.deviceForPath(item.source, sourceStat) !== this.deviceForPath(targetParent, targetParentStat);
        });
        if (crossesVolume) {
          operation.redoable = false;
          operation.redoUnavailableReason = '跨卷移动撤销后不支持安全重做；请重新发起移动并检查传输计划';
        }
      }
      return;
    }

    operation.redoable = false;
    operation.redoUnavailableReason = '此文件操作类型不支持安全重做';
  }

  _redoIdentityFor(operation, sourcePath) {
    return operation.redoIdentities?.find(item => this._pathKey(item.path) === this._pathKey(sourcePath))?.identity || null;
  }

  _restoreOperationSnapshot(operation, snapshot) {
    for (const key of Object.keys(operation)) delete operation[key];
    Object.assign(operation, snapshot);
  }

  async _rollbackRedoCreate(operation) {
    const item = operation.items[0];
    if (!item?.target || !fs.existsSync(item.target)) return;
    if (item.identity) await this._assertRedoIdentity(item.target, item.identity);
    if (operation.type === 'create-directory') {
      if ((await fs.promises.readdir(item.target)).length > 0) throw new Error('重做创建的文件夹已不再为空');
      await fs.promises.rmdir(item.target);
    } else {
      const stat = await fs.promises.lstat(item.target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) throw new Error('重做创建的文件已发生变化');
      await fs.promises.unlink(item.target);
    }
  }

  async redo(operationId) {
    const history = this._loadHistory();
    const redoCandidates = history.operations
      .filter(item => item.undoable && item.undoneAt && item.redoable && !item.redoInvalidatedAt)
      .sort((left, right) => Number(right.undoneAt) - Number(left.undoneAt));
    const operation = operationId
      ? history.operations.find(item => item.id === operationId)
      : redoCandidates[0];
    if (!operation) throw new Error('没有可重做的文件操作');
    if (!operation.undoable || !operation.undoneAt) throw new Error('该操作尚未撤销或不可重做');
    if (operation.redoInvalidatedAt) throw new Error('执行了新的文件操作，重做链已失效');
    if (!operation.redoable) throw new Error(operation.redoUnavailableReason || '该操作不支持安全重做');

    const operationSnapshot = JSON.parse(JSON.stringify(operation));
    let rollback = async () => {};
    let applied = false;

    try {
      if (operation.type === 'create-directory') {
        const item = operation.items[0];
        const target = this._assertManagedPath(item.target);
        const parent = this._assertDirectory(path.dirname(target));
        if (fs.existsSync(target)) throw new Error(`重做目标已存在：${target}`);
        await fs.promises.mkdir(path.join(parent, path.basename(target)));
        item.identity = await this._pathIdentity(target);
        applied = true;
        rollback = () => this._rollbackRedoCreate(operation);
      } else if (operation.type === 'create-file') {
        const item = operation.items[0];
        const target = this._assertManagedPath(item.target);
        const parent = this._assertDirectory(path.dirname(target));
        if (fs.existsSync(target)) throw new Error(`重做目标已存在：${target}`);
        let handle;
        try {
          handle = await fs.promises.open(path.join(parent, path.basename(target)), 'wx', 0o600);
          const stat = await handle.stat();
          item.identity = { dev: stat.dev, ino: stat.ino };
        } finally {
          if (handle) await handle.close().catch(() => {});
        }
        applied = true;
        rollback = () => this._rollbackRedoCreate(operation);
      } else if (operation.type === 'copy' || operation.type === 'import') {
        const byOriginalTarget = new Map((operation.undoTrashItems || []).map(item => [this._pathKey(item.source), item]));
        const restoreItems = [];
        for (const item of operation.items) {
          const originalTarget = this._assertManagedPath(item.target);
          this._assertDirectory(path.dirname(originalTarget));
          if (fs.existsSync(originalTarget)) throw new Error(`重做目标已存在：${originalTarget}`);
          const trashItem = byOriginalTarget.get(this._pathKey(originalTarget));
          if (!trashItem || !fs.existsSync(trashItem.target)) throw new Error(`撤销副本已不在废纸篓：${originalTarget}`);
          await this._assertRedoIdentity(trashItem.target, trashItem.identity);
          const trashParent = path.resolve(path.dirname(trashItem.target));
          const expectedTrashParent = path.resolve(this.trashDirectoryForSource(originalTarget));
          if (trashParent !== expectedTrashParent) throw new Error('撤销副本不在预期来源卷废纸篓中');
          const trashParentStat = fs.lstatSync(trashParent);
          if (!trashParentStat.isDirectory() || trashParentStat.isSymbolicLink()) throw new Error('来源卷废纸篓已不再安全');
          const targetParentStat = fs.statSync(path.dirname(originalTarget));
          if (this.deviceForPath(trashParent, trashParentStat) !== this.deviceForPath(path.dirname(originalTarget), targetParentStat)) {
            throw new Error('撤销副本与目标不在同一卷，不支持安全重做');
          }
          restoreItems.push({ source: trashItem.target, target: originalTarget });
        }
        await this._executeMoves(restoreItems);
        let configRestored = false;
        try {
          this.configService.restoreArchivedPaths(restoreItems.map(item => item.target), operation.undoConfigSnapshot || {});
          configRestored = true;
        } catch (error) {
          await this._executeMoves(restoreItems.map(item => ({ source: item.target, target: item.source })).reverse());
          throw error;
        }
        applied = true;
        rollback = async () => {
          let archivedSnapshot = null;
          if (configRestored) archivedSnapshot = this.configService.archivePaths(restoreItems.map(item => item.target));
          try {
            await this._executeMoves(restoreItems.map(item => ({ source: item.target, target: item.source })).reverse());
          } catch (error) {
            if (archivedSnapshot) this.configService.restoreArchivedPaths(restoreItems.map(item => item.target), archivedSnapshot);
            throw error;
          }
        };
      } else {
        const forwardItems = operation.items.map(item => ({ source: item.source, target: item.target }));
        const renameSourceKeys = operation.type === 'rename'
          ? new Set(forwardItems.map(item => this._batchRenamePathKey(item.source)))
          : null;
        for (const item of forwardItems) {
          this._assertExistingSource(item.source);
          await this._assertRedoIdentity(item.source, this._redoIdentityFor(operation, item.source));
          if (fs.existsSync(item.target)
              && !this._sameFile(item.source, item.target)
              && !renameSourceKeys?.has(this._batchRenamePathKey(item.target))) {
            throw new Error(`重做目标已存在：${item.target}`);
          }
          if (operation.type === 'trash') {
            const expectedTrash = this._trashDirectoryForExistingSource(item.source);
            if (path.resolve(path.dirname(item.target)) !== path.resolve(expectedTrash)) {
              throw new Error('原废纸篓位置已变化，不支持安全重做');
            }
          } else {
            this._assertManagedPath(item.target);
            this._assertDirectory(path.dirname(item.target));
          }
        }
        const mappings = forwardItems.map(item => ({ from: item.source, to: item.target }));
        if (operation.type === 'move' || operation.type === 'rename') this.configService.validateRebindPaths(mappings);
        if (operation.type === 'rename') {
          this._assertRenameMappingsAvailable(forwardItems);
          await this._executeRenameMappings(forwardItems);
        } else {
          await this._executeMoves(forwardItems);
        }
        let configApplied = false;
        let redoConfigSnapshot = null;
        try {
          if (operation.type === 'trash') {
            redoConfigSnapshot = this.configService.archivePaths(forwardItems.map(item => item.source));
            operation.configSnapshot = redoConfigSnapshot;
          } else {
            this.configService.rebindPaths(mappings);
          }
          configApplied = true;
        } catch (error) {
          const rollbackItems = forwardItems.map(item => ({ source: item.target, target: item.source })).reverse();
          if (operation.type === 'rename') await this._executeRenameMappings(rollbackItems);
          else await this._executeMoves(rollbackItems);
          throw error;
        }
        applied = true;
        rollback = async () => {
          const rollbackItems = forwardItems.map(item => ({ source: item.target, target: item.source })).reverse();
          if (operation.type === 'rename') await this._executeRenameMappings(rollbackItems);
          else await this._executeMoves(rollbackItems);
          if (!configApplied) return;
          if (operation.type === 'trash') {
            this.configService.restoreArchivedPaths(forwardItems.map(item => item.source), redoConfigSnapshot || {});
          } else {
            this.configService.rebindPaths([...mappings].reverse().map(item => ({ from: item.to, to: item.from })));
          }
        };
      }

      operation.undoneAt = null;
      operation.redoneAt = Date.now();
      operation.redoable = false;
      operation.redoUnavailableReason = null;
      this._saveHistory();
      return operation;
    } catch (error) {
      if (applied) {
        try {
          await rollback();
        } catch (rollbackError) {
          this._restoreOperationSnapshot(operation, operationSnapshot);
          throw new TransferNeedsReviewError(`文件重做失败且未能完整回滚：${error.message || String(error)}`);
        }
      }
      this._restoreOperationSnapshot(operation, operationSnapshot);
      throw error;
    }
  }

  async undo(operationId) {
    const history = this._loadHistory();
    const operation = operationId
      ? history.operations.find(item => item.id === operationId)
      : history.operations.find(item => item.undoable && !item.undoneAt);
    if (!operation) throw new Error('没有可撤销的文件操作');
    if (!operation.undoable || operation.undoneAt) throw new Error('该操作已经撤销或不可撤销');

    if (operation.type === 'create-directory') {
      const target = operation.items[0].target;
      if (!fs.existsSync(target)) throw new Error('新建的文件夹已不存在');
      if ((await fs.promises.readdir(target)).length > 0) throw new Error('文件夹不再为空，无法撤销新建操作');
      await fs.promises.rmdir(target);
    } else if (operation.type === 'create-file') {
      const item = operation.items[0];
      const target = this._assertManagedPath(item.target);
      if (!fs.existsSync(target)) throw new Error('新建的文件已不存在');
      const stat = await fs.promises.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('目标已不再是原来的普通文件，无法撤销');
      if (item.identity && (stat.dev !== item.identity.dev || stat.ino !== item.identity.ino)) {
        throw new Error('目标已被其他文件替换，无法撤销');
      }
      if (stat.size !== 0) throw new Error('文件已有内容，无法撤销新建操作');
      await fs.promises.unlink(target);
    } else if (operation.type === 'copy' || operation.type === 'import') {
      const copiedPaths = operation.items.map(item => item.target);
      for (const copiedPath of copiedPaths) {
        if (!fs.existsSync(copiedPath)) throw new Error(`待撤销的副本不存在：${copiedPath}`);
      }
      const reservedTargets = new Set();
      const trashItems = copiedPaths.map(source => {
        const target = this._uniqueTrashTarget(source, reservedTargets);
        reservedTargets.add(target);
        return { source, target };
      });
      await this._executeMoves(trashItems);
      try {
        operation.undoConfigSnapshot = this.configService.archivePaths(copiedPaths);
      } catch (error) {
        await this._executeMoves(trashItems.map(item => ({ source: item.target, target: item.source })).reverse());
        throw error;
      }
      operation.undoTrashItems = trashItems;
    } else {
      const reverseItems = operation.items.map(item => ({ source: item.target, target: item.source })).reverse();
      const renameSourceKeys = operation.type === 'rename'
        ? new Set(reverseItems.map(item => this._batchRenamePathKey(item.source)))
        : null;
      for (const item of reverseItems) {
        if (!fs.existsSync(item.source)) throw new Error(`待恢复路径不存在：${item.source}`);
        if (fs.existsSync(item.target)
            && !this._sameFile(item.source, item.target)
            && !renameSourceKeys?.has(this._batchRenamePathKey(item.target))) {
          throw new Error(`原路径已被占用：${item.target}`);
        }
      }
      if (operation.type === 'move' || operation.type === 'rename') {
        this.configService.validateRebindPaths(reverseItems.map(item => ({ from: item.source, to: item.target })));
      }
      if (operation.type === 'rename') {
        this._assertRenameMappingsAvailable(reverseItems);
        await this._executeRenameMappings(reverseItems);
      } else {
        await this._executeMoves(reverseItems);
      }
      try {
        if (operation.type === 'trash') {
          this.configService.restoreArchivedPaths(operation.items.map(item => item.source), operation.configSnapshot || {});
        } else {
          this.configService.rebindPaths(reverseItems.map(item => ({ from: item.source, to: item.target })));
        }
      } catch (error) {
        const rollbackItems = reverseItems.map(item => ({ source: item.target, target: item.source })).reverse();
        if (operation.type === 'rename') await this._executeRenameMappings(rollbackItems);
        else await this._executeMoves(rollbackItems);
        throw error;
      }
    }

    const latestUndoAt = history.operations.reduce((latest, item) => Math.max(latest, Number(item.undoneAt) || 0), 0);
    operation.undoneAt = Math.max(Date.now(), latestUndoAt + 1);
    await this._prepareRedoState(operation);
    this._saveHistory();
    return operation;
  }
}

const singleton = new FileOperationService();
module.exports = singleton;
module.exports.FileOperationService = FileOperationService;
