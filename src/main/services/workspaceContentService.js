const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { TextDecoder } = require('util');
const configService = require('./configService');

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp']
]);
const THUMBNAIL_WIDTH = 192;
const THUMBNAIL_HEIGHT = 128;
const MAX_THUMBNAIL_DATA_URL_CHARACTERS = 512 * 1024;
const SAFE_THUMBNAIL_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i;
const DEFAULT_PREVIEW_PAGE_BYTES = 256 * 1024;
const DEFAULT_MAX_PROGRESSIVE_TEXT_BYTES = 8 * 1024 * 1024;
const DEFAULT_PREVIEW_PAGE_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEW_PAGE_SESSIONS = 64;
const DEFAULT_MAX_BINARY_PLIST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BINARY_PLIST_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_BINARY_PLIST_CONVERSION_TIMEOUT_MS = 10000;

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const CODE_LANGUAGES = new Map([
  ['.json', 'json'], ['.jsonc', 'json'], ['.yaml', 'yaml'], ['.yml', 'yaml'],
  ['.js', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.jsx', 'javascript'],
  ['.css', 'css'], ['.scss', 'scss'], ['.less', 'less'], ['.html', 'html'],
  ['.xml', 'xml'], ['.svg', 'xml'], ['.plist', 'plist'], ['.py', 'python'], ['.rb', 'ruby'],
  ['.go', 'go'], ['.rs', 'rust'], ['.java', 'java'], ['.kt', 'kotlin'],
  ['.c', 'c'], ['.h', 'c'], ['.cpp', 'cpp'], ['.cc', 'cpp'], ['.hpp', 'cpp'],
  ['.swift', 'swift'], ['.sh', 'shell'], ['.zsh', 'shell'], ['.fish', 'shell'],
  ['.sql', 'sql'], ['.toml', 'toml'], ['.ini', 'ini'], ['.env', 'env'],
  ['.csv', 'csv'], ['.tsv', 'tsv'], ['.log', 'log'], ['.txt', 'text']
]);

const TEXT_FILE_NAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc'
]);

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.parcel-cache', 'out', 'target'
]);

const INDEX_SCHEMA_VERSION = 2;
const MAX_REPOSITORY_GROUPS = 24;
const MAX_REPOSITORY_TAGS = 64;
const DEFAULT_CONTENT_SEARCH_FILE_BYTES = 512 * 1024;
const DEFAULT_CONTENT_SEARCH_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_CONTENT_SEARCH_FILES = 2500;
const MAX_CONTENT_SNIPPET_LENGTH = 240;
const CONTENT_SEARCH_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.log', '.csv', '.tsv',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.plist', '.ini', '.conf', '.config', '.properties',
  '.xml', '.svg', '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.swift',
  '.sh', '.zsh', '.fish', '.sql', '.graphql', '.gql', '.proto', '.gradle'
]);
const CONTENT_SEARCH_FILE_NAMES = new Set([
  ...TEXT_FILE_NAMES,
  'license', 'notice', 'readme', 'changelog', 'contributing'
]);

function convertBinaryPlistWithPlutil(sourcePath, options = {}) {
  const maxOutputBytes = Math.max(32, Number(options.maxOutputBytes) || DEFAULT_MAX_BINARY_PLIST_OUTPUT_BYTES);
  const timeout = Math.max(1000, Number(options.timeoutMs) || DEFAULT_BINARY_PLIST_CONVERSION_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/plutil',
      ['-convert', 'xml1', '-o', '-', '--', sourcePath],
      { encoding: 'utf8', timeout, maxBuffer: maxOutputBytes },
      (error, stdout) => {
        if (error) {
          const conversionError = new Error('系统 plist 转换失败');
          conversionError.code = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 'BINARY_PLIST_OUTPUT_TOO_LARGE'
            : 'BINARY_PLIST_CONVERSION_FAILED';
          reject(conversionError);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function utf8CompletePrefixLength(buffer) {
  const length = buffer.length;
  if (!length) return 0;
  let continuationBytes = 0;
  let index = length - 1;
  while (index >= 0 && continuationBytes < 3 && (buffer[index] & 0xc0) === 0x80) {
    continuationBytes += 1;
    index -= 1;
  }
  if (index < 0) return length - continuationBytes;
  const lead = buffer[index];
  const expectedBytes = (lead & 0x80) === 0 ? 1
    : (lead & 0xe0) === 0xc0 ? 2
      : (lead & 0xf0) === 0xe0 ? 3
        : (lead & 0xf8) === 0xf0 ? 4
          : 1;
  return continuationBytes + 1 < expectedBytes ? index : length;
}

class IndexBuildCancelledError extends Error {
  constructor() {
    super('索引构建已取消');
    this.name = 'IndexBuildCancelledError';
    this.code = 'INDEX_BUILD_CANCELLED';
  }
}

class ContentSearchCancelledError extends Error {
  constructor() {
    super('文件内容搜索已取消');
    this.name = 'ContentSearchCancelledError';
    this.code = 'CONTENT_SEARCH_CANCELLED';
  }
}

class WorkspaceContentService {
  constructor(options = {}) {
    this.configService = options.configService || configService;
    this.maxTextBytes = options.maxTextBytes || 1024 * 1024;
    this.maxImageBytes = options.maxImageBytes || 12 * 1024 * 1024;
    this.platform = options.platform || process.platform;
    this.maxBinaryPlistBytes = Math.max(8, Number(options.maxBinaryPlistBytes) || DEFAULT_MAX_BINARY_PLIST_BYTES);
    this.maxBinaryPlistOutputBytes = Math.max(32, Number(options.maxBinaryPlistOutputBytes) || DEFAULT_MAX_BINARY_PLIST_OUTPUT_BYTES);
    this.binaryPlistConversionTimeoutMs = Math.max(1000, Number(options.binaryPlistConversionTimeoutMs) || DEFAULT_BINARY_PLIST_CONVERSION_TIMEOUT_MS);
    this.convertBinaryPlist = Object.prototype.hasOwnProperty.call(options, 'convertBinaryPlist')
      ? (typeof options.convertBinaryPlist === 'function' ? options.convertBinaryPlist : null)
      : (this.platform === 'darwin' ? convertBinaryPlistWithPlutil : null);
    this.previewPageBytes = Math.max(4, Number(options.previewPageBytes) || DEFAULT_PREVIEW_PAGE_BYTES);
    this.maxProgressiveTextBytes = Math.max(this.maxTextBytes, Number(options.maxProgressiveTextBytes) || DEFAULT_MAX_PROGRESSIVE_TEXT_BYTES);
    this.previewPageSessionTtlMs = Math.max(1000, Number(options.previewPageSessionTtlMs) || DEFAULT_PREVIEW_PAGE_SESSION_TTL_MS);
    this.previewPageSessions = new Map();
    this.maxThumbnailCacheEntries = Math.max(1, Number(options.maxThumbnailCacheEntries) || 128);
    this.createThumbnail = typeof options.createThumbnail === 'function' ? options.createThumbnail : null;
    this.thumbnailCache = new Map();
    this.maxIndexEntries = options.maxIndexEntries || 100000;
    this.indexFilePath = options.indexFilePath ? path.resolve(options.indexFilePath) : null;
    this.scanYieldEvery = Math.max(1, Number(options.scanYieldEvery) || 64);
    this.scanYield = options.scanYield || (() => new Promise(resolve => setImmediate(resolve)));
    this.maxContentSearchFileBytes = Math.max(4096, Number(options.maxContentSearchFileBytes) || DEFAULT_CONTENT_SEARCH_FILE_BYTES);
    this.maxContentSearchTotalBytes = Math.max(this.maxContentSearchFileBytes, Number(options.maxContentSearchTotalBytes) || DEFAULT_CONTENT_SEARCH_TOTAL_BYTES);
    this.maxContentSearchFiles = Math.max(1, Number(options.maxContentSearchFiles) || DEFAULT_CONTENT_SEARCH_FILES);
    this.contentSearchYieldEvery = Math.max(1, Number(options.contentSearchYieldEvery) || 16);
    this.contentSearchYield = options.contentSearchYield || (() => new Promise(resolve => setImmediate(resolve)));
    this.indexCache = null;
    this._staleIndex = null;
    this._buildPromise = null;
    this._indexGeneration = 0;
    this._latestSearchRequestId = null;
    this._contentSearchGeneration = 0;
    this._activeContentSearch = null;
    this._contentSearchStatus = this._idleContentSearchStatus();
    this._requiresRefresh = false;
    this._indexStatus = this._idleIndexStatus();
  }

  configurePersistence(indexFilePath) {
    const resolved = indexFilePath ? path.resolve(indexFilePath) : null;
    if (resolved === this.indexFilePath) return;
    const firstConfiguration = !this.indexFilePath && !this.indexCache && !this._buildPromise;
    this.indexFilePath = resolved;
    if (firstConfiguration) return;
    this.invalidateIndex();
  }

  configureThumbnailProvider(provider) {
    if (typeof provider !== 'function') throw new TypeError('缩略图提供器必须是函数');
    this.createThumbnail = provider;
    this.thumbnailCache.clear();
  }

  _idleIndexStatus() {
    return {
      phase: 'idle',
      ready: false,
      building: false,
      stale: false,
      persisted: false,
      incremental: false,
      indexedCount: 0,
      builtAt: null,
      startedAt: null,
      truncated: false,
      processedDirectories: 0,
      discoveredDirectories: 0,
      reusedDirectories: 0,
      scannedDirectories: 0,
      error: null,
      persistenceError: null
    };
  }

  _idleContentSearchStatus() {
    return {
      phase: 'idle',
      requestId: null,
      candidateFiles: 0,
      plannedFiles: 0,
      scannedFiles: 0,
      bytesRead: 0,
      matchedFiles: 0,
      skippedLargeFiles: 0,
      skippedUnsafeFiles: 0,
      fileLimitReached: false,
      byteLimitReached: false,
      error: null
    };
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _configuredRoots() {
    return (this.configService.getTreeRoots() || [])
      .map(root => ({ ...root, path: path.resolve(root.path) }))
      .filter(root => fs.existsSync(root.path));
  }

  _assertReadablePath(candidatePath) {
    const resolved = path.resolve(String(candidatePath || ''));
    const roots = this._configuredRoots();
    const lexicalRoot = roots.find(root => this._pathIsWithin(resolved, root.path));
    if (!lexicalRoot) throw new Error(`路径不在受管开发目录中：${resolved}`);
    if (!fs.existsSync(resolved)) throw new Error(`路径不存在：${resolved}`);

    const realPath = fs.realpathSync.native(resolved);
    const realRoot = fs.realpathSync.native(lexicalRoot.path);
    if (!this._pathIsWithin(realPath, realRoot)) {
      throw new Error(`符号链接指向受管目录之外：${resolved}`);
    }
    return { resolved, realPath, root: lexicalRoot, realRoot };
  }

  async getPreview(candidatePath, options = {}) {
    const { resolved, realPath } = this._assertReadablePath(candidatePath);
    const stat = await fs.promises.stat(realPath);
    const base = {
      name: path.basename(resolved) || resolved,
      path: resolved,
      size: stat.size,
      modifiedTime: stat.mtime.toISOString()
    };

    if (stat.isDirectory()) return this._previewDirectory(realPath, base);
    if (!stat.isFile()) {
      return { ...base, kind: 'unsupported', reason: '暂不支持预览此项目类型' };
    }

    const extension = path.extname(resolved).toLowerCase();
    const imageMimeType = IMAGE_TYPES.get(extension);
    if (imageMimeType) {
      if (stat.size > this.maxImageBytes) {
        return { ...base, kind: 'unsupported', reason: `图片过大，预览上限为 ${this._formatBytes(this.maxImageBytes)}` };
      }
      const buffer = await fs.promises.readFile(realPath);
      return {
        ...base,
        kind: 'image',
        mimeType: imageMimeType,
        dataUrl: `data:${imageMimeType};base64,${buffer.toString('base64')}`
      };
    }

    return this._previewTextFile(realPath, resolved, stat, base, options);
  }

  async convertBinaryPlistPreview(candidatePath) {
    const { resolved, realPath } = this._assertReadablePath(candidatePath);
    if (path.extname(resolved).toLowerCase() !== '.plist') {
      throw new Error('仅支持转换扩展名为 .plist 的文件');
    }

    const stat = await fs.promises.stat(realPath);
    if (!stat.isFile()) throw new Error('只有二进制 plist 文件可以转换预览');
    if (stat.size > this.maxBinaryPlistBytes) {
      throw new Error(`二进制 plist 超过转换上限 ${this._formatBytes(this.maxBinaryPlistBytes)}`);
    }

    const prefix = await this._readTextChunk(realPath, 0, Math.min(8, stat.size), stat.size);
    if (prefix.buffer.toString('ascii') !== 'bplist00') {
      throw new Error('此文件不是二进制 plist，无需转换');
    }
    if (this.platform !== 'darwin' || typeof this.convertBinaryPlist !== 'function') {
      throw new Error('当前平台未提供二进制 plist 的只读转换能力');
    }

    const revision = this._fileRevision(stat);
    let converted;
    try {
      converted = await this.convertBinaryPlist(realPath, {
        maxOutputBytes: this.maxBinaryPlistOutputBytes,
        timeoutMs: this.binaryPlistConversionTimeoutMs
      });
    } catch (error) {
      if (error?.code === 'BINARY_PLIST_OUTPUT_TOO_LARGE') {
        throw new Error(`plist 转换结果超过预览上限 ${this._formatBytes(this.maxBinaryPlistOutputBytes)}`);
      }
      throw new Error('无法使用系统 plutil 生成只读预览');
    }

    const content = Buffer.isBuffer(converted) ? converted.toString('utf8') : String(converted || '');
    if (Buffer.byteLength(content, 'utf8') > this.maxBinaryPlistOutputBytes) {
      throw new Error(`plist 转换结果超过预览上限 ${this._formatBytes(this.maxBinaryPlistOutputBytes)}`);
    }

    const verifiedPath = this._assertReadablePath(resolved);
    const verifiedStat = await fs.promises.stat(verifiedPath.realPath);
    if (verifiedPath.realPath !== realPath || this._fileRevision(verifiedStat) !== revision) {
      throw new Error('plist 在转换期间发生变化，请重新打开预览');
    }
    if (!/<plist(?:\s[^>]*)?\s*\/?>/i.test(content) || content.includes('\0')) {
      throw new Error('系统转换器没有返回有效的 XML plist');
    }

    return {
      name: path.basename(resolved) || resolved,
      path: resolved,
      size: stat.size,
      modifiedTime: stat.mtime.toISOString(),
      kind: 'code',
      language: 'plist',
      content,
      truncated: false,
      convertedFrom: 'binary-plist',
      readOnly: true
    };
  }

  async getThumbnail(candidatePath) {
    const { resolved, realPath } = this._assertReadablePath(candidatePath);
    const stat = await fs.promises.stat(realPath);
    const base = {
      name: path.basename(resolved) || resolved,
      path: resolved,
      size: stat.size,
      modifiedTime: stat.mtime.toISOString()
    };
    if (!stat.isFile()) return { ...base, kind: 'unsupported', reason: '只有图片文件可生成缩略图' };

    const mimeType = IMAGE_TYPES.get(path.extname(resolved).toLowerCase());
    if (!mimeType) return { ...base, kind: 'unsupported', reason: '此文件格式不生成缩略图' };
    if (stat.size > this.maxImageBytes) {
      return { ...base, kind: 'unsupported', reason: `图片过大，缩略图来源上限为 ${this._formatBytes(this.maxImageBytes)}` };
    }
    if (typeof this.createThumbnail !== 'function') {
      return { ...base, kind: 'unsupported', reason: '当前平台未提供缩略图生成能力' };
    }

    const cacheKey = [realPath, stat.size, stat.mtimeMs, stat.ctimeMs].join('\0');
    const cachedDataUrl = this.thumbnailCache.get(cacheKey);
    if (cachedDataUrl) {
      this.thumbnailCache.delete(cacheKey);
      this.thumbnailCache.set(cacheKey, cachedDataUrl);
      return { ...base, kind: 'thumbnail', mimeType: 'image/png', dataUrl: cachedDataUrl, cached: true };
    }

    let dataUrl = '';
    try {
      dataUrl = String(await this.createThumbnail(realPath, {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT
      }) || '');
    } catch (_) {
      return { ...base, kind: 'unsupported', reason: '无法安全生成此图片的缩略图' };
    }
    if (dataUrl.length > MAX_THUMBNAIL_DATA_URL_CHARACTERS || !SAFE_THUMBNAIL_DATA_URL.test(dataUrl)) {
      return { ...base, kind: 'unsupported', reason: '缩略图输出格式不受支持' };
    }

    this.thumbnailCache.set(cacheKey, dataUrl);
    while (this.thumbnailCache.size > this.maxThumbnailCacheEntries) {
      this.thumbnailCache.delete(this.thumbnailCache.keys().next().value);
    }
    return { ...base, kind: 'thumbnail', mimeType: 'image/png', dataUrl, cached: false };
  }

  async _previewDirectory(realPath, base) {
    const entries = await fs.promises.readdir(realPath, { withFileTypes: true });
    const directories = entries.filter(entry => entry.isDirectory()).length;
    const files = entries.filter(entry => entry.isFile()).length;
    const symlinks = entries.filter(entry => entry.isSymbolicLink()).length;
    return {
      ...base,
      kind: 'directory',
      isGitRepo: entries.some(entry => entry.name === '.git' && entry.isDirectory()),
      directoryCount: directories,
      fileCount: files,
      symlinkCount: symlinks,
      samples: entries
        .filter(entry => !entry.name.startsWith('.'))
        .slice(0, 12)
        .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
    };
  }

  async _readTextChunk(realPath, startOffset, maximumBytes, fileSize) {
    const bytesToRead = Math.min(Math.max(0, fileSize - startOffset), maximumBytes + 3);
    if (!bytesToRead) return { buffer: Buffer.alloc(0), bytesRead: 0 };
    const handle = await fs.promises.open(realPath, 'r');
    let buffer;
    try {
      buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, startOffset);
      buffer = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const candidate = buffer.subarray(0, Math.min(maximumBytes, buffer.length));
    let completeLength = utf8CompletePrefixLength(candidate);
    if (!completeLength && buffer.length > candidate.length) completeLength = utf8CompletePrefixLength(buffer);
    return { buffer: buffer.subarray(0, completeLength), bytesRead: completeLength };
  }

  _fileRevision(stat) {
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
  }

  _issuePreviewPageSession(session) {
    const now = Date.now();
    for (const [token, candidate] of this.previewPageSessions) {
      if (candidate.expiresAt <= now) this.previewPageSessions.delete(token);
    }
    while (this.previewPageSessions.size >= MAX_PREVIEW_PAGE_SESSIONS) {
      this.previewPageSessions.delete(this.previewPageSessions.keys().next().value);
    }
    const token = crypto.randomUUID();
    this.previewPageSessions.set(token, { ...session, expiresAt: now + this.previewPageSessionTtlMs });
    return token;
  }

  _attachPreviewPaging(preview, { resolved, realPath, stat, endOffset }) {
    if (!preview.truncated) return preview;
    const maximumOffset = Math.min(stat.size, this.maxProgressiveTextBytes);
    const common = {
      ...preview,
      paged: true,
      startOffset: 0,
      endOffset,
      totalSize: stat.size,
      startLine: 1
    };
    if (endOffset >= maximumOffset) {
      return { ...common, nextPageToken: null, limitReached: stat.size > maximumOffset };
    }
    const nextLineNumber = 1 + (String(preview.content || '').match(/\n/g) || []).length;
    const nextPageToken = this._issuePreviewPageSession({
      resolved,
      realPath,
      revision: this._fileRevision(stat),
      nextOffset: endOffset,
      nextLineNumber,
      maximumOffset,
      language: preview.language || 'text',
      previewKind: preview.kind
    });
    return { ...common, nextPageToken, limitReached: false };
  }

  async getTextPage(pageToken) {
    const token = String(pageToken || '');
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('文本分页令牌无效');
    const session = this.previewPageSessions.get(token);
    this.previewPageSessions.delete(token);
    if (!session || session.expiresAt <= Date.now()) {
      throw new Error('文本分页令牌已过期或已使用，请重新打开预览');
    }

    const { resolved, realPath } = this._assertReadablePath(session.resolved);
    if (realPath !== session.realPath) throw new Error('文件位置在预览后发生变化，请重新打开预览');
    const stat = await fs.promises.stat(realPath);
    if (!stat.isFile() || this._fileRevision(stat) !== session.revision) {
      throw new Error('文件在预览后发生变化，请重新打开预览');
    }
    if (session.nextOffset >= session.maximumOffset || session.nextOffset >= stat.size) {
      throw new Error('此预览已没有可继续读取的内容');
    }

    const maximumBytes = Math.min(this.previewPageBytes, session.maximumOffset - session.nextOffset);
    const chunk = await this._readTextChunk(realPath, session.nextOffset, maximumBytes, stat.size);
    if (!chunk.bytesRead) throw new Error('无法继续读取文本内容');
    if (chunk.buffer.subarray(0, Math.min(chunk.buffer.length, 8192)).includes(0)) {
      throw new Error('后续内容包含二进制数据，已停止渐进预览');
    }
    const content = chunk.buffer.toString('utf8');
    const endOffset = session.nextOffset + chunk.bytesRead;
    const maximumOffset = Math.min(stat.size, session.maximumOffset);
    const hasMore = endOffset < maximumOffset;
    const nextLineNumber = session.nextLineNumber + (content.match(/\n/g) || []).length;
    const nextPageToken = hasMore
      ? this._issuePreviewPageSession({ ...session, nextOffset: endOffset, nextLineNumber })
      : null;
    return {
      kind: 'text-page',
      name: path.basename(resolved) || resolved,
      path: resolved,
      previewKind: session.previewKind,
      language: session.language,
      content,
      startOffset: session.nextOffset,
      endOffset,
      totalSize: stat.size,
      startLine: session.nextLineNumber,
      nextPageToken,
      hasMore,
      limitReached: !hasMore && endOffset < stat.size
    };
  }

  releaseTextPage(pageToken) {
    const token = String(pageToken || '');
    if (!/^[0-9a-f-]{36}$/i.test(token)) return false;
    return this.previewPageSessions.delete(token);
  }

  async _previewTextFile(realPath, resolved, stat, base, options = {}) {
    const chunk = await this._readTextChunk(realPath, 0, Math.min(stat.size, this.maxTextBytes), stat.size);
    const buffer = chunk.buffer;

    const extension = path.extname(resolved).toLowerCase();
    const lowerName = path.basename(resolved).toLowerCase();
    if (extension === '.plist' && buffer.subarray(0, 8).toString('ascii').startsWith('bplist')) {
      const canConvertBinaryPlist = this.platform === 'darwin' && typeof this.convertBinaryPlist === 'function';
      return {
        ...base,
        kind: 'unsupported',
        format: 'binary-plist',
        canConvertBinaryPlist,
        reason: canConvertBinaryPlist
          ? '检测到二进制 plist；可使用系统 plutil 生成只读 XML 预览'
          : '检测到二进制 plist；当前平台未提供只读转换器，请使用默认应用打开'
      };
    }
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
      return { ...base, kind: 'unsupported', reason: '检测到二进制内容，请使用默认应用打开' };
    }

    const truncated = stat.size > chunk.bytesRead;
    let content = buffer.toString('utf8');
    if (extension === '.json' && !truncated) {
      try { content = JSON.stringify(JSON.parse(content), null, 2); } catch (_) {}
    }

    if (MARKDOWN_EXTENSIONS.has(extension)) {
      const preview = { ...base, kind: 'markdown', content, truncated, language: 'markdown' };
      return options.enablePaging === true
        ? this._attachPreviewPaging(preview, { resolved, realPath, stat, endOffset: chunk.bytesRead })
        : preview;
    }
    const language = CODE_LANGUAGES.get(extension)
      || (TEXT_FILE_NAMES.has(lowerName) ? 'text' : null);
    const preview = {
      ...base,
      kind: language ? 'code' : 'text',
      content,
      truncated,
      language: language || 'text'
    };
    return options.enablePaging === true
      ? this._attachPreviewPaging(preview, { resolved, realPath, stat, endOffset: chunk.bytesRead })
      : preview;
  }

  _formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${Math.ceil(bytes / (1024 * 1024))} MB`;
  }

  invalidateIndex() {
    this.cancelContentSearch();
    if (this.indexCache) this._staleIndex = this.indexCache;
    if (this._buildPromise?.token) this._buildPromise.token.cancelled = true;
    this._indexGeneration += 1;
    this.indexCache = null;
    this._requiresRefresh = true;
    this._indexStatus = {
      ...this._indexStatus,
      phase: 'stale',
      ready: false,
      building: false,
      stale: true,
      error: null
    };
    return { invalidated: true, status: this.getIndexStatus() };
  }

  cancelIndexBuild() {
    const active = this._buildPromise?.token;
    if (!active || active.cancelled) return { cancelled: false, status: this.getIndexStatus() };
    active.cancelled = true;
    this._indexGeneration += 1;
    this._requiresRefresh = true;
    this._indexStatus = {
      ...this._indexStatus,
      phase: 'cancelled',
      ready: Boolean(this.indexCache),
      building: false,
      stale: true,
      error: null
    };
    return { cancelled: true, status: this.getIndexStatus() };
  }

  getIndexStatus() {
    return {
      ...this._indexStatus,
      ready: Boolean(this.indexCache),
      building: this._indexStatus.phase === 'building',
      indexedCount: this._indexStatus.phase === 'building'
        ? this._indexStatus.indexedCount
        : (this.indexCache?.entries.length || this._indexStatus.indexedCount || 0),
      builtAt: this.indexCache?.builtAt || this._indexStatus.builtAt || null,
      truncated: Boolean(this.indexCache?.truncated || this._indexStatus.truncated),
      contentSearch: { ...this._contentSearchStatus }
    };
  }

  cancelContentSearch() {
    const active = this._activeContentSearch;
    if (!active || active.cancelled) {
      return { cancelled: false, status: { ...this._contentSearchStatus } };
    }
    active.cancelled = true;
    this._contentSearchGeneration += 1;
    this._contentSearchStatus = {
      ...this._contentSearchStatus,
      phase: 'cancelled',
      error: null
    };
    return { cancelled: true, status: { ...this._contentSearchStatus } };
  }

  _normalizeMetadataText(value, maxLength = 80) {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  _normalizeMetadataColor(value) {
    const color = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#86868b';
  }

  _metadataPathKey(candidatePath) {
    const resolved = path.resolve(String(candidatePath || ''));
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  }

  _getRepositoryMetadataByPath() {
    const result = new Map();
    if (
      typeof this.configService.getRegistry !== 'function'
      || typeof this.configService.getGroups !== 'function'
      || typeof this.configService.getTags !== 'function'
    ) return result;

    try {
      const registry = this.configService.getRegistry() || {};
      const groupsData = this.configService.getGroups() || {};
      const tagsData = this.configService.getTags() || {};
      const activeRepos = (Array.isArray(registry.repos) ? registry.repos : [])
        .filter(repo => !repo?.archived && repo?.id && repo?.path);
      const metadataByRepoId = new Map(activeRepos.map(repo => [String(repo.id), {
        groups: [],
        tags: []
      }]));

      for (const group of Array.isArray(groupsData.groups) ? groupsData.groups : []) {
        const name = this._normalizeMetadataText(group?.name);
        if (!name) continue;
        const descriptor = {
          id: this._normalizeMetadataText(group?.id, 120),
          name,
          color: this._normalizeMetadataColor(group?.color)
        };
        for (const repoId of Array.isArray(group?.repoIds) ? group.repoIds : []) {
          const metadata = metadataByRepoId.get(String(repoId));
          if (!metadata || metadata.groups.length >= MAX_REPOSITORY_GROUPS) continue;
          if (!metadata.groups.some(item => item.id === descriptor.id && item.name === descriptor.name)) {
            metadata.groups.push(descriptor);
          }
        }
      }

      const tagsById = new Map();
      for (const tag of Array.isArray(tagsData.tags) ? tagsData.tags : []) {
        const id = this._normalizeMetadataText(tag?.id, 120);
        const name = this._normalizeMetadataText(tag?.name);
        if (!id || !name) continue;
        tagsById.set(id, { id, name, color: this._normalizeMetadataColor(tag?.color) });
      }
      const repoTags = tagsData.repoTags && typeof tagsData.repoTags === 'object' ? tagsData.repoTags : {};
      for (const [repoId, tagIds] of Object.entries(repoTags)) {
        const metadata = metadataByRepoId.get(String(repoId));
        if (!metadata || !Array.isArray(tagIds)) continue;
        for (const tagId of tagIds) {
          const tag = tagsById.get(String(tagId));
          if (!tag || metadata.tags.length >= MAX_REPOSITORY_TAGS) continue;
          if (!metadata.tags.some(item => item.id === tag.id)) metadata.tags.push(tag);
        }
      }

      for (const repo of activeRepos) {
        result.set(this._metadataPathKey(repo.path), metadataByRepoId.get(String(repo.id)) || { groups: [], tags: [] });
      }
    } catch (_) {
      return new Map();
    }
    return result;
  }

  _isContentSearchCandidate(entry) {
    if (!entry || entry.type !== 'file') return false;
    const extension = String(entry.extension || path.extname(entry.name || '')).toLowerCase();
    const lowerName = String(entry.name || '').toLowerCase();
    return CONTENT_SEARCH_EXTENSIONS.has(extension) || CONTENT_SEARCH_FILE_NAMES.has(lowerName);
  }

  _assertContentSearchActive(token) {
    if (
      token.cancelled
      || token.generation !== this._contentSearchGeneration
      || this._latestSearchRequestId !== token.requestId
    ) {
      throw new ContentSearchCancelledError();
    }
  }

  _contentMatchSnippet(content, contentLower, tokens) {
    const firstMatchIndex = tokens.reduce((earliest, token) => {
      const index = contentLower.indexOf(token);
      return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
    }, -1);
    if (firstMatchIndex < 0) return null;
    const lineStart = content.lastIndexOf('\n', firstMatchIndex - 1) + 1;
    const nextNewline = content.indexOf('\n', firstMatchIndex);
    const lineEnd = nextNewline < 0 ? content.length : nextNewline;
    let snippet = content.slice(lineStart, lineEnd)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!snippet) {
      snippet = content.slice(Math.max(0, firstMatchIndex - 80), firstMatchIndex + 160)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (snippet.length > MAX_CONTENT_SNIPPET_LENGTH) {
      const matchOffset = Math.max(0, firstMatchIndex - lineStart);
      const sliceStart = Math.max(0, Math.min(matchOffset - 70, snippet.length - MAX_CONTENT_SNIPPET_LENGTH));
      snippet = `${sliceStart > 0 ? '…' : ''}${snippet.slice(sliceStart, sliceStart + MAX_CONTENT_SNIPPET_LENGTH)}${sliceStart + MAX_CONTENT_SNIPPET_LENGTH < snippet.length ? '…' : ''}`;
    }
    return {
      line: content.slice(0, firstMatchIndex).split('\n').length,
      snippet
    };
  }

  _decodeContentSearchBuffer(contentBuffer) {
    try {
      if (contentBuffer.length >= 2 && contentBuffer[0] === 0xff && contentBuffer[1] === 0xfe) {
        return new TextDecoder('utf-16le', { fatal: true }).decode(contentBuffer.subarray(2));
      }
      if (contentBuffer.length >= 2 && contentBuffer[0] === 0xfe && contentBuffer[1] === 0xff) {
        return new TextDecoder('utf-16be', { fatal: true }).decode(contentBuffer.subarray(2));
      }
      if (contentBuffer.subarray(0, Math.min(contentBuffer.length, 8192)).includes(0)) return null;
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contentBuffer);
    } catch (_) {
      return null;
    }
  }

  async _readContentSearchFile(entry, tokens, remainingBytes, rootContexts) {
    try {
      const configuredRoot = rootContexts.get(path.resolve(entry.rootPath));
      if (!configuredRoot) return { skippedUnsafe: true };
      const logicalPath = path.resolve(entry.path);
      if (!this._pathIsWithin(logicalPath, configuredRoot.path)) return { skippedUnsafe: true };
      const lexicalStat = await fs.promises.lstat(logicalPath);
      if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) return { skippedUnsafe: true };
      if (lexicalStat.size > this.maxContentSearchFileBytes) return { skippedLarge: true };
      if (lexicalStat.size > remainingBytes) return { byteLimitReached: true };

      const realPath = await fs.promises.realpath(logicalPath);
      if (!this._pathIsWithin(realPath, configuredRoot.realPath)) return { skippedUnsafe: true };

      let handle;
      try {
        let flags = fs.constants.O_RDONLY;
        if (process.platform !== 'win32' && Number.isInteger(fs.constants.O_NOFOLLOW)) flags |= fs.constants.O_NOFOLLOW;
        handle = await fs.promises.open(logicalPath, flags);
        const openedStat = await handle.stat();
        if (!openedStat.isFile()) return { skippedUnsafe: true };
        if (openedStat.size > this.maxContentSearchFileBytes) return { skippedLarge: true };
        if (openedStat.size > remainingBytes) return { byteLimitReached: true };
        const buffer = Buffer.alloc(openedStat.size);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const contentBuffer = buffer.subarray(0, offset);
        const content = this._decodeContentSearchBuffer(contentBuffer);
        if (content === null) return { bytesRead: offset, skippedUnsafe: true };
        const contentLower = content.toLocaleLowerCase('zh-CN');
        if (!tokens.every(token => contentLower.includes(token))) return { bytesRead: offset, match: null };
        return {
          bytesRead: offset,
          match: this._contentMatchSnippet(content, contentLower, tokens)
        };
      } finally {
        if (handle) await handle.close();
      }
    } catch (_) {
      return { skippedUnsafe: true };
    }
  }

  async _searchFileContents(index, normalizedQuery, options, requestId) {
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
    const requestedType = ['file', 'directory', 'repository'].includes(options.type) ? options.type : 'all';
    const allCandidates = requestedType === 'directory' || requestedType === 'repository'
      ? []
      : index.entries.filter(entry => this._isContentSearchCandidate(entry));
    const candidates = allCandidates.slice(0, this.maxContentSearchFiles);
    const rootContexts = new Map(this._configuredRoots().map(root => [path.resolve(root.path), {
      path: path.resolve(root.path),
      realPath: fs.realpathSync.native(root.path)
    }]));
    const token = {
      requestId,
      generation: ++this._contentSearchGeneration,
      cancelled: false
    };
    if (this._activeContentSearch) this._activeContentSearch.cancelled = true;
    this._activeContentSearch = token;
    const status = {
      ...this._idleContentSearchStatus(),
      phase: 'scanning',
      requestId,
      candidateFiles: allCandidates.length,
      plannedFiles: candidates.length,
      fileLimitReached: allCandidates.length > candidates.length
    };
    this._contentSearchStatus = status;

    const matches = [];
    let totalMatches = 0;
    try {
      for (const entry of candidates) {
        this._assertContentSearchActive(token);
        const remainingBytes = this.maxContentSearchTotalBytes - status.bytesRead;
        if (remainingBytes <= 0) {
          status.byteLimitReached = true;
          break;
        }
        const inspected = await this._readContentSearchFile(entry, tokens, remainingBytes, rootContexts);
        this._assertContentSearchActive(token);
        status.scannedFiles += 1;
        status.bytesRead += Number(inspected.bytesRead || 0);
        if (inspected.skippedLarge) status.skippedLargeFiles += 1;
        if (inspected.skippedUnsafe) status.skippedUnsafeFiles += 1;
        if (inspected.byteLimitReached) {
          status.byteLimitReached = true;
          break;
        }
        if (inspected.match) {
          totalMatches += 1;
          status.matchedFiles = totalMatches;
          if (matches.length < limit) matches.push({ ...entry, contentMatch: inspected.match });
        }
        if (status.scannedFiles % this.contentSearchYieldEvery === 0) {
          await this.contentSearchYield();
        }
      }
      this._assertContentSearchActive(token);
      matches.sort((left, right) => (
        left.name.localeCompare(right.name, 'zh-CN')
        || left.path.localeCompare(right.path, 'zh-CN')
      ));
      status.phase = 'ready';
      if (this._activeContentSearch === token) this._contentSearchStatus = { ...status };
      return {
        requestId,
        cancelled: false,
        items: matches,
        totalMatches,
        indexedCount: index.entries.length,
        builtAt: index.builtAt,
        truncated: index.truncated,
        indexSource: index.source || 'memory',
        contentSearch: true,
        contentPersisted: false,
        contentCandidateFiles: allCandidates.length,
        contentScannedFiles: status.scannedFiles,
        contentBytesRead: status.bytesRead,
        contentSkippedLargeFiles: status.skippedLargeFiles,
        contentSkippedUnsafeFiles: status.skippedUnsafeFiles,
        contentFileLimitReached: status.fileLimitReached,
        contentByteLimitReached: status.byteLimitReached,
        contentLimits: {
          maxFiles: this.maxContentSearchFiles,
          maxFileBytes: this.maxContentSearchFileBytes,
          maxTotalBytes: this.maxContentSearchTotalBytes
        }
      };
    } catch (error) {
      if (error?.code !== 'CONTENT_SEARCH_CANCELLED') {
        status.phase = 'error';
        status.error = error?.message || String(error);
        if (this._activeContentSearch === token) this._contentSearchStatus = { ...status };
        throw error;
      }
      status.phase = 'cancelled';
      status.error = null;
      if (this._activeContentSearch === token) this._contentSearchStatus = { ...status };
      return {
        requestId,
        cancelled: true,
        items: [],
        totalMatches: 0,
        indexedCount: index.entries.length,
        truncated: index.truncated,
        contentSearch: true,
        contentPersisted: false,
        contentScannedFiles: status.scannedFiles,
        contentBytesRead: status.bytesRead
      };
    } finally {
      if (this._activeContentSearch === token) this._activeContentSearch = null;
    }
  }

  async search(query, options = {}) {
    const normalizedQuery = String(query || '').slice(0, 500).trim().toLocaleLowerCase('zh-CN');
    const requestId = String(options.requestId || `search-${Date.now()}`).slice(0, 160);
    if (this._activeContentSearch) this._activeContentSearch.cancelled = true;
    this._latestSearchRequestId = requestId;
    const contentSearch = options.mode === 'content' || options.includeContent === true;
    if (!contentSearch) this._contentSearchStatus = this._idleContentSearchStatus();
    if (!normalizedQuery) {
      return { requestId, cancelled: false, items: [], totalMatches: 0, indexedCount: 0, truncated: false };
    }
    if (contentSearch && normalizedQuery.length < 3) {
      this._contentSearchStatus = this._idleContentSearchStatus();
      return {
        requestId,
        cancelled: false,
        items: [],
        totalMatches: 0,
        indexedCount: this.indexCache?.entries.length || 0,
        truncated: Boolean(this.indexCache?.truncated),
        contentSearch: true,
        contentPersisted: false,
        queryTooShort: true
      };
    }

    let index;
    try {
      index = await this._getOrBuildIndex(Boolean(options.forceRefresh));
    } catch (error) {
      if (error?.code === 'INDEX_BUILD_CANCELLED') {
        const status = this.getIndexStatus();
        return {
          requestId,
          cancelled: true,
          items: [],
          totalMatches: 0,
          indexedCount: status.indexedCount,
          truncated: status.truncated
        };
      }
      throw error;
    }
    if (this._latestSearchRequestId !== requestId) {
      return { requestId, cancelled: true, items: [], totalMatches: 0, indexedCount: index.entries.length, truncated: index.truncated };
    }

    if (contentSearch) return this._searchFileContents(index, normalizedQuery, options, requestId);

    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const type = ['file', 'directory', 'repository'].includes(options.type) ? options.type : 'all';
    const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
    const repositoryMetadataByPath = this._getRepositoryMetadataByPath();
    const matches = [];

    for (const entry of index.entries) {
      if (type === 'file' && entry.type !== 'file') continue;
      if (type === 'directory' && entry.type !== 'directory') continue;
      if (type === 'repository' && !entry.isGitRepo) continue;
      const name = entry.name.toLocaleLowerCase('zh-CN');
      const relativePath = entry.relativePath.toLocaleLowerCase('zh-CN');
      const metadata = entry.isGitRepo
        ? (repositoryMetadataByPath.get(this._metadataPathKey(entry.path)) || { groups: [], tags: [] })
        : null;
      const metadataNames = metadata
        ? [...metadata.groups, ...metadata.tags]
          .map(item => item.name.toLocaleLowerCase('zh-CN'))
        : [];
      const metadataText = metadataNames.join(' ');
      const haystack = `${name} ${relativePath} ${entry.type} ${entry.isGitRepo ? 'git repository 仓库' : ''} ${metadataText}`;
      if (!tokens.every(token => haystack.includes(token))) continue;
      let score = 10;
      if (name === normalizedQuery) score = 100;
      else if (name.startsWith(normalizedQuery)) score = 80;
      else if (name.includes(normalizedQuery)) score = 60;
      else if (metadataNames.includes(normalizedQuery)) score = 55;
      else if (metadataNames.some(value => value.startsWith(normalizedQuery))) score = 45;
      else if (metadataText.includes(normalizedQuery)) score = 40;
      else if (relativePath.includes(normalizedQuery)) score = 30;
      matches.push({
        entry: metadata ? { ...entry, groups: metadata.groups, tags: metadata.tags } : entry,
        score
      });
    }

    matches.sort((left, right) => (
      right.score - left.score
      || Number(right.entry.isGitRepo) - Number(left.entry.isGitRepo)
      || left.entry.name.localeCompare(right.entry.name, 'zh-CN')
      || left.entry.path.localeCompare(right.entry.path, 'zh-CN')
    ));

    return {
      requestId,
      cancelled: false,
      items: matches.slice(0, limit).map(match => ({ ...match.entry })),
      totalMatches: matches.length,
      indexedCount: index.entries.length,
      builtAt: index.builtAt,
      truncated: index.truncated,
      indexSource: index.source || 'memory'
    };
  }

  async _getOrBuildIndex(forceRefresh = false) {
    const roots = this._configuredRoots();
    const rootsKey = this._getRootsKey(roots);
    if (!forceRefresh && !this._requiresRefresh && this.indexCache?.rootsKey === rootsKey) {
      return this.indexCache;
    }
    if (this._buildPromise?.rootsKey === rootsKey && !this._buildPromise.token.cancelled) {
      return this._buildPromise.promise;
    }

    let previousIndex = this.indexCache?.rootsKey === rootsKey ? this.indexCache : null;
    if (!previousIndex && this._staleIndex?.rootsKey === rootsKey) previousIndex = this._staleIndex;
    if (!previousIndex) previousIndex = await this._readPersistedIndex(roots, rootsKey);

    if (!forceRefresh && !this._requiresRefresh && previousIndex) {
      this.indexCache = previousIndex;
      this._indexStatus = {
        ...this._idleIndexStatus(),
        phase: 'ready',
        ready: true,
        persisted: previousIndex.source === 'disk',
        indexedCount: previousIndex.entries.length,
        builtAt: previousIndex.builtAt,
        truncated: Boolean(previousIndex.truncated)
      };
      return previousIndex;
    }

    const generation = this._indexGeneration;
    const token = { cancelled: false, generation };
    const incremental = Boolean(previousIndex?.directorySnapshots?.length);
    this._indexStatus = {
      ...this._idleIndexStatus(),
      phase: 'building',
      building: true,
      ready: Boolean(this.indexCache),
      stale: this._requiresRefresh,
      incremental,
      indexedCount: 0,
      startedAt: Date.now(),
      discoveredDirectories: roots.length
    };

    const promise = (async () => {
      try {
        const index = await this._buildIndex(roots, rootsKey, previousIndex, token);
        this._assertBuildActive(token);
        let persisted = false;
        let persistenceError = null;
        try {
          persisted = await this._persistIndex(index);
        } catch (error) {
          persistenceError = error?.message || String(error);
        }
        this._assertBuildActive(token);
        index.source = 'scan';
        this.indexCache = index;
        this._staleIndex = null;
        this._requiresRefresh = false;
        this._indexStatus = {
          ...this._indexStatus,
          phase: 'ready',
          ready: true,
          building: false,
          stale: false,
          persisted,
          indexedCount: index.entries.length,
          builtAt: index.builtAt,
          truncated: Boolean(index.truncated),
          persistenceError
        };
        return index;
      } catch (error) {
        if (error?.code === 'INDEX_BUILD_CANCELLED') {
          if (this._buildPromise?.token === token) {
            this._indexStatus = {
              ...this._indexStatus,
              phase: 'cancelled',
              building: false,
              stale: true,
              error: null
            };
          }
          throw error;
        }
        if (this._buildPromise?.token === token) {
          this._indexStatus = {
            ...this._indexStatus,
            phase: 'error',
            building: false,
            stale: true,
            error: error?.message || String(error)
          };
        }
        throw error;
      } finally {
        if (this._buildPromise?.token === token) this._buildPromise = null;
      }
    })();
    this._buildPromise = { rootsKey, promise, token };
    return promise;
  }

  _getRootsKey(roots) {
    return JSON.stringify(roots.map(root => ({
      path: path.resolve(root.path),
      realPath: fs.realpathSync.native(root.path),
      name: root.name || path.basename(root.path)
    })).sort((left, right) => left.path.localeCompare(right.path)));
  }

  _assertBuildActive(token) {
    if (token.cancelled || token.generation !== this._indexGeneration) {
      throw new IndexBuildCancelledError();
    }
  }

  _updateBuildStatus(token, updates) {
    if (this._buildPromise?.token !== token || token.cancelled) return;
    this._indexStatus = { ...this._indexStatus, ...updates };
  }

  _groupEntriesByParent(index) {
    const grouped = new Map();
    for (const entry of index?.entries || []) {
      const parentPath = path.dirname(entry.path);
      if (!grouped.has(parentPath)) grouped.set(parentPath, []);
      grouped.get(parentPath).push(entry);
    }
    return grouped;
  }

  async _buildIndex(roots, rootsKey, previousIndex = null, token = { cancelled: false, generation: this._indexGeneration }) {
    const entries = [];
    const directorySnapshots = [];
    const seenPaths = new Set();
    const visitedDirectories = new Set();
    const previousEntriesByParent = this._groupEntriesByParent(previousIndex);
    const previousSnapshots = new Map((previousIndex?.directorySnapshots || []).map(snapshot => [snapshot.path, snapshot]));
    let truncated = false;
    let processedDirectories = 0;
    let discoveredDirectories = roots.length;
    let reusedDirectories = 0;
    let scannedDirectories = 0;

    const queue = roots.map(root => {
      const logicalRoot = path.resolve(root.path);
      return {
        root,
        logicalRoot,
        realRoot: fs.realpathSync.native(root.path),
        realDirectoryPath: fs.realpathSync.native(root.path),
        logicalDirectoryPath: logicalRoot,
        directoryEntry: null
      };
    });
    let queueCursor = 0;
    while (queueCursor < queue.length && entries.length < this.maxIndexEntries) {
      this._assertBuildActive(token);
      const current = queue[queueCursor++];
      const { root, logicalRoot, realRoot } = current;
      let realDirectory;
      try { realDirectory = await fs.promises.realpath(current.realDirectoryPath); } catch (_) { continue; }
      if (!this._pathIsWithin(realDirectory, realRoot) || visitedDirectories.has(realDirectory)) continue;
      visitedDirectories.add(realDirectory);

      let directoryStat;
      try { directoryStat = await fs.promises.stat(realDirectory); } catch (_) { continue; }
      const previousSnapshot = previousSnapshots.get(current.logicalDirectoryPath);
      const canReuse = Boolean(
        previousSnapshot
        && previousSnapshot.realPath === realDirectory
        && previousSnapshot.rootPath === logicalRoot
        && previousSnapshot.mtimeMs === directoryStat.mtimeMs
      );

      directorySnapshots.push({
        path: current.logicalDirectoryPath,
        realPath: realDirectory,
        rootPath: logicalRoot,
        mtimeMs: directoryStat.mtimeMs
      });

      if (canReuse) {
        reusedDirectories += 1;
        for (const cachedEntry of previousEntriesByParent.get(current.logicalDirectoryPath) || []) {
          if (entries.length >= this.maxIndexEntries) {
            truncated = true;
            break;
          }
          if (seenPaths.has(cachedEntry.path)) continue;
          seenPaths.add(cachedEntry.path);
          const item = { ...cachedEntry };
          entries.push(item);
          if (item.type === 'directory') {
            queue.push({
              root,
              logicalRoot,
              realRoot,
              realDirectoryPath: path.join(realDirectory, item.name),
              logicalDirectoryPath: item.path,
              directoryEntry: item
            });
            discoveredDirectories += 1;
          }
        }
      } else {
        scannedDirectories += 1;
        let children;
        try { children = await fs.promises.readdir(realDirectory, { withFileTypes: true }); } catch (_) { continue; }
        if (current.directoryEntry) {
          current.directoryEntry.isGitRepo = children.some(child => child.name === '.git' && (child.isDirectory() || child.isFile()));
        }

        for (const child of children) {
          if (entries.length >= this.maxIndexEntries) {
            truncated = true;
            break;
          }
          if (child.name.startsWith('.')) continue;
          if (child.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(child.name)) continue;
          const realChildPath = path.join(realDirectory, child.name);
          const logicalChildPath = path.join(current.logicalDirectoryPath, child.name);
          if (seenPaths.has(logicalChildPath)) continue;
          seenPaths.add(logicalChildPath);

          let stat;
          try { stat = await fs.promises.lstat(realChildPath); } catch (_) { continue; }
          const type = child.isDirectory() ? 'directory' : (child.isFile() ? 'file' : 'symlink');
          const item = {
            name: child.name,
            path: logicalChildPath,
            relativePath: path.relative(logicalRoot, logicalChildPath),
            rootPath: logicalRoot,
            rootName: root.name || path.basename(logicalRoot),
            type,
            size: stat.size,
            modifiedTime: stat.mtime.toISOString(),
            extension: child.isFile() ? path.extname(child.name).toLowerCase() : '',
            isGitRepo: false
          };
          entries.push(item);
          if (child.isDirectory()) {
            queue.push({
              root,
              logicalRoot,
              realRoot,
              realDirectoryPath: realChildPath,
              logicalDirectoryPath: logicalChildPath,
              directoryEntry: item
            });
            discoveredDirectories += 1;
          }
        }
      }

      processedDirectories += 1;
      this._updateBuildStatus(token, {
        indexedCount: entries.length,
        processedDirectories,
        discoveredDirectories,
        reusedDirectories,
        scannedDirectories
      });
      if (processedDirectories % this.scanYieldEvery === 0) await this.scanYield();
    }
    if (queueCursor < queue.length || entries.length >= this.maxIndexEntries) truncated = true;

    this._assertBuildActive(token);
    return {
      version: INDEX_SCHEMA_VERSION,
      rootsKey,
      entries,
      directorySnapshots,
      builtAt: Date.now(),
      truncated
    };
  }

  _validatePersistedIndex(candidate, roots, rootsKey) {
    if (!candidate || candidate.version !== INDEX_SCHEMA_VERSION || candidate.rootsKey !== rootsKey) return null;
    if (candidate.format !== 'compact-v1') return null;
    if (!Array.isArray(candidate.entries) || !Array.isArray(candidate.directorySnapshots)) return null;
    if (!Number.isFinite(candidate.builtAt) || candidate.entries.length > this.maxIndexEntries) return null;
    const rootsByPath = new Map(roots.map(root => [path.resolve(root.path), {
      logicalPath: path.resolve(root.path),
      realPath: fs.realpathSync.native(root.path),
      name: root.name || path.basename(root.path)
    }]));
    let rootDescriptors;
    try { rootDescriptors = JSON.parse(rootsKey); } catch (_) { return null; }
    if (!Array.isArray(rootDescriptors)) return null;
    const indexedRoots = rootDescriptors.map(descriptor => rootsByPath.get(path.resolve(String(descriptor?.path || ''))));
    if (indexedRoots.some(root => !root)) return null;
    const typeByCode = { f: 'file', d: 'directory', s: 'symlink' };
    const entries = [];
    for (const item of candidate.entries) {
      if (!Array.isArray(item) || item.length < 5) return null;
      const root = indexedRoots[Number(item[0])];
      const relativePath = String(item[1] || '');
      const itemPath = root ? path.resolve(root.logicalPath, relativePath) : '';
      if (!root || !this._pathIsWithin(itemPath, root.logicalPath)) return null;
      const type = typeByCode[item[2]];
      if (!type || !relativePath || path.isAbsolute(relativePath)) return null;
      const modifiedTime = new Date(Number(item[4]));
      if (Number.isNaN(modifiedTime.getTime())) return null;
      entries.push({
        name: path.basename(itemPath),
        path: itemPath,
        relativePath: path.relative(root.logicalPath, itemPath),
        rootPath: root.logicalPath,
        rootName: root.name,
        type,
        size: Number(item[3]) || 0,
        modifiedTime: modifiedTime.toISOString(),
        extension: typeof item[5] === 'string' ? item[5] : '',
        isGitRepo: item[6] === 1
      });
    }
    const directorySnapshots = [];
    for (const snapshot of candidate.directorySnapshots) {
      if (!Array.isArray(snapshot) || snapshot.length < 3) return null;
      const root = indexedRoots[Number(snapshot[0])];
      const relativePath = String(snapshot[1] || '');
      const logicalPath = root ? path.resolve(root.logicalPath, relativePath) : '';
      const realPath = root ? path.resolve(root.realPath, relativePath) : '';
      if (!root || !this._pathIsWithin(logicalPath, root.logicalPath) || !this._pathIsWithin(realPath, root.realPath)) return null;
      if (!Number.isFinite(snapshot[2])) return null;
      directorySnapshots.push({ path: logicalPath, realPath, rootPath: root.logicalPath, mtimeMs: snapshot[2] });
    }
    return {
      version: INDEX_SCHEMA_VERSION,
      rootsKey,
      entries,
      directorySnapshots,
      builtAt: candidate.builtAt,
      truncated: Boolean(candidate.truncated),
      source: 'disk'
    };
  }

  async _readPersistedIndex(roots, rootsKey) {
    if (!this.indexFilePath) return null;
    try {
      const raw = await fs.promises.readFile(this.indexFilePath, 'utf8');
      return this._validatePersistedIndex(JSON.parse(raw), roots, rootsKey);
    } catch (_) {
      return null;
    }
  }

  async _persistIndex(index) {
    if (!this.indexFilePath) return false;
    const directory = path.dirname(this.indexFilePath);
    const tempFilePath = `${this.indexFilePath}.${process.pid}.${Date.now()}.tmp`;
    const rootDescriptors = JSON.parse(index.rootsKey);
    const rootIndexByPath = new Map(rootDescriptors.map((root, rootIndex) => [path.resolve(root.path), rootIndex]));
    const typeCode = { file: 'f', directory: 'd', symlink: 's' };
    const payload = JSON.stringify({
      version: INDEX_SCHEMA_VERSION,
      format: 'compact-v1',
      rootsKey: index.rootsKey,
      entries: index.entries.map(entry => [
        rootIndexByPath.get(path.resolve(entry.rootPath)),
        entry.relativePath,
        typeCode[entry.type],
        entry.size,
        Date.parse(entry.modifiedTime),
        entry.extension || '',
        entry.isGitRepo ? 1 : 0
      ]),
      directorySnapshots: index.directorySnapshots.map(snapshot => [
        rootIndexByPath.get(path.resolve(snapshot.rootPath)),
        path.relative(snapshot.rootPath, snapshot.path),
        snapshot.mtimeMs
      ]),
      builtAt: index.builtAt,
      truncated: Boolean(index.truncated)
    });
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await fs.promises.writeFile(tempFilePath, payload, { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(tempFilePath, this.indexFilePath);
      await fs.promises.chmod(this.indexFilePath, 0o600);
      return true;
    } finally {
      try { await fs.promises.unlink(tempFilePath); } catch (_) {}
    }
  }
}

const singleton = new WorkspaceContentService();
module.exports = singleton;
module.exports.WorkspaceContentService = WorkspaceContentService;
module.exports.convertBinaryPlistWithPlutil = convertBinaryPlistWithPlutil;
