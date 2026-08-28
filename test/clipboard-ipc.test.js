const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileService } = require('../src/main/services/fileService');
const { copyManagedPathnames, MAX_PATHNAME_COUNT } = require('../src/main/ipc/clipboard');

test('复制路径名只写入真实受管文件并保持选择顺序', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-clipboard-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const firstPath = path.join(managedRoot, 'first.txt');
  const secondPath = path.join(managedRoot, 'second folder');
  fs.mkdirSync(secondPath, { recursive: true });
  fs.writeFileSync(firstPath, 'first');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });
  let clipboardText = '';
  const result = copyManagedPathnames([firstPath, secondPath, firstPath], {
    fileService: service,
    writeText: value => { clipboardText = value; }
  });

  assert.deepEqual(result, { count: 2 });
  assert.equal(clipboardText, `${firstPath}\n${secondPath}`);
});

test('复制路径名拒绝受管目录之外、空选择和异常批量请求', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-clipboard-boundary-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const outsidePath = path.join(tempRoot, 'outside.txt');
  fs.mkdirSync(managedRoot);
  fs.writeFileSync(outsidePath, 'outside');
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });
  const options = { fileService: service, writeText: () => assert.fail('不应写入剪贴板') };
  assert.throws(() => copyManagedPathnames([], options), /先选择/);
  assert.throws(() => copyManagedPathnames([outsidePath], options), /受管位置/);
  assert.throws(
    () => copyManagedPathnames(Array(MAX_PATHNAME_COUNT + 1).fill(outsidePath), options),
    /一次最多复制/
  );
});

test('Windows 路径名去重遵循大小写不敏感语义', () => {
  const resolved = new Map([
    ['C:\\Work\\Readme.md', 'C:\\Work\\Readme.md'],
    ['c:\\work\\README.md', 'c:\\work\\README.md']
  ]);
  const service = {
    resolveWorkspacePath(candidatePath) {
      return { ok: true, path: resolved.get(candidatePath), type: 'file' };
    }
  };
  let clipboardText = '';
  const result = copyManagedPathnames([...resolved.keys()], {
    fileService: service,
    platform: 'win32',
    writeText: value => { clipboardText = value; }
  });
  assert.deepEqual(result, { count: 1 });
  assert.equal(clipboardText, path.normalize('C:\\Work\\Readme.md'));
});
