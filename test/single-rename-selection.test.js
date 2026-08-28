const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/scripts/app.js'),
  'utf8'
);

test('单项重命名记录操作结果并在刷新后重新定位目标', () => {
  assert.match(
    appSource,
    /async renameSelectedItem\(\)[\s\S]*?let operation = null;[\s\S]*?operation = await window\.gitFinder\.fileOps\.rename\(item\.path, nextName\)[\s\S]*?if \(success\) await this\.revealCreatedFileOperation\(operation, item\.type\)/
  );
});

test('普通文件重命名保护扩展名，文件夹仍全选完整名称', () => {
  assert.match(
    appSource,
    /title: '重命名',[\s\S]*?value: item\.name,[\s\S]*?selectBaseName: item\.type === 'file'/
  );
});

test('文件操作目标定位同步选择、键盘锚点并聚焦新路径卡片', () => {
  assert.match(
    appSource,
    /async revealCreatedFileOperation[\s\S]*?selectedPaths = new Set\(\[target\]\)[\s\S]*?selectionAnchorPath = target[\s\S]*?fileKeyboardFocusPath = target/
  );
  assert.match(
    appSource,
    /querySelector\(`\[data-path="\$\{this\.cssEscape\(target\)\}"\]`\)[\s\S]*?focus\(\{ preventScroll: true \}\)[\s\S]*?scrollIntoView\(\{ block: 'nearest' \}\)/
  );
});
