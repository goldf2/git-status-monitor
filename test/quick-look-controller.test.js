const test = require('node:test');
const assert = require('node:assert/strict');

const QuickLookPaging = require('../src/renderer/scripts/quickLookPaging');
const { Controller } = require('../src/renderer/scripts/quickLookController');

class FakeElement {
  constructor() {
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  querySelector() {
    return null;
  }

  insertAdjacentHTML(_position, html) {
    this.innerHTML += html;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

function createDocument() {
  const elements = new Map([
    ['quick-look-overlay', new FakeElement()],
    ['quick-look-title', new FakeElement()],
    ['quick-look-meta', new FakeElement()],
    ['quick-look-icon', new FakeElement()],
    ['quick-look-body', new FakeElement()],
    ['quick-look-open-btn', new FakeElement()],
    ['quick-look-close-btn', new FakeElement()],
    ['quick-look-prev-btn', new FakeElement()],
    ['quick-look-next-btn', new FakeElement()],
    ['quick-look-position', new FakeElement()]
  ]);
  return {
    elements,
    getElementById: id => elements.get(id) || null
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function preview(path, overrides = {}) {
  return {
    kind: 'text',
    name: path.split('/').pop(),
    path,
    size: 20,
    modifiedTime: '2026-08-27T00:00:00.000Z',
    content: 'safe content',
    truncated: true,
    paged: true,
    startOffset: 0,
    endOffset: 10,
    totalSize: 20,
    startLine: 1,
    nextPageToken: `token-${path}`,
    ...overrides
  };
}

function createController(options = {}) {
  const document = options.document || createDocument();
  const released = [];
  const contentApi = options.contentApi || {
    getPreview: async filePath => preview(filePath),
    getTextPage: async () => null,
    releaseTextPage: async token => released.push(token)
  };
  const controller = new Controller({
    document,
    contentApi,
    fileApi: options.fileApi || { openFile() {} },
    pagingModule: QuickLookPaging,
    developerModule: options.developerModule || null,
    renderMarkdown: value => `<p>${String(value).replace(/</g, '&lt;')}</p>`,
    formatFileSize: value => `${value} bytes`,
    formatItemDate: () => 'today',
    getItemByPath: options.getItemByPath,
    activateDirectory: options.activateDirectory,
    getNavigationState: options.getNavigationState,
    navigateItem: options.navigateItem,
    restoreSelectionFocus: options.restoreSelectionFocus
  });
  return { controller, document, contentApi, released };
}

test('Quick Look 控制器独立管理打开、渲染、关闭和未消费令牌撤销', async () => {
  const { controller, document, released } = createController();
  controller.bind();
  await controller.open({ type: 'file', name: 'large.txt', path: '/managed/large.txt' });

  assert.equal(controller.isOpen(), true);
  assert.equal(controller.currentPath(), '/managed/large.txt');
  assert.equal(document.elements.get('quick-look-overlay').style.display, 'flex');
  assert.match(document.elements.get('quick-look-body').innerHTML, /safe content/);
  assert.match(document.elements.get('quick-look-body').innerHTML, /第 1 段/);

  controller.close();
  await Promise.resolve();
  assert.equal(controller.isOpen(), false);
  assert.equal(document.elements.get('quick-look-overlay').style.display, 'none');
  assert.deepEqual(released, ['token-/managed/large.txt']);
});

test('点击 Quick Look 背景不会关闭，显式关闭按钮仍可关闭', async () => {
  const { controller, document } = createController();
  controller.bind();
  await controller.open({ type: 'file', name: 'notes.txt', path: '/managed/notes.txt' });

  const overlay = document.elements.get('quick-look-overlay');
  overlay.listeners.get('click')?.({ target: overlay, currentTarget: overlay });
  assert.equal(controller.isOpen(), true);

  document.elements.get('quick-look-close-btn').listeners.get('click')?.({});
  assert.equal(controller.isOpen(), false);
});

test('同一路径重复打开也以请求代次拒绝迟到结果并撤销其令牌', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const released = [];
  const { controller, document } = createController({
    contentApi: {
      getPreview: () => (++calls === 1 ? first.promise : second.promise),
      getTextPage: async () => null,
      releaseTextPage: async token => released.push(token)
    }
  });

  const firstOpen = controller.open({ type: 'file', name: 'same.txt', path: '/managed/same.txt' });
  const secondOpen = controller.open({ type: 'file', name: 'same.txt', path: '/managed/same.txt' });
  second.resolve(preview('/managed/same.txt', { content: 'new result', nextPageToken: 'new-token' }));
  await secondOpen;
  first.resolve(preview('/managed/same.txt', { content: 'stale result', nextPageToken: 'stale-token' }));
  await firstOpen;
  await Promise.resolve();

  assert.match(document.elements.get('quick-look-body').innerHTML, /new result/);
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /stale result/);
  assert.deepEqual(released, ['stale-token']);
});

test('Quick Look 连续浏览同步项目、计数和边界按钮', async () => {
  const items = ['/managed/a.txt', '/managed/b.txt', '/managed/c.txt'].map(itemPath => ({
    type: 'file',
    name: itemPath.split('/').pop(),
    path: itemPath
  }));
  const navigationState = itemPath => {
    const index = items.findIndex(item => item.path === itemPath);
    return {
      position: index + 1,
      total: items.length,
      hasPrevious: index > 0,
      hasNext: index >= 0 && index < items.length - 1
    };
  };
  const restoredFocus = [];
  const { controller, document } = createController({
    getNavigationState: navigationState,
    navigateItem: (direction, itemPath) => {
      const index = items.findIndex(item => item.path === itemPath);
      return items[index + direction] || null;
    },
    restoreSelectionFocus: itemPath => restoredFocus.push(itemPath)
  });

  await controller.open(items[0]);
  assert.equal(document.elements.get('quick-look-position').textContent, '1 / 3');
  assert.equal(document.elements.get('quick-look-prev-btn').disabled, true);
  assert.equal(document.elements.get('quick-look-next-btn').disabled, false);

  assert.equal(await controller.navigate(1), true);
  assert.equal(controller.currentPath(), items[1].path);
  assert.equal(document.elements.get('quick-look-title').textContent, 'b.txt');
  assert.equal(document.elements.get('quick-look-position').textContent, '2 / 3');
  assert.equal(document.elements.get('quick-look-prev-btn').disabled, false);
  assert.equal(document.elements.get('quick-look-next-btn').disabled, false);

  assert.equal(await controller.navigate(1), true);
  assert.equal(controller.currentPath(), items[2].path);
  assert.equal(document.elements.get('quick-look-position').textContent, '3 / 3');
  assert.equal(document.elements.get('quick-look-next-btn').disabled, true);
  assert.equal(await controller.navigate(1), false);
  assert.equal(controller.currentPath(), items[2].path);
  controller.close();
  assert.deepEqual(restoredFocus, [items[2].path]);
});

test('翻页期间关闭会拒绝迟到内容并撤销主进程返回的新令牌', async () => {
  const nextPage = deferred();
  const released = [];
  const { controller, document } = createController({
    contentApi: {
      getPreview: async filePath => preview(filePath, { nextPageToken: 'first-token' }),
      getTextPage: () => nextPage.promise,
      releaseTextPage: async token => released.push(token)
    }
  });
  await controller.open({ type: 'file', name: 'large.txt', path: '/managed/large.txt' });
  const pending = controller.loadNextPage();
  controller.close();
  nextPage.resolve({
    kind: 'text-page',
    path: '/managed/large.txt',
    previewKind: 'text',
    content: 'late page',
    startOffset: 10,
    endOffset: 20,
    totalSize: 20,
    startLine: 2,
    nextPageToken: 'rotated-token',
    hasMore: true,
    limitReached: false
  });
  await pending;
  await Promise.resolve();

  assert.equal(document.elements.get('quick-look-overlay').style.display, 'none');
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /late page/);
  assert.deepEqual(released, ['rotated-token']);
});

test('回到开头会撤销当前后续令牌并重新建立第一段状态', async () => {
  let previewCalls = 0;
  const released = [];
  const { controller, document } = createController({
    contentApi: {
      getPreview: async filePath => preview(filePath, {
        content: `first segment ${++previewCalls}`,
        nextPageToken: `first-token-${previewCalls}`
      }),
      getTextPage: async () => ({
        kind: 'text-page',
        path: '/managed/large.txt',
        previewKind: 'text',
        content: 'second segment',
        startOffset: 10,
        endOffset: 15,
        totalSize: 20,
        startLine: 2,
        nextPageToken: 'second-token',
        hasMore: true,
        limitReached: false
      }),
      releaseTextPage: async token => released.push(token)
    }
  });
  await controller.open({ type: 'file', name: 'large.txt', path: '/managed/large.txt' });
  await controller.loadNextPage();
  assert.match(document.elements.get('quick-look-body').innerHTML, /second segment/);

  await controller.restart();
  await Promise.resolve();
  assert.match(document.elements.get('quick-look-body').innerHTML, /first segment 2/);
  assert.match(document.elements.get('quick-look-body').innerHTML, /第 1 段/);
  assert.deepEqual(released, ['second-token']);
});

test('目录操作复用当前项目身份，外部名称和不支持原因保持转义', async () => {
  const activated = [];
  const directory = { type: 'directory', name: 'folder', path: '/managed/folder' };
  const { controller, document } = createController({
    contentApi: {
      getPreview: async () => ({
        kind: 'directory',
        name: 'folder',
        path: directory.path,
        directoryCount: 1,
        fileCount: 1,
        symlinkCount: 0,
        samples: [{ type: 'file', name: '<script>bad()</script>' }]
      }),
      releaseTextPage: async () => {}
    },
    getItemByPath: () => directory,
    activateDirectory: item => activated.push(item.path)
  });
  await controller.open(directory);
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /<script>/);
  assert.match(document.elements.get('quick-look-body').innerHTML, /&lt;script&gt;/);
  controller.openCurrentItem();
  assert.deepEqual(activated, [directory.path]);
  assert.equal(controller.isOpen(), false);

  controller.render({ kind: 'unsupported', reason: '<img src=x>', path: '/managed/bad' });
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /<img src=x>/);
  assert.match(document.elements.get('quick-look-body').innerHTML, /&lt;img src=x&gt;/);
});

test('ZIP Quick Look 展示受限归档摘要并转义内部路径', () => {
  const { controller, document } = createController();
  controller.render({
    kind: 'archive',
    format: 'zip',
    name: 'source.zip',
    path: '/managed/source.zip',
    size: 120,
    modifiedTime: '2026-08-28T00:00:00.000Z',
    totalEntries: 3,
    fileCount: 2,
    directoryCount: 1,
    encryptedCount: 1,
    totalCompressedSize: 20,
    totalUncompressedSize: 40,
    truncated: false,
    entries: [
      { name: 'src/', isDirectory: true, compressedSize: 0, uncompressedSize: 0, method: '存储', encrypted: false },
      { name: '<script>.js', isDirectory: false, compressedSize: 20, uncompressedSize: 40, method: 'Deflate', encrypted: true }
    ]
  });

  const html = document.elements.get('quick-look-body').innerHTML;
  assert.match(html, /3 个条目/);
  assert.match(html, /1 个加密条目/);
  assert.match(html, /src\//);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;\.js/);
  assert.match(html, /只读列出目录/);
});

test('二进制 plist 不会隐式转换，并提供说明清楚的显式只读操作', async () => {
  let conversions = 0;
  const { controller, document } = createController({
    contentApi: {
      getPreview: async () => ({
        kind: 'unsupported',
        format: 'binary-plist',
        canConvertBinaryPlist: true,
        name: 'Info.plist',
        path: '/managed/Info.plist',
        reason: '检测到二进制 plist；可使用系统 plutil 生成只读 XML 预览'
      }),
      convertBinaryPlist: async () => {
        conversions += 1;
        return {
          kind: 'code',
          language: 'plist',
          name: 'Info.plist',
          path: '/managed/Info.plist',
          size: 20,
          modifiedTime: '2026-08-27T00:00:00.000Z',
          content: '<plist><dict/></plist>',
          convertedFrom: 'binary-plist',
          readOnly: true
        };
      },
      releaseTextPage: async () => {}
    }
  });

  await controller.open({ type: 'file', name: 'Info.plist', path: '/managed/Info.plist' });
  const unsupportedHtml = document.elements.get('quick-look-body').innerHTML;
  assert.equal(conversions, 0);
  assert.match(unsupportedHtml, /转换后预览/);
  assert.match(unsupportedHtml, /不修改原文件/);
  assert.match(unsupportedHtml, /data-quick-look-action="convert-binary-plist"/);

  await controller.convertBinaryPlist();
  assert.equal(conversions, 1);
  assert.match(document.elements.get('quick-look-body').innerHTML, /&lt;plist&gt;/);
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /转换后预览/);
});

test('关闭 Quick Look 后忽略迟到的 plist 转换结果', async () => {
  const conversion = deferred();
  const { controller, document } = createController({
    contentApi: {
      getPreview: async () => ({
        kind: 'unsupported',
        format: 'binary-plist',
        canConvertBinaryPlist: true,
        name: 'Info.plist',
        path: '/managed/Info.plist',
        reason: '二进制 plist'
      }),
      convertBinaryPlist: () => conversion.promise,
      releaseTextPage: async () => {}
    }
  });
  await controller.open({ type: 'file', name: 'Info.plist', path: '/managed/Info.plist' });

  const pending = controller.convertBinaryPlist();
  controller.close();
  conversion.resolve({
    kind: 'code',
    language: 'plist',
    name: 'Info.plist',
    path: '/managed/Info.plist',
    content: 'late converted result'
  });
  await pending;

  assert.equal(controller.isOpen(), false);
  assert.doesNotMatch(document.elements.get('quick-look-body').innerHTML, /late converted result/);
});
