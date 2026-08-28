const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const { DirectoryWatchService } = require('../src/main/services/directoryWatchService');

class FakeWatcher extends EventEmitter {
  constructor(listener) {
    super();
    this.listener = listener;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }
}

function availableInspection(paths) {
  return {
    directories: paths.map(directoryPath => ({ path: directoryPath, available: true }))
  };
}

test('目录监听合并短时间内的外部变化并限制公开名称', async () => {
  const watchers = [];
  const events = [];
  const service = new DirectoryWatchService({
    debounceMs: 5,
    inspectDirectories: availableInspection,
    watch: (_directoryPath, options, listener) => {
      assert.deepEqual(options, { persistent: false, recursive: false });
      const watcher = new FakeWatcher(listener);
      watchers.push(watcher);
      return watcher;
    }
  });
  const directoryPath = path.resolve('/workspace/project');
  const started = service.start('renderer-1', directoryPath, event => events.push(event));

  watchers[0].listener('change', 'README.md');
  watchers[0].listener('rename', 'src');
  watchers[0].listener('change', 'README.md');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(events.length, 1);
  assert.equal(events[0].watchId, started.watchId);
  assert.deepEqual(events[0].eventTypes, ['change', 'rename']);
  assert.deepEqual(events[0].names, ['README.md', 'src']);
});

test('同一窗口切换目录时关闭旧监听，错误监听 ID 不能关闭新监听', () => {
  const watchers = [];
  const service = new DirectoryWatchService({
    inspectDirectories: availableInspection,
    watch: (_directoryPath, _options, listener) => {
      const watcher = new FakeWatcher(listener);
      watchers.push(watcher);
      return watcher;
    }
  });
  const first = service.start('renderer-1', path.resolve('/workspace/one'), () => {});
  const second = service.start('renderer-1', path.resolve('/workspace/two'), () => {});

  assert.equal(watchers[0].closed, true);
  assert.equal(service.stop('renderer-1', first.watchId).stopped, false);
  assert.equal(watchers[1].closed, false);
  assert.equal(service.stop('renderer-1', second.watchId).stopped, true);
  assert.equal(watchers[1].closed, true);
});

test('目录监听拒绝相对路径和不可用或非受管目录', () => {
  let watchCalls = 0;
  const service = new DirectoryWatchService({
    inspectDirectories: paths => ({ directories: paths.map(directoryPath => ({ path: directoryPath, available: false })) }),
    watch: () => {
      watchCalls++;
      return new FakeWatcher(() => {});
    }
  });

  assert.throws(() => service.start('renderer-1', 'relative/path', () => {}), /绝对路径/);
  assert.throws(() => service.start('renderer-1', path.resolve('/outside'), () => {}), /受管根目录/);
  assert.equal(watchCalls, 0);
});

test('底层监听错误会关闭监听并向渲染层发送有界错误', () => {
  let watcher;
  const events = [];
  const service = new DirectoryWatchService({
    inspectDirectories: availableInspection,
    watch: (_directoryPath, _options, listener) => {
      watcher = new FakeWatcher(listener);
      return watcher;
    }
  });
  const started = service.start('renderer-1', path.resolve('/workspace/project'), event => events.push(event));

  watcher.emit('error', new Error('volume disconnected'));

  assert.equal(watcher.closed, true);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: 'error',
    watchId: started.watchId,
    path: path.resolve('/workspace/project'),
    error: 'volume disconnected'
  });
  assert.equal(service.stop('renderer-1', started.watchId).stopped, false);
});

test('桌面桥接在目录视图生命周期内启动监听并在退出时释放', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const filesystemIpcSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'filesystem.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'scripts', 'app.js'), 'utf8');

  assert.match(preloadSource, /watchDirectory:.*fs:watchDirectory/);
  assert.match(preloadSource, /onDirectoryChanged:[\s\S]*fs:directoryChanged/);
  assert.match(filesystemIpcSource, /fs:watchDirectory[\s\S]*directoryWatchService\.start/);
  assert.match(appSource, /onDirectoryChanged[\s\S]*handleDirectoryWatchEvent/);
  assert.match(appSource, /beforeunload[\s\S]*unwatchDirectory/);
  assert.match(appSource, /async renderContent\(\) \{[\s\S]*?this\.syncCurrentDirectoryWatch\(\)/);
  assert.match(appSource, /refreshCurrentDirectoryFromWatch[\s\S]*normalizeAndRepairWorkspaceTabs/);
  assert.match(appSource, /renderTreeView[\s\S]*showFileSelectionDetail\(this\.getSelectedFileItems\(\)\)/);
});
