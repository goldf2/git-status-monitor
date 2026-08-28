const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseUnifiedDiff,
  buildSelectionPatch
} = require('../src/shared/gitPatchSelection');

const TWO_HUNK_DIFF = [
  'diff --git a/sample.txt b/sample.txt',
  'index 12ab34c..56de78f 100644',
  '--- a/sample.txt',
  '+++ b/sample.txt',
  '@@ -1,4 +1,4 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  '@@ -8,4 +8,4 @@ seven',
  ' eight',
  '-nine',
  '+NINE',
  ' ten',
  ' eleven',
  ''
].join('\n');

test('统一 diff 解析为稳定的可选择行身份和原始行号', () => {
  const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);

  assert.equal(parsed.supported, true, parsed.reason);
  assert.equal(parsed.hunks.length, 2);
  assert.deepEqual(parsed.changedLines.map(line => ({
    id: line.id,
    type: line.type,
    oldLine: line.oldLine,
    newLine: line.newLine,
    content: line.content
  })), [
    { id: 'h0:l1', type: 'deletion', oldLine: 2, newLine: null, content: 'two' },
    { id: 'h0:l2', type: 'addition', oldLine: null, newLine: 2, content: 'TWO' },
    { id: 'h1:l1', type: 'deletion', oldLine: 9, newLine: null, content: 'nine' },
    { id: 'h1:l2', type: 'addition', oldLine: null, newLine: 9, content: 'NINE' }
  ]);
});

test('选择首个替换时省略第二个 hunk，并重新计算补丁范围', () => {
  const result = buildSelectionPatch(TWO_HUNK_DIFF, ['h0:l1', 'h0:l2']);

  assert.equal(result.selectedLineCount, 2);
  assert.equal(result.additionCount, 1);
  assert.equal(result.deletionCount, 1);
  assert.match(result.patch, /@@ -1,4 \+1,4 @@/);
  assert.match(result.patch, /-two\n\+TWO/);
  assert.doesNotMatch(result.patch, /nine|NINE/);
});

test('单独选择新增或删除行时生成可应用的最小语义补丁', () => {
  const addition = buildSelectionPatch(TWO_HUNK_DIFF, ['h0:l2']);
  const deletion = buildSelectionPatch(TWO_HUNK_DIFF, ['h0:l1']);

  assert.match(addition.patch, / two\n\+TWO/);
  assert.doesNotMatch(addition.patch, /-two/);
  assert.match(deletion.patch, /-two/);
  assert.doesNotMatch(deletion.patch, /\+TWO/);
});

test('拒绝未知行身份、空选择和二进制 diff', () => {
  assert.throws(() => buildSelectionPatch(TWO_HUNK_DIFF, []), /至少选择/);
  assert.throws(() => buildSelectionPatch(TWO_HUNK_DIFF, ['h9:l9']), /不存在|无效/);
  const parsed = parseUnifiedDiff('diff --git a/a.bin b/a.bin\nBinary files a/a.bin and b/a.bin differ\n');
  assert.equal(parsed.supported, false);
  assert.match(parsed.reason, /二进制/);
});
