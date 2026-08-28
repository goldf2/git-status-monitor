const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
const mainCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/main.css'), 'utf8');
const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

test('Finder 风格工具栏提供明确的后退、前进和上级目录导航', () => {
  assert.match(html, /class="finder-nav-group"/);
  assert.match(html, /id="btn-back"[^>]+aria-label="返回上一位置"[^>]+title="后退 \(⌘\[\)"/);
  assert.match(html, /id="btn-forward"[^>]+aria-label="前往下一位置"[^>]+title="前进 \(⌘\]\)"/);
  assert.match(html, /id="btn-up"[^>]+aria-label="前往上级目录"/);
  assert.match(appSource, /primaryKey\s*=\s*event\.metaKey\s*\|\|\s*\(window\.gitFinder\.platform\s*!==\s*'darwin'\s*&&\s*event\.ctrlKey\)/);
  assert.match(appSource, /primaryKey\s*&&\s*event\.key\s*===\s*'\['/);
  assert.match(appSource, /primaryKey\s*&&\s*event\.key\s*===\s*'\]'/);
});

test('视图、新建、文件操作和显示选项使用可访问下拉菜单', () => {
  for (const id of ['view-menu-trigger', 'file-create-menu-trigger', 'file-actions-menu-trigger', 'sort-menu-trigger']) {
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"`));
  }
  for (const id of ['view-menu', 'file-create-menu', 'file-actions-menu', 'sort-menu']) {
    assert.match(html, new RegExp(`id="${id}"[^>]+role="menu"[^>]+hidden`));
  }
  assert.doesNotMatch(html, /class="view-switcher"/);
  assert.match(appSource, /setupToolbarMenus\(\)/);
  assert.match(appSource, /closeToolbarMenus\(/);
  assert.match(appSource, /\.sort-btn\[data-sort\]/);
  assert.match(html, /id="toggle-hidden-files"[^>]+role="menuitemcheckbox"[^>]+aria-checked="false"/);
  assert.match(html, /显示隐藏项目<\/span><kbd>⌘⇧\.<\/kbd>/);
});

test('顶层工作区只保留结构不同的页面，项目与仓库筛选明确标注范围', () => {
  const viewMenu = html.match(/<div class="finder-menu" id="view-menu"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(viewMenu, /data-view="tree"[\s\S]*?>文件浏览</);
  assert.match(viewMenu, /data-view="dashboard"[\s\S]*?>仪表盘</);
  assert.match(viewMenu, /data-view="tasks"[\s\S]*?>开发任务</);
  assert.doesNotMatch(viewMenu, /data-view="projects"|data-view="grid"/);
  assert.match(html, /class="finder-menu-heading" id="directory-filter-scope-heading">当前目录<\/div>/);
  assert.match(html, /class="finder-menu-heading">属性（可组合）<\/div>/);
  assert.match(html, /class="finder-menu-heading">所有受管位置<\/div>/);
  assert.match(appSource, /`当前目录 · \$\{label\} \$\{count\}\$\{advancedSuffix\}`/);
  assert.match(appSource, /`所有位置 · 项目 \$\{projectCount\}\$\{advancedSuffix\}`/);
  assert.match(appSource, /`所有位置 · Git 仓库 \$\{repositoryCount\}\$\{advancedSuffix\}`/);
});

test('仓库分类移入内容筛选下拉，左侧只保留访达式标签', () => {
  assert.doesNotMatch(html, /id="groups-sidebar-section"|<span class="sidebar-title-text">仓库分类<\/span>/);
  assert.match(html, /id="category-filter-btn"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(html, /id="category-filter-dropdown"[^>]+role="menu"[^>]+hidden/);
  assert.match(html, /id="groups-list"/);
  assert.match(html, /id="add-group-bottom-btn"[^>]+role="menuitem"/);
  assert.match(html, /id="tags-sidebar-section"[\s\S]*?<span class="sidebar-title-text">仓库标签<\/span>/);
  assert.doesNotMatch(html, /<span class="sidebar-title-text">项目分类<\/span>/);
  assert.match(appSource, /ContentQuery\.showsRepositoryMetadata\(/);
  assert.match(appSource, /setActiveRepositoryCategory\(category\)/);
  assert.match(appSource, /repositoryCategory:\s*normalized/);
  assert.match(appSource, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(appSource, /tagsSection\.style\.display\s*=\s*repositoryMetadataContext \? '' : 'none'/);
});

test('全局内容筛选可保存为本机智能集合并从侧栏恢复', () => {
  assert.match(html, /id="content-filter-save-collection"[^>]+role="menuitem"[^>]+disabled/);
  assert.match(html, /id="smart-collections-sidebar-section"[^>]+data-section-id="smart-collections"[^>]+hidden/);
  assert.match(html, /id="smart-collection-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(html, /id="smart-collection-context-menu"[^>]+role="menu"[^>]+hidden/);
  assert.match(html, /data-smart-collection-action="rename"[^>]+role="menuitem"/);
  assert.match(html, /data-smart-collection-action="move-up"[^>]+role="menuitem"/);
  assert.match(html, /data-smart-collection-action="move-down"[^>]+role="menuitem"/);
  assert.match(html, /data-smart-collection-action="remove"[^>]+role="menuitem"/);
  assert.match(html, /只保存本机筛选条件，不复制文件，也不会修改 Git 或项目配置/);
  assert.ok(html.indexOf('scripts/smartCollections.js') < html.indexOf('scripts/smartCollectionsController.js'));
  assert.ok(html.indexOf('scripts/smartCollectionsController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupSmartCollectionsController\(\)/);
  assert.match(appSource, /await this\.smartCollectionsController\.load\(\)/);
  assert.match(appSource, /smartCollectionsController\?\.updateControls\(\)/);
  assert.match(appSource, /id === 'smart-collections'[\s\S]*?locationsIndex \+ 1/);
});

test('更多筛选使用独立可访问弹窗并在标签页内保存高级条件', () => {
  assert.match(html, /id="content-filter-more"[^>]+role="menuitem"/);
  assert.match(html, /id="content-filter-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(html, /id="content-filter-title">更多内容筛选</);
  assert.match(html, /name="content-filter-lifecycle"/);
  assert.match(html, /name="content-filter-git-status"/);
  assert.match(html, /id="content-filter-extensions"/);
  assert.match(html, /id="content-filter-modified"/);
  assert.match(html, /id="content-filter-modified-from"[^>]+type="date"/);
  assert.match(html, /id="content-filter-modified-to"[^>]+type="date"/);
  assert.match(html, /id="content-filter-size"/);
  assert.match(html, /id="content-filter-size-min"[^>]+type="number"/);
  assert.match(html, /id="content-filter-size-max"[^>]+type="number"/);
  assert.match(html, /id="content-filter-file-label-section"/);
  assert.match(html, /id="content-filter-file-labels"/);
  assert.ok(html.indexOf('scripts/contentFilterController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupContentFilterController\(\)/);
  assert.match(appSource, /advancedFilterCount\(query\)/);
  assert.match(appSource, /modifiedTime:\s*project\.modifiedTime/);
  assert.match(appSource, /filtered = filtered\.filter\(repo => window\.ContentQuery\.matchesAttributes/);
});

test('文件标签从目录操作进入并与仓库标签、项目颜色保持独立', () => {
  assert.match(html, /id="file-labels"[^>]+>\s*<span>分配标签…<\/span>/);
  assert.match(html, /data-context-action="labels"/);
  assert.match(html, /id="file-label-modal"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(appSource, /data-app-action="manage-file-labels"/);
  assert.ok(html.indexOf('../shared/fileLabels.js') < html.indexOf('scripts/fileLabelController.js'));
  assert.ok(html.indexOf('scripts/fileLabelController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /fileLabelController\.enrichItems\(items\)/);
  assert.match(appSource, /getFileLabelDotsHtml\(item/);
  assert.match(html, /id="file-labels-sidebar-section"[^>]+data-section-id="file-labels"/);
  assert.match(html, /id="file-labels-sidebar-list"/);
  assert.match(appSource, /openFileLabelCollection\(labelId\)/);
  assert.match(appSource, /fileLabels\.getCollection\(query\.fileLabelIds\)/);
  assert.match(appSource, /renderFileLabelColumnView\(items, contentArea\)/);
  assert.match(contentCss, /\.file-label-dot/);
  assert.match(mainCss, /\.file-label-modal/);
});

test('全部仓库状态条件写入当前标签查询，仪表盘临时筛选保持隔离', () => {
  assert.match(appSource, /activeRepositoryStatusFilters\(\)/);
  assert.match(appSource, /setActiveRepositoryStatusFilters\(statuses\)/);
  assert.match(appSource, /contentCollectionKind\(\) === 'repositories'[\s\S]*?AppState\.contentQuery = window\.ContentQuery\.normalize/);
  assert.match(appSource, /AppState\.selectedStatuses = normalized/);
  assert.match(appSource, /ContentQuery\.normalize\(AppState\.contentQuery\)\.gitStatuses\.length > 0/);
});

test('隐藏项目显示可从菜单、快捷键和应用设置切换并保持浏览边界', () => {
  assert.match(appSource, /showHiddenFiles:\s*false/);
  assert.match(appSource, /config\.get\('showHiddenFiles'\)/);
  assert.match(appSource, /config\.set\('showHiddenFiles',\s*AppState\.showHiddenFiles\)/);
  assert.match(appSource, /event\.code === 'Period'/);
  assert.match(appSource, /showHidden:\s*AppState\.showHiddenFiles/);
  assert.match(appSource, /id="settings-show-hidden"/);
  assert.match(contentCss, /\.repo-card\.is-hidden/);
});

test('目录模式提供 Finder 式分栏视图并保留当前列文件操作模型', () => {
  assert.match(html, /class="style-btn finder-menu-item" data-style="column"[^>]+role="menuitemradio"/);
  assert.match(html, /<span>分栏<\/span><kbd>⌘3<\/kbd>/);
  assert.match(appSource, /async renderColumnView\(items, container, context\)/);
  assert.match(appSource, /columnDirectoryPaths\(/);
  assert.match(appSource, /finder-column-current/);
  assert.match(appSource, /data-progressive-directory-target="column"/);
  assert.match(appSource, /appendDirectoryItemElements\([\s\S]*?_getColumnItemHtml/);
  assert.match(appSource, /\{ 1: 'card', 2: 'list', 3: 'column', 4: 'gallery' \}/);
  assert.match(appSource, /column:\s*'Ctrl\+3'/);
  assert.match(contentCss, /\.finder-column-browser\s*\{/);
  assert.match(contentCss, /\.repo-list-item\.finder-column-item\.selected/);
  assert.match(appSource, /class="finder-column-resizer"[^>]+role="separator"/);
  assert.match(appSource, /columnWidthFromDrag\(/);
  assert.match(appSource, /columnWidthFromKey\(/);
  assert.match(contentCss, /grid-auto-columns:\s*var\(--finder-column-width, 260px\)/);
});

test('目录模式提供 Finder 式图库视图和跨平台第四视图快捷键', () => {
  assert.match(html, /class="style-btn finder-menu-item" data-style="gallery"[^>]+role="menuitemradio"/);
  assert.match(html, /<span>图库<\/span><kbd>⌘4<\/kbd>/);
  assert.ok(html.indexOf('scripts/galleryView.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /async renderGalleryView\(items, container, context = null\)/);
  assert.match(appSource, /renderGalleryPreview\(item\)/);
  assert.match(appSource, /AppState\.currentMode === 'tree' && !this\.isGlobalSearchActive\(\)/);
  assert.match(appSource, /\{ 1: 'card', 2: 'list', 3: 'column', 4: 'gallery' \}/);
  assert.match(appSource, /gallery:\s*'Ctrl\+4'/);
  assert.match(contentCss, /\.finder-gallery-browser\s*\{/);
  assert.match(contentCss, /\.finder-gallery-strip\s*\{/);
  assert.match(contentCss, /\.finder-gallery-preview-body\s*\{/);
  assert.match(contentCss, /\.finder-gallery-image-wrap\s*\{[^}]*height:\s*100%/s);
  assert.match(contentCss, /\.finder-gallery-image\s*\{[^}]*max-height:\s*calc\(100% - 48px\)/s);
});

test('菜单具备浮层、选中态、禁用态和窄窗口自适应样式', () => {
  const css = `${mainCss}\n${contentCss}`;
  assert.match(css, /\.finder-menu\s*\{/);
  assert.match(css, /\.finder-menu\[hidden\]/);
  assert.match(css, /\.finder-menu-item\.active/);
  assert.match(css, /\.finder-menu-item:disabled/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
});
