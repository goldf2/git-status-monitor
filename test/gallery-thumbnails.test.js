const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GalleryThumbnails = require('../src/renderer/scripts/galleryThumbnails');

const SAFE_DATA_URL = 'data:image/png;base64,AA==';

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

function fakeElement(item) {
  const visual = {
    attributes: {},
    child: null,
    title: '',
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren(child) { this.child = child; }
  };
  const ownerDocument = {
    defaultView: {},
    createElement: () => ({ className: '', alt: '', src: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })
  };
  return {
    dataset: { path: item.path },
    isConnected: true,
    ownerDocument,
    visual,
    querySelector(selector) { return selector === '.finder-gallery-item-visual' ? visual : null; }
  };
}

function fakeContainer(elements) {
  return {
    ownerDocument: { defaultView: {} },
    querySelectorAll: selector => selector === '.finder-gallery-item' ? elements : [],
    querySelector: () => null
  };
}

test('图库缩略图只识别安全栅格图片并按文件版本生成缓存键', () => {
  assert.equal(GalleryThumbnails.isThumbnailCandidate({ type: 'file', name: 'ICON.PNG' }), true);
  assert.equal(GalleryThumbnails.isThumbnailCandidate({ type: 'file', name: 'vector.svg' }), false);
  assert.equal(GalleryThumbnails.isThumbnailCandidate({ type: 'directory', name: 'photos.png' }), false);
  assert.notEqual(
    GalleryThumbnails.cacheKey({ path: '/a.png', size: 1, modifiedTime: 'one' }),
    GalleryThumbnails.cacheKey({ path: '/a.png', size: 1, modifiedTime: 'two' })
  );
});

test('图库缩略图缓存拒绝非 PNG data URL 并按最近使用淘汰', () => {
  const cache = new GalleryThumbnails.ThumbnailCache(2);
  const first = { path: '/first.png', size: 1, modifiedTime: 'one' };
  const second = { path: '/second.png', size: 1, modifiedTime: 'one' };
  const third = { path: '/third.png', size: 1, modifiedTime: 'one' };
  assert.equal(cache.set(first, 'data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(cache.set(first, SAFE_DATA_URL), true);
  assert.equal(cache.set(second, SAFE_DATA_URL), true);
  assert.equal(cache.get(first), SAFE_DATA_URL);
  assert.equal(cache.set(third, SAFE_DATA_URL), true);
  assert.equal(cache.get(second), '');
  assert.equal(cache.get(first), SAFE_DATA_URL);
  assert.equal(cache.size, 2);
});

test('图库缩略图加载器限制并发并把安全结果写入当前胶片项', async () => {
  const items = Array.from({ length: 5 }, (_, index) => ({
    type: 'file',
    name: `${index}.png`,
    path: `/workspace/${index}.png`,
    size: index + 1,
    modifiedTime: 'now'
  }));
  const elements = items.map(fakeElement);
  const resolvers = [];
  const calls = [];
  const loader = new GalleryThumbnails.Loader(filePath => new Promise(resolve => {
    calls.push(filePath);
    resolvers.push(resolve);
  }), { maxConcurrent: 2 });

  loader.observe(fakeContainer(elements), items, { isCurrent: () => true });
  await flush();
  assert.equal(calls.length, 2);
  resolvers.shift()({ kind: 'thumbnail', dataUrl: SAFE_DATA_URL });
  await flush();
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(elements[0].visual.attributes['data-thumbnail-state'], 'ready');
  assert.equal(elements[0].visual.child.src, SAFE_DATA_URL);

  loader.disconnect();
  resolvers.forEach(resolve => resolve({ kind: 'thumbnail', dataUrl: SAFE_DATA_URL }));
  await flush();
});

test('图库切换后拒绝把迟到缩略图写入旧胶片项', async () => {
  const item = { type: 'file', name: 'late.png', path: '/workspace/late.png', size: 1, modifiedTime: 'now' };
  const element = fakeElement(item);
  let resolveThumbnail;
  const loader = new GalleryThumbnails.Loader(() => new Promise(resolve => { resolveThumbnail = resolve; }));
  loader.observe(fakeContainer([element]), [item], { isCurrent: () => true });
  await flush();
  loader.disconnect();
  resolveThumbnail({ kind: 'thumbnail', dataUrl: SAFE_DATA_URL });
  await flush();
  await flush();
  assert.equal(element.visual.child, null);
  assert.notEqual(element.visual.attributes['data-thumbnail-state'], 'ready');
});

test('图库缩略图桥接受受信 IPC 且模块在 App 前加载', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/content.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  assert.match(preload, /getThumbnail:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\('content:getThumbnail', filePath\)/);
  assert.match(ipc, /registerTrustedHandler\('content:getThumbnail'/);
  assert.ok(html.indexOf('scripts/galleryThumbnails.js') < html.indexOf('scripts/app.js'));
  assert.match(app, /new window\.GalleryThumbnails\.Loader/);
  assert.match(app, /maxConcurrent:\s*4,\s*cacheLimit:\s*128/);
});
