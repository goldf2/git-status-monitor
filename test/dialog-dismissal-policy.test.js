const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererScripts = path.join(__dirname, '..', 'src', 'renderer', 'scripts');

const dialogSources = [
  'app.js',
  'batchRenameController.js',
  'contentFilterController.js',
  'directoryPerformanceController.js',
  'fileLabelController.js',
  'fileOperationDialogController.js',
  'projectTasks.js',
  'quickLookController.js',
  'relationshipBoardController.js',
  'smartCollectionsController.js'
];

test('有显式关闭控件的窗口不会因点击背景遮罩而关闭', () => {
  const forbiddenBackdropDismissals = [
    /event\.target\s*===\s*event\.currentTarget/,
    /event\.target\s*===\s*overlay/,
    /e\.target\s*===\s*overlay/,
    /event\.target\s*===\s*this\.modal/,
    /event\.target\s*!==\s*modal/,
    /event\.target\s*===\s*this\.element\(['"][^'"]+-modal['"]\)/
  ];

  for (const filename of dialogSources) {
    const source = fs.readFileSync(path.join(rendererScripts, filename), 'utf8');
    for (const pattern of forbiddenBackdropDismissals) {
      assert.doesNotMatch(source, pattern, `${filename} 不应通过背景遮罩关闭窗口`);
    }
  }
});

test('临时菜单仍保留点击外部收起行为', () => {
  const appSource = fs.readFileSync(path.join(rendererScripts, 'app.js'), 'utf8');
  assert.match(appSource, /document\.addEventListener\('click', \(\) => this\.closeToolbarMenus\(\)\)/);
  assert.match(appSource, /if \(!event\.target\.closest\('#file-context-menu'\)\) close\(\)/);
});
