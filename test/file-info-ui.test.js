const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const FileInfo = require('../src/renderer/scripts/fileInfoController');

const html = read('src/renderer/index.html');
const appSource = read('src/renderer/scripts/app.js');
const mainSource = read('main.js');
const cssSource = read('src/renderer/styles/content.css');

test('显示简介把目录身份、Git 属性和权限作为不同维度呈现', () => {
  const view = FileInfo.presentFileInfo({
    name: 'demo',
    path: '/workspace/demo',
    type: 'directory',
    size: 96,
    modifiedTime: '2026-08-28T01:00:00.000Z',
    createdTime: '2026-08-27T01:00:00.000Z',
    accessedTime: '2026-08-28T02:00:00.000Z',
    isProject: true,
    isGitRepo: true,
    isHidden: false,
    mode: '755',
    readable: true,
    writable: true,
    executable: true
  }, {
    platform: 'darwin',
    formatFileSize: value => `${value} B`,
    formatDate: value => value
  });

  assert.equal(view.kindLabel, '项目文件夹 · Git 仓库');
  assert.equal(view.sizeLabel, '正在计算文件夹大小…');
  assert.equal(view.permissionLabel, '读、写、执行 · 755');
  assert.equal(view.revealLabel, '在 Finder 中显示');
  assert.equal(view.canOpen, false);
});

test('显示简介有工具栏、右键、系统菜单和跨平台快捷键入口', () => {
  for (const id of [
    'file-get-info',
    'file-info-panel',
    'file-info-close',
    'file-info-title',
    'file-info-body',
    'file-info-open',
    'file-info-reveal'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-context-action="get-info"/);
  assert.match(html, /aria-modal="false"/);
  assert.ok(html.indexOf('scripts/fileInfoController.js') < html.indexOf('scripts/app.js'));
  assert.match(mainSource, /show-file-info/);
  assert.match(mainSource, /Alt\+Enter/);
  assert.match(appSource, /openSelectedFileInfo/);
  assert.match(appSource, /fileInfoController\?\.open/);
  assert.match(read('src/renderer/scripts/fileInfoController.js'), /calculateDirectorySize/);
  assert.match(read('src/renderer/scripts/fileInfoController.js'), /cancelDirectorySize/);
  assert.match(read('src/renderer/scripts/fileInfoController.js'), /已扫描/);
  assert.match(cssSource, /\.file-info-panel/);
  assert.match(cssSource, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*\.file-info-panel/);
});

test('显示简介立即打开加载态，并忽略关闭后的迟到结果', async () => {
  class Element {
    constructor({ hidden = false } = {}) {
      this.hidden = hidden;
      this.innerHTML = '';
      this.textContent = '';
      this.attributes = {};
      this.disabled = false;
      this.isConnected = true;
      this.focused = false;
    }
    addEventListener() {}
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { this.focused = true; }
  }
  const elements = new Map([
    ['file-info-panel', new Element({ hidden: true })],
    ['file-info-close', new Element()],
    ['file-info-title', new Element()],
    ['file-info-subtitle', new Element()],
    ['file-info-icon', new Element()],
    ['file-info-body', new Element()],
    ['file-info-open', new Element()],
    ['file-info-reveal', new Element()]
  ]);
  let resolveInfo;
  const pending = new Promise(resolve => { resolveInfo = resolve; });
  const document = {
    activeElement: new Element(),
    getElementById: id => elements.get(id) || null,
    addEventListener() {}
  };
  const controller = new FileInfo.Controller({
    app: {
      closeToolbarMenus() {},
      escapeHtml: value => String(value),
      formatFileSize: value => `${value} B`,
      formatItemDate: value => value,
      fileOperationHistoryController: { close() {} },
      closeQuickLook() {}
    },
    bridge: { platform: 'darwin', fs: { getFileInfo: () => pending } },
    document,
    window: { requestAnimationFrame: callback => callback() }
  });

  const opening = controller.open({ name: 'demo.txt', path: '/workspace/demo.txt', type: 'file' });
  assert.equal(elements.get('file-info-panel').hidden, false);
  assert.match(elements.get('file-info-body').innerHTML, /正在读取/);
  controller.close();
  resolveInfo({
    name: 'demo.txt', path: '/workspace/demo.txt', type: 'file', size: 4,
    modifiedTime: '2026-08-28T01:00:00.000Z', createdTime: '2026-08-28T01:00:00.000Z'
  });
  await opening;

  assert.equal(elements.get('file-info-panel').hidden, true);
  assert.doesNotMatch(elements.get('file-info-body').innerHTML, /demo\.txt/);
});
