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
  assert.match(acceptance, /Uninstall GitFinder\.exe/);
  assert.match(acceptance, /Get-FileHash/);
});

test('Windows 运行时验证覆盖项目配置、Git、复制移动和系统回收站', () => {
  const runtime = fs.readFileSync(path.join(projectRoot, 'scripts/verify-windows-runtime.js'), 'utf8');
  for (const marker of ['initializeProject', 'discoverRepositories', 'previewTransfer', 'applyTransfer', 'shell.trashItem']) {
    assert.match(runtime, new RegExp(marker.replace('.', '\\.')));
  }
});
