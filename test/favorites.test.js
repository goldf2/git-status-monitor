const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

test('收藏夹写入通过受信主进程切换受管目录，不再借用仓库标签', () => {
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'ipc', 'config.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');

  assert.match(preloadSource, /toggleFavoriteDirectory:.*config:toggleFavoriteDirectory/);
  assert.match(ipcSource, /config:toggleFavoriteDirectory[\s\S]*configService\.toggleFavoriteDirectory/);
  assert.match(appSource, /toggleFavoritePath[\s\S]*config\.toggleFavoriteDirectory/);
  assert.doesNotMatch(appSource, /tags\.create\('收藏'/);
});

test('普通文件夹可从操作菜单、右键菜单和详情加入侧栏收藏夹', () => {
  const htmlSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');
  const detailSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'scripts', 'fileSelectionDetailController.js'), 'utf8');

  assert.match(htmlSource, /id="file-favorite"[\s\S]*data-context-action="favorite"/);
  assert.match(appSource, /file-favorite[\s\S]*toggleSelectedFavorite/);
  assert.match(detailSource, /data-detail-action="toggle-favorite"/);
  assert.match(appSource, /file-context-favorite-label[\s\S]*isFavoritePath/);
});

test('侧栏收藏夹批量识别普通、Git 和项目文件夹并标记失效位置', () => {
  const preloadSource = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const filesystemIpcSource = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'ipc', 'filesystem.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');

  assert.match(preloadSource, /getFavoriteDirectoryInfos:.*fs:getFavoriteDirectoryInfos/);
  assert.match(filesystemIpcSource, /fs:getFavoriteDirectoryInfos[\s\S]*fileService\.inspectFavoriteDirectories/);
  assert.match(appSource, /loadFavorites[\s\S]*getFavoriteDirectoryInfos[\s\S]*getItemKindIconHtml/);
  assert.match(appSource, /is-unavailable[\s\S]*位置不可用/);
});

test('系统快捷位置先核对受管范围，未授权位置不能绕过目录读取边界', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'scripts', 'app.js'), 'utf8');

  assert.match(appSource, /loadFavorites[\s\S]*inspectWorkspaceDirectories\(\(quickLocs/);
  assert.match(appSource, /快捷位置尚未授权[\s\S]*添加目录/);
  assert.match(appSource, /const unavailable = !item\.available/);
});
