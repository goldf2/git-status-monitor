const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const os = require('os');
const localProjectService = require('./localProjectService');
const configService = require('./configService');

const MAX_WORKSPACE_PATHS = 2000;
const MAX_WORKSPACE_PATH_LENGTH = 32768;
const MAX_PROJECT_TEXT_BYTES = 1024 * 1024;

class FileService {
  constructor(options = {}) {
    this.dirCache = new Map();
    this.gitRepoCache = new Set();
    this.getTreeRoots = options.getTreeRoots || (() => configService.getTreeRoots());
    this.getFavorites = options.getFavorites || (() => configService.getFavorites());
  }

  _absoluteWorkspacePath(candidatePath) {
    if (typeof candidatePath !== 'string' || !candidatePath || candidatePath.length > MAX_WORKSPACE_PATH_LENGTH) return null;
    if (candidatePath.includes('\0') || !path.isAbsolute(candidatePath)) return null;
    return path.normalize(candidatePath);
  }

  _workspacePathKey(candidatePath) {
    const normalized = this._absoluteWorkspacePath(candidatePath);
    if (!normalized) return '';
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  _workspacePathIsWithin(candidatePath, rootPath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  _availableWorkspaceDirectory(candidatePath, realRootPath) {
    try {
      const stat = fs.statSync(candidatePath);
      if (!stat.isDirectory()) return false;
      const realPath = fs.realpathSync.native(candidatePath);
      return this._workspacePathIsWithin(realPath, realRootPath);
    } catch (_) {
      return false;
    }
  }

  inspectWorkspaceDirectories(candidatePaths) {
    const treeRoots = this.getTreeRoots();
    const rawConfiguredRoots = Array.isArray(treeRoots) ? treeRoots : [];
    const usedRootKeys = new Set();
    const configuredRoots = [];
    const roots = [];

    for (const root of rawConfiguredRoots) {
      const rootPath = this._absoluteWorkspacePath(root?.path);
      const rootKey = this._workspacePathKey(rootPath);
      if (!rootPath || !rootKey || usedRootKeys.has(rootKey)) continue;
      usedRootKeys.add(rootKey);
      const record = { path: rootPath, available: false, realPath: '' };
      try {
        const stat = fs.statSync(rootPath);
        if (stat.isDirectory()) {
          record.realPath = fs.realpathSync.native(rootPath);
          record.available = true;
          roots.push(record);
        }
      } catch (_) {}
      configuredRoots.push(record);
    }

    const usedCandidateKeys = new Set();
    const directories = [];
    for (const rawPath of (Array.isArray(candidatePaths) ? candidatePaths : []).slice(0, MAX_WORKSPACE_PATHS)) {
      const candidatePath = this._absoluteWorkspacePath(rawPath);
      const candidateKey = this._workspacePathKey(candidatePath);
      if (!candidatePath || !candidateKey || usedCandidateKeys.has(candidateKey)) continue;
      usedCandidateKeys.add(candidateKey);

      const configuredRoot = configuredRoots
        .filter(root => this._workspacePathIsWithin(candidatePath, root.path))
        .sort((left, right) => right.path.length - left.path.length)[0];
      const containingRoot = roots
        .filter(root => this._workspacePathIsWithin(candidatePath, root.path))
        .sort((left, right) => right.path.length - left.path.length)[0];
      let available = false;
      let nearestAvailablePath = '';
      if (containingRoot) {
        available = this._availableWorkspaceDirectory(candidatePath, containingRoot.realPath);
        if (available) {
          nearestAvailablePath = candidatePath;
        } else {
          let currentPath = candidatePath;
          while (this._workspacePathIsWithin(currentPath, containingRoot.path)) {
            if (this._availableWorkspaceDirectory(currentPath, containingRoot.realPath)) {
              nearestAvailablePath = currentPath;
              break;
            }
            if (currentPath === containingRoot.path) break;
            const parentPath = path.dirname(currentPath);
            if (!parentPath || parentPath === currentPath) break;
            currentPath = parentPath;
          }
        }
      }

      directories.push({
        path: rawPath,
        available,
        availability: available
          ? 'available'
          : (!containingRoot && configuredRoot ? 'root-unavailable' : (containingRoot ? 'path-unavailable' : 'outside-managed-root')),
        configuredRootPath: configuredRoot?.path || '',
        rootAvailable: Boolean(containingRoot),
        managedRootPath: containingRoot?.path || '',
        nearestAvailablePath
      });
    }

    return {
      platform: process.platform,
      availableRoots: roots.map(root => root.path),
      directories
    };
  }

  resolveWorkspaceDirectory(rawInput) {
    let candidate = typeof rawInput === 'string' ? rawInput.trim() : '';
    if (!candidate) {
      return { ok: false, code: 'empty', message: '请输入文件夹路径' };
    }
    if (candidate.length > MAX_WORKSPACE_PATH_LENGTH || candidate.includes('\0')) {
      return { ok: false, code: 'invalid', message: '路径格式无效或长度超出限制' };
    }

    const quote = candidate[0];
    if ((quote === '"' || quote === "'") && candidate.at(-1) === quote && candidate.length > 1) {
      candidate = candidate.slice(1, -1).trim();
    }
    if (candidate === '~' || /^~[\\/]/.test(candidate)) {
      const relativeHomePath = candidate.slice(1).replace(/^[\\/]+/, '');
      candidate = relativeHomePath ? path.join(os.homedir(), relativeHomePath) : os.homedir();
    }
    if (!path.isAbsolute(candidate)) {
      return {
        ok: false,
        code: 'not-absolute',
        message: process.platform === 'win32'
          ? '请输入绝对路径，例如 C:\\work 或 \\\\server\\share'
          : '请输入绝对路径，例如 /Volumes/project 或 ~/Projects'
      };
    }

    const normalizedPath = path.normalize(candidate);
    const inspection = this.inspectWorkspaceDirectories([normalizedPath]);
    const directory = inspection.directories.find(entry => entry.path === normalizedPath);
    if (directory?.availability === 'root-unavailable') {
      return {
        ok: false,
        code: 'root-unavailable',
        message: '该受管位置暂时不可用，请重新连接磁盘或网络位置后重试'
      };
    }
    if (!directory?.managedRootPath) {
      return {
        ok: false,
        code: 'outside-managed-root',
        message: '该文件夹不在 GitFinder 的受管位置中，请先使用左侧“添加目录”'
      };
    }
    if (!directory.available) {
      try {
        const stat = fs.statSync(normalizedPath);
        if (!stat.isDirectory()) {
          return { ok: false, code: 'not-directory', message: '该路径不是文件夹' };
        }
        return {
          ok: false,
          code: 'unsafe-or-unavailable',
          message: '无法安全进入该文件夹，可能存在符号链接越界或权限问题'
        };
      } catch (_) {
        return { ok: false, code: 'not-found', message: '找不到该文件夹或没有读取权限' };
      }
    }

    return {
      ok: true,
      path: normalizedPath,
      managedRootPath: directory.managedRootPath
    };
  }

  resolveWorkspacePath(rawPath) {
    const candidatePath = this._absoluteWorkspacePath(rawPath);
    if (!candidatePath) return { ok: false, code: 'invalid', message: '路径必须是有效绝对路径' };
    const roots = (Array.isArray(this.getTreeRoots()) ? this.getTreeRoots() : [])
      .map(root => this._absoluteWorkspacePath(root?.path))
      .filter(Boolean);
    const containingRoot = roots
      .filter(rootPath => this._workspacePathIsWithin(candidatePath, rootPath))
      .sort((left, right) => right.length - left.length)[0];
    if (!containingRoot) return { ok: false, code: 'outside-managed-root', message: '路径不在受管开发目录中' };
    try {
      const stat = fs.statSync(candidatePath);
      const realPath = fs.realpathSync.native(candidatePath);
      const realRoot = fs.realpathSync.native(containingRoot);
      if (!this._workspacePathIsWithin(realPath, realRoot)) {
        return { ok: false, code: 'symlink-escape', message: '路径通过符号链接离开受管开发目录' };
      }
      return {
        ok: true,
        path: candidatePath,
        type: stat.isDirectory() ? 'directory' : (stat.isFile() ? 'file' : 'other'),
        managedRootPath: containingRoot
      };
    } catch (_) {
      return { ok: false, code: 'not-found', message: '路径不存在或没有读取权限' };
    }
  }

  getWorkspaceDirectoryInfos(candidatePaths) {
    const inspection = this.inspectWorkspaceDirectories(candidatePaths);
    return {
      ...inspection,
      directories: inspection.directories.map(directory => ({
        ...directory,
        info: directory.available ? this.getFileInfo(directory.path) : null
      }))
    };
  }

  inspectFavoriteDirectories(candidatePaths) {
    const allowedPaths = new Map();
    for (const favorite of (Array.isArray(this.getFavorites()) ? this.getFavorites() : [])) {
      const favoritePath = this._absoluteWorkspacePath(favorite?.path);
      const favoriteKey = this._workspacePathKey(favoritePath);
      if (favoritePath && favoriteKey) allowedPaths.set(favoriteKey, favoritePath);
    }

    const usedKeys = new Set();
    const directories = [];
    for (const rawPath of (Array.isArray(candidatePaths) ? candidatePaths : []).slice(0, MAX_WORKSPACE_PATHS)) {
      const candidatePath = this._absoluteWorkspacePath(rawPath);
      const candidateKey = this._workspacePathKey(candidatePath);
      const configuredPath = allowedPaths.get(candidateKey);
      if (!candidatePath || !candidateKey || !configuredPath || usedKeys.has(candidateKey)) continue;
      usedKeys.add(candidateKey);

      let available = false;
      try {
        available = fs.statSync(configuredPath).isDirectory();
      } catch (_) {}
      directories.push({
        path: configuredPath,
        available,
        info: available ? this.getFileInfo(configuredPath) : null
      });
    }
    return { directories };
  }

  resolveFavoriteDirectory(rawPath) {
    const candidatePath = this._absoluteWorkspacePath(rawPath);
    const candidateKey = this._workspacePathKey(candidatePath);
    const favorite = (Array.isArray(this.getFavorites()) ? this.getFavorites() : [])
      .find(item => this._workspacePathKey(item?.path) === candidateKey);
    if (!candidatePath || !candidateKey || !favorite) {
      return { ok: false, code: 'not-favorite', message: '该位置不在收藏夹中' };
    }
    try {
      if (!fs.statSync(candidatePath).isDirectory()) {
        return { ok: false, code: 'not-directory', message: '该收藏位置不是文件夹' };
      }
      return { ok: true, path: candidatePath };
    } catch (_) {
      return { ok: false, code: 'not-found', message: '收藏位置不存在或没有读取权限' };
    }
  }

  listDirectory(dirPath, options = {}) {
    return this._listDirectory(dirPath, options, false);
  }

  _listDirectory(dirPath, { showHidden = false, recursive = false, depth = 2, onlyGit = false } = {}, nested = false) {
    const result = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        if (recursive && entry.name === 'node_modules') continue;

        const fullPath = path.join(dirPath, entry.name);
        const isDir = entry.isDirectory();

        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        const item = {
          name: entry.name,
          path: fullPath,
          type: isDir ? 'directory' : 'file',
          size: stat.size,
          modifiedTime: stat.mtime.toISOString(),
          isHidden: entry.name.startsWith('.'),
          isGitRepo: false,
          readme: null
        };

        if (isDir) {
          item.isGitRepo = this.isGitRepo(fullPath);
          try {
            const projectIdentity = localProjectService.describeDirectory(fullPath);
            item.isProject = projectIdentity.isProject;
            item.project = projectIdentity.project;
          } catch (error) {
            item.isProject = false;
            item.project = null;
            item.projectError = error?.message || String(error);
          }

          if (item.isGitRepo) {
            this.gitRepoCache.add(fullPath);
            try {
              item.readme = this.getReadmePreview(fullPath);
            } catch (e) {}
          }

          if (recursive && depth > 0 && !item.isGitRepo) {
            item.children = this._listDirectory(fullPath, {
              showHidden,
              recursive: true,
              depth: depth - 1,
              onlyGit
            }, true);
          }

          if (!onlyGit || item.isGitRepo) {
            result.push(item);
          }
        } else {
          if (!onlyGit) {
            result.push(item);
          }
        }
      }

      result.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });

    } catch (error) {
      if (!nested) throw error;
    }

    return result;
  }

  isGitRepo(dirPath) {
    if (this.gitRepoCache.has(dirPath)) return true;
    try {
      const gitDir = path.join(dirPath, '.git');
      const exists = fs.existsSync(gitDir);
      if (exists) this.gitRepoCache.add(dirPath);
      return exists;
    } catch (e) {
      return false;
    }
  }

  async findGitRepos(rootPath, { depth = 3, showHidden = false } = {}) {
    const repos = [];
    const addRepo = async repoPath => {
      const stat = await fs.promises.stat(repoPath);
      repos.push({
        name: path.basename(repoPath) || repoPath,
        path: repoPath,
        type: 'directory',
        size: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        isGitRepo: true,
        readme: this.getReadmePreview(repoPath)
      });
    };
    try {
      if (this.isGitRepo(rootPath)) await addRepo(rootPath);
    } catch (_) {}
    const scanDir = async (dir, currentDepth) => {
      if (currentDepth > depth) return;
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const childDirs = [];
        for (const entry of entries) {
          if (!showHidden && entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules') continue;
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);
          if (this.isGitRepo(fullPath)) {
            await addRepo(fullPath);
          } else {
            childDirs.push(fullPath);
          }
        }
        for (const childDir of childDirs) {
          await scanDir(childDir, currentDepth + 1);
        }
      } catch (e) {}
    };
    await scanDir(rootPath, 0);
    return repos;
  }

  getReadmePreview(dirPath) {
    const readmeNames = ['README.md', 'README', 'readme.md', 'Readme.md', 'README.MD'];
    let readmeFile = null;

    for (const name of readmeNames) {
      const filePath = path.join(dirPath, name);
      if (fs.existsSync(filePath)) {
        readmeFile = filePath;
        break;
      }
    }

    if (!readmeFile) {
      const pkgPath = path.join(dirPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.description) {
            return {
              title: pkg.name || path.basename(dirPath),
              description: pkg.description,
              hasReadme: false
            };
          }
        } catch (e) {}
      }
      return null;
    }

    try {
      const content = fs.readFileSync(readmeFile, 'utf-8');
      const lines = content.split('\n');
      let title = path.basename(dirPath);
      let description = '';
      let descLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('# ')) {
          title = line.replace(/^#+\s*/, '').trim();
          continue;
        }
        if (line === '' && descLines.length === 0) continue;
        if (line.startsWith('#')) continue;
        if (line.startsWith('---')) continue;
        if (descLines.length < 3) {
          descLines.push(line);
        } else {
          break;
        }
      }

      description = descLines.join(' ')
        .replace(/<[^>]*>/g, '') // 移除 HTML 标签,防止破坏卡片 DOM 结构
        .replace(/[*_`#>\-\[\]]/g, '') // 移除 markdown 字符
        .trim();
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }

      return {
        title,
        description,
        hasReadme: true
      };
    } catch (e) {
      return null;
    }
  }

  listProjectControlFiles(repoPath) {
    const directory = this._assertProjectDirectory(repoPath);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase() !== 'agents.md' && /\.(csv|md)$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(directory, entry.name);
        this._assertRegularProjectFile(filePath);
        const stat = fs.statSync(filePath);
        return {
          fileName: entry.name,
          format: path.extname(entry.name).slice(1).toLowerCase(),
          size: stat.size,
          modifiedTime: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'));
  }

  listMarkdownDocuments(repoPath) {
    const directory = this._assertProjectDirectory(repoPath);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase() !== 'agents.md' && /\.md$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(directory, entry.name);
        this._assertRegularProjectFile(filePath);
        const stat = fs.statSync(filePath);
        return {
          fileName: entry.name,
          format: 'md',
          size: stat.size,
          modifiedTime: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'));
  }

  readMarkdownDocument(repoPath, fileName) {
    const filePath = this._resolveMarkdownDocumentPath(repoPath, fileName);
    if (!fs.existsSync(filePath)) {
      return { fileName, exists: false, content: '', format: 'md' };
    }
    this._assertRegularProjectFile(filePath);
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_PROJECT_TEXT_BYTES) {
      throw new Error('Markdown 文档超过 1 MB，无法在应用内编辑');
    }
    return {
      fileName,
      exists: true,
      content: fs.readFileSync(filePath, 'utf-8'),
      format: 'md',
      modifiedTime: stat.mtime.toISOString()
    };
  }

  saveMarkdownDocument(repoPath, fileName, content) {
    if (typeof content !== 'string') throw new Error('Markdown 文档内容必须是文本');
    if (Buffer.byteLength(content, 'utf-8') > MAX_PROJECT_TEXT_BYTES) throw new Error('Markdown 文档不能超过 1 MB');
    const filePath = this._resolveMarkdownDocumentPath(repoPath, fileName);
    this._writeProjectTextFile(filePath, content);
    return this.readMarkdownDocument(repoPath, fileName);
  }

  readProjectControlFile(repoPath, fileName) {
    const filePath = this._resolveProjectControlPath(repoPath, fileName);
    if (!fs.existsSync(filePath)) {
      return { fileName, exists: false, content: '', format: path.extname(fileName).slice(1).toLowerCase() };
    }
    this._assertRegularProjectFile(filePath);
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_PROJECT_TEXT_BYTES) {
      throw new Error('控制文件超过 1 MB，无法在应用内编辑');
    }
    return {
      fileName,
      exists: true,
      content: fs.readFileSync(filePath, 'utf-8'),
      format: path.extname(fileName).slice(1).toLowerCase(),
      modifiedTime: stat.mtime.toISOString()
    };
  }

  saveProjectControlFile(repoPath, fileName, content) {
    if (typeof content !== 'string') throw new Error('控制文件内容必须是文本');
    if (Buffer.byteLength(content, 'utf-8') > MAX_PROJECT_TEXT_BYTES) throw new Error('控制文件不能超过 1 MB');
    const filePath = this._resolveProjectControlPath(repoPath, fileName);
    this._writeProjectTextFile(filePath, content);
    return this.readProjectControlFile(repoPath, fileName);
  }

  syncProjectControlAgentRules(repoPath, selections) {
    const directory = this._assertProjectDirectory(repoPath);
    const goalsFile = this._validateProjectControlFileName(selections?.goalsFile || '');
    const progressFile = this._validateProjectControlFileName(selections?.progressFile || '');
    const milestoneFile = this._validateProjectControlFileName(selections?.milestoneFile || '');
    if (!goalsFile && !progressFile && !milestoneFile) throw new Error('请先选择目标、进度或里程碑文件');

    const agentsPath = path.join(directory, 'AGENTS.md');
    const startMarker = '<!-- git-status-monitor:project-control:start -->';
    const endMarker = '<!-- git-status-monitor:project-control:end -->';
    const fileLines = [
      goalsFile ? `- 目标文件：\`${goalsFile}\`` : null,
      progressFile ? `- 进度文件：\`${progressFile}\`` : null,
      milestoneFile ? `- 里程碑文件：\`${milestoneFile}\`` : null
    ].filter(Boolean).join('\n');
    const block = `${startMarker}\n## 项目控制文件\n\n${fileLines}\n\n完成开发任务后，及时更新上述 CSV 或 Markdown 文件。目标文件记录项目目标、优先级、状态和关键日期；进度文件至少记录日期、当前状态、已完成内容、下一步、阻塞项；达到关键节点时同步更新里程碑。保留现有列和既有记录，不覆盖人工填写内容。\n${endMarker}`;
    if (fs.existsSync(agentsPath)) this._assertRegularProjectFile(agentsPath);
    const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '# AGENTS.md\n';
    const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
    const content = markerPattern.test(existing)
      ? existing.replace(markerPattern, block)
      : `${existing.trimEnd()}\n\n${block}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_PROJECT_TEXT_BYTES) throw new Error('AGENTS.md 超过 1 MB，无法安全更新');
    this._writeProjectTextFile(agentsPath, content);
    return { fileName: 'AGENTS.md', updated: true };
  }

  _assertProjectDirectory(repoPath) {
    const result = this.resolveWorkspaceDirectory(repoPath);
    if (!result.ok) throw new Error(`项目目录不在可写受管位置中：${result.message}`);
    return result.path;
  }

  _assertRegularProjectFile(filePath) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('项目文档必须是普通文件，不能是符号链接');
    if (Number(stat.nlink || 1) > 1) throw new Error('项目文档存在硬链接，拒绝在应用内修改');
    return stat;
  }

  _writeProjectTextFile(filePath, content) {
    if (fs.existsSync(filePath)) this._assertRegularProjectFile(filePath);
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | noFollow;
    let handle = null;
    try {
      handle = fs.openSync(filePath, flags, 0o600);
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || Number(stat.nlink || 1) > 1) throw new Error('项目文档不是可安全写入的普通文件');
      fs.ftruncateSync(handle, 0);
      fs.writeFileSync(handle, content, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
  }

  _validateProjectControlFileName(fileName) {
    if (!fileName) return '';
    if (path.basename(fileName) !== fileName || !/\.(csv|md)$/i.test(fileName)) {
      throw new Error('控制文件必须是项目根目录下的 CSV 或 Markdown 文件');
    }
    return fileName;
  }

  _resolveProjectControlPath(repoPath, fileName) {
    const directory = this._assertProjectDirectory(repoPath);
    const validated = this._validateProjectControlFileName(fileName);
    if (!validated) throw new Error('请选择控制文件');
    return path.join(directory, validated);
  }

  _resolveMarkdownDocumentPath(repoPath, fileName) {
    const directory = this._assertProjectDirectory(repoPath);
    if (!fileName || path.basename(fileName) !== fileName || !/\.md$/i.test(fileName)) {
      throw new Error('文档必须是项目根目录下的 Markdown 文件');
    }
    if (fileName.toLowerCase() === 'agents.md') {
      throw new Error('AGENTS.md 请通过 AI 规则入口维护，不作为普通文档编辑');
    }
    return path.join(directory, fileName);
  }

  getFileInfo(filePath) {
    try {
      const linkStat = fs.lstatSync(filePath);
      const stat = fs.statSync(filePath);
      const canAccess = mode => {
        try {
          fs.accessSync(filePath, mode);
          return true;
        } catch (_) {
          return false;
        }
      };
      const info = {
        name: path.basename(filePath),
        path: filePath,
        type: stat.isDirectory() ? 'directory' : (stat.isFile() ? 'file' : 'other'),
        extension: stat.isFile() ? path.extname(filePath).slice(1).toLowerCase() : '',
        size: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        createdTime: stat.birthtime.toISOString(),
        accessedTime: stat.atime.toISOString(),
        isHidden: path.basename(filePath).startsWith('.'),
        isSymbolicLink: linkStat.isSymbolicLink(),
        mode: process.platform === 'win32' ? null : (stat.mode & 0o777).toString(8).padStart(3, '0'),
        readable: canAccess(fs.constants.R_OK),
        writable: canAccess(fs.constants.W_OK),
        executable: canAccess(fs.constants.X_OK),
        isGitRepo: stat.isDirectory() && this.isGitRepo(filePath)
      };
      if (stat.isDirectory()) {
        try {
          const projectIdentity = localProjectService.describeDirectory(filePath);
          info.isProject = projectIdentity.isProject;
          info.project = projectIdentity.project;
        } catch (_) {
          info.isProject = false;
          info.project = null;
        }
      }
      return info;
    } catch (e) {
      return null;
    }
  }

  showInFinder(filePath) {
    try {
      if (process.platform === 'darwin') {
        execFileSync('open', ['-R', filePath]);
      } else if (process.platform === 'win32') {
        execFileSync('explorer.exe', [`/select,${filePath}`]);
      } else {
        const dir = path.dirname(filePath);
        execFileSync('xdg-open', [dir]);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  openFile(filePath) {
    try {
      let child;
      if (process.platform === 'darwin') {
        child = spawn('open', [filePath], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '', filePath], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
      }
      child.unref();
      return true;
    } catch (e) {
      return false;
    }
  }

  getDefaultPath() {
    const home = os.homedir();
    const candidates = [
      path.join(home, 'Projects'),
      path.join(home, 'project'),
      path.join(home, 'workspace'),
      path.join(home, 'Work'),
      path.join(home, 'Documents'),
      home
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return home;
  }

  getQuickLocations() {
    const home = os.homedir();
    const locations = [];

    const locs = [
      { name: '桌面', path: path.join(home, 'Desktop') },
      { name: '文稿', path: path.join(home, 'Documents') },
      { name: '下载', path: path.join(home, 'Downloads') },
      { name: '主目录', path: home }
    ];

    for (const loc of locs) {
      if (fs.existsSync(loc.path)) {
        locations.push(loc);
      }
    }

    return locations;
  }

  /**
   * 获取所有挂载的磁盘/卷一级位置(类似访达的"位置")
   * macOS: /Volumes 下的所有挂载点 + 根目录 /
   * Windows: 所有盘符 C:\ D:\ 等
   * Linux: / + /media/* + /mnt/*
   */
  getMountedVolumes() {
    const volumes = [];
    const platform = process.platform;

    if (platform === 'win32') {
      // Windows: 检测所有盘符
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const drivePath = `${letter}:\\`;
        try {
          fs.accessSync(drivePath);
          volumes.push({
            name: `${letter}: 盘`,
            path: drivePath,
            type: 'drive',
            icon: '💽'
          });
        } catch (e) {}
      }
    } else {
      // Unix-like (macOS/Linux)
      // 根目录
      volumes.push({
        name: platform === 'darwin' ? 'Macintosh HD' : '根目录',
        path: '/',
        type: 'system',
        icon: '💻'
      });

      // /Volumes 下的所有挂载点(macOS 外接磁盘、网络磁盘等)
      const volumesDir = '/Volumes';
      try {
        const entries = fs.readdirSync(volumesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) {
            const fullPath = path.join(volumesDir, entry.name);
            // 跳过系统盘(Macintosh HD 已在根目录显示)
            if (entry.name === 'Macintosh HD' || entry.name === '/') continue;
            volumes.push({
              name: entry.name,
              path: fullPath,
              type: 'external',
              icon: '💽'
            });
          }
        }
      } catch (e) {}

      // Linux: /media 和 /mnt
      if (platform === 'linux') {
        for (const mountDir of ['/media', '/mnt']) {
          try {
            const entries = fs.readdirSync(mountDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const fullPath = path.join(mountDir, entry.name);
                volumes.push({
                  name: entry.name,
                  path: fullPath,
                  type: 'mount',
                  icon: '💽'
                });
              }
            }
          } catch (e) {}
        }
      }
    }

    return volumes;
  }

  autoDetectTags(repoPath) {
    const tags = [];
    const pkgPath = path.join(repoPath, 'package.json');

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        if (deps['react'] || deps['react-dom']) tags.push('React');
        if (deps['vue'] || deps['vue-next']) tags.push('Vue');
        if (deps['next']) tags.push('Next.js');
        if (deps['@angular/core']) tags.push('Angular');
        if (deps['express'] || deps['koa']) tags.push('Node.js');
        if (deps['electron']) tags.push('Electron');
        if (deps['typescript']) tags.push('TypeScript');
        if (deps['tailwindcss']) tags.push('Tailwind');

        tags.push('前端');
      } catch (e) {}
    }

    if (fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
      tags.push('Python');
    }
    if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      tags.push('Go');
    }
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
      tags.push('Rust');
    }
    if (fs.existsSync(path.join(repoPath, 'pom.xml'))) {
      tags.push('Java');
    }
    if (fs.existsSync(path.join(repoPath, 'Dockerfile'))) {
      tags.push('Docker');
    }
    if (fs.existsSync(path.join(repoPath, '.gitlab-ci.yml')) || fs.existsSync(path.join(repoPath, '.github', 'workflows'))) {
      tags.push('CI/CD');
    }

    return tags;
  }

  async calculateDirectorySize(dirPath, options = {}) {
    const rootPath = path.resolve(dirPath);
    const rootStat = await fs.promises.lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('文件夹大小只能对普通文件夹进行计算');
    }

    const rootRealPath = await fs.promises.realpath(rootPath);
    const signal = options.signal;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const progressEvery = Number.isInteger(options.progressEvery) && options.progressEvery > 0
      ? options.progressEvery
      : 128;
    const yieldEvery = Number.isInteger(options.yieldEvery) && options.yieldEvery > 0
      ? options.yieldEvery
      : 64;
    const startedAt = Date.now();
    const pendingDirectories = [rootPath];
    const result = {
      size: 0,
      fileCount: 0,
      directoryCount: 0,
      symlinkCount: 0,
      skippedCount: 0,
      otherCount: 0,
      processedCount: 0,
      cancelled: false,
      durationMs: 0
    };
    let lastProgressCount = 0;
    let lastProgressAt = startedAt;

    const snapshot = () => ({
      size: result.size,
      fileCount: result.fileCount,
      directoryCount: result.directoryCount,
      symlinkCount: result.symlinkCount,
      skippedCount: result.skippedCount,
      otherCount: result.otherCount,
      processedCount: result.processedCount,
      cancelled: Boolean(signal?.aborted),
      durationMs: Date.now() - startedAt
    });
    const emitProgress = (force = false) => {
      if (!onProgress) return;
      const now = Date.now();
      if (!force && result.processedCount - lastProgressCount < progressEvery && now - lastProgressAt < 150) return;
      lastProgressCount = result.processedCount;
      lastProgressAt = now;
      try {
        onProgress(snapshot());
      } catch (_) {}
    };

    while (pendingDirectories.length && !signal?.aborted) {
      const currentPath = pendingDirectories.pop();
      if (currentPath !== rootPath) {
        try {
          const currentStat = await fs.promises.lstat(currentPath);
          if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
            result.skippedCount += 1;
            result.processedCount += 1;
            emitProgress();
            continue;
          }
          const currentRealPath = await fs.promises.realpath(currentPath);
          if (!this._workspacePathIsWithin(currentRealPath, rootRealPath)) {
            result.skippedCount += 1;
            result.processedCount += 1;
            emitProgress();
            continue;
          }
        } catch (_) {
          result.skippedCount += 1;
          result.processedCount += 1;
          emitProgress();
          continue;
        }
      }

      let directory;
      try {
        directory = await fs.promises.opendir(currentPath);
        for await (const entry of directory) {
          if (signal?.aborted) break;
          const entryPath = path.join(currentPath, entry.name);
          try {
            const entryStat = await fs.promises.lstat(entryPath);
            if (entryStat.isSymbolicLink()) {
              result.symlinkCount += 1;
              result.size += entryStat.size;
            } else if (entryStat.isDirectory()) {
              result.directoryCount += 1;
              pendingDirectories.push(entryPath);
            } else if (entryStat.isFile()) {
              result.fileCount += 1;
              result.size += entryStat.size;
            } else {
              result.otherCount += 1;
            }
          } catch (_) {
            result.skippedCount += 1;
          }
          result.processedCount += 1;
          emitProgress();
          if (result.processedCount % yieldEvery === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
      } catch (_) {
        if (currentPath === rootPath) throw new Error('无法读取文件夹内容');
        result.skippedCount += 1;
        result.processedCount += 1;
        emitProgress();
      }
    }

    result.cancelled = Boolean(signal?.aborted);
    result.durationMs = Date.now() - startedAt;
    emitProgress(true);
    return result;
  }

  async getDirSize(dirPath) {
    const result = await this.calculateDirectorySize(dirPath);
    return result.size;
  }
}

const fileService = new FileService();
module.exports = fileService;
module.exports.FileService = FileService;
