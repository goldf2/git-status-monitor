const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const html = read('src/renderer/index.html');
const appSource = read('src/renderer/scripts/app.js');
const css = read('src/renderer/styles/main.css');
const { Controller } = require('../src/renderer/scripts/workspaceTabOverflowController');

function classList() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    contains: name => values.has(name)
  };
}

function createFixture({ activeRect = { left: -180, right: -20 } } = {}) {
  const listeners = new Map();
  const resizeListeners = new Map();
  const active = {
    scrollCalls: [],
    getBoundingClientRect: () => activeRect,
    scrollIntoView(options) { this.scrollCalls.push(options); }
  };
  const container = {
    scrollWidth: 900,
    clientWidth: 500,
    scrollLeft: 300,
    scrollCalls: [],
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector: selector => selector === '.workspace-tab.active' ? active : null,
    getBoundingClientRect: () => ({ left: 0, right: 500 }),
    scrollBy(options) { this.scrollCalls.push(options); }
  };
  const button = () => ({
    hidden: true,
    disabled: false,
    classList: classList(),
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    removeEventListener(type) { delete this[`on${type}`]; }
  });
  const left = button();
  const right = button();
  const document = {
    getElementById(id) {
      return { 'workspace-tabs': container, 'workspace-tabs-left': left, 'workspace-tabs-right': right }[id] || null;
    }
  };
  const window = {
    addEventListener(type, handler) { resizeListeners.set(type, handler); },
    removeEventListener(type) { resizeListeners.delete(type); }
  };
  return { active, container, left, right, document, window, listeners, resizeListeners };
}

test('标签溢出控制器标出活动标签所在方向并优先找回活动标签', () => {
  const fixture = createFixture();
  const controller = new Controller({ document: fixture.document, window: fixture.window });
  controller.mount();

  assert.equal(fixture.left.hidden, false);
  assert.equal(fixture.right.hidden, false);
  assert.equal(fixture.left.classList.contains('contains-active-tab'), true);
  assert.equal(fixture.right.classList.contains('contains-active-tab'), false);

  fixture.left.onclick();

  assert.deepEqual(fixture.active.scrollCalls, [{ block: 'nearest', inline: 'nearest', behavior: 'smooth' }]);
  assert.equal(fixture.container.scrollCalls.length, 0);
});

test('活动标签已可见时溢出按钮按一页宽度浏览标签', () => {
  const fixture = createFixture({ activeRect: { left: 120, right: 300 } });
  const controller = new Controller({ document: fixture.document, window: fixture.window });
  controller.mount();

  fixture.right.onclick();

  assert.equal(fixture.active.scrollCalls.length, 0);
  assert.deepEqual(fixture.container.scrollCalls, [{ left: 360, behavior: 'smooth' }]);
});

test('标签渲染后自动保持活动标签可见并同步溢出状态', () => {
  const fixture = createFixture();
  const controller = new Controller({ document: fixture.document, window: fixture.window });
  controller.mount();

  fixture.active.scrollCalls.length = 0;
  controller.afterRender();

  assert.deepEqual(fixture.active.scrollCalls, [{ block: 'nearest', inline: 'nearest', behavior: 'auto' }]);
  assert.equal(fixture.left.hidden, false);
  assert.equal(fixture.right.hidden, false);
});

test('标签栏接入可访问的溢出按钮和独立控制器', () => {
  assert.match(html, /id="workspace-tabs-left"[^>]*aria-label="向左浏览标签页"/);
  assert.match(html, /id="workspace-tabs-right"[^>]*aria-label="向右浏览标签页"/);
  assert.ok(html.indexOf('scripts/workspaceTabOverflowController.js') < html.indexOf('scripts/app.js'));
  assert.match(css, /\.workspace-tab-overflow/);
  assert.match(css, /\.contains-active-tab/);
  assert.match(appSource, /setupWorkspaceTabOverflowController\(\)/);
  assert.match(appSource, /workspaceTabOverflowController\.afterRender\(\)/);
  assert.match(appSource, /aria-label="\$\{this\.escapeHtml\(`\$\{title\}，\$\{tabHelp\}`\)\}"/);
  assert.match(appSource, /title="\$\{this\.escapeHtml\(title\)\}"/);
  assert.doesNotMatch(appSource, /title="\$\{this\.escapeHtml\(tabHelp\)\}"/);
});
