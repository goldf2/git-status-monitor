const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const { DirectoryGrantService } = require('../src/main/services/directoryGrantService');

test('系统目录选择授权绑定路径、单次消费并会过期', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-grant-'));
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-other-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(otherRoot, { recursive: true, force: true }));
  let now = 1000;
  const service = new DirectoryGrantService({ now: () => now, ttlMs: 5000 });

  const first = service.issue(tempRoot);
  assert.throws(() => service.consume(otherRoot, first.grantToken), /重新通过系统文件夹选择器/);
  assert.equal(service.consume(tempRoot, first.grantToken), tempRoot);
  assert.throws(() => service.consume(tempRoot, first.grantToken), /重新通过系统文件夹选择器/);

  const expired = service.issue(tempRoot);
  now += 5001;
  assert.throws(() => service.consume(tempRoot, expired.grantToken), /重新通过系统文件夹选择器/);
});

test('添加受管根必须消费系统选择授权，普通配置写入不能替换根目录', () => {
  const filesystemSource = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/filesystem.js'), 'utf8');
  const configIpcSource = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/config.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(filesystemSource, /fs:selectFolder[\s\S]*directoryGrantService\.issue/);
  assert.match(configIpcSource, /config:set[\s\S]*setRendererPreference/);
  assert.match(configIpcSource, /config:addTreeRoot[\s\S]*directoryGrantService\.consume/);
  assert.match(preloadSource, /addTreeRoot: \(dirPath, name, grantToken\)/);
  assert.match(appSource, /selectFolder\(\)[\s\S]*selection\.grantToken/);
  assert.doesNotMatch(appSource, /addTreeRoot\(AppState\.currentPath\)/);
});

test('内嵌终端限制受管工作目录并在主进程原生确认每条 shell 命令', () => {
  const terminalSource = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/terminal.js'), 'utf8');

  assert.match(terminalSource, /fileService\.resolveWorkspacePath/);
  assert.match(terminalSource, /dialog\.showMessageBox/);
  assert.match(terminalSource, /buttons:\s*\['取消', '执行'\]/);
  assert.match(terminalSource, /result\.response === 1/);
  assert.match(terminalSource, /cancelled:\s*true/);
  assert.match(terminalSource, /openInEditor[\s\S]*resolveManagedTarget/);
});

test('文件标签使用独立主进程接口并拒绝越过受管路径边界', () => {
  const configIpcSource = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/config.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  assert.match(configIpcSource, /fileLabels:getForPaths[\s\S]*resolveManagedFileLabelPaths/);
  assert.match(configIpcSource, /resolveManagedFileLabelPaths[\s\S]*resolveWorkspacePath/);
  assert.match(configIpcSource, /\['file', 'directory'\]\.includes\(resolved\.type\)/);
  assert.match(configIpcSource, /fileLabels:getCollection[\s\S]*resolveFileLabelCollection/);
  assert.match(configIpcSource, /pathsForLabelIds\(store, selectedIds\)[\s\S]*resolveWorkspacePath/);
  assert.match(preloadSource, /fileLabels:\s*\{[\s\S]*getCollection[\s\S]*updateAssignments/);
});
