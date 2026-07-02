const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');

const serverApp = express();
const port = 3001;

serverApp.use(cors());
serverApp.use(express.json());

function loadCache() {
    try {
        const CACHE_FILE = path.join(app.getPath('userData'), '.git-monitor-cache.json');
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
        const CACHE_FILE = path.join(app.getPath('userData'), '.git-monitor-cache.json');
        const cache = { timestamp: Date.now(), data };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error('保存缓存失败:', err);
    }
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
    const skipDirs = ['.git', '.DS_Store', '.DocumentRevisions-V100', '.Spotlight-V100', '.TemporaryItems', '.Trashes', '.fseventsd', '.VolumeIcon.icns', '.apdisk', '.metadata_never_index', '.metadata_never_index_unless_rootfs', 'node_modules', 'vendor', '__pycache__', '.venv', 'env'];

    function scan(currentPath, currentDepth) {
        if (currentDepth > depth) return;
        try {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (skipDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
                    const fullPath = path.join(currentPath, entry.name);
                    if (excluded.includes(fullPath)) continue;
                    if (isGitRepo(fullPath)) {
                        repos.push({ name: entry.name, path: fullPath });
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

function getGitStatus(repoPath) {
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
        if (allRemotes) {
            const lines = allRemotes.split('\n');
            const seen = new Set();
            lines.forEach(line => {
                const parts = line.split(/\s+/);
                if (parts.length >= 2 && !seen.has(parts[0])) {
                    status.remotes.push({ name: parts[0], url: parts[1] });
                    seen.add(parts[0]);
                }
            });
        }

        const statusOutput = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
        if (statusOutput) {
            status.hasUncommitted = true;
            const lines = statusOutput.split('\n');
            lines.forEach(line => {
                const st = line.substring(0, 2);
                if (st[0] !== ' ') status.stagedCount++;
                if (st[1] !== ' ') status.modifiedCount++;
                if (line.includes('??')) status.untrackedCount++;
            });
        }

        try {
            const aheadBehind = execSync('git rev-list --left-right --count HEAD...origin/HEAD 2>/dev/null || echo "0\t0"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
            const parts = aheadBehind.split('\t');
            if (parts.length >= 2) {
                status.aheadCount = parseInt(parts[0]) || 0;
                status.behindCount = parseInt(parts[1]) || 0;
            }
            status.hasUnpushed = status.aheadCount > 0;
            status.hasUnpulled = status.behindCount > 0;
        } catch {}

        try {
            const lastCommit = execSync('git log -1 --oneline 2>/dev/null || echo ""', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
            status.lastCommit = lastCommit;

            const lastCommitTime = execSync('git log -1 --format=%ci 2>/dev/null || echo ""', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
            status.lastCommitTime = lastCommitTime;
        } catch {}

        const readmeFiles = ['README.md', 'README', 'readme.md', 'readme'];
        for (const file of readmeFiles) {
            const readmePath = path.join(repoPath, file);
            if (fs.existsSync(readmePath)) {
                try {
                    const content = fs.readFileSync(readmePath, 'utf-8');
                    const lines = content.split('\n');
                    const title = lines[0]?.replace(/^#+\s*/, '').trim() || '';
                    let description = '';
                    for (let i = 1; i < lines.length && description.length < 200; i++) {
                        const line = lines[i].trim();
                        if (line && !line.startsWith('#')) description += line + ' ';
                    }
                    status.readme = { title, description: description.trim().substring(0, 200) };
                    break;
                } catch {}
            }
        }
    } catch (err) {
        status.error = err.message || '获取状态失败';
    }
    return status;
}

serverApp.get('/api/repos', (req, res) => {
    const basePath = req.query.path || '/Volumes/project';
    const depth = parseInt(req.query.depth) || 1;
    const repos = scanGitRepos(basePath, depth);
    res.json({ repos });
});

serverApp.get('/api/cache', (req, res) => {
    const cache = loadCache();
    res.json({ hasCache: !!cache, data: cache });
});

serverApp.post('/api/status', (req, res) => {
    const { path, depth, excluded } = req.body;
    if (!path) return res.status(400).json({ error: '路径不能为空' });
    const scanDepth = parseInt(depth) || 1;
    const excludedList = excluded || [];
    const repos = scanGitRepos(path, scanDepth, excludedList);
    const statuses = repos.map(repo => getGitStatus(repo.path));
    const result = { total: statuses.length, statuses, cachedAt: new Date().toISOString() };
    saveCache(result);
    res.json(result);
});

serverApp.post('/api/refresh', (req, res) => {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) return res.status(400).json({ error: '路径列表不能为空' });
    const statuses = paths.map(p => getGitStatus(p));
    res.json({ statuses });
});

serverApp.post('/api/action', (req, res) => {
    const { path, action } = req.body;
    if (!path || !action) return res.status(400).json({ error: '参数不能为空' });
    try {
        let result;
        switch (action) {
            case 'pull': result = execSync('git pull', { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim(); break;
            case 'push': result = execSync('git push', { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim(); break;
            case 'fetch': result = execSync('git fetch origin', { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim(); break;
            default: return res.status(400).json({ error: '无效的操作' });
        }
        res.json({ success: true, result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

serverApp.post('/api/commit', (req, res) => {
    const { path, message } = req.body;
    if (!path || !message) return res.status(400).json({ error: '参数不能为空' });
    try {
        execSync('git add .', { cwd: path, encoding: 'utf-8', timeout: 10000 });
        execSync(`git commit -m "${message}"`, { cwd: path, encoding: 'utf-8', timeout: 10000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

serverApp.post('/api/commits', (req, res) => {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: '路径不能为空' });
    try {
        const output = execSync('git log --oneline -20', { cwd: path, encoding: 'utf-8', timeout: 5000 }).trim();
        const commits = output.split('\n').filter(line => line.trim()).map(line => {
            const parts = line.split(' ', 2);
            return { hash: parts[0], message: parts[1] || '' };
        });
        res.json({ commits });
    } catch (err) {
        res.json({ commits: [], error: err.message });
    }
});

serverApp.post('/api/diff', (req, res) => {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: '路径不能为空' });
    try {
        const statusOutput = execSync('git status --porcelain', { cwd: path, encoding: 'utf-8', timeout: 5000 }).trim();
        const diffOutput = execSync('git diff --stat', { cwd: path, encoding: 'utf-8', timeout: 5000 }).trim();
        const files = statusOutput.split('\n').filter(line => line.trim()).map(line => ({ status: line.substring(0, 2), file: line.substring(3) }));
        res.json({ files, diff: diffOutput });
    } catch (err) {
        res.json({ files: [], diff: '', error: err.message });
    }
});

serverApp.post('/api/remote', (req, res) => {
    const { path, action, remoteName, remoteUrl } = req.body;
    if (!path || !action) return res.status(400).json({ error: '参数不完整' });
    try {
        let result;
        switch (action) {
            case 'list': result = execSync('git remote -v', { cwd: path, encoding: 'utf-8', timeout: 5000 }).trim(); break;
            case 'add':
                if (!remoteName || !remoteUrl) return res.status(400).json({ error: '远程名称和地址不能为空' });
                execSync(`git remote add ${remoteName} ${remoteUrl}`, { cwd: path, encoding: 'utf-8', timeout: 5000 });
                result = '添加成功';
                break;
            case 'set-url':
                if (!remoteName || !remoteUrl) return res.status(400).json({ error: '远程名称和地址不能为空' });
                execSync(`git remote set-url ${remoteName} ${remoteUrl}`, { cwd: path, encoding: 'utf-8', timeout: 5000 });
                result = '更新成功';
                break;
            case 'fetch':
                if (!remoteName) return res.status(400).json({ error: '远程名称不能为空' });
                result = execSync(`git fetch ${remoteName}`, { cwd: path, encoding: 'utf-8', timeout: 30000 }).trim();
                break;
            case 'remove':
                if (!remoteName) return res.status(400).json({ error: '远程名称不能为空' });
                return res.status(403).json({ error: '删除操作必须在CLI中执行' });
            default: return res.status(400).json({ error: '无效的操作' });
        }
        res.json({ success: true, result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

let mainWindow;
let server;

function resolvePublicPath() {
    const possiblePaths = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'public'),
        path.join(__dirname, 'public'),
        path.join(app.getAppPath(), 'public'),
        path.join(process.resourcesPath, 'app', 'public'),
        path.join(process.resourcesPath, 'public')
    ];

    for (const p of possiblePaths) {
        const indexPath = path.join(p, 'index.html');
        console.log(`检查路径: ${p}, 存在: ${fs.existsSync(p)}, index.html: ${fs.existsSync(indexPath)}`);
        if (fs.existsSync(indexPath)) {
            return p;
        }
    }

    return path.join(app.getAppPath(), 'public');
}

function createWindow() {
    const publicPath = resolvePublicPath();
    const indexPath = path.join(publicPath, 'index.html');

    console.log(`最终 public 路径: ${publicPath}`);
    console.log(`最终 index.html 路径: ${indexPath}`);
    console.log(`index.html 是否存在: ${fs.existsSync(indexPath)}`);

    serverApp.use(express.static(publicPath));

    serverApp.get('*', (req, res) => {
        res.sendFile(indexPath);
    });

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Git Status Monitor',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    server = http.createServer(serverApp);
    server.listen(port, () => {
        console.log(`Git状态监控服务运行在 http://localhost:${port}`);
        mainWindow.loadURL(`http://localhost:${port}`);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (server) server.close();
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});