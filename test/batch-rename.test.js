const test = require('node:test');
const assert = require('node:assert/strict');

const BatchRename = require('../src/shared/batchRename');

test('替换文本只做字面匹配并可覆盖多处', () => {
  assert.equal(BatchRename.transformName(
    { name: 'draft-draft.md', isFile: true },
    { mode: 'replace', searchText: 'draft', replacementText: 'final' }
  ), 'final-final.md');
  assert.equal(BatchRename.transformName(
    { name: 'a[1].js', isFile: true },
    { mode: 'replace', searchText: '[1]', replacementText: '(1)' }
  ), 'a(1).js');
});

test('名称后添加文本保留文件扩展名，目录按完整名称处理', () => {
  assert.equal(BatchRename.transformName(
    { name: 'report.csv', isFile: true },
    { mode: 'add', text: '-review', placement: 'after' }
  ), 'report-review.csv');
  assert.equal(BatchRename.transformName(
    { name: 'assets', isFile: false },
    { mode: 'add', text: '-old', placement: 'after' }
  ), 'assets-old');
  assert.equal(BatchRename.transformName(
    { name: '.env', isFile: true },
    { mode: 'add', text: '.local', placement: 'after' }
  ), '.env.local');
});

test('格式化名称使用稳定序号并保留文件扩展名', () => {
  const options = { mode: 'format', formatName: '图片', startAt: 8, counterWidth: 3 };
  assert.equal(BatchRename.transformName({ name: 'a.png', isFile: true }, options, 0), '图片 008.png');
  assert.equal(BatchRename.transformName({ name: 'b.jpg', isFile: true }, options, 1), '图片 009.jpg');
});

test('损坏参数回退且空查找、空添加和空格式不能预览', () => {
  assert.equal(BatchRename.normalizeOptions({ mode: 'unknown', startAt: -1 }).mode, 'replace');
  assert.equal(BatchRename.validateOptions({ mode: 'replace', searchText: '' }).ok, false);
  assert.equal(BatchRename.validateOptions({ mode: 'add', text: '' }).ok, false);
  assert.equal(BatchRename.validateOptions({ mode: 'format', formatName: '   ' }).ok, false);
});
