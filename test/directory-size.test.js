const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileService = require('../src/main/services/fileService');
const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('异步文件夹大小包含隐藏与依赖内容，并返回文件和目录摘要', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.txt'), Buffer.alloc(11));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, '.hidden', 'b.txt'), Buffer.alloc(7));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'c.bin'), Buffer.alloc(13));

  const progress = [];
  const result = await fileService.calculateDirectorySize(root, {
    progressEvery: 1,
    onProgress: snapshot => progress.push(snapshot)
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.size, 31);
  assert.equal(result.fileCount, 3);
  assert.equal(result.directoryCount, 2);
  assert.equal(result.symlinkCount, 0);
  assert.equal(result.skippedCount, 0);
  assert.ok(progress.length >= 1);
  assert.equal(progress.at(-1).size, 31);
});

test('文件夹大小不跟随符号链接到目录外部', { skip: process.platform === 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-size-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-size-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.bin'), Buffer.alloc(4096));
  const linkPath = path.join(root, 'external-link');
  fs.symlinkSync(outside, linkPath, 'dir');
  const linkSize = fs.lstatSync(linkPath).size;

  const result = await fileService.calculateDirectorySize(root);

  assert.equal(result.size, linkSize);
  assert.equal(result.fileCount, 0);
  assert.equal(result.symlinkCount, 1);
  assert.equal(result.directoryCount, 0);
});

test('文件夹大小扫描可在进度回调后取消且不继续遍历', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-directory-size-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 40; index += 1) {
    fs.writeFileSync(path.join(root, `${index}.txt`), Buffer.alloc(3));
  }
  const controller = new AbortController();

  const result = await fileService.calculateDirectorySize(root, {
    signal: controller.signal,
    progressEvery: 1,
    onProgress: () => controller.abort()
  });

  assert.equal(result.cancelled, true);
  assert.ok(result.fileCount >= 1);
  assert.ok(result.fileCount < 40);
  assert.ok(result.size < 120);
});

test('文件夹大小通过受信 IPC 提供任务隔离、进度和取消', () => {
  const ipcSource = read('src/main/ipc/filesystem.js');
  const preloadSource = read('preload.js');

  assert.match(ipcSource, /fs:calculateDirectorySize[\s\S]*assertManagedWorkspacePath/);
  assert.match(ipcSource, /directorySizeJobs/);
  assert.match(ipcSource, /AbortController/);
  assert.match(ipcSource, /fs:directorySizeProgress/);
  assert.match(ipcSource, /fs:cancelDirectorySize/);
  assert.match(preloadSource, /calculateDirectorySize:.*fs:calculateDirectorySize/);
  assert.match(preloadSource, /cancelDirectorySize:.*fs:cancelDirectorySize/);
  assert.match(preloadSource, /onDirectorySizeProgress/);
});
