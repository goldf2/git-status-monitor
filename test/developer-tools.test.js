const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DeveloperToolService } = require('../src/main/services/developerToolService');

test('Windows 优先发现 Windows Terminal、PowerShell、Git 和代码编辑器', () => {
  const service = new DeveloperToolService({ platform: 'win32', environment: {} });
  const commands = new Map([
    ['wt.exe', 'C:\\WindowsApps\\wt.exe'],
    ['pwsh.exe', 'C:\\Program Files\\PowerShell\\pwsh.exe'],
    ['powershell.exe', 'C:\\Windows\\powershell.exe'],
    ['cmd.exe', 'C:\\Windows\\cmd.exe'],
    ['git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'],
    ['code.exe', 'C:\\Program Files\\Microsoft VS Code\\Code.exe'],
    ['pycharm64.exe', 'C:\\Program Files\\JetBrains\\PyCharm\\pycharm64.exe']
  ]);
  service._commandPath = command => commands.get(command) || null;
  const capabilities = service.discover();
  assert.equal(capabilities.terminals[0].id, 'windows-terminal');
  assert.equal(capabilities.git.installed, true);
  assert.equal(capabilities.editors.some(tool => tool.name === 'Visual Studio Code'), true);
  assert.equal(capabilities.editors.some(tool => tool.name === 'PyCharm'), true);
});

test('自定义编辑器只接受存在的程序路径并传入目标', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-tools-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const executable = path.join(temporaryRoot, 'editor.exe');
  const project = path.join(temporaryRoot, 'project');
  fs.writeFileSync(executable, 'stub');
  fs.mkdirSync(project);
  const service = new DeveloperToolService({ platform: 'win32', environment: {} });
  service._commandPath = () => null;
  let spawned = null;
  service._spawn = (file, args, cwd) => { spawned = { file, args, cwd }; };
  const result = service.openEditor(project, executable);
  assert.equal(result.opened, true);
  assert.deepEqual(spawned, { file: executable, args: [project], cwd: project });
});

test('工具设置入口和打开编辑器桥接完整存在', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  for (const id of ['btn-settings', 'file-open-editor']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['preferred-terminal', 'preferred-editor', 'settings-card-style', 'settings-sort-by']) {
    assert.match(appSource, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="btn-settings"[^>]+aria-label="应用设置"/);
  assert.match(appSource, /renderSettingsView/);
  assert.match(appSource, /data-app-action="choose-local-project"/);
  assert.match(appSource, /primaryKey\s*&&\s*event\.key\s*===\s*','/);
  assert.match(appSource, /openDeveloperToolSettings/);
  assert.match(appSource, /openPathInEditor/);
  assert.match(contentCss, /\.main-container\.settings-mode/);
  assert.match(contentCss, /\.app-settings-page/);
  assert.match(mainSource, /accelerator:\s*'CmdOrCtrl\+,'/);
  assert.match(mainSource, /sendShortcut\('open-settings'\)/);
  assert.match(preload, /getCapabilities/);
  assert.match(preload, /openInEditor/);
});
