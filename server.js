const express = require('express');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '127.0.0.1';

const CACHE_FILE = path.join(__dirname, '.git-monitor-cache.json');

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      const cache = JSON.parse(content);
      if (cache.timestamp && Date.now() - cache.timestamp < 3600000) {
        return cache.data;
      }
    }
  } catch (err) {
    console.error('读取缓存失败:', err);
  }
  return null;
}

function saveCache(data) {
  try {
    const cache = {
      timestamp: Date.now(),
      data
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('保存缓存失败:', err);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireWebWrite(req, res, next) {
  if (process.env.GITFINDER_WEB_WRITE_ENABLED === '1') return next();
  return res.status(403).json({
    success: false,
    error: 'Web 写操作默认关闭，请在可信本机环境显式启用'
  });
}

function isGitRepo(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

function scanGitRepos(basePath, depth = 1, excluded = []) {
  const repos = [];
  const skipDirs = [
    '.git', '.DS_Store', '.DocumentRevisions-V100', '.Spotlight-V100',
    '.TemporaryItems', '.Trashes', '.fseventsd', '.VolumeIcon.icns',
    '.apdisk', '.metadata_never_index', '.metadata_never_index_unless_rootfs',
    'node_modules', 'vendor', '__pycache__', '.venv', 'env'
  ];
  
  function scan(currentPath, currentDepth) {
    if (currentDepth > depth) return;
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.includes(entry.name) || entry.name.startsWith('.')) {
            continue;
          }
          
          const fullPath = path.join(currentPath, entry.name);
          
          if (excluded.includes(fullPath)) {
            continue;
          }
          
          if (isGitRepo(fullPath)) {
            repos.push({
              name: entry.name,
              path: fullPath
            });
          } else {
            scan(fullPath, currentDepth + 1);
          }
        }
      }
    } catch (err) {
      console.error('扫描目录失败:', err);
    }
  }
  
  scan(basePath, 1);
  return repos;
}

function getGitStatus(repoPath, autoFetch = false) {
  const status = {
    name: path.basename(repoPath),
    path: repoPath,
    branch: '',
    hasUncommitted: false,
    hasUnpushed: false,
    hasUnpulled: false,
    aheadCount: 0,
    behindCount: 0,
    modifiedCount: 0,
    stagedCount: 0,
    untrackedCount: 0,
    lastCommit: '',
    lastCommitTime: '',
    remoteUrl: '',
    remoteUrlBackup: '',
    remotes: [],
    readme: '',
    error: null
  };

  try {
    const branchOutput = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    status.branch = branchOutput;

    const remoteOutput = execSync('git remote get-url origin 2>/dev/null || echo "no remote"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    status.remoteUrl = remoteOutput !== 'no remote' ? remoteOutput : '';

    const remoteBackupOutput = execSync('git remote get-url backup 2>/dev/null || git remote get-url github 2>/dev/null || git remote get-url gitlab 2>/dev/null || echo "no remote"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    status.remoteUrlBackup = remoteBackupOutput !== 'no remote' ? remoteBackupOutput : '';

    const allRemotes = execSync('git remote -v', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    const remoteLines = allRemotes.split('\n').filter(l => l.trim());
    status.remotes = remoteLines.map(line => {
      const parts = line.split(/\s+/);
      return {
        name: parts[0] || '',
        url: parts[1] || '',
        type: parts[2] ? parts[2].replace(/[()]/g, '') : ''
      };
    });

    if (autoFetch) {
      try {
        execSync('git fetch origin', { cwd: repoPath, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {}
    }

    const aheadBehind = execSync('git rev-list --left-right --count HEAD...origin/HEAD 2>/dev/null || echo "0\t0"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    const [ahead, behind] = aheadBehind.split('\t').map(Number);
    status.aheadCount = ahead;
    status.behindCount = behind;

    if (ahead > 0) status.hasUnpushed = true;
    if (behind > 0) status.hasUnpulled = true;

    const statusOutput = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 });
    const lines = statusOutput.trim().split('\n').filter(l => l.trim());

    let modified = 0;
    let staged = 0;
    let untracked = 0;

    for (const line of lines) {
      const firstChar = line[0];
      const secondChar = line[1];

      if (firstChar === '?' && secondChar === '?') {
        untracked++;
      } else {
        if (firstChar !== ' ') staged++;
        if (secondChar !== ' ') modified++;
      }
    }

    status.modifiedCount = modified;
    status.stagedCount = staged;
    status.untrackedCount = untracked;
    status.hasUncommitted = modified > 0 || staged > 0 || untracked > 0;

    try {
      const logOutput = execSync('git log -1 --format="%h - %s%n%ad" --date=iso', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
      const parts = logOutput.split('\n');
      if (parts.length >= 2) {
        status.lastCommit = parts[0];
        status.lastCommitTime = parts[1];
      }
    } catch {}

    try {
      const readmeFiles = ['README.md', 'readme.md', 'README', 'Readme.md'];
      for (const file of readmeFiles) {
        const readmePath = path.join(repoPath, file);
        if (fs.existsSync(readmePath)) {
          const content = fs.readFileSync(readmePath, 'utf-8');
          const lines = content.split('\n');
          const title = lines[0]?.replace(/^#+\s*/, '').trim() || '';
          let description = '';
          for (let i = 1; i < lines.length && description.length < 200; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
              description += line + ' ';
            }
          }
          status.readme = {
            title: title,
            description: description.trim().substring(0, 200)
          };
          break;
        }
      }
    } catch {}

  } catch (err) {
    status.error = err.message || '获取状态失败';
  }

  return status;
}

app.get('/api/default-path', (req, res) => {
  const defaultPath = process.platform === 'win32' 
    ? process.env.USERPROFILE + '\\Projects' 
    : process.env.HOME + '/Projects';
  res.json({ path: defaultPath });
});

app.get('/api/repos', (req, res) => {
  const defaultPath = process.platform === 'win32' 
    ? process.env.USERPROFILE + '\\Projects' 
    : process.env.HOME + '/Projects';
  const basePath = req.query.path || defaultPath;
  const depth = parseInt(req.query.depth) || 1;
  const repos = scanGitRepos(basePath, depth);
  res.json({ repos });
});

app.get('/api/cache', (req, res) => {
  const cache = loadCache();
  res.json({ 
    hasCache: !!cache,
    data: cache 
  });
});

app.post('/api/status', (req, res) => {
  const { path, depth, excluded, autoFetch } = req.body;
  if (!path) {
    return res.status(400).json({ error: '路径不能为空' });
  }
  
  const scanDepth = parseInt(depth) || 1;
  const excludedList = excluded || [];
  const repos = scanGitRepos(path, scanDepth, excludedList);
  const statuses = repos.map(repo => getGitStatus(repo.path, autoFetch));
  
  const result = { 
    total: statuses.length,
    statuses,
    cachedAt: new Date().toISOString()
  };
  
  saveCache(result);
  
  res.json(result);
});

app.post('/api/refresh', (req, res) => {
  const { paths, autoFetch } = req.body;
  if (!paths || !Array.isArray(paths)) {
    return res.status(400).json({ error: '路径列表不能为空' });
  }
  
  const statuses = paths.map(path => getGitStatus(path, autoFetch));
  res.json({ statuses });
});

app.post('/api/action', requireWebWrite, (req, res) => {
  const { path, action } = req.body;
  if (!path || !action) {
    return res.status(400).json({ error: '参数不能为空' });
  }

  try {
    let result;
    switch (action) {
      case 'pull':
        result = execFileSync('git', ['pull'], { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim();
        break;
      case 'push':
        result = execFileSync('git', ['push'], { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim();
        break;
      case 'fetch':
        result = execFileSync('git', ['fetch', 'origin'], { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim();
        break;
      case 'status':
        result = execFileSync('git', ['status'], { cwd: path, encoding: 'utf-8', timeout: 10000 }).trim();
        break;
      default:
        return res.status(400).json({ error: '不支持的操作' });
    }
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/commit', requireWebWrite, (req, res) => {
  const { path, message } = req.body;
  if (!path || !message) {
    return res.status(400).json({ error: '路径和提交信息不能为空' });
  }

  try {
    execFileSync('git', ['add', '--all'], { cwd: path, encoding: 'utf-8', timeout: 10000 });
    const result = execFileSync('git', ['commit', '-m', message], { cwd: path, encoding: 'utf-8', timeout: 10000 }).trim();
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/log', (req, res) => {
  const repoPath = req.query.path;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
  
  if (!repoPath) {
    return res.status(400).json({ error: '路径不能为空' });
  }

  try {
    const logOutput = execFileSync('git', ['log', '-n', String(limit), '--format=%h|%s|%an|%ad|%ae', '--date=iso'], {
      cwd: repoPath, 
      encoding: 'utf-8', 
      timeout: 5000 
    }).trim();
    
    const commits = logOutput.split('\n').filter(line => line.trim()).map(line => {
      const [hash, subject, author, date, email] = line.split('|');
      return { hash, subject, author, date, email };
    });
    
    res.json({ commits });
  } catch (err) {
    res.json({ commits: [], error: err.message });
  }
});

app.get('/api/diff', (req, res) => {
  const repoPath = req.query.path;
  
  if (!repoPath) {
    return res.status(400).json({ error: '路径不能为空' });
  }

  try {
    const statusOutput = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    const diffOutput = execSync('git diff --stat', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    
    const files = statusOutput.split('\n').filter(line => line.trim()).map(line => {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      return { status, file };
    });
    
    res.json({ files, diff: diffOutput });
  } catch (err) {
    res.json({ files: [], diff: '', error: err.message });
  }
});

app.post('/api/remote', (req, res) => {
  const { path, action, remoteName, remoteUrl } = req.body;
  
  if (!path || !action) {
    return res.status(400).json({ error: '参数不完整' });
  }

  try {
    let result;
    switch (action) {
      case 'get':
        result = execFileSync('git', ['remote', '-v'], { cwd: path, encoding: 'utf-8', timeout: 5000 }).trim();
        break;
      case 'set':
        if (process.env.GITFINDER_WEB_WRITE_ENABLED !== '1') {
          return requireWebWrite(req, res, () => {});
        }
        if (!remoteUrl) {
          return res.status(400).json({ error: '远程URL不能为空' });
        }
        const remote = remoteName || 'origin';
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
          return res.status(400).json({ error: '远程仓库名称无效' });
        }
        try {
          execFileSync('git', ['remote', 'set-url', remote, remoteUrl], { cwd: path, encoding: 'utf-8', timeout: 5000 });
        } catch {
          execFileSync('git', ['remote', 'add', remote, remoteUrl], { cwd: path, encoding: 'utf-8', timeout: 5000 });
        }
        result = `远程仓库 ${remote} 已设置为: ${remoteUrl}`;
        break;
      case 'remove':
            return res.status(403).json({ success: false, error: '删除操作必须在CLI中执行' });
      default:
        return res.status(400).json({ error: '不支持的操作' });
    }
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

module.exports = app;
module.exports.startServer = startServer;

if (require.main === module) {
  startServer().then(server => {
    const address = server.address();
    console.log(`Git状态监控服务运行在 http://${address.address}:${address.port}`);
  }).catch(error => {
    console.error('Git状态监控服务启动失败:', error.message);
    process.exitCode = 1;
  });
}
