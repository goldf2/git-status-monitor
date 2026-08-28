const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Controller } = require('../src/renderer/scripts/directoryTerminalController');
const { resolveTerminalWorkingDirectory } = require('../src/main/ipc/terminal');

function createHarness({
  items = [],
  currentPath = '/workspace/current',
  directoryBrowsing = true,
  globalSearch = false,
  result = { opened: true, tool: { name: 'Terminal' } }
} = {}) {
  const calls = [];
  const app = {
    getSelectedFileItems: () => items,
    isDirectoryBrowsingContext: () => directoryBrowsing,
    isGlobalSearchActive: () => globalSearch,
    closeToolbarMenus: () => calls.push(['close-menus']),
    openDeveloperToolSettings: async () => calls.push(['open-settings']),
    _showStatusMessage: (message, level) => calls.push(['status', message, level])
  };
  const state = { currentPath };
  const bridge = {
    config: {
      get: async key => {
        calls.push(['config', key]);
        return 'preferred-terminal';
      }
    },
    terminal: {
      openForPath: async (targetPath, preferred) => {
        calls.push(['open', targetPath, preferred]);
        return result;
      }
    }
  };
  return { app, bridge, calls, controller: new Controller({ app, state, bridge }), state };
}

test('单选文件夹或文件时把真实受管目标交给主进程解析终端目录', async () => {
  const directory = createHarness({ items: [{ path: '/workspace/project', type: 'directory' }] });
  assert.equal(await directory.controller.open(), true);
  assert.deepEqual(directory.calls.find(call => call[0] === 'open'), ['open', '/workspace/project', 'preferred-terminal']);

  const file = createHarness({ items: [{ path: '/workspace/project/README.md', type: 'file' }] });
  assert.equal(await file.controller.open(), true);
  assert.deepEqual(file.calls.find(call => call[0] === 'open'), ['open', '/workspace/project/README.md', 'preferred-terminal']);
});

test('没有选择时只允许从真实当前目录打开终端，多选和全局搜索不猜测目标', async () => {
  const current = createHarness();
  assert.equal(await current.controller.open(), true);
  assert.deepEqual(current.calls.find(call => call[0] === 'open'), ['open', '/workspace/current', 'preferred-terminal']);

  const multiple = createHarness({ items: [
    { path: '/workspace/a', type: 'directory' },
    { path: '/workspace/b', type: 'directory' }
  ] });
  assert.equal(await multiple.controller.open(), false);
  assert.equal(multiple.calls.some(call => call[0] === 'open'), false);

  const globalSearch = createHarness({ globalSearch: true });
  assert.equal(await globalSearch.controller.open(), false);
  assert.equal(globalSearch.calls.some(call => call[0] === 'open'), false);
});

test('终端缺失时给出设置入口，路径错误不会误导用户修改工具配置', async () => {
  const missing = createHarness({ result: { opened: false, reason: 'terminal-not-found' } });
  assert.equal(await missing.controller.open(), false);
  assert.equal(missing.calls.some(call => call[0] === 'open-settings'), true);

  const invalid = createHarness({ result: { opened: false, reason: '路径不在受管开发目录中或不可用' } });
  assert.equal(await invalid.controller.open(), false);
  assert.equal(invalid.calls.some(call => call[0] === 'open-settings'), false);
  assert.equal(invalid.calls.some(call => call[0] === 'status' && call[1].includes('路径不在受管开发目录中')), true);
});

test('主进程把受管文件转换为父目录，并拒绝目录与文件之外的目标', () => {
  const service = {
    resolveWorkspacePath(targetPath) {
      if (targetPath === '/workspace/project') return { ok: true, type: 'directory', path: targetPath };
      if (targetPath === '/workspace/project/README.md') return { ok: true, type: 'file', path: targetPath };
      if (targetPath === '/workspace/link') return { ok: true, type: 'symlink', path: targetPath };
      return { ok: false };
    }
  };
  assert.equal(resolveTerminalWorkingDirectory('/workspace/project', service), '/workspace/project');
  assert.equal(resolveTerminalWorkingDirectory('/workspace/project/README.md', service), path.dirname('/workspace/project/README.md'));
  assert.equal(resolveTerminalWorkingDirectory('/workspace/link', service), null);
  assert.equal(resolveTerminalWorkingDirectory('/outside', service), null);
});

test('目录操作、右键菜单、系统文件菜单和受信桥完整接入终端入口', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'src/renderer/scripts/app.js'), 'utf8');
  const actionBarSource = fs.readFileSync(path.join(root, 'src/renderer/scripts/fileActionBarController.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

  assert.match(html, /id="file-open-terminal"/);
  assert.match(html, /data-context-action="open-terminal"/);
  assert.ok(html.indexOf('scripts/directoryTerminalController.js') < html.indexOf('scripts/app.js'));
  assert.match(actionBarSource, /file-open-terminal/);
  assert.match(appSource, /setupDirectoryTerminalController/);
  assert.match(appSource, /openSelectedInTerminal/);
  assert.match(appSource, /action === 'open-terminal'/);
  assert.match(mainSource, /sendShortcut\('open-terminal'\)/);
  assert.match(preloadSource, /openForPath:\s*\(targetPath, preferred\)/);
});
