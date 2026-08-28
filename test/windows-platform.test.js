const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

test('Windows x64 使用 NSIS 安装包并仅允许真正 Windows 主机宣告产物', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts/build-win.js'), 'utf8');
  assert.match(pkg.scripts['pack:win'], /build-win\.js/);
  assert.deepEqual(pkg.build.win.target, [
    { target: 'nsis', arch: ['x64'] },
    { target: 'zip', arch: ['x64'] }
  ]);
  assert.match(pkg.build.nsis.artifactName, /setup/);
  assert.match(buildScript, /process\.platform !== 'win32'/);
  assert.match(buildScript, /spawnSync\(process\.execPath/);
  assert.match(buildScript, /electron-builder\/out\/cli\/cli\.js/);
  assert.match(buildScript, /SHA256SUMS-windows\.txt/);
  assert.match(buildScript, /unsignedTestBuild/);
});

test('Windows CI 在 windows-latest 执行运行时、安装、启动和卸载验证', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/release.yml'), 'utf8');
  const acceptance = fs.readFileSync(path.join(projectRoot, 'scripts/verify-windows-package.ps1'), 'utf8');
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /npm run verify:windows-runtime/);
  assert.match(workflow, /verify-windows-package\.ps1/);
  assert.match(workflow, /windows-install-verification\.json/);
  assert.match(acceptance, /win-unpacked\\GitFinder\.exe/);
  assert.match(acceptance, /Assert-ApplicationStarts \$UnpackedExe/);
  assert.doesNotMatch(acceptance, /--disable-gpu/);
  assert.match(acceptance, /defaultStartup = \$true/);
  assert.match(acceptance, /Uninstall GitFinder\.exe/);
  assert.match(acceptance, /Get-FileHash/);
});

test('Windows 未签名测试版只有在手动明确选择后才发布为预发布', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /publish_unsigned_windows:/);
  assert.match(workflow, /type:\s*boolean/);
  assert.match(workflow, /default:\s*false/);
  assert.match(workflow, /inputs\.publish_unsigned_windows == true/);
  assert.match(workflow, /steps\.release_state\.outputs\.signed == 'false'/);
  assert.match(workflow, /test_tag=windows-v\$version-test1/);
  assert.match(workflow, /tag_name:\s*\$\{\{ steps\.release_state\.outputs\.test_tag \}\}/);
  assert.match(workflow, /prerelease:\s*true/);
  assert.match(workflow, /SmartScreen/);
});

test('Windows 默认使用软件渲染并记录 GPU 或渲染进程崩溃', () => {
  const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  assert.match(mainSource, /process\.platform === 'win32'[\s\S]*app\.disableHardwareAcceleration\(\)/);
  assert.match(mainSource, /app\.on\('child-process-gone'/);
  assert.match(mainSource, /webContents\.on\('render-process-gone'/);
  assert.match(mainSource, /git-status-monitor-startup\.log/);
});

test('Windows 运行时验证覆盖项目配置、Git、复制移动和系统回收站', () => {
  const runtime = fs.readFileSync(path.join(projectRoot, 'scripts/verify-windows-runtime.js'), 'utf8');
  for (const marker of ['initializeProject', 'discoverRepositories', 'previewTransfer', 'applyTransfer', 'shell.trashItem']) {
    assert.match(runtime, new RegExp(marker.replace('.', '\\.')));
  }
});
