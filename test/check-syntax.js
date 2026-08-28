const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const roots = ['main.js', 'preload.js', 'server.js', 'cli.js', 'src', 'public', 'test'];
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const files = [];

function collect(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (targetPath.endsWith('.js')) files.push(targetPath);
    return;
  }
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    collect(path.join(targetPath, entry.name));
  }
}

for (const entry of roots) collect(path.join(projectRoot, entry));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `语法检查失败: ${file}\n`);
    process.exit(result.status || 1);
  }
}

process.stdout.write(`已检查 ${files.length} 个 JavaScript 文件。\n`);
