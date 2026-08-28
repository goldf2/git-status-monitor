const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DirectoryViewPreferences = require('../src/renderer/scripts/directoryViewPreferences');

test('目录偏好路径只接受绝对路径，并按平台稳定规范化', () => {
  assert.equal(DirectoryViewPreferences.normalizePathKey('/Volumes/project/app/', 'darwin'), '/Volumes/project/app');
  assert.equal(DirectoryViewPreferences.normalizePathKey('/', 'darwin'), '/');
  assert.equal(DirectoryViewPreferences.normalizePathKey('relative/path', 'darwin'), '');
  assert.equal(DirectoryViewPreferences.normalizePathKey('/tmp/bad\0path', 'darwin'), '');

  assert.equal(
    DirectoryViewPreferences.normalizePathKey('C:/Users/Dev/Project/', 'win32'),
    'c:\\users\\dev\\project'
  );
  assert.equal(
    DirectoryViewPreferences.normalizePathKey('\\\\Server\\Share\\Folder\\', 'win32'),
    '\\\\server\\share\\folder'
  );
  assert.equal(DirectoryViewPreferences.normalizePathKey('project\\src', 'win32'), '');
});

test('损坏目录偏好会被丢弃，Windows 大小写重复项保留最新记录', () => {
  const normalized = DirectoryViewPreferences.normalizeStore({
    'C:\\Work\\App': { style: 'card', sortBy: 'name', sortOrder: 'asc', updatedAt: 10 },
    'c:\\work\\app\\': { style: 'list', sortBy: 'time', sortOrder: 'desc', updatedAt: 20 },
    relative: { style: 'list', sortBy: 'name', sortOrder: 'asc', updatedAt: 30 },
    'C:\\Work\\Broken': { style: 'tiles', sortBy: 'name', sortOrder: 'asc', updatedAt: 40 }
  }, { platform: 'win32', now: 100 });

  assert.deepEqual(normalized, {
    'c:\\work\\app': { style: 'list', sortBy: 'time', sortOrder: 'desc', updatedAt: 20 }
  });
});

test('目录偏好使用全局默认回退，并只覆盖命中的目录', () => {
  const defaults = { style: 'card', sortBy: 'name', sortOrder: 'asc', columnWidth: 260 };
  const store = DirectoryViewPreferences.rememberDirectory({}, '/workspace/a', {
    style: 'list', sortBy: 'size', sortOrder: 'desc', columnWidth: 320
  }, { platform: 'darwin', now: 50 });

  assert.deepEqual(
    DirectoryViewPreferences.preferenceForDirectory(store, '/workspace/a/', defaults, { platform: 'darwin', now: 100 }),
    { style: 'list', sortBy: 'size', sortOrder: 'desc', columnWidth: 320 }
  );
  assert.deepEqual(
    DirectoryViewPreferences.preferenceForDirectory(store, '/workspace/b', defaults, { platform: 'darwin', now: 100 }),
    defaults
  );

  const columnStore = DirectoryViewPreferences.rememberDirectory(store, '/workspace/columns', {
    style: 'column', sortBy: 'name', sortOrder: 'asc'
  }, { platform: 'darwin', now: 60 });
  assert.equal(
    DirectoryViewPreferences.preferenceForDirectory(columnStore, '/workspace/columns', defaults, { platform: 'darwin', now: 100 }).style,
    'column'
  );

  const galleryStore = DirectoryViewPreferences.rememberDirectory(columnStore, '/workspace/gallery', {
    style: 'gallery', sortBy: 'time', sortOrder: 'desc'
  }, { platform: 'darwin', now: 70 });
  assert.deepEqual(
    DirectoryViewPreferences.preferenceForDirectory(galleryStore, '/workspace/gallery', defaults, { platform: 'darwin', now: 100 }),
    { style: 'gallery', sortBy: 'time', sortOrder: 'desc', columnWidth: 260 }
  );
});

test('分栏宽度限制在安全范围，并支持拖拽和键盘调整', () => {
  assert.equal(DirectoryViewPreferences.normalizeColumnWidth(''), 260);
  assert.equal(DirectoryViewPreferences.normalizeColumnWidth(120), 180);
  assert.equal(DirectoryViewPreferences.normalizeColumnWidth(900), 520);
  assert.equal(DirectoryViewPreferences.columnWidthFromDrag(260, 100, 145), 305);
  assert.equal(DirectoryViewPreferences.columnWidthFromDrag(500, 100, 200), 520);
  assert.equal(DirectoryViewPreferences.columnWidthFromKey(260, 'ArrowLeft'), 244);
  assert.equal(DirectoryViewPreferences.columnWidthFromKey(260, 'ArrowRight', { shiftKey: true }), 308);
  assert.equal(DirectoryViewPreferences.columnWidthFromKey(260, 'Home'), 180);
  assert.equal(DirectoryViewPreferences.columnWidthFromKey(260, 'End'), 520);
  assert.equal(DirectoryViewPreferences.columnWidthFromKey(260, 'Enter'), null);
});

test('旧目录偏好没有列宽时沿用全局值，非法列宽不会污染记录', () => {
  const legacyStore = {
    '/workspace/legacy': { style: 'column', sortBy: 'name', sortOrder: 'asc', updatedAt: 10 },
    '/workspace/broken': { style: 'column', sortBy: 'name', sortOrder: 'asc', columnWidth: 'wide', updatedAt: 20 }
  };
  assert.equal(
    DirectoryViewPreferences.preferenceForDirectory(legacyStore, '/workspace/legacy', {
      style: 'card', sortBy: 'name', sortOrder: 'asc', columnWidth: 280
    }, { platform: 'darwin', now: 100 }).columnWidth,
    280
  );
  assert.equal(
    DirectoryViewPreferences.normalizeStore(legacyStore, { platform: 'darwin', now: 100 })['/workspace/broken'].columnWidth,
    undefined
  );
});

test('目录偏好按最近使用时间限制为 500 项', () => {
  let store = {};
  for (let index = 0; index < 505; index += 1) {
    store[`/workspace/${index}`] = {
      style: index % 2 ? 'list' : 'card',
      sortBy: 'name',
      sortOrder: 'asc',
      updatedAt: index + 1
    };
  }
  const normalized = DirectoryViewPreferences.normalizeStore(store, { platform: 'darwin', now: 1000 });
  assert.equal(Object.keys(normalized).length, DirectoryViewPreferences.MAX_ENTRIES);
  assert.equal(Object.hasOwn(normalized, '/workspace/0'), false);
  assert.equal(Object.hasOwn(normalized, '/workspace/504'), true);
});

test('设置页、目录切换和路径重绑定接入同一目录偏好模型', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const navigationSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/directoryNavigationController.js'), 'utf8');
  const configSource = fs.readFileSync(path.join(projectRoot, 'src/main/services/configService.js'), 'utf8');

  assert.ok(html.indexOf('scripts/directoryViewPreferences.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /id="settings-remember-directory-views"/);
  assert.match(appSource, /persistCurrentDirectoryViewPreference\(\)/);
  assert.match(navigationSource, /applyDirectoryViewPreference\(path, 'tree'\)/);
  assert.match(appSource, /DirectoryViewPreferences\.rememberDirectory/);
  assert.match(appSource, /<option value="column"[^>]*>分栏<\/option>/);
  assert.match(appSource, /<option value="gallery"[^>]*>图库<\/option>/);
  assert.match(appSource, /每个目录分别保存视图、排列方式和分栏宽度/);
  assert.match(appSource, /id="settings-column-view-width"/);
  assert.match(appSource, /bindColumnViewSizing\(browser\)/);
  assert.match(appSource, /role="separator"[^>]+aria-orientation="vertical"/);
  assert.match(configSource, /rememberDirectoryViewPreferences:\s*false/);
  assert.match(configSource, /columnViewWidth:\s*260/);
  assert.match(configSource, /\['projectControlSelections', 'markdownDocumentSelections', 'directoryViewPreferences'\]/);
});
