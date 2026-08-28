const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WorkspaceContentService } = require('../src/main/services/workspaceContentService');

function createFixture(t, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-content-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const firstRoot = path.join(tempRoot, 'first-root');
  const secondRoot = path.join(tempRoot, 'second-root');
  fs.mkdirSync(firstRoot);
  fs.mkdirSync(secondRoot);
  const metadata = options.metadata || {
    registry: { version: 1, repos: [] },
    groups: { version: 2, groups: [], ungroupedIds: [] },
    tags: { version: 2, tags: [], repoTags: {} }
  };
  const serviceOptions = { ...options };
  delete serviceOptions.metadata;
  const configService = {
    getTreeRoots: () => [
      { path: firstRoot, name: 'first' },
      { path: secondRoot, name: 'second' }
    ],
    getRegistry: () => metadata.registry,
    getGroups: () => metadata.groups,
    getTags: () => metadata.tags
  };
  const service = new WorkspaceContentService({ configService, ...serviceOptions });
  return { tempRoot, firstRoot, secondRoot, configService, metadata, service };
}

test('文本和 Markdown 预览受字节上限约束并标记截断', async (t) => {
  const { firstRoot, service } = createFixture(t, { maxTextBytes: 18 });
  const markdownPath = path.join(firstRoot, 'README.md');
  fs.writeFileSync(markdownPath, '# Title\n\nThis content is longer than the preview limit.\n');

  const preview = await service.getPreview(markdownPath);
  assert.equal(preview.kind, 'markdown');
  assert.equal(preview.truncated, true);
  assert.equal(Buffer.byteLength(preview.content, 'utf8') <= 21, true);
  assert.equal(preview.name, 'README.md');
});

test('大型文本使用单次令牌连续读取且不切断 UTF-8 多字节字符', async (t) => {
  const { firstRoot, service } = createFixture(t, {
    maxTextBytes: 11,
    previewPageBytes: 7,
    maxProgressiveTextBytes: 256
  });
  const filePath = path.join(firstRoot, 'large.txt');
  const original = '开头🙂第一行\n第二行包含中文🙂\n结尾';
  fs.writeFileSync(filePath, original);

  const ordinaryPreview = await service.getPreview(filePath);
  assert.equal(ordinaryPreview.nextPageToken, undefined);

  const preview = await service.getPreview(filePath, { enablePaging: true });
  assert.equal(preview.paged, true);
  assert.equal(preview.startOffset, 0);
  assert.match(preview.nextPageToken, /^[0-9a-f-]{36}$/i);
  const revokedPreview = await service.getPreview(filePath, { enablePaging: true });
  assert.equal(service.releaseTextPage(revokedPreview.nextPageToken), true);
  assert.equal(service.releaseTextPage(revokedPreview.nextPageToken), false);
  await assert.rejects(() => service.getTextPage(revokedPreview.nextPageToken), /已过期或已使用/);
  const expiredPreview = await service.getPreview(filePath, { enablePaging: true });
  service.previewPageSessions.get(expiredPreview.nextPageToken).expiresAt = Date.now() - 1;
  await assert.rejects(() => service.getTextPage(expiredPreview.nextPageToken), /已过期或已使用/);
  const chunks = [preview.content];
  let token = preview.nextPageToken;
  let finalPage = null;
  while (token) {
    const consumedToken = token;
    const page = await service.getTextPage(consumedToken);
    finalPage = page;
    chunks.push(page.content);
    token = page.nextPageToken;
    await assert.rejects(() => service.getTextPage(consumedToken), /已过期或已使用/);
  }
  assert.equal(chunks.join(''), original);
  assert.equal(finalPage.hasMore, false);
  assert.equal(finalPage.limitReached, false);
  assert.equal(finalPage.endOffset, Buffer.byteLength(original));
});

test('大型文本分页在文件变化、二进制后续内容和总量上限处停止', async (t) => {
  const { firstRoot, service } = createFixture(t, {
    maxTextBytes: 8,
    previewPageBytes: 4,
    maxProgressiveTextBytes: 12
  });
  const changedPath = path.join(firstRoot, 'changed.log');
  fs.writeFileSync(changedPath, 'abcdefghijklmnop');
  const changedPreview = await service.getPreview(changedPath, { enablePaging: true });
  fs.appendFileSync(changedPath, 'changed');
  await assert.rejects(() => service.getTextPage(changedPreview.nextPageToken), /发生变化/);

  const limitedPath = path.join(firstRoot, 'limited.txt');
  fs.writeFileSync(limitedPath, 'abcdefghijklmnopqrstuvwxyz');
  const limitedPreview = await service.getPreview(limitedPath, { enablePaging: true });
  const limitedPage = await service.getTextPage(limitedPreview.nextPageToken);
  assert.equal(limitedPage.endOffset, 12);
  assert.equal(limitedPage.hasMore, false);
  assert.equal(limitedPage.limitReached, true);
  assert.equal(limitedPage.nextPageToken, null);

  const binaryPath = path.join(firstRoot, 'later.txt');
  fs.writeFileSync(binaryPath, Buffer.concat([Buffer.from('abcdefgh'), Buffer.from([0, 1, 2, 3])]));
  const binaryPreview = await service.getPreview(binaryPath, { enablePaging: true });
  await assert.rejects(() => service.getTextPage(binaryPreview.nextPageToken), /二进制数据/);
});

test('JSON 预览格式化有效内容，二进制文件不作为文本返回', async (t) => {
  const { firstRoot, service } = createFixture(t);
  const jsonPath = path.join(firstRoot, 'config.json');
  const binaryPath = path.join(firstRoot, 'binary.dat');
  fs.writeFileSync(jsonPath, '{"enabled":true,"count":2}');
  fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 4]));

  const jsonPreview = await service.getPreview(jsonPath);
  const binaryPreview = await service.getPreview(binaryPath);
  assert.equal(jsonPreview.kind, 'code');
  assert.equal(jsonPreview.language, 'json');
  assert.match(jsonPreview.content, /\n  "enabled": true/);
  assert.equal(binaryPreview.kind, 'unsupported');
  assert.match(binaryPreview.reason, /二进制/);
});

test('ZIP 预览走只读归档分支，损坏文件不会退回普通二进制文本', async (t) => {
  const { firstRoot, service } = createFixture(t);
  const emptyArchivePath = path.join(firstRoot, 'empty.zip');
  const corruptArchivePath = path.join(firstRoot, 'corrupt.zip');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  fs.writeFileSync(emptyArchivePath, eocd);
  fs.writeFileSync(corruptArchivePath, Buffer.from('broken archive'));

  const emptyPreview = await service.getPreview(emptyArchivePath);
  const corruptPreview = await service.getPreview(corruptArchivePath);
  assert.equal(emptyPreview.kind, 'archive');
  assert.equal(emptyPreview.format, 'zip');
  assert.equal(emptyPreview.totalEntries, 0);
  assert.equal(emptyPreview.readOnly, true);
  assert.equal(corruptPreview.kind, 'unsupported');
  assert.equal(corruptPreview.format, 'zip');
  assert.match(corruptPreview.reason, /ZIP/);
});

test('开发配置与日志返回明确语言，二进制 plist 只暴露显式只读转换入口', async (t) => {
  const conversionCalls = [];
  const convertedXml = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>Demo</string></dict></plist>\n';
  const { firstRoot, service } = createFixture(t, {
    platform: 'darwin',
    convertBinaryPlist: async (sourcePath, options) => {
      conversionCalls.push({ sourcePath, options });
      return convertedXml;
    }
  });
  const fixtures = [
    ['service.yml', 'name: api\nport: 3000\n', 'yaml'],
    ['pyproject.toml', '[project]\nname = "demo"\n', 'toml'],
    ['Info.plist', '<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>Demo</string></dict></plist>', 'plist'],
    ['server.log', '2026-08-27 10:00:00 INFO ready\n', 'log']
  ];
  for (const [name, content, language] of fixtures) {
    const filePath = path.join(firstRoot, name);
    fs.writeFileSync(filePath, content);
    const preview = await service.getPreview(filePath);
    assert.equal(preview.kind, 'code');
    assert.equal(preview.language, language);
    assert.equal(preview.content, content);
  }

  const binaryPlistPath = path.join(firstRoot, 'Binary.plist');
  const originalBytes = Buffer.concat([Buffer.from('bplist00'), Buffer.from([0, 1, 2, 3])]);
  fs.writeFileSync(binaryPlistPath, originalBytes);
  const binaryPreview = await service.getPreview(binaryPlistPath);
  assert.equal(binaryPreview.kind, 'unsupported');
  assert.equal(binaryPreview.format, 'binary-plist');
  assert.equal(binaryPreview.canConvertBinaryPlist, true);
  assert.match(binaryPreview.reason, /二进制 plist/);
  assert.match(binaryPreview.reason, /plutil/);
  assert.equal(conversionCalls.length, 0);

  const convertedPreview = await service.convertBinaryPlistPreview(binaryPlistPath);
  assert.equal(convertedPreview.kind, 'code');
  assert.equal(convertedPreview.language, 'plist');
  assert.equal(convertedPreview.content, convertedXml);
  assert.equal(convertedPreview.convertedFrom, 'binary-plist');
  assert.equal(convertedPreview.readOnly, true);
  assert.equal(conversionCalls.length, 1);
  assert.equal(conversionCalls[0].sourcePath, fs.realpathSync.native(binaryPlistPath));
  assert.equal(conversionCalls[0].options.maxOutputBytes > 0, true);
  assert.deepEqual(fs.readFileSync(binaryPlistPath), originalBytes);
});

test('二进制 plist 转换拒绝错误格式、不可用平台、超限输出和转换期间源文件变化', async (t) => {
  const fixture = createFixture(t, {
    platform: 'win32',
    convertBinaryPlist: async () => '<plist/>'
  });
  const binaryPath = path.join(fixture.firstRoot, 'Binary.plist');
  const xmlPath = path.join(fixture.firstRoot, 'Info.plist');
  const textPath = path.join(fixture.firstRoot, 'notes.txt');
  fs.writeFileSync(binaryPath, Buffer.concat([Buffer.from('bplist00'), Buffer.from([1, 2, 3])]));
  fs.writeFileSync(xmlPath, '<?xml version="1.0"?><plist/>');
  fs.writeFileSync(textPath, 'plain text');

  const unsupportedPreview = await fixture.service.getPreview(binaryPath);
  assert.equal(unsupportedPreview.canConvertBinaryPlist, false);
  await assert.rejects(() => fixture.service.convertBinaryPlistPreview(binaryPath), /当前平台/);
  await assert.rejects(() => fixture.service.convertBinaryPlistPreview(xmlPath), /不是二进制 plist/);
  await assert.rejects(() => fixture.service.convertBinaryPlistPreview(textPath), /仅支持.*\.plist/);

  const oversized = new WorkspaceContentService({
    configService: fixture.configService,
    platform: 'darwin',
    maxBinaryPlistOutputBytes: 32,
    convertBinaryPlist: async () => `<?xml version="1.0"?><plist>${'x'.repeat(64)}</plist>`
  });
  await assert.rejects(() => oversized.convertBinaryPlistPreview(binaryPath), /转换结果超过/);

  const changed = new WorkspaceContentService({
    configService: fixture.configService,
    platform: 'darwin',
    convertBinaryPlist: async sourcePath => {
      fs.appendFileSync(sourcePath, Buffer.from([4]));
      return '<?xml version="1.0"?><plist/>';
    }
  });
  await assert.rejects(() => changed.convertBinaryPlistPreview(binaryPath), /转换期间发生变化/);
});

test('白名单栅格图片以 data URL 返回，超限图片拒绝载入内存', async (t) => {
  const { firstRoot, service } = createFixture(t, { maxImageBytes: 80 });
  const imagePath = path.join(firstRoot, 'pixel.png');
  const largeImagePath = path.join(firstRoot, 'large.png');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(imagePath, pixel);
  fs.writeFileSync(largeImagePath, Buffer.alloc(81, 1));

  const imagePreview = await service.getPreview(imagePath);
  const largePreview = await service.getPreview(largeImagePath);
  assert.equal(imagePreview.kind, 'image');
  assert.match(imagePreview.dataUrl, /^data:image\/png;base64,/);
  assert.equal(largePreview.kind, 'unsupported');
  assert.match(largePreview.reason, /过大/);
});

test('图库缩略图复用受管图片边界、固定尺寸并使用有界 LRU 缓存', async (t) => {
  const calls = [];
  const { firstRoot, service } = createFixture(t, {
    maxImageBytes: 100,
    maxThumbnailCacheEntries: 1,
    createThumbnail: async (sourcePath, size) => {
      calls.push({ sourcePath, size });
      return 'data:image/png;base64,AA==';
    }
  });
  const firstImage = path.join(firstRoot, 'first.png');
  const secondImage = path.join(firstRoot, 'second.jpg');
  const vectorImage = path.join(firstRoot, 'vector.svg');
  fs.writeFileSync(firstImage, Buffer.from([1, 2, 3]));
  fs.writeFileSync(secondImage, Buffer.from([4, 5, 6]));
  fs.writeFileSync(vectorImage, '<svg/>');

  const first = await service.getThumbnail(firstImage);
  const firstCached = await service.getThumbnail(firstImage);
  assert.equal(first.kind, 'thumbnail');
  assert.equal(first.cached, false);
  assert.equal(firstCached.cached, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].size, { width: 192, height: 128 });
  assert.equal(calls[0].sourcePath, fs.realpathSync.native(firstImage));

  await service.getThumbnail(secondImage);
  await service.getThumbnail(firstImage);
  assert.equal(calls.length, 3);
  assert.equal(service.thumbnailCache.size, 1);

  const vector = await service.getThumbnail(vectorImage);
  assert.equal(vector.kind, 'unsupported');
  assert.match(vector.reason, /不生成缩略图/);
  assert.equal(calls.length, 3);
});

test('图库缩略图拒绝超限来源、非 PNG 输出和受管根逃逸', async (t) => {
  const { tempRoot, firstRoot, service } = createFixture(t, {
    maxImageBytes: 3,
    createThumbnail: async () => 'data:image/svg+xml;base64,PHN2Zz4='
  });
  const oversized = path.join(firstRoot, 'large.png');
  const unsafeOutput = path.join(firstRoot, 'unsafe.png');
  const outside = path.join(tempRoot, 'outside.png');
  const link = path.join(firstRoot, 'outside.png');
  fs.writeFileSync(oversized, Buffer.alloc(4, 1));
  fs.writeFileSync(unsafeOutput, Buffer.alloc(2, 1));
  fs.writeFileSync(outside, Buffer.alloc(2, 1));
  fs.symlinkSync(outside, link);

  const oversizedResult = await service.getThumbnail(oversized);
  const unsafeResult = await service.getThumbnail(unsafeOutput);
  assert.equal(oversizedResult.kind, 'unsupported');
  assert.match(oversizedResult.reason, /过大/);
  assert.equal(unsafeResult.kind, 'unsupported');
  assert.match(unsafeResult.reason, /输出格式/);
  await assert.rejects(() => service.getThumbnail(outside), /不在受管开发目录中/);
  await assert.rejects(() => service.getThumbnail(link), /符号链接指向受管目录之外/);
});

test('目录预览返回有限摘要并识别 Git 仓库', async (t) => {
  const { firstRoot, service } = createFixture(t);
  const repoPath = path.join(firstRoot, 'repo');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'src'));
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Repo\n');

  const preview = await service.getPreview(repoPath);
  assert.equal(preview.kind, 'directory');
  assert.equal(preview.isGitRepo, true);
  assert.equal(preview.directoryCount, 2);
  assert.equal(preview.fileCount, 1);
});

test('预览拒绝受管根之外路径及符号链接逃逸', async (t) => {
  const { tempRoot, firstRoot, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside.txt');
  const link = path.join(firstRoot, 'outside-link.txt');
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, link);

  await assert.rejects(() => service.getPreview(outside), /不在受管开发目录中/);
  await assert.rejects(() => service.getPreview(link), /符号链接指向受管目录之外/);
});

test('全局搜索跨受管根目录工作并跳过依赖、Git 元数据和隐藏目录', async (t) => {
  const { firstRoot, secondRoot, service } = createFixture(t);
  fs.mkdirSync(path.join(firstRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(firstRoot, 'src', 'alpha-service.js'), 'alpha\n');
  fs.mkdirSync(path.join(firstRoot, 'node_modules', 'alpha-package'), { recursive: true });
  fs.writeFileSync(path.join(firstRoot, 'node_modules', 'alpha-package', 'index.js'), 'ignored\n');
  fs.mkdirSync(path.join(firstRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(firstRoot, '.git', 'alpha-config'), 'ignored\n');
  fs.mkdirSync(path.join(secondRoot, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(secondRoot, '.hidden', 'alpha-secret.txt'), 'ignored\n');
  fs.mkdirSync(path.join(secondRoot, 'alpha-docs'));

  const result = await service.search('alpha', { requestId: 'search-1', limit: 20 });
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.items.map(item => item.name).sort(), ['alpha-docs', 'alpha-service.js']);
  assert.equal(result.indexedCount >= 3, true);

  const filesOnly = await service.search('alpha', { requestId: 'search-2', type: 'file' });
  assert.deepEqual(filesOnly.items.map(item => item.name), ['alpha-service.js']);
});

test('文件内容只在显式模式下读取，返回有限匹配片段且不持久化', async (t) => {
  const fixture = createFixture(t, {
    indexFilePath: path.join(os.tmpdir(), `gitfinder-content-index-${Date.now()}-${Math.random()}.json`)
  });
  t.after(() => fs.rmSync(fixture.service.indexFilePath, { force: true }));
  const notePath = path.join(fixture.firstRoot, 'release-notes.md');
  const utf16Path = path.join(fixture.firstRoot, 'manufacturing-plan.txt');
  fs.writeFileSync(notePath, '# Release\n\nThe unique recovery phrase appears here.\n');
  fs.writeFileSync(utf16Path, Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('计划\n制造计划已确认\n', 'utf16le')
  ]));

  const metadataOnly = await fixture.service.search('unique recovery phrase', { requestId: 'content-default' });
  assert.deepEqual(metadataOnly.items, []);

  const contentResult = await fixture.service.search('unique recovery phrase', {
    requestId: 'content-explicit',
    mode: 'content',
    type: 'file'
  });

  assert.deepEqual(contentResult.items.map(item => item.path), [notePath]);
  assert.equal(contentResult.items[0].contentMatch.line, 3);
  assert.match(contentResult.items[0].contentMatch.snippet, /unique recovery phrase/i);
  assert.equal(contentResult.contentSearch, true);
  assert.equal(contentResult.contentPersisted, false);
  assert.equal(contentResult.contentScannedFiles >= 1, true);
  assert.equal(fixture.service.getIndexStatus().contentSearch.phase, 'ready');
  assert.doesNotMatch(fs.readFileSync(fixture.service.indexFilePath, 'utf8'), /unique recovery phrase/i);

  const utf16Result = await fixture.service.search('制造计划', {
    requestId: 'content-utf16',
    mode: 'content'
  });
  assert.deepEqual(utf16Result.items.map(item => item.path), [utf16Path]);
  assert.equal(utf16Result.items[0].contentMatch.line, 2);
});

test('内容搜索跳过超限、二进制、非白名单和搜索前被替换的符号链接', async (t) => {
  const { tempRoot, firstRoot, service } = createFixture(t, {
    maxContentSearchFileBytes: 4096,
    maxContentSearchTotalBytes: 32 * 1024
  });
  const safePath = path.join(firstRoot, 'safe.txt');
  const largePath = path.join(firstRoot, 'large.txt');
  const binaryPath = path.join(firstRoot, 'binary.txt');
  const unsupportedPath = path.join(firstRoot, 'archive.bin');
  const swappedPath = path.join(firstRoot, 'swapped.txt');
  const outsidePath = path.join(tempRoot, 'outside.txt');
  fs.writeFileSync(safePath, 'bounded needle content\n');
  fs.writeFileSync(largePath, `${'x'.repeat(5000)} bounded needle content\n`);
  fs.writeFileSync(binaryPath, Buffer.from('bounded needle\0content'));
  fs.writeFileSync(unsupportedPath, 'bounded needle content\n');
  fs.writeFileSync(swappedPath, 'safe before index\n');
  fs.writeFileSync(outsidePath, 'bounded needle content outside\n');

  await service.search('swapped', { requestId: 'content-safety-index' });
  fs.unlinkSync(swappedPath);
  fs.symlinkSync(outsidePath, swappedPath);

  const result = await service.search('bounded needle', {
    requestId: 'content-safety',
    mode: 'content'
  });

  assert.deepEqual(result.items.map(item => item.path), [safePath]);
  assert.equal(result.contentSkippedLargeFiles, 1);
  assert.equal(result.contentSkippedUnsafeFiles >= 2, true);
  assert.equal(result.items.some(item => item.path === unsupportedPath), false);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'bounded needle content outside\n');
});

test('内容搜索按文件数和总读取量限流并报告边界', async (t) => {
  const filesFixture = createFixture(t, {
    maxContentSearchFiles: 2,
    maxContentSearchFileBytes: 4096,
    maxContentSearchTotalBytes: 16 * 1024
  });
  for (let index = 0; index < 4; index++) {
    fs.writeFileSync(path.join(filesFixture.firstRoot, `limited-${index}.txt`), `limit needle ${index}\n`);
  }
  const fileLimited = await filesFixture.service.search('limit needle', {
    requestId: 'content-file-limit',
    mode: 'content'
  });
  assert.equal(fileLimited.contentCandidateFiles, 4);
  assert.equal(fileLimited.contentScannedFiles, 2);
  assert.equal(fileLimited.contentFileLimitReached, true);

  const bytesFixture = createFixture(t, {
    maxContentSearchFiles: 10,
    maxContentSearchFileBytes: 4096,
    maxContentSearchTotalBytes: 5000
  });
  fs.writeFileSync(path.join(bytesFixture.firstRoot, 'bytes-a.txt'), `${'a'.repeat(2980)} byte needle\n`);
  fs.writeFileSync(path.join(bytesFixture.firstRoot, 'bytes-b.txt'), `${'b'.repeat(2980)} byte needle\n`);
  const byteLimited = await bytesFixture.service.search('byte needle', {
    requestId: 'content-byte-limit',
    mode: 'content'
  });
  assert.equal(byteLimited.contentByteLimitReached, true);
  assert.equal(byteLimited.contentBytesRead < 5000, true);
});

test('内容搜索支持主动取消，后发查询不继续读取旧请求', async (t) => {
  const fixture = createFixture(t, {
    contentSearchYieldEvery: 1,
    contentSearchYield: () => new Promise(resolve => setTimeout(resolve, 5))
  });
  for (let index = 0; index < 80; index++) {
    fs.writeFileSync(path.join(fixture.firstRoot, `cancel-${index}.txt`), `cancel needle ${index}\n`);
  }
  await fixture.service.search('cancel-', { requestId: 'content-cancel-index' });

  const pending = fixture.service.search('cancel needle', {
    requestId: 'content-cancel-active',
    mode: 'content'
  });
  for (let attempt = 0; attempt < 20 && fixture.service.getIndexStatus().contentSearch.phase !== 'scanning'; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const cancelled = fixture.service.cancelContentSearch();
  const result = await pending;

  assert.equal(cancelled.cancelled, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.contentSearch, true);
  assert.equal(fixture.service.getIndexStatus().contentSearch.phase, 'cancelled');
});

test('快速连续查询时旧请求取消不覆盖新请求进度', async (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.firstRoot, 'old.txt'), 'oldneedle\n');
  fs.writeFileSync(path.join(fixture.firstRoot, 'new.txt'), 'newneedle\n');
  await fixture.service.search('needle-index', { requestId: 'content-race-index' });

  const originalRead = fixture.service._readContentSearchFile.bind(fixture.service);
  let releaseOld;
  let releaseNew;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const newGate = new Promise(resolve => { releaseNew = resolve; });
  fixture.service._readContentSearchFile = async (entry, tokens, remainingBytes, roots) => {
    if (tokens.includes('oldneedle')) await oldGate;
    if (tokens.includes('newneedle')) await newGate;
    return originalRead(entry, tokens, remainingBytes, roots);
  };

  const oldPending = fixture.service.search('oldneedle', { requestId: 'content-race-old', mode: 'content' });
  for (let attempt = 0; attempt < 20 && fixture.service.getIndexStatus().contentSearch.requestId !== 'content-race-old'; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const newPending = fixture.service.search('newneedle', { requestId: 'content-race-new', mode: 'content' });
  for (let attempt = 0; attempt < 20 && fixture.service.getIndexStatus().contentSearch.requestId !== 'content-race-new'; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  releaseOld();
  const oldResult = await oldPending;
  assert.equal(oldResult.cancelled, true);
  assert.equal(fixture.service.getIndexStatus().contentSearch.requestId, 'content-race-new');
  assert.equal(fixture.service.getIndexStatus().contentSearch.phase, 'scanning');

  releaseNew();
  const newResult = await newPending;
  assert.equal(newResult.cancelled, false);
  assert.deepEqual(newResult.items.map(item => item.name), ['new.txt']);
  assert.equal(fixture.service.getIndexStatus().contentSearch.phase, 'ready');
});

test('内容搜索少于三个字符时零扫描返回', async (t) => {
  const { service } = createFixture(t);
  service._getOrBuildIndex = async () => {
    throw new Error('过短查询不应建立索引');
  };

  const result = await service.search('ab', { requestId: 'content-too-short', mode: 'content' });

  assert.equal(result.queryTooShort, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.contentScannedFiles, undefined);
});

test('全局搜索可按 GitFinder 仓库分类与标签定位仓库', async (t) => {
  const fixture = createFixture(t);
  const repoPath = path.join(fixture.firstRoot, 'service-console');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'metadata-only.txt'), 'content\n');
  fixture.metadata.registry.repos.push({ id: 'r_console', path: repoPath, archived: false });
  fixture.metadata.groups.groups.push({ id: 'g_ai', name: 'AI 工具', color: '#7357bd', repoIds: ['r_console'] });
  fixture.metadata.tags.tags.push({ id: 't_favorite', name: '重点维护', color: '#d97706' });
  fixture.metadata.tags.repoTags.r_console = ['t_favorite'];

  const byGroup = await fixture.service.search('AI 工具', { requestId: 'metadata-group', type: 'repository' });
  const byTag = await fixture.service.search('重点维护', { requestId: 'metadata-tag' });

  assert.deepEqual(byGroup.items.map(item => item.path), [repoPath]);
  assert.deepEqual(byTag.items.map(item => item.path), [repoPath]);
  assert.deepEqual(byTag.items[0].groups.map(group => group.name), ['AI 工具']);
  assert.deepEqual(byTag.items[0].tags.map(tag => tag.name), ['重点维护']);
});

test('仓库元数据变化会即时参与搜索且不触发文件索引重建', async (t) => {
  const fixture = createFixture(t);
  const repoPath = path.join(fixture.firstRoot, 'runtime-service');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fixture.metadata.registry.repos.push({ id: 'r_runtime', path: repoPath, archived: false });
  fixture.metadata.tags.tags.push({ id: 't_stage', name: '旧标签', color: '#007aff' });
  fixture.metadata.tags.repoTags.r_runtime = ['t_stage'];
  const originalBuildIndex = fixture.service._buildIndex.bind(fixture.service);
  let buildCount = 0;
  fixture.service._buildIndex = async (...args) => {
    buildCount += 1;
    return originalBuildIndex(...args);
  };

  const first = await fixture.service.search('旧标签', { requestId: 'metadata-before' });
  fixture.metadata.tags.tags[0].name = '新标签';
  const second = await fixture.service.search('新标签', { requestId: 'metadata-after' });

  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 1);
  assert.equal(buildCount, 1);
  assert.equal(second.builtAt, first.builtAt);
});

test('仓库标签不会泄漏给仓库内文件且元数据字段受到清理', async (t) => {
  const fixture = createFixture(t);
  const repoPath = path.join(fixture.firstRoot, 'safe-service');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'inside.txt'), 'inside\n');
  fixture.metadata.registry.repos.push({ id: 'r_safe', path: repoPath, archived: false });
  fixture.metadata.tags.tags.push({ id: 't_safe', name: '发布\u0000候选', color: 'red' });
  fixture.metadata.tags.repoTags.r_safe = ['t_safe'];

  const repoResult = await fixture.service.search('发布 候选', { requestId: 'metadata-sanitized' });
  const filesOnly = await fixture.service.search('发布 候选', { requestId: 'metadata-file', type: 'file' });

  assert.deepEqual(repoResult.items.map(item => item.path), [repoPath]);
  assert.equal(repoResult.items[0].tags[0].name, '发布 候选');
  assert.equal(repoResult.items[0].tags[0].color, '#86868b');
  assert.deepEqual(filesOnly.items, []);
});

test('全局搜索限制返回数量，后发请求会取消旧请求结果', async (t) => {
  const { firstRoot, service } = createFixture(t);
  for (let index = 0; index < 12; index++) {
    fs.writeFileSync(path.join(firstRoot, `match-${index}.txt`), `${index}\n`);
  }

  const first = service.search('match', { requestId: 'old', limit: 3 });
  const second = service.search('match', { requestId: 'new', limit: 3 });
  const [oldResult, newResult] = await Promise.all([first, second]);
  assert.equal(oldResult.cancelled, true);
  assert.equal(newResult.cancelled, false);
  assert.equal(newResult.items.length, 3);
  assert.equal(newResult.totalMatches, 12);
});

test('索引显式失效后吸收新文件', async (t) => {
  const { firstRoot, service } = createFixture(t);
  await service.search('later', { requestId: 'before' });
  fs.writeFileSync(path.join(firstRoot, 'later-added.md'), '# Later\n');

  const cached = await service.search('later', { requestId: 'cached' });
  assert.equal(cached.items.length, 0);
  service.invalidateIndex();
  const refreshed = await service.search('later', { requestId: 'after' });
  assert.deepEqual(refreshed.items.map(item => item.name), ['later-added.md']);
});

test('受管根目录是符号链接时，搜索结果保留逻辑路径并可继续预览', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-linked-root-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const physicalRoot = path.join(tempRoot, 'physical');
  const linkedRoot = path.join(tempRoot, 'linked');
  fs.mkdirSync(physicalRoot);
  fs.symlinkSync(physicalRoot, linkedRoot);
  fs.writeFileSync(path.join(physicalRoot, 'linked-note.md'), '# Linked\n');
  const service = new WorkspaceContentService({
    configService: { getTreeRoots: () => [{ path: linkedRoot, name: 'linked' }] }
  });

  const result = await service.search('linked-note', { requestId: 'linked-root' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].path, path.join(linkedRoot, 'linked-note.md'));
  const preview = await service.getPreview(result.items[0].path);
  assert.equal(preview.kind, 'markdown');
});

test('持久化索引可在服务重启后直接复用且不读取文件内容', async (t) => {
  const fixture = createFixture(t);
  const indexFilePath = path.join(fixture.tempRoot, 'cache', 'workspace-index.json');
  fs.writeFileSync(path.join(fixture.firstRoot, 'persistent-note.md'), 'secret body is not index data\n');
  const firstService = new WorkspaceContentService({
    configService: fixture.configService,
    indexFilePath
  });

  const initial = await firstService.search('persistent-note', { requestId: 'persist-first' });
  assert.equal(initial.items.length, 1);
  assert.equal(fs.existsSync(indexFilePath), true);
  const persistedText = fs.readFileSync(indexFilePath, 'utf8');
  assert.doesNotMatch(persistedText, /secret body is not index data/);
  assert.equal(JSON.parse(persistedText).format, 'compact-v1');

  const restartedService = new WorkspaceContentService({
    configService: fixture.configService
  });
  restartedService.configurePersistence(indexFilePath);
  restartedService._buildIndex = async () => {
    throw new Error('持久化索引有效时不应重新扫描');
  };
  const restored = await restartedService.search('persistent-note', { requestId: 'persist-restored' });
  assert.equal(restored.items.length, 1);
  assert.equal(restored.indexSource, 'disk');
  assert.equal(restartedService.getIndexStatus().persisted, true);
});

test('索引失效后只重扫变化目录并复用未变化目录快照', async (t) => {
  const fixture = createFixture(t);
  const indexFilePath = path.join(fixture.tempRoot, 'cache', 'workspace-index.json');
  const stableDirectory = path.join(fixture.firstRoot, 'stable');
  const changedDirectory = path.join(fixture.firstRoot, 'changed');
  fs.mkdirSync(stableDirectory);
  fs.mkdirSync(changedDirectory);
  fs.writeFileSync(path.join(stableDirectory, 'stable-note.md'), '# Stable\n');
  fs.writeFileSync(path.join(changedDirectory, 'before.md'), '# Before\n');
  const service = new WorkspaceContentService({ configService: fixture.configService, indexFilePath });
  await service.search('before', { requestId: 'incremental-first' });

  fs.writeFileSync(path.join(changedDirectory, 'incremental-added.md'), '# Added\n');
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(changedDirectory, future, future);
  service.invalidateIndex();
  const refreshed = await service.search('incremental-added', { requestId: 'incremental-second' });
  const status = service.getIndexStatus();

  assert.deepEqual(refreshed.items.map(item => item.name), ['incremental-added.md']);
  assert.equal(status.incremental, true);
  assert.equal(status.reusedDirectories >= 1, true);
  assert.equal(status.scannedDirectories >= 1, true);
});

test('损坏的持久化索引会被忽略并由有效索引原子替换', async (t) => {
  const fixture = createFixture(t);
  const indexFilePath = path.join(fixture.tempRoot, 'cache', 'workspace-index.json');
  fs.mkdirSync(path.dirname(indexFilePath), { recursive: true });
  fs.writeFileSync(indexFilePath, '{not valid json');
  fs.writeFileSync(path.join(fixture.firstRoot, 'recovered-index.txt'), 'recovered\n');
  const service = new WorkspaceContentService({ configService: fixture.configService, indexFilePath });

  const result = await service.search('recovered-index', { requestId: 'corrupt-cache' });
  const persisted = JSON.parse(fs.readFileSync(indexFilePath, 'utf8'));
  assert.equal(result.items.length, 1);
  assert.equal(persisted.version, 2);
  assert.equal(Array.isArray(persisted.directorySnapshots), true);
});

test('长目录扫描可取消且不会发布不完整索引', async (t) => {
  const fixture = createFixture(t, {
    scanYieldEvery: 1,
    scanYield: () => new Promise(resolve => setImmediate(resolve))
  });
  let parent = fixture.firstRoot;
  for (let index = 0; index < 80; index++) {
    parent = path.join(parent, `level-${index}`);
    fs.mkdirSync(parent);
    fs.writeFileSync(path.join(parent, `item-${index}.txt`), `${index}\n`);
  }

  const pending = fixture.service.search('item', { requestId: 'cancel-build' });
  await new Promise(resolve => setImmediate(resolve));
  const cancelled = fixture.service.cancelIndexBuild();
  const result = await pending;

  assert.equal(cancelled.cancelled, true);
  assert.equal(result.cancelled, true);
  assert.equal(fixture.service.getIndexStatus().phase, 'cancelled');
  assert.equal(fixture.service.indexCache, null);
});

test('索引达到上限时按广度覆盖多个受管根目录', async (t) => {
  const fixture = createFixture(t, { maxIndexEntries: 4 });
  const deepDirectory = path.join(fixture.firstRoot, 'deep');
  fs.mkdirSync(deepDirectory);
  for (let index = 0; index < 10; index++) {
    fs.writeFileSync(path.join(deepDirectory, `deep-${index}.txt`), `${index}\n`);
  }
  fs.writeFileSync(path.join(fixture.secondRoot, 'other-root-target.md'), '# Target\n');

  const result = await fixture.service.search('other-root-target', { requestId: 'breadth-first' });
  assert.deepEqual(result.items.map(item => item.name), ['other-root-target.md']);
  assert.equal(result.truncated, true);
});
