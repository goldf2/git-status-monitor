const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
const selectionDetailSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/fileSelectionDetailController.js'), 'utf8');
const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');

test('项目与仓库作为内容筛选而不是顶层工作区入口', () => {
  assert.doesNotMatch(html, /class="view-btn[^>]+data-view="projects"/);
  assert.doesNotMatch(html, /class="view-btn[^>]+data-view="grid"/);
  assert.match(html, /class="finder-menu-heading">属性（可组合）<\/div>[\s\S]*?data-content-attribute="project"[\s\S]*?data-content-attribute="repository"/);
  assert.match(html, /class="finder-menu-heading">所有受管位置<\/div>[\s\S]*?data-content-preset="all-projects"[\s\S]*?data-content-preset="all-repositories"/);
  assert.ok(html.indexOf('scripts/contentQuery.js') < html.indexOf('scripts/workspaceTabs.js'));
  assert.match(appSource, /applyContentPreset\(preset\)/);
  assert.match(appSource, /toggleCurrentContentAttribute\(attribute\)/);
  assert.match(appSource, /renderProjectsView\(forceRefresh = false\)/);
  assert.match(appSource, /repositoryCount/);
});

test('文件夹可从工具栏、右键菜单和详情入口设为项目', () => {
  assert.match(html, /id="file-project-settings"/);
  assert.match(html, /data-context-action="project"/);
  assert.match(html, /id="detail-project-settings"/);
  assert.match(appSource, /openSelectedProjectSettings\(\)/);
  assert.match(selectionDetailSource, /data-app-action="file-project-settings"/);
  assert.match(appSource, /data-app-action="choose-local-project"/);
  assert.match(appSource, /选择文件夹并设为项目…/);
  assert.match(appSource, /window\.gitFinder\.fs\.selectFolder\(\)/);
});

test('项目设置明确不修改 Git，并只通过受限 IPC 写项目清单', () => {
  assert.match(html, /不会执行 git init、暂存、提交或推送/);
  assert.match(preload, /localProjects:\s*\{/);
  assert.match(preload, /ipcRenderer\.invoke\('localProjects:initialize'/);
  assert.match(preload, /ipcRenderer\.invoke\('localProjects:update'/);
  assert.match(main, /registerLocalProjectsIPC\(\)/);
});

test('目录页包含 Finder 风格右键菜单、剪切和重复副本快捷动作', () => {
  assert.match(html, /id="file-context-menu"/);
  assert.match(html, /id="file-cut"[\s\S]*?⌘X/);
  assert.match(html, /id="file-duplicate"[\s\S]*?⌘D/);
  assert.match(appSource, /cutSelectedItems\(\)/);
  assert.match(appSource, /duplicateSelectedItems\(\)/);
  assert.match(appSource, /event\.key\s*===\s*'F2'/);
});

test('目录页可把所选绝对路径复制到系统剪贴板且保留平台快捷键', () => {
  assert.match(html, /id="file-copy-path"[\s\S]*?复制为路径名[\s\S]*?⌥⌘C/);
  assert.match(html, /data-context-action="copy-path"[\s\S]*?复制为路径名/);
  assert.match(appSource, /copySelectedPathnames\(\)/);
  assert.match(appSource, /'file-copy-path': 'Ctrl\+Shift\+C'/);
  assert.match(preload, /copyPathnames: \(paths\) => ipcRenderer\.invoke\('clipboard:copyPathnames', paths\)/);
  assert.match(main, /registerClipboardIPC\(\)/);
});
