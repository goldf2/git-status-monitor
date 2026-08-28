const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QuickLook = require('../src/renderer/scripts/quickLook');

test('YAML、TOML 和 plist 生成有层级的结构导航', () => {
  const yaml = QuickLook.buildStructureOutline('service:\n  name: api\n  ports:\n    http: 3000\n', 'yaml');
  assert.deepEqual(yaml.items.map(item => [item.label, item.depth]), [
    ['service', 0], ['name', 1], ['ports', 1], ['http', 2]
  ]);

  const toml = QuickLook.buildStructureOutline('[project]\nname = "demo"\n[tool.build]\ntarget = "app"\n', 'toml');
  assert.deepEqual(toml.items.map(item => [item.label, item.depth]), [
    ['project', 0], ['name', 1], ['tool.build', 1], ['target', 2]
  ]);

  const plist = QuickLook.buildStructureOutline('<plist>\n<dict>\n<key>CFBundleName</key><string>Demo</string>\n</dict>\n</plist>', 'plist');
  assert.deepEqual(plist.items.map(item => [item.label, item.value]), [['CFBundleName', 'Demo']]);
});

test('日志级别和时间戳识别保持中性行且不夸大状态', () => {
  assert.equal(QuickLook.logSeverity('2026-08-27 10:00:00 ERROR failed'), 'error');
  assert.equal(QuickLook.logSeverity('10:00:01 WARN retrying'), 'warning');
  assert.equal(QuickLook.logSeverity('DEBUG request payload'), 'debug');
  assert.equal(QuickLook.logSeverity('plain application output'), 'neutral');
  assert.equal(QuickLook.logTimestamp('2026-08-27 10:00:00 ERROR failed'), '2026-08-27 10:00:00');
  assert.equal(QuickLook.logMessage('2026-08-27 10:00:00 ERROR failed'), 'failed');
  assert.equal(QuickLook.logMessage('plain application output'), 'plain application output');
});

test('分段 Quick Look 保留大型日志和结构化文件的原始行号', () => {
  const log = QuickLook.renderDeveloperPreview({ language: 'log', content: 'INFO resumed\n', startLine: 2401, paged: true });
  assert.match(log.html, />2401<\/span>/);
  assert.match(log.html, /从第 2401 行/);
  const structured = QuickLook.renderDeveloperPreview({ language: 'yaml', content: 'service:\n  port: 3000\n', startLine: 501, paged: true });
  assert.match(structured.html, />501<\/span>/);
  assert.match(structured.html, /第 501 行/);
});

test('结构化和日志预览转义外部内容并限制逐行 DOM 数量', () => {
  const structured = QuickLook.renderDeveloperPreview({
    language: 'yaml',
    content: 'title: <script>alert(1)</script>\n'
  });
  assert.match(structured.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(structured.html, /<script>/);

  const largeLog = Array.from({ length: 1600 }, (_, index) => `${index} INFO line`).join('\n');
  const logPreview = QuickLook.renderDeveloperPreview({ language: 'log', content: largeLog });
  assert.match(logPreview.html, /日志较大，仅显示安全预览范围/);
  assert.equal((logPreview.html.match(/class="quick-look-log-line severity-/g) || []).length, 1500);
  const singleLine = QuickLook.renderDeveloperPreview({ language: 'log', content: '2026-08-27 10:00:00 INFO ready' });
  assert.equal((singleLine.html.match(/2026-08-27 10:00:00/g) || []).length, 1);
  assert.match(singleLine.html, />ready<\/code>/);
});

test('Quick Look 模块在 App 前加载并接管开发文件预览', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/quickLookController.js'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  assert.match(html, /scripts\/syntaxHighlight\.js[\s\S]*scripts\/quickLook\.js[\s\S]*scripts\/quickLookController\.js[\s\S]*scripts\/app\.js/);
  assert.match(controllerSource, /developerModule\?\.renderDeveloperPreview\(preview\)/);
  assert.match(appSource, /new window\.QuickLookController\.Controller/);
  assert.match(css, /\.quick-look-structured/);
  assert.match(css, /\.quick-look-log-line\.severity-error/);
});

test('二进制 plist 显式转换通过受信 IPC 暴露', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/content.js'), 'utf8');
  const controller = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/quickLookController.js'), 'utf8');
  assert.match(preload, /convertBinaryPlist:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\('content:convertBinaryPlist', filePath\)/);
  assert.match(ipc, /registerTrustedHandler\('content:convertBinaryPlist'/);
  assert.match(controller, /convertBinaryPlist\(\)/);
  assert.match(controller, /data-quick-look-action="convert-binary-plist"/);
});
