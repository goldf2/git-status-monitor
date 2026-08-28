const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileService } = require('../src/main/services/fileService');
const { assertManagedWorkspacePath } = require('../src/main/ipc/filesystem');

test('文件系统 IPC 只接受真实受管路径并校验文件类型', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-fs-ipc-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(managedRoot);
  fs.mkdirSync(outsideRoot);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const directoryPath = path.join(managedRoot, 'project');
  const filePath = path.join(directoryPath, 'README.md');
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(filePath, 'readme');
  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });

  assert.equal(assertManagedWorkspacePath(directoryPath, ['directory'], service), directoryPath);
  assert.equal(assertManagedWorkspacePath(filePath, ['file'], service), filePath);
  assert.throws(
    () => assertManagedWorkspacePath(directoryPath, ['file'], service),
    /需要文件/
  );
  assert.throws(
    () => assertManagedWorkspacePath(outsideRoot, ['directory'], service),
    /受管位置/
  );
  assert.throws(
    () => assertManagedWorkspacePath(path.join(managedRoot, 'missing'), ['file'], service),
    /受管位置/
  );
});

test('文件系统 IPC 拒绝通过受管目录中的符号链接读取外部路径', { skip: process.platform === 'win32' }, (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-fs-ipc-link-'));
  const managedRoot = path.join(tempRoot, 'managed');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(managedRoot);
  fs.mkdirSync(outsideRoot);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const escapedPath = path.join(managedRoot, 'escaped');
  fs.symlinkSync(outsideRoot, escapedPath, 'dir');
  const service = new FileService({ getTreeRoots: () => [{ path: managedRoot }] });

  assert.throws(
    () => assertManagedWorkspacePath(escapedPath, ['directory'], service),
    /符号链接|受管位置/
  );
});

test('所有接收渲染层路径的旧文件系统入口统一经过真实路径校验', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main/ipc/filesystem.js'), 'utf8');
  for (const channel of [
    'fs:listDirectory',
    'fs:findGitRepos',
    'fs:getFileInfo',
    'fs:getReadmePreview',
    'fs:showInFinder',
    'fs:openFile',
    'fs:autoDetectTags',
    'fs:getDirSize'
  ]) {
    const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const handler = source.match(new RegExp(`ipcMain\\.handle\\('${escapedChannel}'[\\s\\S]*?\\n  \\}\\);`))?.[0] || '';
    assert.match(handler, /assertManagedWorkspacePath\(/, `${channel} 缺少受管路径校验`);
  }
});
