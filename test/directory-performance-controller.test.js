const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const DirectoryPerformance = require('../src/renderer/scripts/directoryPerformance.js');
const { Controller } = require('../src/renderer/scripts/directoryPerformanceController.js');

class FakeElement {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.style = { display: id === 'directory-performance-modal' ? 'none' : '' };
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.small = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, currentTarget: this, ...event });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  querySelector(selector) {
    return selector === 'small' ? this.small : null;
  }

  focus() {
    this.document.activeElement = this;
  }
}

function createHarness() {
  const document = {
    activeElement: null,
    elements: new Map(),
    getElementById(id) { return this.elements.get(id) || null; }
  };
  const ids = [
    'directory-performance-diagnostics',
    'directory-performance-modal',
    'directory-performance-close-btn',
    'directory-performance-done-btn',
    'directory-performance-path',
    'directory-performance-state',
    'directory-performance-grid',
    'sort-menu-trigger'
  ];
  for (const id of ids) document.elements.set(id, new FakeElement(id, document));
  const summary = new FakeElement('summary', document);
  document.getElementById('directory-performance-diagnostics').small = summary;
  const state = { currentPath: '/workspace/huge', directoryPerformance: null };
  const app = {
    directoryVirtualizer: { itemsPerRow: () => 2 },
    isFileBrowsingContext: () => true,
    escapeHtml: value => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  };
  let now = 100;
  const controller = new Controller({
    app,
    state,
    document,
    performanceApi: DirectoryPerformance,
    virtualWindow: {
      shouldVirtualize: total => total > 1000,
      canVirtualizeCardItems: items => items.length > 1000
    },
    progressiveRender: { shouldRenderProgressively: total => total > 320 },
    clock: () => now
  });
  const context = { requestId: 4, path: state.currentPath, style: 'card' };
  const container = { querySelectorAll: () => ({ length: 14 }) };
  return { app, container, context, controller, document, setNow: value => { now = value; }, state, summary };
}

test('控制器采样当前目录并同步收纳式菜单摘要', () => {
  const harness = createHarness();
  harness.controller.begin(harness.context);
  harness.setNow(142.5);
  harness.controller.markRead(harness.context, 12000);
  harness.setNow(147.5);
  harness.controller.markVisible(harness.context, 12000);
  harness.controller.setStrategy(harness.context, new Array(1201), 'card');
  harness.setNow(154);
  harness.controller.markFirstDom(harness.context, harness.container);
  harness.setNow(160);
  harness.controller.complete(harness.context, harness.container);

  const snapshot = DirectoryPerformance.snapshot(harness.state.directoryPerformance);
  assert.equal(snapshot.strategy, 'virtual-card');
  assert.equal(snapshot.domItems, 14);
  assert.equal(snapshot.itemsPerRow, 2);
  assert.equal(snapshot.totalMs, 60);
  assert.equal(harness.document.getElementById('directory-performance-diagnostics').disabled, false);
  assert.equal(harness.summary.textContent, '12,000 项 · 多列虚拟图标（2 列）');
});

test('控制器打开安全诊断弹窗，Esc 关闭并恢复到排列菜单按钮', () => {
  const harness = createHarness();
  harness.controller.bind();
  harness.controller.begin(harness.context);
  harness.setNow(120);
  harness.controller.markRead(harness.context, 2);
  harness.controller.markVisible(harness.context, 2);
  harness.controller.setStrategy(harness.context, [{}, {}], 'card');
  harness.controller.markFirstDom(harness.context, harness.container);
  harness.controller.complete(harness.context, harness.container);

  harness.document.getElementById('directory-performance-diagnostics').dispatch('click');
  const modal = harness.document.getElementById('directory-performance-modal');
  assert.equal(modal.style.display, 'flex');
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.match(harness.document.getElementById('directory-performance-grid').innerHTML, /显示策略/);
  assert.match(harness.document.getElementById('directory-performance-grid').innerHTML, /直接图标/);
  assert.equal(harness.document.activeElement.id, 'directory-performance-close-btn');

  let prevented = false;
  modal.dispatch('keydown', {
    key: 'Escape',
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {}
  });
  assert.equal(prevented, true);
  assert.equal(modal.style.display, 'none');
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(modal.hasAttribute('inert'), true);
  assert.equal(harness.document.activeElement.id, 'sort-menu-trigger');
});

test('控制器拒绝用迟到上下文更新新目录样本', () => {
  const harness = createHarness();
  harness.controller.begin(harness.context);
  harness.setNow(130);
  harness.controller.markRead({ ...harness.context, requestId: 3 }, 999);
  harness.controller.markVisible({ ...harness.context, path: '/workspace/old' }, 999);
  const snapshot = DirectoryPerformance.snapshot(harness.state.directoryPerformance);
  assert.equal(snapshot.sourceItems, 0);
  assert.equal(snapshot.visibleItems, 0);
});
