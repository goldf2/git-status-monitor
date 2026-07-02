const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_DIR = '/Volumes/project';

const PROJECT_INDICATORS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  '.gitignore',
  'src/',
  'app/',
  'lib/',
  'prisma/',
  'next.config.js',
  'vite.config.ts',
  'vite.config.js',
  'astro.config.mjs',
  'tsconfig.json'
];

function isProjectDir(dirPath) {
  for (const indicator of PROJECT_INDICATORS) {
    const fullPath = path.join(dirPath, indicator);
    if (fs.existsSync(fullPath)) {
      return true;
    }
  }
  return false;
}

function hasReadme(dirPath) {
  const files = fs.readdirSync(dirPath);
  return files.some(f => 
    f.toLowerCase() === 'readme.md' || 
    f.toLowerCase() === 'readme.txt' ||
    f.toLowerCase() === 'readme'
  );
}

function hasGit(dirPath) {
  return fs.existsSync(path.join(dirPath, '.git'));
}

function getDirName(dirPath) {
  return path.basename(dirPath);
}

function createReadme(dirPath) {
  const name = getDirName(dirPath);
  const readmePath = path.join(dirPath, 'README.md');
  
  let description = '';
  try {
    const files = fs.readdirSync(dirPath).slice(0, 20);
    description = files.join('、');
  } catch (e) {
    description = '项目目录';
  }
  
  const content = `# ${name}

## 项目简介

${name} 项目

## 目录结构

\`\`\`
${name}/
├── ...
\`\`\`

## 说明

此项目由 git-status-monitor 自动初始化。
`;
  
  fs.writeFileSync(readmePath, content, 'utf-8');
  console.log(`  ✅ 创建 README.md: ${readmePath}`);
}

function initGit(dirPath) {
  const name = getDirName(dirPath);
  try {
    execSync('git init', { cwd: dirPath, encoding: 'utf-8', stdio: 'pipe' });
    console.log(`  ✅ git init 完成`);
    
    execSync('git add .', { cwd: dirPath, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
    console.log(`  ✅ git add . 完成`);
    
    try {
      execSync('git commit -m "Initial commit"', { 
        cwd: dirPath, 
        encoding: 'utf-8', 
        stdio: 'pipe',
        timeout: 30000,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Auto Init',
          GIT_AUTHOR_EMAIL: 'auto@local.dev',
          GIT_COMMITTER_NAME: 'Auto Init',
          GIT_COMMITTER_EMAIL: 'auto@local.dev'
        }
      });
      console.log(`  ✅ git commit 完成`);
    } catch (commitErr) {
      console.log(`  ⚠️  git commit 跳过（可能没有可提交的内容）: ${commitErr.message.substring(0, 80)}`);
    }
    
    return true;
  } catch (err) {
    console.error(`  ❌ git 初始化失败: ${err.message.substring(0, 100)}`);
    return false;
  }
}

function scanDir(dirPath, depth = 0, maxDepth = 2) {
  const results = [];
  
  if (depth > maxDepth) return results;
  
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || 
        entry.name === '.venv' || entry.name === 'dist' || entry.name === '.next') {
      continue;
    }
    
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      const isProject = isProjectDir(fullPath);
      const hasReadmeFile = hasReadme(fullPath);
      const hasGitRepo = hasGit(fullPath);
      
      results.push({
        path: fullPath,
        name: entry.name,
        depth,
        isProject,
        hasReadme: hasReadmeFile,
        hasGit: hasGitRepo
      });
      
      if (!hasGitRepo && depth < maxDepth) {
        const subResults = scanDir(fullPath, depth + 1, maxDepth);
        results.push(...subResults);
      }
    }
  }
  
  return results;
}

console.log('🔍 扫描 /Volumes/project 目录...\n');

const allDirs = scanDir(BASE_DIR, 0, 2);

console.log(`📊 共发现 ${allDirs.length} 个目录\n`);

console.log('='.repeat(80));
console.log('📋 目录清单:');
console.log('='.repeat(80));

const needReadme = [];
const needGit = [];

for (const dir of allDirs) {
  const indent = '  '.repeat(dir.depth);
  const statuses = [];
  if (dir.isProject) statuses.push('📦 项目');
  if (dir.hasReadme) statuses.push('📄 有README');
  if (dir.hasGit) statuses.push('🔀 有Git');
  
  console.log(`${indent}${dir.name}`);
  console.log(`${indent}  ${statuses.join(' | ') || '📁 普通目录'}`);
  console.log();
  
  if (!dir.hasReadme) {
    needReadme.push(dir);
  }
  
  if (dir.isProject && !dir.hasGit) {
    needGit.push(dir);
  }
}

console.log('\n' + '='.repeat(80));
console.log(`📝 需要创建 README 的目录: ${needReadme.length} 个`);
console.log(`🔀 需要初始化 Git 的项目目录: ${needGit.length} 个`);
console.log('='.repeat(80));

console.log('\n📝 需要创建 README 的目录列表:');
for (const dir of needReadme) {
  console.log(`  - ${dir.path}`);
}

console.log('\n🔀 需要初始化 Git 的项目目录列表:');
for (const dir of needGit) {
  console.log(`  - ${dir.path}`);
}

console.log('\n⚠️  以上为扫描结果，脚本只做扫描不执行操作。');
