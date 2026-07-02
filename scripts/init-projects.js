const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_DIR = '/Volumes/project';

const TOP_LEVEL_DIRS = [
  '学习',
  '开发工具',
  '正式项目',
  '项目存档'
];

const PROJECT_ROOTS = [
  'git-status-monitor',
  'mes-lite',
  'obsidian2026',
  'yaofan',
  '学习/astro/density-dwarf',
  '学习/nextlearn',
  '开发工具/ai-dev-handoff-template',
  '开发工具/andrej-karpathy-skills-main',
  '开发工具/nuwa-skill-main',
  '开发工具/skills-main',
  '开发工具/中文规则',
  '正式项目/AI image generator',
  '正式项目/MoneyPrinterTurbo-1.3.0',
  '正式项目/ebm01',
  '正式项目/html-tools',
  '正式项目/simple_saas',
  '正式项目/simple_saas_cn',
  '正式项目/unfold',
  '正式项目/何晴',
  '正式项目/量化交易',
  '项目存档/mini_mrp',
  '项目存档/odoo_project',
  '项目存档/odoo数字工厂',
  '项目存档/panda object'
];

function hasReadme(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
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

function createReadme(dirPath, type = 'project') {
  const name = path.basename(dirPath);
  const readmePath = path.join(dirPath, 'README.md');
  
  let content = '';
  
  if (type === 'category') {
    content = `# ${name}

## 目录说明

${name} 目录用于存放相关项目和资源。

## 子目录

\`\`\`
${name}/
├── ...
\`\`\`

## 说明

此目录用于组织和管理相关项目文件。
`;
  } else {
    let description = `${name} 项目`;
    
    try {
      const packageJsonPath = path.join(dirPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.description) {
          description = pkg.description;
        }
      }
    } catch (e) {}
    
    content = `# ${name}

## 项目简介

${description}

## 技术栈

- ...

## 安装

\`\`\`bash
npm install
\`\`\`

## 使用

\`\`\`bash
npm start
\`\`\`

## 目录结构

\`\`\`
${name}/
├── src/          # 源代码
├── public/       # 静态资源
├── ...
\`\`\`

## 说明

此 README 由 git-status-monitor 自动生成，请根据项目实际情况补充完善。
`;
  }
  
  fs.writeFileSync(readmePath, content, 'utf-8');
  console.log(`  ✅ 创建 README.md: ${dirPath}`);
}

function initGit(dirPath) {
  const name = path.basename(dirPath);
  
  try {
    execSync('git init', { cwd: dirPath, encoding: 'utf-8', stdio: 'pipe' });
    console.log(`  ✅ git init`);
    
    let gitignorePath = path.join(dirPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      const gitignoreContent = `node_modules/
dist/
build/
.next/
.astro/
.venv/
__pycache__/
*.pyc
.env
.env.local
.DS_Store
*.log
`;
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf-8');
      console.log(`  ✅ 创建 .gitignore`);
    }
    
    execSync('git add .', { cwd: dirPath, encoding: 'utf-8', stdio: 'pipe', timeout: 60000 });
    console.log(`  ✅ git add .`);
    
    try {
      execSync('git commit -m "Initial commit"', { 
        cwd: dirPath, 
        encoding: 'utf-8', 
        stdio: 'pipe',
        timeout: 60000,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Auto Init',
          GIT_AUTHOR_EMAIL: 'auto@local.dev',
          GIT_COMMITTER_NAME: 'Auto Init',
          GIT_COMMITTER_EMAIL: 'auto@local.dev'
        }
      });
      console.log(`  ✅ git commit -m "Initial commit"`);
    } catch (commitErr) {
      console.log(`  ⚠️  commit 跳过: ${commitErr.message.substring(0, 60)}`);
    }
    
    return true;
  } catch (err) {
    console.error(`  ❌ git 初始化失败: ${err.message.substring(0, 100)}`);
    return false;
  }
}

console.log('🚀 开始处理项目...\n');
console.log('='.repeat(80));

let readmeCreated = 0;
let gitInited = 0;

console.log('\n📁 处理一级分类目录...\n');

for (const dir of TOP_LEVEL_DIRS) {
  const fullPath = path.join(BASE_DIR, dir);
  if (!fs.existsSync(fullPath)) continue;
  
  if (!hasReadme(fullPath)) {
    console.log(`📝 ${dir}`);
    createReadme(fullPath, 'category');
    readmeCreated++;
  } else {
    console.log(`✅ ${dir} (已有 README)`);
  }
}

console.log('\n📦 处理项目根目录...\n');

for (const project of PROJECT_ROOTS) {
  const fullPath = path.join(BASE_DIR, project);
  if (!fs.existsSync(fullPath)) continue;
  
  console.log(`\n📂 ${project}`);
  
  if (!hasReadme(fullPath)) {
    createReadme(fullPath, 'project');
    readmeCreated++;
  } else {
    console.log(`  ✅ 已有 README`);
  }
  
  if (!hasGit(fullPath)) {
    console.log(`  🔀 初始化 git...`);
    if (initGit(fullPath)) {
      gitInited++;
    }
  } else {
    console.log(`  ✅ 已有 git 仓库`);
  }
}

console.log('\n' + '='.repeat(80));
console.log(`\n📊 处理完成:`);
console.log(`   - 创建 README: ${readmeCreated} 个`);
console.log(`   - 初始化 git: ${gitInited} 个`);
console.log('\n✅ 全部完成！');
