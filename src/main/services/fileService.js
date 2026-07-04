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
