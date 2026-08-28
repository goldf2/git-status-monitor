const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FileBrowser = require('../src/renderer/scripts/fileBrowser');

const items = [
  { path: '/workspace/docs', type: 'directory', isGitRepo: false },
  { path: '/workspace/app', type: 'directory', isGitRepo: true },
  { path: '/workspace/product', type: 'directory', isGitRepo: true, isProject: true, project: { color: 'purple', lifecycle: 'active' } },
  { path: '/workspace/notes.md', type: 'file', isGitRepo: false },
  { path: '/workspace/link', type: 'symlink', isGitRepo: false }
];

test('目录语义与 Git 属性分离，文件夹筛选包含带 Git 角标的目录', () => {
  assert.deepEqual(FileBrowser.filterDirectoryItems(items, 'directory').map(item => item.path), ['/workspace/docs', '/workspace/app', '/workspace/product']);
  assert.deepEqual(FileBrowser.filterDirectoryItems(items, 'project').map(item => item.path), ['/workspace/product']);
  assert.deepEqual(FileBrowser.filterDirectoryItems(items, 'repository').map(item => item.path), ['/workspace/app', '/workspace/product']);
  assert.deepEqual(FileBrowser.filterDirectoryItems(items, 'file').map(item => item.path), ['/workspace/notes.md']);
  assert.equal(FileBrowser.filterDirectoryItems(items, 'all').length, 5);
});

test('视觉类型只表达普通文件夹或项目，Git 作为可叠加属性', () => {
  assert.equal(FileBrowser.itemVisualKind(items[0]), 'directory');
  assert.equal(FileBrowser.itemVisualKind(items[1]), 'directory');
  assert.equal(FileBrowser.itemVisualKind(items[2]), 'project');
  assert.equal(FileBrowser.itemVisualKind(items[3]), 'file');
  assert.equal(FileBrowser.itemVisualKind(items[4]), 'symlink');
  assert.equal(FileBrowser.itemVisualKind({ type: 'unknown' }), 'other');
});

test('项目文件夹使用配置颜色，Git 仓库仅叠加分支角标', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const themeCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/theme.css'), 'utf8');
  const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  const sidebarCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/sidebar.css'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const sidebarTreeSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/sidebarTreeController.js'), 'utf8');

  assert.match(themeCss, /--folder-color:\s*#[0-9a-f]{6}/i);
  assert.match(contentCss, /\.file-kind-directory\s*\{[^}]*color:\s*var\(--folder-color\)/s);
  assert.match(contentCss, /\.file-kind-project\s*\{[^}]*color:\s*var\(--project-folder-color/);
  assert.match(appSource, /class="file-kind-git-badge"[\s\S]*?<circle/);
  assert.doesNotMatch(appSource, /file-kind-git-badge">git</);
  assert.match(sidebarTreeSource, /getItemKindIconHtml\(directoryItem, 'tree-node-icon'\)/);
  assert.match(sidebarTreeSource, /renderNode\(child\.path, child\.name, false, depth \+ 1/);
  assert.match(appSource, /_renderTreeNode[\s\S]*sidebarTreeController\.renderNode/);
  assert.doesNotMatch(sidebarCss, /\.tree-node\.is-git\s+\.tree-node-icon\s*\{/);
  assert.equal(FileBrowser.projectColor(items[2]), '#af52de');
  assert.equal(FileBrowser.projectColor({ isProject: true, project: { color: 'unsafe' } }), '#007aff');
  assert.equal(FileBrowser.projectColor({ isProject: true, project: { color: 'unsafe' } }, '#0a84ff'), '#0a84ff');
  assert.equal(FileBrowser.projectLifecycleKey(items[2]), 'active');
});

test('仓库搜索元数据展示会去重、限量并清理异常内容', () => {
  const presentation = FileBrowser.repositoryMetadataPresentation({
    isGitRepo: true,
    groups: [
      { name: 'AI\u0000工具', color: '#7357bd' },
      { name: 'AI 工具', color: '#7357bd' }
    ],
    tags: [
      { name: '重点维护', color: 'red' },
      { name: '本地优先', color: '#007aff' }
    ]
  }, 2);

  assert.deepEqual(presentation.chips, [
    { kind: 'group', label: '组：AI 工具', color: '#7357bd' },
    { kind: 'tag', label: '#重点维护', color: '#86868b' }
  ]);
  assert.equal(presentation.hiddenCount, 1);
  assert.equal(presentation.title, '组：AI 工具 · #重点维护 · #本地优先');
  assert.deepEqual(FileBrowser.repositoryMetadataPresentation({ type: 'directory' }), {
    chips: [], hiddenCount: 0, title: ''
  });
});

test('全局搜索结果以第二行元数据胶囊展示分类和标签', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(contentCss, /\.global-search-location\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(contentCss, /\.global-search-metadata-chip/);
  assert.match(appSource, /repositoryMetadataPresentation\(item, 3\)/);
  assert.match(appSource, /global-search-metadata-chip metadata-\$\{chip\.kind\}/);
});

test('全局文件内容搜索是显式模式并展示隐私边界和匹配片段', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/content.js'), 'utf8');

  assert.match(appSource, /\['metadata', '名称与路径'\], \['content', '文件内容'\]/);
  assert.match(appSource, /文件内容不写入索引/);
  assert.match(appSource, /class="global-search-snippet"/);
  assert.match(appSource, /escapeHtml\(contentMatch\.snippet \|\| ''\)/);
  assert.match(appSource, /mode:\s*AppState\.globalSearchMode/);
  assert.match(contentCss, /\.global-search-mode\.active/);
  assert.match(contentCss, /\.global-search-snippet/);
  assert.match(contentCss, /\.global-search-filter,\s*\.global-search-mode\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(contentCss, /@media \(max-width:\s*760px\)[\s\S]*?\.global-search-controls\s*\{[^}]*width:\s*100%/s);
  assert.match(preload, /cancelSearch:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('content:cancelSearch'\)/);
  assert.match(ipc, /content:cancelSearch/);
});

test('目录类型计数保留全部项目并忽略未分类类型的小计', () => {
  assert.deepEqual(FileBrowser.countDirectoryItems(items), {
    all: 5,
    directory: 3,
    project: 1,
    repository: 2,
    file: 1
  });
});

test('损坏的目录类型设置回退为全部', () => {
  assert.equal(FileBrowser.normalizeDirectoryType('archive'), 'all');
  assert.equal(FileBrowser.normalizeDirectoryType('project'), 'project');
  assert.equal(FileBrowser.normalizeDirectoryType('repository'), 'repository');
});

test('只把来自系统的 Files 拖放识别为外部导入', () => {
  assert.equal(FileBrowser.isExternalFileDrag({ types: ['Files'] }), true);
  assert.equal(FileBrowser.isExternalFileDrag({ types: ['Files', FileBrowser.INTERNAL_DRAG_TYPE] }), false);
  assert.equal(FileBrowser.isExternalFileDrag({ types: ['text/plain'] }), false);
});

test('拖入路径去重、忽略空值并受数量上限约束', () => {
  assert.deepEqual(FileBrowser.uniqueDroppedPaths([' /tmp/a ', '/tmp/a', '', '/tmp/b'], 2), ['/tmp/a', '/tmp/b']);
});

test('内部拖拽使用平台熟悉的修饰键在移动与复制之间即时切换', () => {
  assert.equal(FileBrowser.internalDragMode({ altKey: false, ctrlKey: false }, 'darwin'), 'move');
  assert.equal(FileBrowser.internalDragMode({ altKey: true, ctrlKey: false }, 'darwin'), 'copy');
  assert.equal(FileBrowser.internalDragMode({ altKey: false, ctrlKey: true }, 'darwin'), 'move');
  assert.equal(FileBrowser.internalDragMode({ altKey: false, ctrlKey: true }, 'win32'), 'copy');
  assert.equal(FileBrowser.internalDragMode({ altKey: true, ctrlKey: false }, 'win32'), 'move');
  assert.equal(FileBrowser.internalDragMode({ ctrlKey: true }, 'linux'), 'copy');
  assert.equal(FileBrowser.internalDragModifierHint('darwin'), '按住 ⌥ 可复制');
  assert.equal(FileBrowser.internalDragModifierHint('win32'), '按住 Ctrl 可复制');
});

test('拖拽复制允许在原目录制作副本，但移动仍拒绝原地空操作和自嵌套', () => {
  const sourcePaths = ['/workspace/app', '/workspace/readme.md'];
  assert.equal(FileBrowser.canDropPathsToDirectory(sourcePaths, '/workspace', 'move', 'darwin'), false);
  assert.equal(FileBrowser.canDropPathsToDirectory(sourcePaths, '/workspace', 'copy', 'darwin'), true);
  assert.equal(FileBrowser.canDropPathsToDirectory(['/workspace/app'], '/workspace/app', 'copy', 'darwin'), false);
  assert.equal(FileBrowser.canDropPathsToDirectory(['/workspace/app'], '/workspace/app/src', 'copy', 'darwin'), false);
  assert.equal(FileBrowser.canDropPathsToDirectory(['C:\\Work\\App'], 'c:\\work', 'copy', 'win32'), true);
  assert.equal(FileBrowser.canDropPathsToDirectory(['C:\\Work\\App'], 'c:\\WORK', 'move', 'win32'), false);
  assert.equal(FileBrowser.canDropPathsToDirectory(['C:\\Work\\App'], 'c:\\work\\APP\\src', 'copy', 'win32'), false);
});

test('内部拖拽把 copyMove 和最终模式交给既有零写入传输预览', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  assert.match(appSource, /effectAllowed\s*=\s*'copyMove'/);
  assert.match(appSource, /internalDragMode\(event, window\.gitFinder\.platform\)/);
  assert.match(appSource, /openTransferReview\(paths, target\.path, mode\)/);
});

test('窄窗口会按可缩空间约束两侧面板并保留中央工作区', () => {
  assert.deepEqual(FileBrowser.constrainPanelWidths(800, 500, 700), {
    sidebarWidth: 200,
    detailWidth: 269
  });
  assert.deepEqual(FileBrowser.constrainPanelWidths(1440, 240, 320), {
    sidebarWidth: 240,
    detailWidth: 320
  });
});

test('分栏路径从最深受管根展开并限制可见列数', () => {
  assert.deepEqual(
    FileBrowser.columnDirectoryPaths(
      [{ path: '/Volumes/project' }, { path: '/Volumes/project/work' }],
      '/Volumes/project/work/app/src/components',
      'darwin',
      6
    ),
    [
      '/Volumes/project/work',
      '/Volumes/project/work/app',
      '/Volumes/project/work/app/src',
      '/Volumes/project/work/app/src/components'
    ]
  );
  assert.deepEqual(
    FileBrowser.columnDirectoryPaths(['/workspace'], '/workspace/a/b/c/d/e/f/g', 'darwin', 4),
    ['/workspace/a/b/c/d', '/workspace/a/b/c/d/e', '/workspace/a/b/c/d/e/f', '/workspace/a/b/c/d/e/f/g']
  );
});

test('Windows 分栏路径忽略大小写并保留盘符与 UNC 结构', () => {
  assert.deepEqual(
    FileBrowser.columnDirectoryPaths(['C:\\Work'], 'c:\\work\\App\\src', 'win32'),
    ['C:\\Work', 'C:\\Work\\App', 'C:\\Work\\App\\src']
  );
  assert.deepEqual(
    FileBrowser.columnDirectoryPaths(['\\\\Server\\Share'], '\\\\server\\share\\Team\\Repo', 'win32'),
    ['\\\\Server\\Share', '\\\\Server\\Share\\Team', '\\\\Server\\Share\\Team\\Repo']
  );
  assert.deepEqual(FileBrowser.columnDirectoryPaths(['/workspace'], 'relative/path', 'darwin'), []);
});
