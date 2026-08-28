const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const History = require('../src/renderer/scripts/fileOperationHistoryController');

const html = read('src/renderer/index.html');
const appSource = read('src/renderer/scripts/app.js');
const mainSource = read('main.js');
const controllerSource = read('src/renderer/scripts/fileOperationHistoryController.js');
const cssSource = read('src/renderer/styles/content.css');

test('文件操作历史把底层记录转换为稳定、可读的动作摘要', () => {
  const presentation = History.presentOperation({
    id: 'op_1',
    type: 'rename',
    batch: true,
    createdAt: Date.UTC(2026, 7, 28, 2, 0, 0),
    items: [
      { source: '/workspace/a.txt', target: '/workspace/b.txt' },
      { source: '/workspace/c.txt', target: '/workspace/d.txt' }
    ],
    undoable: true,
    undoneAt: null
  }, { now: Date.UTC(2026, 7, 28, 2, 3, 0), platform: 'darwin' });

  assert.equal(presentation.title, '批量重命名');
  assert.equal(presentation.countLabel, '2 项');
  assert.equal(presentation.statusLabel, '已完成');
  assert.equal(presentation.timeLabel, '3 分钟前');
  assert.equal(presentation.primaryName, 'a.txt → b.txt');
  assert.equal(presentation.remainingLabel, '另有 1 项');
});

test('历史状态区分撤销、重做失效、不可撤销和恢复记录', () => {
  assert.equal(History.presentOperation({
    type: 'move', items: [], undoable: true, undoneAt: 10, redoable: true
  }).statusLabel, '已撤销');
  assert.equal(History.presentOperation({
    type: 'move', items: [], undoable: true, undoneAt: 10, redoable: true, redoInvalidatedAt: 20
  }).statusLabel, '已撤销 · 重做已失效');
  assert.equal(History.presentOperation({
    type: 'trash', items: [], undoable: false, systemTrash: true
  }, { platform: 'win32' }).statusLabel, '已完成 · 请在回收站恢复');
  assert.equal(History.presentOperation({
    type: 'copy', items: [], undoable: true, recoveredAt: 10
  }).statusLabel, '中断后已安全恢复');
});

test('历史定位选择当前仍存在的语义路径，而不是系统废纸篓内部路径', () => {
  const rename = { type: 'rename', items: [{ source: '/workspace/a.txt', target: '/workspace/b.txt' }] };
  const trash = { type: 'trash', items: [{ source: '/workspace/a.txt', target: '/Users/me/.Trash/a.txt' }] };
  assert.equal(History.operationLocation(rename), '/workspace/b.txt');
  assert.equal(History.operationLocation({ ...rename, undoneAt: 10 }), '/workspace/a.txt');
  assert.equal(History.operationLocation(trash), '/workspace/a.txt');
});

test('历史面板由工具栏下拉与系统显示菜单打开，并保持非模态语义', () => {
  for (const id of [
    'file-history',
    'file-operation-history-panel',
    'file-operation-history-close',
    'file-operation-history-refresh',
    'file-operation-history-summary',
    'file-operation-history-list'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-modal="false"/);
  assert.ok(html.indexOf('scripts/fileOperationHistoryController.js') < html.indexOf('scripts/app.js'));
  assert.match(mainSource, /open-file-history/);
  assert.match(appSource, /setupFileOperationHistoryController/);
  assert.match(appSource, /fileOperationHistoryController\.open/);
});

test('历史面板只复用既有撤销重做与受管目录导航，不执行新的文件语义', () => {
  assert.match(controllerSource, /fileOps\.undo\(operation\.id\)/);
  assert.match(controllerSource, /fileOps\.redo\(operation\.id\)/);
  assert.match(controllerSource, /revealFileOperationHistoryLocation/);
  assert.doesNotMatch(controllerSource, /showInFinder/);
  assert.match(controllerSource, /event\.key === 'Escape'/);
  assert.match(cssSource, /\.file-operation-history-panel/);
  assert.match(cssSource, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*\.file-operation-history-panel/);
});

test('历史控制器立即打开面板，并只给当前候选生成撤销或重做按钮', async () => {
  class Element {
    constructor({ hidden = false } = {}) {
      this.hidden = hidden;
      this.innerHTML = '';
      this.textContent = '';
      this.attributes = {};
      this.isConnected = true;
      this.focused = false;
    }
    addEventListener() {}
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { this.focused = true; }
  }
  const elements = new Map([
    ['file-operation-history-panel', new Element({ hidden: true })],
    ['file-operation-history-close', new Element()],
    ['file-operation-history-refresh', new Element()],
    ['file-operation-history-list', new Element()],
    ['file-operation-history-summary', new Element()]
  ]);
  const previousFocus = new Element();
  const document = {
    activeElement: previousFocus,
    getElementById: id => elements.get(id) || null,
    addEventListener() {}
  };
  const state = {
    fileOperationBusy: false,
    fileRecoveryStatus: null,
    fileOperationHistory: [
      { id: 'active', type: 'create-file', createdAt: Date.now(), undoable: true, items: [{ target: '/workspace/a.txt' }] },
      { id: 'redone', type: 'copy', createdAt: Date.now(), undoable: true, undoneAt: 20, redoable: true, items: [{ source: '/workspace/a.txt', target: '/workspace/b.txt' }] },
      { id: 'older', type: 'rename', createdAt: Date.now(), undoable: true, items: [{ source: '/workspace/c.txt', target: '/workspace/d.txt' }] }
    ]
  };
  const app = {
    closeToolbarMenus() {},
    loadFileOperationHistory: async () => {},
    escapeHtml: value => String(value),
    fileOperationController: {
      latestUndoable: () => state.fileOperationHistory[0],
      latestRedoable: () => state.fileOperationHistory[1]
    }
  };
  const controller = new History.Controller({
    app,
    state,
    bridge: { platform: 'darwin' },
    document,
    window: { requestAnimationFrame: callback => callback() }
  });

  await controller.open();
  assert.equal(elements.get('file-operation-history-panel').hidden, false);
  assert.equal((elements.get('file-operation-history-list').innerHTML.match(/data-history-action="undo"/g) || []).length, 1);
  assert.equal((elements.get('file-operation-history-list').innerHTML.match(/data-history-action="redo"/g) || []).length, 1);
  assert.equal(elements.get('file-operation-history-close').focused, true);

  controller.close();
  assert.equal(elements.get('file-operation-history-panel').hidden, true);
  assert.equal(previousFocus.focused, true);
});
