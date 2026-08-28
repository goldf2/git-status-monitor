const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
const gitSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/git.js'), 'utf8');
const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');
const ipc = fs.readFileSync(path.join(projectRoot, 'src/main/ipc/git.js'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/main.css'), 'utf8');

test('行级暂存通过主进程预览令牌和二次应用接口，不上传渲染层补丁', () => {
  for (const channel of ['previewLineSelection', 'applyLineSelection']) {
    assert.match(preload, new RegExp(`${channel}:`));
    assert.match(ipc, new RegExp(`git:${channel}`));
    assert.match(gitSource, new RegExp(`git\\.${channel}\\(`));
  }
  assert.match(html, /id="commit-line-preview-btn"/);
  assert.match(html, /id="commit-line-preview"[^>]+hidden/);
  assert.match(html, /src="\.\.\/shared\/gitPatchSelection\.js"/);
  assert.match(gitSource, /data-line-id/);
  assert.doesNotMatch(preload, /applyLineSelection[^\n]+patch/);
});

test('amend 使用显式模式、预览卡片和已发布提交确认', () => {
  for (const channel of ['getAmendContext', 'previewAmend', 'applyAmend']) {
    assert.match(preload, new RegExp(`${channel}:`));
    assert.match(ipc, new RegExp(`git:${channel}`));
    assert.match(gitSource, new RegExp(`git\\.${channel}\\(`));
  }
  assert.match(html, /id="commit-amend-toggle"/);
  assert.match(html, /id="commit-amend-context"[^>]+hidden/);
  assert.match(html, /id="commit-amend-preview"[^>]+hidden/);
  assert.match(gitSource, /acknowledgePublished/);
  assert.match(css, /\.commit-amend-published-warning/);
});

test('提交差异使用可选择的网格行并保留 reduced-motion 支持', () => {
  assert.match(html, /<div class="commit-diff-content" id="commit-diff-content"/);
  assert.match(css, /\.commit-diff-line\.selectable/);
  assert.match(css, /\.commit-diff-line-number/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
