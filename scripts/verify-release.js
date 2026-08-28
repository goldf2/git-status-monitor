#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRODUCT_NAME = 'GitFinder';
const BUNDLE_ID = 'com.gitfinder.app';
const UPDATE_SOURCE = 'provider: github\nowner: goldf2\nrepo: git-status-monitor';
const VALID_MODES = new Set(['development', 'official']);
const VALID_PHASES = new Set(['source', 'artifact']);

function issue(code, message) {
  return { code, message };
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ''));
}

function validateSourceConfiguration({
  packageJson,
  lockJson,
  appUpdateText,
  mode = 'development',
  expectedTag = '',
  iconHeaders = {},
}) {
  const issues = [];
  const version = String(packageJson?.version || '');
  const build = packageJson?.build || {};

  if (!isSemver(version)) {
    issues.push(issue('version.package', 'package.json 必须提供有效语义化版本。'));
  }
  if (String(lockJson?.version || '') !== version) {
    issues.push(issue('version.lock', 'package-lock.json 顶层版本与 package.json 不一致。'));
  }
  if (String(lockJson?.packages?.['']?.version || '') !== version) {
    issues.push(issue('version.lock-root', 'package-lock.json 根包版本与 package.json 不一致。'));
  }
  if (build.appId !== BUNDLE_ID) {
    issues.push(issue('bundle.id', `Bundle ID 必须固定为 ${BUNDLE_ID}。`));
  }
  if (packageJson?.productName !== PRODUCT_NAME || build.productName !== PRODUCT_NAME) {
    issues.push(issue('product.name', `产品名称必须固定为 ${PRODUCT_NAME}。`));
  }
  if (!Array.isArray(build?.mac?.target) || !build.mac.target.includes('zip')) {
    issues.push(issue('target.mac-zip', 'macOS 构建必须包含 ZIP 自动升级包。'));
  }
  if (build?.mac?.icon !== 'public/icon.icns'
    || build?.win?.icon !== 'public/icon.ico'
    || build?.linux?.icon !== 'public/icon.png') {
    issues.push(issue('icons.paths', '三个平台必须使用约定的 GitFinder 图标资产。'));
  }

  const png = Buffer.from(iconHeaders.png || []);
  const icns = Buffer.from(iconHeaders.icns || []);
  const ico = Buffer.from(iconHeaders.ico || []);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    issues.push(issue('icons.png', 'public/icon.png 不是有效 PNG 文件。'));
  }
  if (icns.subarray(0, 4).toString('ascii') !== 'icns') {
    issues.push(issue('icons.icns', 'public/icon.icns 不是有效 ICNS 文件。'));
  }
  if (ico.subarray(0, 4).toString('hex') !== '00000100') {
    issues.push(issue('icons.ico', 'public/icon.ico 不是有效 ICO 文件。'));
  }
  if (normalizeText(appUpdateText) !== UPDATE_SOURCE) {
    issues.push(issue('update.source', '应用内更新源必须固定指向 goldf2/git-status-monitor。'));
  }

  if (mode === 'official') {
    if (!expectedTag) {
      issues.push(issue('tag.missing', '正式发布必须从明确的 Git 标签构建。'));
    } else if (expectedTag !== `v${version}`) {
      issues.push(issue('tag.version', `Git 标签必须等于 v${version}。`));
    }
  }

  return { issues, version };
}

function scalar(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function parseLatestMacManifest(text) {
  return {
    version: scalar(text, /^version:\s*(.+)$/m),
    fileUrl: scalar(text, /^\s*-\s+url:\s*(.+)$/m),
    fileSha512: scalar(text, /^\s{4}sha512:\s*(.+)$/m),
    fileSize: Number(scalar(text, /^\s{4}size:\s*(\d+)$/m)),
    path: scalar(text, /^path:\s*(.+)$/m),
    sha512: scalar(text, /^sha512:\s*(.+)$/m),
    releaseDate: scalar(text, /^releaseDate:\s*(.+)$/m),
  };
}

function validateMacManifest({ manifest, version, zipName, zipSize, zipSha512Base64 }) {
  const issues = [];
  if (manifest.version !== version) {
    issues.push(issue('manifest.version', 'latest-mac.yml 版本与 package.json 不一致。'));
  }
  if (manifest.fileUrl !== zipName) {
    issues.push(issue('manifest.url', 'latest-mac.yml 文件 URL 与实际 ZIP 文件名不一致。'));
  }
  if (manifest.path !== zipName) {
    issues.push(issue('manifest.path', 'latest-mac.yml path 与实际 ZIP 文件名不一致。'));
  }
  if (manifest.fileSize !== zipSize) {
    issues.push(issue('manifest.size', 'latest-mac.yml 文件大小与实际 ZIP 不一致。'));
  }
  if (manifest.fileSha512 !== zipSha512Base64 || manifest.sha512 !== zipSha512Base64) {
    issues.push(issue('manifest.sha512', 'latest-mac.yml SHA-512 与实际 ZIP 不一致。'));
  }
  return { issues };
}

function parseCodesignDetails(details) {
  const text = String(details || '');
  const authority = scalar(text, /^Authority=(Developer ID Application:.+)$/m);
  const teamIdentifier = scalar(text, /^TeamIdentifier=(.+)$/m);
  const isAdhoc = /^Signature=adhoc$/m.test(text) || /^flags=.*\badhoc\b/m.test(text);
  return {
    authority,
    teamIdentifier: teamIdentifier === 'not set' ? '' : teamIdentifier,
    hardenedRuntime: /^flags=.*\bruntime\b/m.test(text),
    secureTimestamp: /^Timestamp=(?!none\s*$).+$/m.test(text),
    signatureType: authority ? 'developer-id' : (isAdhoc ? 'adhoc' : 'unknown'),
  };
}

function hasDebugEntitlement(entitlements) {
  return /<key>\s*com\.apple\.security\.get-task-allow\s*<\/key>\s*<true\s*\/>/m
    .test(String(entitlements || ''));
}

function evaluateMacSignature({
  mode = 'development',
  details = '',
  entitlements = '',
  codesignValid = false,
  gatekeeperAccepted = false,
  stapleValid = false,
  expectedTeamId = '',
}) {
  const parsed = parseCodesignDetails(details);
  const issues = [];
  const warnings = [];

  if (!codesignValid) {
    issues.push(issue('signature.invalid', '严格深度代码签名校验失败。'));
  }

  if (mode === 'official') {
    if (parsed.signatureType !== 'developer-id') {
      issues.push(issue('signature.developerId', '正式发布必须使用 Developer ID Application 签名。'));
    }
    if (!expectedTeamId || parsed.teamIdentifier !== expectedTeamId) {
      issues.push(issue('signature.team', '签名 TeamIdentifier 与发布配置不一致。'));
    }
    if (!parsed.hardenedRuntime) {
      issues.push(issue('signature.runtime', '正式发布签名必须启用 Hardened Runtime。'));
    }
    if (!parsed.secureTimestamp) {
      issues.push(issue('signature.timestamp', '正式发布签名必须包含安全时间戳。'));
    }
    if (hasDebugEntitlement(entitlements)) {
      issues.push(issue('entitlements.get-task-allow', '正式发布禁止 com.apple.security.get-task-allow。'));
    }
    if (!gatekeeperAccepted) {
      issues.push(issue('notarization.gatekeeper', 'Gatekeeper 未接受该应用。'));
    }
    if (!stapleValid) {
      issues.push(issue('notarization.staple', '应用没有可验证的 Apple 公证票据。'));
    }
  } else if (parsed.signatureType === 'adhoc') {
    warnings.push(issue('signature.adhoc', '开发构建仅为 ad-hoc 签名，不具备正式分发资格。'));
  } else if (!gatekeeperAccepted || !stapleValid) {
    warnings.push(issue('notarization.missing', '开发构建没有通过 Gatekeeper 与公证票据验证。'));
  }

  return {
    issues,
    warnings,
    signatureType: parsed.signatureType,
    authority: parsed.authority,
    teamIdentifier: parsed.teamIdentifier,
    hardenedRuntime: parsed.hardenedRuntime,
    secureTimestamp: parsed.secureTimestamp,
    codesignValid,
    gatekeeperAccepted,
    stapleValid,
    eligibleForDistribution: mode === 'official' && issues.length === 0,
  };
}

function parseArgs(argv) {
  const options = {
    mode: process.env.GITFINDER_RELEASE_MODE || 'development',
    phase: 'artifact',
    expectedTag: process.env.GITFINDER_EXPECTED_TAG || '',
    expectedTeamId: process.env.APPLE_TEAM_ID || '',
    reportPath: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--mode', '--phase', '--expected-tag', '--expected-team-id', '--report'].includes(key)) {
      throw new Error(`未知参数：${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    index += 1;
    if (key === '--mode') options.mode = value;
    if (key === '--phase') options.phase = value;
    if (key === '--expected-tag') options.expectedTag = value;
    if (key === '--expected-team-id') options.expectedTeamId = value;
    if (key === '--report') options.reportPath = value;
  }
  if (!VALID_MODES.has(options.mode)) {
    throw new Error(`无效发布模式：${options.mode}`);
  }
  if (!VALID_PHASES.has(options.phase)) {
    throw new Error(`无效验证阶段：${options.phase}`);
  }
  return options;
}

function readHeader(filePath, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function runCommand(command, args) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: String(stdout || '').trim() };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ''}${error.stderr || ''}`.trim(),
    };
  }
}

function runCommandWithStderr(command, args) {
  try {
    const result = require('node:child_process').spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  } catch (error) {
    return { ok: false, output: String(error.message || error) };
  }
}

function hashFile(filePath, algorithm, encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest(encoding);
}

function readPlistValue(plistPath, key) {
  const result = runCommand('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath]);
  return result.ok ? result.output : '';
}

function sourceSnapshot(projectRoot, options) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const appUpdatePath = path.join(projectRoot, 'resources', 'app-update.yml');
  const sourceResult = validateSourceConfiguration({
    packageJson,
    lockJson,
    appUpdateText: fs.readFileSync(appUpdatePath, 'utf8'),
    mode: options.mode,
    expectedTag: options.expectedTag,
    iconHeaders: {
      png: readHeader(path.join(projectRoot, 'public', 'icon.png'), 8),
      icns: readHeader(path.join(projectRoot, 'public', 'icon.icns'), 4),
      ico: readHeader(path.join(projectRoot, 'public', 'icon.ico'), 4),
    },
  });

  const gitHead = runCommand('git', ['-C', projectRoot, 'rev-parse', 'HEAD']);
  if (!gitHead.ok) {
    sourceResult.issues.push(issue('git.head', '无法读取发布源码的 Git 提交。'));
  }
  if (options.mode === 'official') {
    const status = runCommand('git', ['-C', projectRoot, 'status', '--porcelain', '--untracked-files=all']);
    if (!status.ok || status.output) {
      sourceResult.issues.push(issue('git.dirty', '正式发布必须来自完全干净的 Git 工作区。'));
    }
    if (options.expectedTag) {
      const tag = runCommand('git', [
        '-C', projectRoot, 'tag', '--points-at', 'HEAD', '--list', options.expectedTag,
      ]);
      if (!tag.ok || tag.output !== options.expectedTag) {
        sourceResult.issues.push(issue('tag.commit', '正式发布标签必须指向当前检出的提交。'));
      }
    }
  }

  return {
    ...sourceResult,
    commit: gitHead.ok ? gitHead.output : '',
  };
}

function requireRegularPath(filePath, description, issues) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      issues.push(issue('artifact.symlink', `${description} 不能是符号链接。`));
      return false;
    }
    return true;
  } catch {
    issues.push(issue('artifact.missing', `缺少${description}：${filePath}`));
    return false;
  }
}

function verifyArtifact(projectRoot, options, source) {
  const version = source.version;
  const distDir = path.join(projectRoot, 'dist');
  const appPath = path.join(distDir, 'GitFinder-darwin-arm64', 'GitFinder.app');
  const zipName = `GitFinder-${version}-arm64-mac.zip`;
  const zipPath = path.join(distDir, zipName);
  const manifestPath = path.join(distDir, 'latest-mac.yml');
  const issues = [...source.issues];

  const haveApp = requireRegularPath(appPath, 'macOS App', issues);
  const haveZip = requireRegularPath(zipPath, 'macOS ZIP', issues);
  const haveManifest = requireRegularPath(manifestPath, 'latest-mac.yml', issues);
  if (!haveApp || !haveZip || !haveManifest) {
    return {
      issues,
      warnings: [],
      eligibleForDistribution: false,
      appPath: path.relative(projectRoot, appPath),
      zipPath: path.relative(projectRoot, zipPath),
      manifestPath: path.relative(projectRoot, manifestPath),
    };
  }

  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const bundleVersion = readPlistValue(plistPath, 'CFBundleShortVersionString');
  const buildVersion = readPlistValue(plistPath, 'CFBundleVersion');
  const bundleId = readPlistValue(plistPath, 'CFBundleIdentifier');
  const executableName = readPlistValue(plistPath, 'CFBundleExecutable');
  if (bundleVersion !== version || buildVersion !== version) {
    issues.push(issue('app.version', 'App Bundle 版本与 package.json 不一致。'));
  }
  if (bundleId !== BUNDLE_ID) {
    issues.push(issue('app.bundle-id', `App Bundle ID 必须为 ${BUNDLE_ID}。`));
  }
  if (path.basename(executableName) !== executableName || !executableName) {
    issues.push(issue('app.executable', 'App 主可执行文件名无效。'));
  }

  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName || PRODUCT_NAME);
  const architecture = runCommand('file', ['-b', executablePath]);
  if (!architecture.ok || !/Mach-O 64-bit executable arm64/.test(architecture.output)) {
    issues.push(issue('app.architecture', 'macOS 发布包主程序必须是 arm64 Mach-O。'));
  }

  const updateConfigPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
  if (!fs.existsSync(updateConfigPath)
    || normalizeText(fs.readFileSync(updateConfigPath, 'utf8')) !== UPDATE_SOURCE) {
    issues.push(issue('app.update-source', 'App 内更新源缺失或不正确。'));
  }

  const sourceIconPath = path.join(projectRoot, 'public', 'icon.icns');
  const appIconPath = path.join(appPath, 'Contents', 'Resources', 'electron.icns');
  const sourceIconSha256 = hashFile(sourceIconPath, 'sha256');
  const appIconSha256 = fs.existsSync(appIconPath) ? hashFile(appIconPath, 'sha256') : '';
  if (!appIconSha256 || appIconSha256 !== sourceIconSha256) {
    issues.push(issue('app.icon', 'App 内图标与 public/icon.icns 不一致。'));
  }

  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  let packagedVersion = '';
  try {
    const asar = require('@electron/asar');
    const packagedPackage = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    packagedVersion = String(packagedPackage.version || '');
  } catch {
    issues.push(issue('app.asar', '无法读取打包后的 package.json。'));
  }
  if (packagedVersion && packagedVersion !== version) {
    issues.push(issue('app.asar-version', 'app.asar 内版本与 package.json 不一致。'));
  }

  const zipTest = runCommand('unzip', ['-tqq', zipPath]);
  if (!zipTest.ok) {
    issues.push(issue('artifact.zip', 'macOS ZIP 完整性检查失败。'));
  }
  const zipEntries = runCommand('unzip', ['-Z1', zipPath]);
  if (!zipEntries.ok
    || !zipEntries.output.split('\n').some((entry) => entry === `GitFinder.app/Contents/MacOS/${PRODUCT_NAME}`)
    || zipEntries.output.split('\n').some((entry) => entry && !entry.startsWith('GitFinder.app/'))) {
    issues.push(issue('artifact.zip-layout', 'macOS ZIP 必须只包含根目录 GitFinder.app。'));
  }

  const zipStat = fs.statSync(zipPath);
  const zipSha512Base64 = hashFile(zipPath, 'sha512', 'base64');
  const manifest = parseLatestMacManifest(fs.readFileSync(manifestPath, 'utf8'));
  issues.push(...validateMacManifest({
    manifest,
    version,
    zipName,
    zipSize: zipStat.size,
    zipSha512Base64,
  }).issues);

  const codesign = runCommandWithStderr('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const codesignDetails = runCommandWithStderr('codesign', ['-dv', '--verbose=4', appPath]);
  const entitlements = runCommandWithStderr('codesign', ['-d', '--entitlements', ':-', appPath]);
  const gatekeeper = runCommandWithStderr('spctl', ['-a', '-t', 'exec', '-vv', appPath]);
  const staple = runCommandWithStderr('xcrun', ['stapler', 'validate', appPath]);
  const signature = evaluateMacSignature({
    mode: options.mode,
    details: codesignDetails.output,
    entitlements: entitlements.output,
    codesignValid: codesign.ok,
    gatekeeperAccepted: gatekeeper.ok,
    stapleValid: staple.ok,
    expectedTeamId: options.expectedTeamId,
  });
  issues.push(...signature.issues);

  return {
    issues,
    warnings: signature.warnings,
    eligibleForDistribution: options.mode === 'official' && issues.length === 0,
    version,
    commit: source.commit,
    appPath: path.relative(projectRoot, appPath),
    zipPath: path.relative(projectRoot, zipPath),
    manifestPath: path.relative(projectRoot, manifestPath),
    bundleId,
    bundleVersion,
    buildVersion,
    architecture: architecture.output,
    packagedVersion,
    sourceIconSha256,
    appIconSha256,
    appAsarSha256: hashFile(asarPath, 'sha256'),
    zipSize: zipStat.size,
    zipSha512: hashFile(zipPath, 'sha512'),
    zipSha512Base64,
    manifest,
    signature: {
      signatureType: signature.signatureType,
      authority: signature.authority,
      teamIdentifier: signature.teamIdentifier,
      hardenedRuntime: signature.hardenedRuntime,
      secureTimestamp: signature.secureTimestamp,
      codesignValid: signature.codesignValid,
      gatekeeperAccepted: signature.gatekeeperAccepted,
      stapleValid: signature.stapleValid,
    },
  };
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tempPath, reportPath);
}

function printResult(result, options) {
  const prefix = options.phase === 'source' ? '发布源码门禁' : '发布产物门禁';
  if (result.issues.length) {
    console.error(`${prefix}失败：`);
    result.issues.forEach((entry) => console.error(`- [${entry.code}] ${entry.message}`));
  } else {
    console.log(`${prefix}通过（${options.mode}）。`);
  }
  (result.warnings || []).forEach((entry) => {
    console.warn(`- 警告 [${entry.code}] ${entry.message}`);
  });
  if (options.phase === 'artifact') {
    console.log(`正式分发资格：${result.eligibleForDistribution ? '是' : '否'}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(__dirname, '..');
  if (process.platform !== 'darwin' && options.phase === 'artifact') {
    throw new Error('macOS 产物门禁必须在 macOS 主机运行。');
  }
  const source = sourceSnapshot(projectRoot, options);
  const result = options.phase === 'source'
    ? { ...source, warnings: [], eligibleForDistribution: false }
    : verifyArtifact(projectRoot, options, source);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    phase: options.phase,
    mode: options.mode,
    expectedTag: options.expectedTag,
    ...result,
  };
  if (options.reportPath) {
    const absoluteReport = path.resolve(projectRoot, options.reportPath);
    const distRoot = `${path.join(projectRoot, 'dist')}${path.sep}`;
    if (!absoluteReport.startsWith(distRoot)) {
      throw new Error('发布报告只能写入 dist 目录。');
    }
    writeReport(absoluteReport, report);
  }
  printResult(result, options);
  if (result.issues.length) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`发布门禁执行失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  evaluateMacSignature,
  parseCodesignDetails,
  parseLatestMacManifest,
  validateMacManifest,
  validateSourceConfiguration,
};
