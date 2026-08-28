#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const distDir = path.join(projectRoot, 'dist');
const installerName = `GitFinder-${pkg.version}-x64-win-setup.exe`;
const zipName = `GitFinder-${pkg.version}-x64-win.zip`;
const installerPath = path.join(distDir, installerName);
const zipPath = path.join(distDir, zipName);

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function signatureStatus(filePath) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-AuthenticodeSignature -LiteralPath $env:GITFINDER_SIGNATURE_TARGET).Status.ToString()'
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, GITFINDER_SIGNATURE_TARGET: filePath }
  });
  return result.status === 0 ? String(result.stdout || '').trim() : 'UnknownError';
}

if (process.platform !== 'win32') {
  console.error('Windows 发布包必须在真正的 Windows runner 上构建；本命令不接受交叉打包结果。');
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
const builderExecutable = require.resolve('electron-builder/out/cli/cli.js');
const environment = { ...process.env };
if (!environment.CSC_LINK && !environment.WIN_CSC_LINK) environment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const build = spawnSync(process.execPath, [builderExecutable, '--win', 'nsis', 'zip', '--x64', '--publish', 'never'], {
  cwd: projectRoot,
  env: environment,
  stdio: 'inherit'
});
if (build.error) {
  console.error(`无法启动 Windows 打包器：${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status || 1);

for (const artifactPath of [installerPath, zipPath]) {
  if (!fs.existsSync(artifactPath)) throw new Error(`缺少 Windows 构建产物：${artifactPath}`);
}

const signature = signatureStatus(installerPath);
const unsignedTestBuild = signature !== 'Valid';
const artifacts = [installerPath, zipPath].map(filePath => ({
  file: path.basename(filePath),
  bytes: fs.statSync(filePath).size,
  sha256: sha256(filePath)
}));
const metadata = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  productName: 'GitFinder',
  version: pkg.version,
  platform: 'windows',
  architecture: 'x64',
  installerType: 'NSIS',
  signatureStatus: signature,
  unsignedTestBuild,
  distributionStatus: unsignedTestBuild ? 'unsigned-test-build' : 'signed-release-candidate',
  smartScreenWarning: unsignedTestBuild
    ? '未配置可验证的 Windows 代码签名，SmartScreen 可能显示风险提示；不得标记为稳定正式版。'
    : null,
  artifacts
};
fs.writeFileSync(
  path.join(distDir, 'SHA256SUMS-windows.txt'),
  `${artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n')}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(distDir, 'windows-release-metadata.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
  'utf8'
);
console.log(`Windows x64 构建完成：${metadata.distributionStatus}`);
