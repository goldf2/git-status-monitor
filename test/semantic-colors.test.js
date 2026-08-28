const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SemanticColors = require('../src/shared/semanticColors');

test('默认语义色将蓝色文件夹与紫色 Git 角标明确分离', () => {
  const profile = SemanticColors.profileForPreset('finder');
  assert.equal(profile.colors.folder, '#4f7fa8');
  assert.equal(profile.colors.project, '#0a84ff');
  assert.equal(profile.colors.gitBadge, '#7a4fd0');
  assert.ok(SemanticColors.colorDistance(profile.colors.folder, profile.colors.gitBadge) >= 56);
  assert.ok(SemanticColors.colorDistance(profile.colors.project, profile.colors.gitBadge) >= 56);
  assert.deepEqual(SemanticColors.roleCollisions(profile), []);
});

test('语义色配置只保留已知色位并把非法值回退为默认', () => {
  const profile = SemanticColors.normalizeProfile({
    version: 999,
    preset: 'unknown',
    colors: {
      folder: '#ABCDEF',
      project: 'red',
      gitBadge: '#123456',
      gitMark: '#fefefe',
      injected: 'url(file:///secret)'
    },
    lifecycle: { active: '#102030', frozen: 'var(--unsafe)', injected: '#000000' },
    extra: true
  });

  assert.deepEqual(Object.keys(profile.colors), SemanticColors.ROLE_KEYS);
  assert.deepEqual(Object.keys(profile.lifecycle), SemanticColors.LIFECYCLE_KEYS);
  assert.equal(profile.version, 1);
  assert.equal(profile.preset, 'custom');
  assert.equal(profile.colors.folder, '#abcdef');
  assert.equal(profile.colors.project, '#0a84ff');
  assert.equal(profile.colors.gitBadge, '#123456');
  assert.equal(profile.lifecycle.active, '#102030');
  assert.equal(profile.lifecycle.frozen, SemanticColors.PRESETS.finder.lifecycle.frozen);
  assert.equal(Object.hasOwn(profile, 'extra'), false);
});

test('语义色可转为受控 CSS 变量并警告过于接近的角色', () => {
  const profile = SemanticColors.profileForPreset('soft');
  const variables = SemanticColors.cssVariables(profile);
  assert.equal(variables['--folder-color'], profile.colors.folder);
  assert.equal(variables['--repository-color'], profile.colors.gitBadge);
  assert.equal(variables['--lifecycle-abandoned'], profile.lifecycle.abandoned);
  assert.equal(Object.keys(variables).length, 14);

  const collision = SemanticColors.normalizeProfile({
    ...profile,
    preset: 'custom',
    colors: { ...profile.colors, folder: '#7a4fd1', gitBadge: '#7a4fd0' }
  });
  assert.deepEqual(SemanticColors.roleCollisions(collision)[0], { left: 'folder', right: 'gitBadge' });

  const writes = [];
  const applied = SemanticColors.applyToElement({ style: { setProperty: (...args) => writes.push(args) } }, profile);
  assert.equal(applied.preset, 'soft');
  assert.equal(writes.length, 14);
});

test('设置页提供预设、四个语义色位、生命周期高级配置和安全持久化', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');
  const contentCss = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');

  assert.ok(html.indexOf('../shared/semanticColors.js') < html.indexOf('scripts/fileBrowser.js'));
  assert.match(appSource, /id="semantic-color-preset"/);
  assert.match(appSource, /\['folder', '\u666e\u901a\u76ee\u5f55'/);
  assert.match(appSource, /\['project', '\u9ed8\u8ba4\u9879\u76ee'/);
  assert.match(appSource, /\['gitBadge', 'Git \u89d2\u6807'/);
  assert.match(appSource, /\['gitMark', 'Git \u7ebf\u6761'/);
  assert.match(appSource, /id="semantic-color-\$\{key\}"/);
  assert.match(appSource, /data-semantic-lifecycle=/);
  assert.match(appSource, /aria-label="Git 状态条图例"/);
  assert.match(appSource, /data-status="clean">已同步/);
  assert.match(appSource, /config\.set\('semanticColorProfile', semanticColorProfile\)/);
  assert.match(appSource, /SemanticColors\.applyToElement/);
  assert.match(contentCss, /\.file-kind-directory\s*\{[^}]*var\(--folder-color\)/s);
  assert.match(contentCss, /\.file-kind-git-badge\s*\{[^}]*var\(--repository-color\)/s);
  assert.match(contentCss, /\.repo-card\.status-clean::before\s*\{[^}]*var\(--status-clean\)/s);
  assert.match(contentCss, /project-lifecycle-badge\[data-lifecycle="frozen"\]/);
});
