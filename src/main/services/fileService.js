const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const os = require('os');

class FileService {
  constructor() {
    this.dirCache = new Map();
    this.gitRepoCache = new Set();
  }

  listDirectory(dirPath, { showHidden = false, recursive = false, depth = 2, onlyGit = false } = {}) {
    const result = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

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
          isGitRepo: false,
          readme: null
        };

        if (isDir) {
          item.isGitRepo = this.isGitRepo(fullPath);

          if (item.isGitRepo) {
            this.gitRepoCache.add(fullPath);
            try {
              item.readme = this.getReadmePreview(fullPath);
            } catch (e) {}
          }

          if (recursive && depth > 0 && !item.isGitRepo) {
            item.children = this.listDirectory(fullPath, {
              showHidden,
              recursive: true,
              depth: depth - 1,
              onlyGit
            });
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

    } catch (e) {
      console.error('listDirectory error:', e.message);
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

  findGitRepos(rootPath, { depth = 3, showHidden = false } = {}) {
    const repos = [];
    const scanDir = (dir, currentDepth) => {
      if (currentDepth > depth) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!showHidden && entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules') continue;
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);
          if (this.isGitRepo(fullPath)) {
            const stat = fs.statSync(fullPath);
            repos.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              size: stat.size,
              modifiedTime: stat.mtime.toISOString(),
              isGitRepo: true,
              readme: this.getReadmePreview(fullPath)
            });
          } else {
            scanDir(fullPath, currentDepth + 1);
          }
        }
      } catch (e) {}
    };
    scanDir(rootPath, 0);
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
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
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
    this._assertProjectDirectory(repoPath);
    return fs.readdirSync(repoPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase() !== 'agents.md' && /\.(csv|md)$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(repoPath, entry.name);
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
    this._assertProjectDirectory(repoPath);
    return fs.readdirSync(repoPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase() !== 'agents.md' && /\.md$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(repoPath, entry.name);
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
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) {
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
    if (Buffer.byteLength(content, 'utf-8') > 1024 * 1024) throw new Error('Markdown 文档不能超过 1 MB');
    const filePath = this._resolveMarkdownDocumentPath(repoPath, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    return this.readMarkdownDocument(repoPath, fileName);
  }

  readProjectControlFile(repoPath, fileName) {
    const filePath = this._resolveProjectControlPath(repoPath, fileName);
    if (!fs.existsSync(filePath)) {
      return { fileName, exists: false, content: '', format: path.extname(fileName).slice(1).toLowerCase() };
    }
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) {
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
    if (Buffer.byteLength(content, 'utf-8') > 1024 * 1024) throw new Error('控制文件不能超过 1 MB');
    const filePath = this._resolveProjectControlPath(repoPath, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    return this.readProjectControlFile(repoPath, fileName);
  }

  syncProjectControlAgentRules(repoPath, selections) {
    this._assertProjectDirectory(repoPath);
    const goalsFile = this._validateProjectControlFileName(selections?.goalsFile || '');
    const progressFile = this._validateProjectControlFileName(selections?.progressFile || '');
    const milestoneFile = this._validateProjectControlFileName(selections?.milestoneFile || '');
    if (!goalsFile && !progressFile && !milestoneFile) throw new Error('请先选择目标、进度或里程碑文件');

    const agentsPath = path.join(repoPath, 'AGENTS.md');
    const startMarker = '<!-- git-status-monitor:project-control:start -->';
    const endMarker = '<!-- git-status-monitor:project-control:end -->';
    const fileLines = [
      goalsFile ? `- 目标文件：\`${goalsFile}\`` : null,
      progressFile ? `- 进度文件：\`${progressFile}\`` : null,
      milestoneFile ? `- 里程碑文件：\`${milestoneFile}\`` : null
    ].filter(Boolean).join('\n');
    const block = `${startMarker}\n## 项目控制文件\n\n${fileLines}\n\n完成开发任务后，及时更新上述 CSV 或 Markdown 文件。目标文件记录项目目标、优先级、状态和关键日期；进度文件至少记录日期、当前状态、已完成内容、下一步、阻塞项；达到关键节点时同步更新里程碑。保留现有列和既有记录，不覆盖人工填写内容。\n${endMarker}`;
    const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : '# AGENTS.md\n';
    const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
    const content = markerPattern.test(existing)
      ? existing.replace(markerPattern, block)
      : `${existing.trimEnd()}\n\n${block}\n`;
    fs.writeFileSync(agentsPath, content, 'utf-8');
    return { fileName: 'AGENTS.md', updated: true };
  }

  _assertProjectDirectory(repoPath) {
    if (!repoPath || !fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      throw new Error('项目目录不存在');
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
    this._assertProjectDirectory(repoPath);
    const validated = this._validateProjectControlFileName(fileName);
    if (!validated) throw new Error('请选择控制文件');
    return path.join(path.resolve(repoPath), validated);
  }

  _resolveMarkdownDocumentPath(repoPath, fileName) {
    this._assertProjectDirectory(repoPath);
    if (!fileName || path.basename(fileName) !== fileName || !/\.md$/i.test(fileName)) {
      throw new Error('文档必须是项目根目录下的 Markdown 文件');
    }
    if (fileName.toLowerCase() === 'agents.md') {
      throw new Error('AGENTS.md 请通过 AI 规则入口维护，不作为普通文档编辑');
    }
    return path.join(path.resolve(repoPath), fileName);
  }

  getFileInfo(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        createdTime: stat.birthtime.toISOString(),
        isGitRepo: stat.isDirectory() && this.isGitRepo(filePath)
      };
    } catch (e) {
      return null;
    }
  }

  showInFinder(filePath) {
    try {
      if (process.platform === 'darwin') {
        execSync(`open -R "${filePath}"`);
      } else if (process.platform === 'win32') {
        execSync(`explorer /select,"${filePath}"`);
      } else {
        const dir = path.dirname(filePath);
        execSync(`xdg-open "${dir}"`);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  openFile(filePath) {
    try {
      if (process.platform === 'darwin') {
        exec(`open "${filePath}"`);
      } else if (process.platform === 'win32') {
        exec(`start "" "${filePath}"`);
      } else {
        exec(`xdg-open "${filePath}"`);
      }
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

  getDirSize(dirPath) {
    let totalSize = 0;
    const walk = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else {
            try {
              totalSize += fs.statSync(fullPath).size;
            } catch (e) {}
          }
        }
      } catch (e) {}
    };
    walk(dirPath);
    return totalSize;
  }
}

module.exports = new FileService();
