const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseZipCentralDirectory,
  readZipPreview,
  ZipPreviewError
} = require('../src/main/services/zipPreview');

function createZip(entries = []) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content || '', 'utf8');
    const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.name.endsWith('/') ? 0x10 : 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('ZIP 中央目录只读解析条目、目录、体积和加密状态', () => {
  const archive = createZip([
    { name: 'src/' },
    { name: 'src/index.js', content: 'console.log(1)' },
    { name: '<script>.txt', content: 'safe' },
    { name: 'secret.env', content: 'TOKEN=x', encrypted: true }
  ]);
  const preview = parseZipCentralDirectory(archive, { maxPreviewEntries: 3 });

  assert.equal(preview.totalEntries, 4);
  assert.equal(preview.directoryCount, 1);
  assert.equal(preview.fileCount, 3);
  assert.equal(preview.encryptedCount, 1);
  assert.equal(preview.totalUncompressedSize, 25);
  assert.equal(preview.entries.length, 3);
  assert.equal(preview.truncated, true);
  assert.equal(preview.entries[0].name, 'src/');
  assert.equal(preview.entries[1].method, '存储');
});

test('ZIP 预览拒绝损坏、分卷和 Zip64 目录，不把它们当普通文本', () => {
  assert.throws(
    () => parseZipCentralDirectory(Buffer.from('not-a-zip')),
    error => error instanceof ZipPreviewError && error.code === 'ZIP_EOCD_NOT_FOUND'
  );

  const splitArchive = createZip([]);
  splitArchive.writeUInt16LE(1, splitArchive.length - 18);
  assert.throws(
    () => parseZipCentralDirectory(splitArchive),
    error => error instanceof ZipPreviewError && error.code === 'ZIP_MULTIDISK_UNSUPPORTED'
  );

  const zip64Archive = createZip([]);
  zip64Archive.writeUInt16LE(0xffff, zip64Archive.length - 12);
  assert.throws(
    () => parseZipCentralDirectory(zip64Archive),
    error => error instanceof ZipPreviewError && error.code === 'ZIP64_UNSUPPORTED'
  );
});

test('ZIP 文件读取只访问尾部和受限中央目录并返回稳定摘要', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-zip-preview-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const archivePath = path.join(temporaryRoot, 'demo.zip');
  fs.writeFileSync(archivePath, createZip([
    { name: 'README.md', content: '# Demo' },
    { name: 'src/app.js', content: 'export default 1' }
  ]));

  const stat = fs.statSync(archivePath);
  const preview = await readZipPreview(archivePath, stat);
  assert.equal(preview.totalEntries, 2);
  assert.equal(preview.fileCount, 2);
  assert.deepEqual(preview.entries.map(entry => entry.name), ['README.md', 'src/app.js']);
});
