const test = require('node:test');
const assert = require('node:assert/strict');

const GalleryView = require('../src/renderer/scripts/galleryView');

test('图库优先预览键盘焦点，其次选择项，最后回退到首项', () => {
  const items = [
    { path: '/workspace/a', name: 'a' },
    { path: '/workspace/b', name: 'b' },
    { path: '/workspace/c', name: 'c' }
  ];

  assert.equal(GalleryView.pickPreviewItem(items, new Set(['/workspace/b']), '/workspace/c').path, '/workspace/c');
  assert.equal(GalleryView.pickPreviewItem(items, ['/workspace/b'], '/workspace/missing').path, '/workspace/b');
  assert.equal(GalleryView.pickPreviewItem(items, [], '').path, '/workspace/a');
  assert.equal(GalleryView.pickPreviewItem([], [], ''), null);
});

test('图库只接纳仍属于当前目录和当前请求的异步预览结果', () => {
  const expected = { requestId: 7, directoryPath: '/workspace/a' };
  assert.equal(GalleryView.isPreviewRequestCurrent(expected, {
    requestId: 7,
    directoryPath: '/workspace/a',
    mode: 'tree',
    style: 'gallery'
  }), true);
  assert.equal(GalleryView.isPreviewRequestCurrent(expected, {
    requestId: 8,
    directoryPath: '/workspace/a',
    mode: 'tree',
    style: 'gallery'
  }), false);
  assert.equal(GalleryView.isPreviewRequestCurrent(expected, {
    requestId: 7,
    directoryPath: '/workspace/b',
    mode: 'tree',
    style: 'gallery'
  }), false);
  assert.equal(GalleryView.isPreviewRequestCurrent(expected, {
    requestId: 7,
    directoryPath: '/workspace/a',
    mode: 'grid',
    style: 'gallery'
  }), false);
});

test('图库仅接受受支持的图片 data URL，并转义图片名称', () => {
  const safe = GalleryView.renderPreview({
    kind: 'image',
    name: '<img onerror=alert(1)>',
    path: '/workspace/icon.png',
    dataUrl: 'data:image/png;base64,AA=='
  });
  assert.match(safe.html, /src="data:image\/png;base64,AA=="/);
  assert.doesNotMatch(safe.html, /<img onerror/);
  assert.match(safe.html, /&lt;img onerror=alert\(1\)&gt;/);

  const unsafe = GalleryView.renderPreview({
    kind: 'image',
    name: 'bad.svg',
    path: '/workspace/bad.svg',
    dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='
  });
  assert.equal(unsafe.kind, 'unsupported');
  assert.doesNotMatch(unsafe.html, /data:image\/svg/);
});

test('图库文本预览限制 DOM 内容长度并完整转义', () => {
  const payload = `<script>alert('x')</script>${'a'.repeat(GalleryView.MAX_TEXT_CHARACTERS + 200)}`;
  const presentation = GalleryView.renderPreview({
    kind: 'code',
    name: 'danger.js',
    path: '/workspace/danger.js',
    language: 'javascript',
    content: payload,
    truncated: false
  });

  assert.doesNotMatch(presentation.html, /<script>/);
  assert.match(presentation.html, /&lt;script&gt;/);
  assert.match(presentation.html, /仅显示前/);
  assert.equal(presentation.domTruncated, true);
});

test('图库 Markdown 不生成可点击链接并转义嵌入 HTML', () => {
  const presentation = GalleryView.renderPreview({
    kind: 'markdown',
    name: 'README.md',
    path: '/workspace/README.md',
    content: '# 标题\n\n[危险链接](javascript:alert(1))\n\n<img src=x onerror=alert(2)>'
  });

  assert.match(presentation.html, /<h1>标题<\/h1>/);
  assert.match(presentation.html, /class="markdown-link"/);
  assert.doesNotMatch(presentation.html, /href=/);
  assert.doesNotMatch(presentation.html, /<img src=/);
  assert.match(presentation.html, /&lt;img src=x onerror=alert\(2\)&gt;/);
});

test('图库目录统计和样本名称均按纯文本渲染', () => {
  const presentation = GalleryView.renderPreview({
    kind: 'directory',
    name: 'repo',
    path: '/workspace/repo',
    isGitRepo: true,
    directoryCount: 2,
    fileCount: 3,
    symlinkCount: 1,
    samples: [{ name: '<svg onload=alert(1)>', type: 'file' }]
  });

  assert.match(presentation.html, /Git 仓库/);
  assert.match(presentation.html, /<strong>2<\/strong>/);
  assert.doesNotMatch(presentation.html, /<svg onload/);
  assert.match(presentation.html, /&lt;svg onload=alert\(1\)&gt;/);
});

test('图库加载和错误状态不直接注入路径或错误文本', () => {
  const loading = GalleryView.renderLoading({ name: '<b>file</b>', path: '/workspace/<b>' });
  const error = GalleryView.renderError('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(loading.html, /<b>file<\/b>/);
  assert.match(loading.title, /<b>file<\/b>/);
  assert.doesNotMatch(error.html, /<img src=/);
  assert.match(error.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
