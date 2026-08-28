const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
const app = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
const controller = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/quickLookController.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

test('Quick Look 提供可访问的连续浏览控件和方向键入口', () => {
  assert.match(html, /id="quick-look-prev-btn"[^>]+aria-label="预览上一项"[^>]+aria-keyshortcuts="ArrowLeft ArrowUp"/);
  assert.match(html, /id="quick-look-next-btn"[^>]+aria-label="预览下一项"[^>]+aria-keyshortcuts="ArrowRight ArrowDown"/);
  assert.match(html, /id="quick-look-position"[^>]+aria-live="polite"/);
  assert.match(controller, /quick-look-prev-btn[^\n]+navigate\(-1\)/);
  assert.match(controller, /quick-look-next-btn[^\n]+navigate\(1\)/);
  assert.match(app, /getNavigationState:\s*itemPath\s*=>\s*this\.getQuickLookNavigationState\(itemPath\)/);
  assert.match(app, /navigateItem:\s*\(direction, itemPath\)\s*=>\s*this\.selectQuickLookNavigationItem\(direction, itemPath\)/);
  assert.match(app, /restoreSelectionFocus:\s*itemPath\s*=>\s*this\.directorySelectionController\.focusPath\(itemPath\)/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'\]\.includes\(event\.key\)/);
  assert.match(app, /quickLookController\.navigate\(direction\)/);
  assert.match(contentCss, /\.quick-look-navigation/);
  assert.match(contentCss, /\.quick-look-position/);
});

test('Quick Look 相邻项目只来自当前完整显示顺序并同步目录单选', () => {
  assert.match(app, /const orderedPaths = AppState\.fileDisplayOrder\.length/);
  assert.match(app, /orderedPaths\.map\(itemPath => byPath\.get\(itemPath\)\)\.filter\(Boolean\)/);
  assert.match(app, /if \(!this\.selectSingleFileItem\(item\.path, \{ focus: false \}\)\) return null/);
  assert.match(app, /targetIndex < 0 \|\| targetIndex >= items\.length/);
});
