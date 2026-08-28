const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Controller } = require('../src/renderer/scripts/fileOperationDialogController.js');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.style = { display: id === 'file-operation-modal' ? 'none' : '' };
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.textContent = '';
    this.value = '';
    this.selection = null;
    this.isConnected = true;
    this.visible = true;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, currentTarget: this, ...event });
    }
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  focus() { this.document.activeElement = this; }
  select() { this.selection = [0, this.value.length]; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  getClientRects() { return this.visible ? [{}] : []; }
}

function createHarness() {
  const document = {
    activeElement: null,
    elements: new Map(),
    getElementById(id) { return this.elements.get(id) || null; },
    querySelectorAll(selector) {
      return selector === '#file-operation-modal [data-modal="file-operation-modal"]'
        ? [this.elements.get('file-operation-close-btn'), this.elements.get('file-operation-cancel-btn')]
        : [];
    }
  };
  const ids = [
    'file-operation-modal',
    'file-operation-title',
    'file-operation-label',
    'file-operation-input',
    'file-operation-hint',
    'file-operation-confirm-btn',
    'file-operation-close-btn',
    'file-operation-cancel-btn',
    'file-create-menu-trigger',
    'file-actions-menu-trigger',
    'origin-card'
  ];
  for (const id of ids) document.elements.set(id, new FakeElement(id, document));
  const controller = new Controller({
    document,
    window: { getComputedStyle: element => ({ display: element.visible ? 'block' : 'none', visibility: 'visible' }) },
    requestAnimationFrame: callback => callback()
  });
  return { controller, document };
}

test('名称对话框设置安全模态状态并选中文件扩展名前的基本名称', () => {
  const harness = createHarness();
  harness.document.activeElement = harness.document.getElementById('origin-card');
  harness.controller.open({
    title: '新建文件',
    label: '名称',
    value: '未命名.txt',
    confirmLabel: '创建',
    hint: '创建空白文件',
    selectBaseName: true
  });

  const modal = harness.document.getElementById('file-operation-modal');
  const input = harness.document.getElementById('file-operation-input');
  assert.equal(modal.style.display, 'flex');
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.equal(modal.hasAttribute('inert'), false);
  assert.equal(harness.document.getElementById('file-operation-title').textContent, '新建文件');
  assert.equal(harness.document.getElementById('file-operation-confirm-btn').textContent, '创建');
  assert.equal(input.value, '未命名.txt');
  assert.deepEqual(input.selection, [0, 3]);
  assert.equal(harness.document.activeElement, input);
});

test('空名称保持对话框打开，有效名称通过 Return 提交并恢复原焦点', async () => {
  const harness = createHarness();
  const origin = harness.document.getElementById('origin-card');
  harness.document.activeElement = origin;
  harness.controller.bind();
  const result = harness.controller.open({ title: '重命名', value: 'old.txt' });
  const input = harness.document.getElementById('file-operation-input');

  input.value = '   ';
  let prevented = false;
  let stopped = false;
  input.dispatch('keydown', {
    key: 'Enter',
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(harness.document.getElementById('file-operation-modal').style.display, 'flex');
  assert.equal(harness.document.getElementById('file-operation-hint').textContent, '名称不能为空');
  assert.equal(harness.document.getElementById('file-operation-hint').classList.contains('error'), true);

  input.value = 'new.txt';
  input.dispatch('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(await result, 'new.txt');
  assert.equal(harness.document.getElementById('file-operation-modal').style.display, 'none');
  assert.equal(harness.document.getElementById('file-operation-modal').getAttribute('aria-hidden'), 'true');
  assert.equal(harness.document.getElementById('file-operation-modal').hasAttribute('inert'), true);
  assert.equal(harness.document.activeElement, origin);
});

test('Escape 取消当前请求，隐藏来源不可恢复时聚焦显式回退按钮', async () => {
  const harness = createHarness();
  const hiddenOrigin = harness.document.getElementById('origin-card');
  hiddenOrigin.visible = false;
  harness.document.activeElement = hiddenOrigin;
  harness.controller.bind();
  const result = harness.controller.open({
    title: '新建文件夹',
    returnFocusId: 'file-create-menu-trigger'
  });
  const input = harness.document.getElementById('file-operation-input');
  let prevented = false;
  input.dispatch('keydown', {
    key: 'Escape',
    preventDefault: () => { prevented = true; },
    stopPropagation() {}
  });

  assert.equal(prevented, true);
  assert.equal(await result, null);
  assert.equal(harness.document.activeElement.id, 'file-create-menu-trigger');
});

test('页面先加载名称对话框控制器，App 只保留兼容委托', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src/renderer/scripts/app.js'), 'utf8');
  assert.ok(html.indexOf('scripts/fileOperationDialogController.js') < html.indexOf('scripts/app.js'));
  assert.match(appSource, /setupFileOperationDialogController/);
  assert.match(appSource, /return this\.fileOperationDialogController\.open\(options\)/);
  assert.match(appSource, /return this\.fileOperationDialogController\.submit\(\)/);
  assert.match(appSource, /return this\.fileOperationDialogController\.close\(value\)/);
  assert.doesNotMatch(appSource, /_fileOperationDialogResolve/);
});
