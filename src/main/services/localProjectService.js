const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const configService = require('./configService');

const MANIFEST_DIRECTORY = '.gitfinder';
const MANIFEST_FILE = 'project.json';
const MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 256 * 1024;
const PROJECT_ID_PATTERN = /^project_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_COLORS = Object.freeze(['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);
const PROJECT_LIFECYCLES = Object.freeze([
  'inbox', 'planned', 'active', 'validation', 'deployed', 'maintenance', 'paused', 'frozen', 'abandoned', 'archived'
]);
const SCAN_SKIPPED_DIRECTORIES = new Set([
  '.git', '.gitfinder', 'node_modules', 'dist', 'build', '.cache', '.next', '.turbo', 'coverage'
]);

class LocalProjectService {
  constructor(options = {}) {
    this.configService = options.configService || configService;
  }

  _pathIsWithin(candidatePath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _managedRoots() {
    return (this.configService.getTreeRoots() || []).map(root => path.resolve(root.path));
  }

  _assertManagedDirectory(candidatePath) {
    const directory = path.resolve(String(candidatePath || ''));
    const roots = this._managedRoots();
    if (!roots.some(root => this._pathIsWithin(directory, root))) {
      throw new Error(`路径不在受管开发目录中：${directory}`);
    }
    if (!fs.existsSync(directory)) throw new Error(`项目目录不存在：${directory}`);
    const linkStat = fs.lstatSync(directory);
    if (linkStat.isSymbolicLink()) throw new Error('不能通过符号链接创建项目身份');
    if (!linkStat.isDirectory()) throw new Error(`项目路径不是文件夹：${directory}`);

    const realDirectory = fs.realpathSync.native(directory);
    const realRoots = roots.map(root => {
      try { return fs.realpathSync.native(root); } catch (_) { return null; }
    }).filter(Boolean);
    if (!realRoots.some(root => this._pathIsWithin(realDirectory, root))) {
      throw new Error(`项目目录通过符号链接离开受管开发目录：${directory}`);
    }
    return directory;
  }

  _manifestPaths(directory) {
    const metadataDirectory = path.join(directory, MANIFEST_DIRECTORY);
    return {
      metadataDirectory,
      manifestPath: path.join(metadataDirectory, MANIFEST_FILE)
    };
  }

  _cleanText(value, fallback = '', maxLength = 2000) {
    const cleaned = String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (cleaned || fallback).slice(0, maxLength);
  }

  _normalizeExcludedPaths(values) {
    const source = Array.isArray(values) ? values : [];
    const normalized = [];
    const seen = new Set();
    for (const raw of source) {
      const input = String(raw || '').trim().replace(/\\/g, '/');
      if (!input) continue;
      if (path.posix.isAbsolute(input) || /^[a-z]:\//i.test(input)) {
        throw new Error('仓库排除项必须使用项目内相对路径');
      }
      const relative = path.posix.normalize(input.replace(/^\.\//, '')).replace(/\/$/, '');
      if (!relative || relative === '.' || relative === '..' || relative.startsWith('../')) {
        throw new Error('仓库排除项必须位于项目目录内部');
      }
      if (!seen.has(relative)) {
        seen.add(relative);
        normalized.push(relative);
      }
    }
    return normalized.sort((left, right) => left.localeCompare(right, 'en'));
  }

  _normalizeManifest(directory, value, { requireId = true } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目清单格式无效');
    const projectId = String(value.projectId || '');
    if (requireId && !PROJECT_ID_PATTERN.test(projectId)) throw new Error('项目清单缺少有效 projectId');
    const color = PROJECT_COLORS.includes(value.color) ? value.color : 'blue';
    const lifecycle = PROJECT_LIFECYCLES.includes(value.lifecycle) ? value.lifecycle : 'active';
    return {
      schemaVersion: MANIFEST_VERSION,
      projectId,
      name: this._cleanText(value.name, path.basename(directory), 160),
      description: this._cleanText(value.description, '', 2000),
      color,
      lifecycle,
      repositories: {
        excluded: this._normalizeExcludedPaths(value.repositories?.excluded || value.excludedRepositories)
      }
    };
  }

  _readManifest(directory, { required = false } = {}) {
    const { manifestPath } = this._manifestPaths(directory);
    if (!fs.existsSync(manifestPath)) {
      if (required) throw new Error('此文件夹尚未设为 GitFinder 项目');
      return null;
    }
    const stat = fs.lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('项目清单必须是普通文件');
    if (stat.size > MAX_MANIFEST_BYTES) throw new Error('项目清单超过大小限制');
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`项目清单无法解析：${error.message || String(error)}`);
    }
    if (Number(parsed.schemaVersion) !== MANIFEST_VERSION) {
      throw new Error(`暂不支持项目清单版本：${parsed.schemaVersion ?? '未知'}`);
    }
    return this._normalizeManifest(directory, parsed);
  }

  _publicProject(directory, manifest) {
    return {
      ...manifest,
      path: directory,
      manifestPath: this._manifestPaths(directory).manifestPath
    };
  }

  _writeNewManifest(directory, manifest) {
    const { metadataDirectory, manifestPath } = this._manifestPaths(directory);
    if (fs.existsSync(metadataDirectory)) {
      const stat = fs.lstatSync(metadataDirectory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('.gitfinder 必须是普通文件夹');
    } else {
      fs.mkdirSync(metadataDirectory, { mode: 0o700 });
    }
    let handle = null;
    try {
      handle = fs.openSync(manifestPath, 'wx', 0o600);
      fs.writeFileSync(handle, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
  }

  _writeManifestAtomic(directory, manifest) {
    const { metadataDirectory, manifestPath } = this._manifestPaths(directory);
    const directoryStat = fs.lstatSync(metadataDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('.gitfinder 必须是普通文件夹');
    const temporaryPath = path.join(metadataDirectory, `project.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle = null;
    try {
      handle = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(handle, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.fsyncSync(handle);
      fs.closeSync(handle);
      handle = null;
      fs.renameSync(temporaryPath, manifestPath);
    } finally {
      if (handle !== null) {
        try { fs.closeSync(handle); } catch (_) {}
      }
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }

  initializeProject(candidatePath, values = {}) {
    const directory = this._assertManagedDirectory(candidatePath);
    const existing = this._readManifest(directory);
    if (existing) return { created: false, project: this._publicProject(directory, existing) };
    const manifest = this._normalizeManifest(directory, {
      schemaVersion: MANIFEST_VERSION,
      projectId: `project_${crypto.randomUUID()}`,
      name: values.name,
      description: values.description,
      color: values.color,
      lifecycle: values.lifecycle,
      repositories: { excluded: values.excludedRepositories || values.repositories?.excluded || [] }
    });
    try {
      this._writeNewManifest(directory, manifest);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const raced = this._readManifest(directory, { required: true });
      return { created: false, project: this._publicProject(directory, raced) };
    }
    return { created: true, project: this._publicProject(directory, manifest) };
  }

  updateProject(candidatePath, values = {}) {
    const directory = this._assertManagedDirectory(candidatePath);
    const current = this._readManifest(directory, { required: true });
    const next = this._normalizeManifest(directory, {
      ...current,
      name: Object.hasOwn(values, 'name') ? values.name : current.name,
      description: Object.hasOwn(values, 'description') ? values.description : current.description,
      color: Object.hasOwn(values, 'color') ? values.color : current.color,
      lifecycle: Object.hasOwn(values, 'lifecycle') ? values.lifecycle : current.lifecycle,
      repositories: {
        excluded: Object.hasOwn(values, 'excludedRepositories')
          ? values.excludedRepositories
          : (values.repositories?.excluded ?? current.repositories.excluded)
      }
    });
    this._writeManifestAtomic(directory, next);
    return this._publicProject(directory, next);
  }

  describeDirectory(candidatePath) {
    const directory = this._assertManagedDirectory(candidatePath);
    const manifest = this._readManifest(directory);
    return manifest
      ? { isProject: true, project: this._publicProject(directory, manifest) }
      : { isProject: false, project: null };
  }

  getProject(candidatePath) {
    const directory = this._assertManagedDirectory(candidatePath);
    const manifest = this._readManifest(directory, { required: true });
    return this._publicProject(directory, manifest);
  }

  _hasGitMetadata(directory) {
    const gitPath = path.join(directory, '.git');
    if (!fs.existsSync(gitPath)) return false;
    const stat = fs.lstatSync(gitPath);
    return stat.isDirectory() || stat.isFile();
  }

  _isExcluded(relativePath, exclusions) {
    if (!relativePath || relativePath === '.') return false;
    return exclusions.some(excluded => relativePath === excluded || relativePath.startsWith(`${excluded}/`));
  }

  async discoverRepositories(candidatePath, suppliedManifest = null) {
    const directory = this._assertManagedDirectory(candidatePath);
    const manifest = suppliedManifest || this._readManifest(directory, { required: true });
    const exclusions = manifest.repositories?.excluded || [];
    const repositories = [];

    const visit = async (current, relativePath) => {
      if (this._isExcluded(relativePath, exclusions)) return;
      if (relativePath !== '.' && this._readManifest(current)) return;
      if (this._hasGitMetadata(current)) {
        const stat = await fs.promises.stat(current);
        repositories.push({
          name: path.basename(current),
          path: current,
          relativePath,
          type: 'directory',
          size: stat.size,
          modifiedTime: stat.mtime.toISOString(),
          isGitRepo: true
        });
      }
      let entries;
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (_) {
        return;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || SCAN_SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        const childRelative = relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
        await visit(path.join(current, entry.name), childRelative);
      }
    };

    await visit(directory, '.');
    return repositories.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  }

  async listProjects() {
    const projectDirectories = new Map();
    const visited = new Set();
    const visit = async (directory) => {
      let realDirectory;
      try { realDirectory = fs.realpathSync.native(directory); } catch (_) { return; }
      if (visited.has(realDirectory)) return;
      visited.add(realDirectory);

      let manifest = null;
      try { manifest = this._readManifest(directory); } catch (_) { manifest = null; }
      if (manifest) projectDirectories.set(realDirectory, { directory, manifest });

      let entries;
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch (_) { return; }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || SCAN_SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await visit(path.join(directory, entry.name));
      }
    };

    for (const root of this._managedRoots()) await visit(root);
    const projects = [];
    for (const { directory, manifest } of projectDirectories.values()) {
      const repositories = await this.discoverRepositories(directory, manifest);
      const stat = await fs.promises.stat(directory).catch(() => null);
      projects.push({
        ...this._publicProject(directory, manifest),
        modifiedTime: stat?.mtime?.toISOString() || null,
        repositoryCount: repositories.length,
        repositories,
        rootIsGitRepo: repositories.some(repo => repo.relativePath === '.')
      });
    }
    return projects.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }
}

module.exports = new LocalProjectService();
module.exports.PROJECT_COLORS = PROJECT_COLORS;
module.exports.PROJECT_LIFECYCLES = PROJECT_LIFECYCLES;
