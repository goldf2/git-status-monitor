const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FileBrowser = require('../src/renderer/scripts/fileBrowser');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
const selectionSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/directorySelectionController.js'), 'utf8');
const fileOperationDialogSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/fileOperationDialogController.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

const gridRects = [
  { left: 0, top: 0, width: 100, height: 72 },
  { left: 120, top: 0, width: 100, height: 72 },
  { left: 0, top: 96, width: 100, height: 72 },
  { left: 120, top: 96, width: 100, height: 72 }
];

const stripRects = [
  { left: 0, top: 0, width: 100, height: 72 },
  { left: 120, top: 0, width: 100, height: 72 },
  { left: 240, top: 0, width: 100, height: 72 }
];

test('图标视图方向键按可见几何关系移动，Home/End 到边界', () => {
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 0, 'ArrowRight', 'card'), 1);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 0, 'ArrowDown', 'card'), 2);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 3, 'ArrowLeft', 'card'), 2);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 3, 'ArrowUp', 'card'), 1);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 2, 'Home', 'card'), 0);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'End', 'card'), 3);
});

test('列表视图只用上下键按行移动，不抢占左右键', () => {
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'ArrowDown', 'list'), 2);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'ArrowUp', 'list'), 0);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'ArrowLeft', 'list'), null);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 3, 'ArrowDown', 'list'), 3);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'ArrowDown', 'column'), 2);
  assert.equal(FileBrowser.nextFileNavigationIndex(gridRects, 1, 'ArrowLeft', 'column'), null);
  assert.equal(FileBrowser.nextFileNavigationIndex(stripRects, 0, 'ArrowRight', 'gallery'), 1);
  assert.equal(FileBrowser.nextFileNavigationIndex(stripRects, 2, 'ArrowLeft', 'gallery'), 1);
});

test('文件项可通过游标焦点和方向键选择，并支持 Shift 范围选择', () => {
  assert.match(selectionSource, /fileKeyboardFocusPath/);
  assert.match(appSource, /handleFileKeyboardNavigation\(event\)/);
  assert.match(appSource, /aria-multiselectable="true"/);
  assert.match(appSource, /tabindex="\$\{focused \? '0' : '-1'\}"/);
  assert.match(selectionSource, /event\.shiftKey[\s\S]*?selectionAnchorPath/);
  assert.match(selectionSource, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
  assert.match(contentCss, /\.repo-card:focus-visible[\s\S]*?outline:/);
});

test('Windows Enter 打开选中项，仓库卡片不再平铺 Git 写操作', () => {
  assert.match(appSource, /window\.gitFinder\.platform !== 'darwin'\s*&&\s*event\.key === 'Enter'/);
  assert.doesNotMatch(appSource, /data-action="(?:pull|push|commit)"/);
  assert.doesNotMatch(appSource, /class="repo-actions"/);
});

test('文件操作对话框消费 Return 和 Escape，避免同一次按键再次触发目录快捷键', () => {
  assert.match(
    fileOperationDialogSource,
    /file-operation-input'[\s\S]*?event\.key === 'Enter'[\s\S]*?event\.preventDefault\?\.\(\);\s*event\.stopPropagation\?\.\(\);[\s\S]*?this\.submit\(\)/
  );
  assert.match(
    fileOperationDialogSource,
    /file-operation-input'[\s\S]*?event\.key === 'Escape'[\s\S]*?event\.preventDefault\?\.\(\);\s*event\.stopPropagation\?\.\(\);[\s\S]*?this\.close\(null\)/
  );
  assert.match(appSource, /handleFileKeyboardShortcut\(event\)\s*{\s*if \(event\.defaultPrevented\) return;/);
});
