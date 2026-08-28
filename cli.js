#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '.git-monitor-cache.json');

function isGitRepo(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    return fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

function scanGitRepos(basePath, depth = 1) {
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
      console.log(`  ⚠️  无法访问: ${currentPath}`);
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
    remoteUrl: '',
    error: null
  };

  try {
    const branchOutput = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    status.branch = branchOutput;

    const remoteOutput = execSync('git remote get-url origin 2>/dev/null || echo "no remote"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
    status.remoteUrl = remoteOutput !== 'no remote' ? remoteOutput : '';

    try {
      execSync('git fetch origin', { cwd: repoPath, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {}

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

  } catch (err) {
    status.error = err.message || '获取状态失败';
  }

  return status;
}

function printStatus(status) {
  let icon = '✅';
  let color = '\x1b[32m';
  
  if (status.error) {
    icon = '❌';
    color = '\x1b[31m';
  } else if (status.hasUncommitted) {
    icon = '🔴';
    color = '\x1b[31m';
  } else if (status.hasUnpulled) {
    icon = '🔵';
    color = '\x1b[34m';
  } else if (status.hasUnpushed) {
    icon = '🟡';
    color = '\x1b[33m';
  }

  const reset = '\x1b[0m';
  const dim = '\x1b[90m';
  
  process.stdout.write(`${color}${icon} ${status.name}${reset}\n`);
  process.stdout.write(`${dim}  分支: ${status.branch || '无'}${reset}\n`);
  
  if (status.hasUncommitted) {
    process.stdout.write(`${dim}  修改: ${status.modifiedCount} | 暂存: ${status.stagedCount} | 未跟踪: ${status.untrackedCount}${reset}\n`);
  }
  if (status.hasUnpushed) {
    process.stdout.write(`${dim}  ↑ 领先: ${status.aheadCount} 个提交${reset}\n`);
  }
  if (status.hasUnpulled) {
    process.stdout.write(`${dim}  ↓ 落后: ${status.behindCount} 个提交${reset}\n`);
  }
  if (status.error) {
    process.stdout.write(`${color}  错误: ${status.error}${reset}\n`);
  }
  
  process.stdout.write('\n');
}

function showHelp() {
  console.log(`
Git状态监控 CLI 工具

用法:
  git-monitor [命令] [选项]

命令:
  scan          扫描并显示所有Git仓库状态
  server        启动Web服务器
  status        查看缓存的状态（快速）
  clear         清除缓存

选项:
  --path, -p    指定扫描路径（默认: /Volumes/project）
  --depth, -d   指定扫描深度（默认: 2）

示例:
  git-monitor scan
  git-monitor scan --path /Users/user/projects --depth 3
  git-monitor server
  git-monitor status
  git-monitor clear
  `);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'scan';
  
  const defaultPath = process.platform === 'win32' 
    ? process.env.USERPROFILE + '\\Projects' 
    : process.env.HOME + '/Projects';
  let basePath = defaultPath;
  let depth = 2;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' || args[i] === '-p') {
      basePath = args[i + 1];
      i++;
    } else if (args[i] === '--depth' || args[i] === '-d') {
      depth = parseInt(args[i + 1]) || 2;
      i++;
    }
  }

  switch (command) {
    case 'scan':
      console.log(`\n🔍 正在扫描路径: ${basePath} (深度: ${depth})\n`);
      
      const repos = scanGitRepos(basePath, depth);
      console.log(`📁 发现 ${repos.length} 个Git仓库\n`);
      
      let synced = 0;
      let uncommitted = 0;
      let unpushed = 0;
      let unpulled = 0;
      
      for (let i = 0; i < repos.length; i++) {
        process.stdout.write(`\x1b[90m处理中: ${i + 1}/${repos.length} - ${repos[i].name}\x1b[0m\r`);
        const status = getGitStatus(repos[i].path);
        
        if (status.error) {
          // 跳过错误的仓库
        } else if (!status.hasUncommitted && !status.hasUnpushed && !status.hasUnpulled) {
          synced++;
        } else {
          if (status.hasUncommitted) uncommitted++;
          if (status.hasUnpushed) unpushed++;
          if (status.hasUnpulled) unpulled++;
          printStatus(status);
        }
      }
      
      process.stdout.write('\x1b[K');
      
      console.log('────────────────────────────────');
      console.log(`📊 统计: 已同步 ${synced} | 未提交 ${uncommitted} | 未推送 ${unpushed} | 需拉取 ${unpulled}`);
      console.log('────────────────────────────────\n');
      
      break;
      
    case 'server':
      console.log('🚀 启动Git状态监控服务...');
      console.log('访问: http://localhost:3001');
      await require('./server').startServer();
      break;
      
    case 'status':
      try {
        if (fs.existsSync(CACHE_FILE)) {
          const content = fs.readFileSync(CACHE_FILE, 'utf-8');
          const cache = JSON.parse(content);
          const age = Math.floor((Date.now() - cache.timestamp) / 1000);
          
          console.log(`\n📋 缓存状态 (${age}秒前)\n`);
          
          cache.data.statuses.forEach(status => {
            if (status.hasUncommitted || status.hasUnpushed || status.hasUnpulled) {
              printStatus(status);
            }
          });
          
          console.log('────────────────────────────────');
          console.log(`📊 总仓库: ${cache.data.total}`);
          console.log(`⏱️ 更新时间: ${new Date(cache.timestamp).toLocaleString('zh-CN')}`);
          console.log('────────────────────────────────\n');
        } else {
          console.log('⚠️  暂无缓存，请先运行 scan 或启动 server\n');
        }
      } catch (err) {
        console.log('❌ 读取缓存失败:', err.message, '\n');
      }
      break;
      
    case 'clear':
      try {
        if (fs.existsSync(CACHE_FILE)) {
          fs.unlinkSync(CACHE_FILE);
          console.log('✅ 缓存已清除\n');
        } else {
          console.log('⚠️  暂无缓存\n');
        }
      } catch (err) {
        console.log('❌ 清除缓存失败:', err.message, '\n');
      }
      break;
      
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
      
    default:
      console.log(`❌ 未知命令: ${command}`);
      showHelp();
      break;
  }
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
