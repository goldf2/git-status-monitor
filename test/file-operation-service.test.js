const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { FileOperationService } = require('../src/main/services/fileOperationService');

function createFixture(t, serviceOptions = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitfinder-fileops-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const managedRoot = path.join(tempRoot, 'managed');
  const historyDir = path.join(tempRoot, 'history');
  const trashDir = path.join(tempRoot, 'trash');
  fs.mkdirSync(managedRoot);
  const calls = [];
  const configService = {
    getTreeRoots: () => [{ path: managedRoot, name: 'managed' }],
    validateRebindPaths: mappings => calls.push({ type: 'validate', mappings }),
    rebindPaths: mappings => calls.push({ type: 'rebind', mappings }),
    archivePaths: paths => {
      calls.push({ type: 'archive', paths });
      return { removedFavorites: [{ path: paths[0], name: path.basename(paths[0]) }] };
    },
    restoreArchivedPaths: (paths, snapshot) => calls.push({ type: 'restore', paths, snapshot })
  };
  const service = new FileOperationService({ configService, historyDir, trashDir, ...serviceOptions });
  return { tempRoot, managedRoot, historyDir, trashDir, calls, service };
}

test('移动目录后记录历史并可撤销，同时正反向同步路径关联', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'project-a');
  const destinationDir = path.join(managedRoot, 'archive');
  fs.mkdirSync(source);
  fs.mkdirSync(destinationDir);
  fs.writeFileSync(path.join(source, 'README.md'), '# A\n');

  const operation = await service.move([source], destinationDir);
  const target = path.join(destinationDir, 'project-a');

  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(path.join(target, 'README.md')), true);
  assert.deepEqual(calls[0], { type: 'validate', mappings: [{ from: source, to: target }] });
  assert.deepEqual(calls[1], { type: 'rebind', mappings: [{ from: source, to: target }] });
  assert.equal(service.getHistory()[0].id, operation.id);

  const undone = await service.undo(operation.id);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(target), false);
  assert.equal(undone.undoneAt > 0, true);
  assert.deepEqual(calls.at(-1), { type: 'rebind', mappings: [{ from: target, to: source }] });
});

test('撤销后的同卷移动可安全重做并再次撤销', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'project-a');
  const destinationDir = path.join(managedRoot, 'archive');
  const target = path.join(destinationDir, 'project-a');
  fs.mkdirSync(source);
  fs.mkdirSync(destinationDir);
  fs.writeFileSync(path.join(source, 'README.md'), '# A\n');

  const operation = await service.move([source], destinationDir);
  await service.undo(operation.id);
  const redone = await service.redo(operation.id);

  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), '# A\n');
  assert.equal(redone.undoneAt, null);
  assert.equal(redone.redoneAt > 0, true);
  assert.deepEqual(calls.at(-2), { type: 'validate', mappings: [{ from: source, to: target }] });
  assert.deepEqual(calls.at(-1), { type: 'rebind', mappings: [{ from: source, to: target }] });

  await service.undo(operation.id);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(target), false);
});

test('撤销后的跨卷移动不冒险重做复制删除', async (t) => {
  let destinationDir = '';
  const fixture = createFixture(t, {
    spaceReserveBytes: 0,
    deviceForPath: candidatePath => destinationDir && path.resolve(candidatePath).startsWith(path.resolve(destinationDir)) ? 2 : 1
  });
  const { managedRoot, service } = fixture;
  const source = path.join(managedRoot, 'project-a');
  destinationDir = path.join(managedRoot, 'other-volume');
  fs.mkdirSync(source);
  fs.mkdirSync(destinationDir);
  fs.writeFileSync(path.join(source, 'README.md'), '# A\n');

  const operation = await service.move([source], destinationDir);
  await service.undo(operation.id);

  assert.equal(operation.redoable, false);
  assert.match(operation.redoUnavailableReason, /跨卷/);
  await assert.rejects(() => service.redo(operation.id), /跨卷|不支持安全重做/);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(path.join(destinationDir, 'project-a')), false);
});

test('重命名拒绝覆盖现有路径', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const source = path.join(managedRoot, 'source');
  const existing = path.join(managedRoot, 'existing');
  fs.mkdirSync(source);
  fs.mkdirSync(existing);

  await assert.rejects(() => service.rename(source, 'existing'), /目标已存在/);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(existing), true);
});

test('移入废纸篓后可恢复原路径和配置快照', async (t) => {
  const { managedRoot, trashDir, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'notes.md');
  fs.writeFileSync(source, 'notes\n');

  const operation = await service.trash([source]);
  assert.equal(fs.existsSync(source), false);
  assert.equal(operation.items[0].target.startsWith(trashDir + path.sep), true);
  assert.equal(fs.existsSync(operation.items[0].target), true);
  assert.deepEqual(calls.find(call => call.type === 'archive'), { type: 'archive', paths: [source] });

  await service.undo(operation.id);
  assert.equal(fs.readFileSync(source, 'utf8'), 'notes\n');
  assert.equal(fs.existsSync(operation.items[0].target), false);
  const restoreCall = calls.find(call => call.type === 'restore');
  assert.deepEqual(restoreCall.paths, [source]);
  assert.deepEqual(restoreCall.snapshot.removedFavorites, [{ path: source, name: 'notes.md' }]);
});

test('废纸篓撤销可重做且重新归档路径关联', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'notes.md');
  fs.writeFileSync(source, 'notes\n');

  const operation = await service.trash([source]);
  const trashTarget = operation.items[0].target;
  await service.undo(operation.id);
  const redone = await service.redo(operation.id);

  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(trashTarget, 'utf8'), 'notes\n');
  assert.equal(redone.undoneAt, null);
  assert.deepEqual(calls.at(-1), { type: 'archive', paths: [source] });
});

test('Windows 使用系统回收站且不伪造可撤销路径', async (t) => {
  const recycled = [];
  const { managedRoot, calls, service } = createFixture(t, {
    platform: 'win32',
    trashDir: null,
    systemTrashItem: async source => {
      recycled.push(source);
      await fs.promises.rm(source, { recursive: true });
    }
  });
  const source = path.join(managedRoot, 'notes.md');
  fs.writeFileSync(source, 'notes\n');

  const operation = await service.trash([source]);
  assert.deepEqual(recycled, [source]);
  assert.equal(fs.existsSync(source), false);
  assert.equal(operation.systemTrash, true);
  assert.equal(operation.undoable, false);
  assert.deepEqual(operation.items, [{ source, target: null }]);
  assert.deepEqual(calls.find(call => call.type === 'archive')?.paths, [source]);
  await assert.rejects(() => service.undo(operation.id), /不可撤销/);
});

test('Windows 拒绝保留文件名、尾部点空格和非法字符', async (t) => {
  const { managedRoot, service } = createFixture(t, { platform: 'win32', systemTrashItem: async () => {} });
  for (const name of ['CON', 'aux.txt', 'folder.', 'folder ', 'bad:name', 'bad?name']) {
    await assert.rejects(() => service.createDirectory(managedRoot, name), /Windows|名称无效/);
  }
  assert.deepEqual(fs.readdirSync(managedRoot), []);
});

test('拒绝操作受管根目录之外的路径和根目录本身', async (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside.txt');
  fs.writeFileSync(outside, 'outside\n');

  await assert.rejects(() => service.trash([outside]), /不在受管开发目录中/);
  await assert.rejects(() => service.trash([managedRoot]), /不能直接操作受管根目录/);
  assert.equal(fs.existsSync(outside), true);
  assert.equal(fs.existsSync(managedRoot), true);
});

test('新建文件夹可撤销，但写入内容后不允许撤销', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const first = await service.createDirectory(managedRoot, 'new-folder');
  assert.equal(fs.statSync(first.items[0].target).isDirectory(), true);
  await service.undo(first.id);
  assert.equal(fs.existsSync(first.items[0].target), false);

  const second = await service.createDirectory(managedRoot, 'kept-folder');
  fs.writeFileSync(path.join(second.items[0].target, 'work.txt'), 'work\n');
  await assert.rejects(() => service.undo(second.id), /文件夹不再为空/);
  assert.equal(fs.existsSync(second.items[0].target), true);
});

test('新建空白文件使用独占创建并可撤销', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const operation = await service.createFile(managedRoot, 'notes.md');
  const target = path.join(managedRoot, 'notes.md');

  assert.equal(operation.type, 'create-file');
  assert.equal(fs.statSync(target).isFile(), true);
  assert.equal(fs.statSync(target).size, 0);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  await assert.rejects(() => service.createFile(managedRoot, 'notes.md'), /目标已存在/);

  await service.undo(operation.id);
  assert.equal(fs.existsSync(target), false);
});

test('新建空白文件撤销后可独占重做并更新文件身份', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const operation = await service.createFile(managedRoot, 'notes.md');
  const target = operation.items[0].target;

  await service.undo(operation.id);
  const redone = await service.redo(operation.id);

  assert.equal(fs.statSync(target).isFile(), true);
  assert.equal(fs.statSync(target).size, 0);
  assert.deepEqual(redone.items[0].identity, {
    dev: fs.statSync(target).dev,
    ino: fs.statSync(target).ino
  });
  await service.undo(operation.id);
  assert.equal(fs.existsSync(target), false);
});

test('重做拒绝目标冲突，新文件操作会废弃旧重做链', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const conflicted = await service.createFile(managedRoot, 'conflicted.txt');
  await service.undo(conflicted.id);
  fs.writeFileSync(conflicted.items[0].target, 'new owner\n');

  await assert.rejects(() => service.redo(conflicted.id), /目标已存在/);
  assert.equal(fs.readFileSync(conflicted.items[0].target, 'utf8'), 'new owner\n');
  fs.unlinkSync(conflicted.items[0].target);

  const stale = await service.createDirectory(managedRoot, 'stale');
  await service.undo(stale.id);
  await service.createDirectory(managedRoot, 'new-action');
  await assert.rejects(() => service.redo(stale.id), /重做链已失效/);
  const stored = service.getHistory().find(item => item.id === stale.id);
  assert.equal(stored.redoInvalidatedAt > 0, true);
});

test('连续撤销后按最近撤销顺序逐项重做', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const first = await service.createDirectory(managedRoot, 'first');
  const second = await service.createDirectory(managedRoot, 'second');

  await service.undo();
  await service.undo();
  assert.equal(fs.existsSync(first.items[0].target), false);
  assert.equal(fs.existsSync(second.items[0].target), false);

  const firstRedone = await service.redo();
  assert.equal(firstRedone.id, first.id);
  assert.equal(fs.existsSync(first.items[0].target), true);
  assert.equal(fs.existsSync(second.items[0].target), false);

  const secondRedone = await service.redo();
  assert.equal(secondRedone.id, second.id);
  assert.equal(fs.existsSync(second.items[0].target), true);
});

test('重做历史写入失败会回滚刚恢复的空白文件', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const operation = await service.createFile(managedRoot, 'rollback.txt');
  await service.undo(operation.id);
  service._saveHistory = () => { throw new Error('history unavailable'); };

  await assert.rejects(() => service.redo(operation.id), /history unavailable/);
  assert.equal(fs.existsSync(operation.items[0].target), false);
  assert.equal(operation.undoneAt > 0, true);
});

test('新建文件写入内容或被替换后拒绝撤销', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const written = await service.createFile(managedRoot, 'written.txt');
  fs.writeFileSync(written.items[0].target, 'keep me\n');
  await assert.rejects(() => service.undo(written.id), /文件已有内容/);
  assert.equal(fs.readFileSync(written.items[0].target, 'utf8'), 'keep me\n');

  const replaced = await service.createFile(managedRoot, 'replaced.txt');
  fs.unlinkSync(replaced.items[0].target);
  fs.writeFileSync(replaced.items[0].target, '');
  await assert.rejects(() => service.undo(replaced.id), /其他文件替换/);
  assert.equal(fs.existsSync(replaced.items[0].target), true);
});

test('新建文件拒绝通过符号链接写出受管目录', async (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside');
  const link = path.join(managedRoot, 'outside-link');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, 'dir');

  await assert.rejects(() => service.createFile(link, 'escape.txt'), /符号链接离开受管开发目录/);
  assert.equal(fs.existsSync(path.join(outside, 'escape.txt')), false);
});

test('同名项目批量移入废纸篓时使用互不覆盖的目标', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const firstParent = path.join(managedRoot, 'first');
  const secondParent = path.join(managedRoot, 'second');
  fs.mkdirSync(firstParent);
  fs.mkdirSync(secondParent);
  const first = path.join(firstParent, 'notes.md');
  const second = path.join(secondParent, 'notes.md');
  fs.writeFileSync(first, 'first\n');
  fs.writeFileSync(second, 'second\n');

  const operation = await service.trash([first, second]);
  assert.notEqual(operation.items[0].target, operation.items[1].target);
  assert.equal(fs.readFileSync(operation.items[0].target, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(operation.items[1].target, 'utf8'), 'second\n');
});

test('废纸篓目标按来源卷分别路由并保持同卷原子移动条件', async (t) => {
  let firstParent = '';
  const { tempRoot, managedRoot, service } = createFixture(t, {
    trashDirectoryForSource: source => source.startsWith(firstParent)
      ? path.join(tempRoot, 'trash-volume-a')
      : path.join(tempRoot, 'trash-volume-b')
  });
  firstParent = path.join(managedRoot, 'volume-a');
  const secondParent = path.join(managedRoot, 'volume-b');
  fs.mkdirSync(firstParent);
  fs.mkdirSync(secondParent);
  const first = path.join(firstParent, 'notes.txt');
  const second = path.join(secondParent, 'notes.txt');
  fs.writeFileSync(first, 'first\n');
  fs.writeFileSync(second, 'second\n');

  const operation = await service.trash([first, second]);

  assert.equal(operation.items[0].target.startsWith(path.join(tempRoot, 'trash-volume-a') + path.sep), true);
  assert.equal(operation.items[1].target.startsWith(path.join(tempRoot, 'trash-volume-b') + path.sep), true);
  assert.equal(fs.readFileSync(operation.items[0].target, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(operation.items[1].target, 'utf8'), 'second\n');
});

test('来源卷废纸篓不在同一设备或是符号链接时零写入拒绝', async (t) => {
  let unsafeTrash = '';
  const { tempRoot, managedRoot, service } = createFixture(t, {
    trashDirectoryForSource: () => unsafeTrash,
    deviceForPath: candidatePath => candidatePath.startsWith(unsafeTrash) ? 22 : 11
  });
  const source = path.join(managedRoot, 'notes.txt');
  unsafeTrash = path.join(tempRoot, 'other-device-trash');
  fs.writeFileSync(source, 'keep\n');

  await assert.rejects(() => service.trash([source]), /废纸篓不可用/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'keep\n');

  const realTrash = path.join(tempRoot, 'real-trash');
  const linkedTrash = path.join(tempRoot, 'linked-trash');
  fs.mkdirSync(realTrash);
  fs.symlinkSync(realTrash, linkedTrash, 'dir');
  unsafeTrash = linkedTrash;
  service.deviceForPath = (candidatePath, stat) => stat?.dev || fs.statSync(candidatePath).dev;
  await assert.rejects(() => service.trash([source]), /不是安全的真实目录/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'keep\n');
});

test('重命名、废纸篓和新建目录在历史写入失败时恢复原状态', async (t) => {
  const renameFixture = createFixture(t);
  const renameSource = path.join(renameFixture.managedRoot, 'before.txt');
  const renameTarget = path.join(renameFixture.managedRoot, 'after.txt');
  fs.writeFileSync(renameSource, 'rename rollback\n');
  renameFixture.service._record = () => { throw new Error('history unavailable'); };
  await assert.rejects(() => renameFixture.service.rename(renameSource, 'after.txt'), /history unavailable/);
  assert.equal(fs.readFileSync(renameSource, 'utf8'), 'rename rollback\n');
  assert.equal(fs.existsSync(renameTarget), false);
  assert.deepEqual(renameFixture.calls.filter(call => call.type === 'rebind'), [
    { type: 'rebind', mappings: [{ from: renameSource, to: renameTarget }] },
    { type: 'rebind', mappings: [{ from: renameTarget, to: renameSource }] }
  ]);

  const trashFixture = createFixture(t);
  const trashSource = path.join(trashFixture.managedRoot, 'trash.txt');
  fs.writeFileSync(trashSource, 'trash rollback\n');
  trashFixture.service._record = () => { throw new Error('history unavailable'); };
  await assert.rejects(() => trashFixture.service.trash([trashSource]), /history unavailable/);
  assert.equal(fs.readFileSync(trashSource, 'utf8'), 'trash rollback\n');
  assert.equal(fs.readdirSync(trashFixture.trashDir).length, 0);
  assert.equal(trashFixture.calls.some(call => call.type === 'restore'), true);

  const directoryFixture = createFixture(t);
  directoryFixture.service._record = () => { throw new Error('history unavailable'); };
  await assert.rejects(() => directoryFixture.service.createDirectory(directoryFixture.managedRoot, 'temporary'), /history unavailable/);
  assert.equal(fs.existsSync(path.join(directoryFixture.managedRoot, 'temporary')), false);
});

test('拒绝把文件夹移动到自身内部', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const source = path.join(managedRoot, 'source');
  const child = path.join(source, 'child');
  fs.mkdirSync(child, { recursive: true });

  await assert.rejects(() => service.move([source], child), /自身内部/);
  assert.equal(fs.existsSync(source), true);
});

test('复制文件和目录保留源内容，撤销时把副本移入废纸篓', async (t) => {
  const { managedRoot, trashDir, calls, service } = createFixture(t);
  const sourceFile = path.join(managedRoot, 'notes.md');
  const sourceDirectory = path.join(managedRoot, 'project-a');
  const destination = path.join(managedRoot, 'copies');
  fs.writeFileSync(sourceFile, 'source notes\n');
  fs.mkdirSync(sourceDirectory);
  fs.writeFileSync(path.join(sourceDirectory, 'README.md'), '# Project A\n');
  fs.mkdirSync(destination);

  const operation = await service.copy([sourceFile, sourceDirectory], destination);
  const copiedFile = path.join(destination, 'notes.md');
  const copiedDirectory = path.join(destination, 'project-a');
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'source notes\n');
  assert.equal(fs.readFileSync(copiedFile, 'utf8'), 'source notes\n');
  assert.equal(fs.readFileSync(path.join(copiedDirectory, 'README.md'), 'utf8'), '# Project A\n');
  assert.equal(calls.some(call => call.type === 'rebind'), false);

  await service.undo(operation.id);
  assert.equal(fs.existsSync(sourceFile), true);
  assert.equal(fs.existsSync(sourceDirectory), true);
  assert.equal(fs.existsSync(copiedFile), false);
  assert.equal(fs.existsSync(copiedDirectory), false);
  assert.equal(operation.undoTrashItems.length, 2);
  assert.equal(operation.undoTrashItems.every(item => item.target.startsWith(trashDir + path.sep)), true);
  assert.equal(operation.undoTrashItems.every(item => fs.existsSync(item.target)), true);
  assert.deepEqual(calls.find(call => call.type === 'archive')?.paths.sort(), [copiedFile, copiedDirectory].sort());
});

test('复制撤销后可从同卷废纸篓安全重做并恢复路径关联', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'notes.md');
  const destination = path.join(managedRoot, 'copies');
  const target = path.join(destination, 'notes.md');
  fs.writeFileSync(source, 'source notes\n');
  fs.mkdirSync(destination);

  const operation = await service.copy([source], destination);
  await service.undo(operation.id);
  const trashTarget = operation.undoTrashItems[0].target;
  const redone = await service.redo(operation.id);

  assert.equal(fs.readFileSync(source, 'utf8'), 'source notes\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'source notes\n');
  assert.equal(fs.existsSync(trashTarget), false);
  assert.equal(redone.undoneAt, null);
  assert.deepEqual(calls.at(-1), {
    type: 'restore',
    paths: [target],
    snapshot: operation.undoConfigSnapshot
  });
});

test('复制到同一目录使用 Finder 式副本名称且从不覆盖现有内容', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const source = path.join(managedRoot, 'notes.md');
  fs.writeFileSync(source, 'original\n');

  const first = await service.copy([source], managedRoot);
  const second = await service.copy([source], managedRoot);
  assert.equal(path.basename(first.items[0].target), 'notes 副本.md');
  assert.equal(path.basename(second.items[0].target), 'notes 副本 2.md');
  assert.equal(fs.readFileSync(source, 'utf8'), 'original\n');
  assert.equal(fs.readFileSync(first.items[0].target, 'utf8'), 'original\n');
  assert.equal(fs.readFileSync(second.items[0].target, 'utf8'), 'original\n');
});

test('同名冲突预览支持保留两者、跳过和替换三种批量策略', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const source = path.join(sourceDirectory, 'notes.md');
  const target = path.join(destinationDirectory, 'notes.md');
  fs.writeFileSync(source, 'new\n');
  fs.writeFileSync(target, 'old\n');

  const keepBoth = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'keep-both' });
  const skip = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'skip' });
  const replace = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'replace' });

  assert.equal(path.basename(keepBoth.items[0].target), 'notes 副本.md');
  assert.equal(keepBoth.items[0].conflictAction, 'keep-both');
  assert.equal(skip.items[0].skipped, true);
  assert.equal(skip.skipCount, 1);
  assert.equal(replace.items[0].target, target);
  assert.equal(replace.items[0].conflictAction, 'replace');
  assert.match(replace.items[0].targetRevisionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(replace.replaceCount, 1);
  assert.notEqual(keepBoth.previewToken, replace.previewToken);
});

test('跳过冲突不会修改来源或目标，也不会生成可撤销的伪操作', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const source = path.join(sourceDirectory, 'notes.md');
  const target = path.join(destinationDirectory, 'notes.md');
  fs.writeFileSync(source, 'new\n');
  fs.writeFileSync(target, 'old\n');

  const preview = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'skip' });
  const operation = await service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'copy',
    conflictPolicy: 'skip'
  });

  assert.equal(fs.readFileSync(source, 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'old\n');
  assert.deepEqual(operation.items, []);
  assert.equal(operation.undoable, false);
  assert.equal(operation.skippedCount, 1);
});

test('批量跳过冲突时仍完整传输非冲突项并清理临时文件', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const conflictingSource = path.join(sourceDirectory, 'a.txt');
  const safeSource = path.join(sourceDirectory, 'longer.txt');
  fs.writeFileSync(conflictingSource, 'new conflict\n');
  fs.writeFileSync(safeSource, 'safe\n');
  fs.writeFileSync(path.join(destinationDirectory, 'a.txt'), 'old conflict\n');

  const preview = await service.previewTransfer(
    [conflictingSource, safeSource],
    destinationDirectory,
    'copy',
    { conflictPolicy: 'skip' }
  );
  const operation = await service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [conflictingSource, safeSource],
    destinationDirectory,
    mode: 'copy',
    conflictPolicy: 'skip'
  });

  assert.equal(fs.readFileSync(path.join(destinationDirectory, 'a.txt'), 'utf8'), 'old conflict\n');
  assert.equal(fs.readFileSync(path.join(destinationDirectory, 'longer.txt'), 'utf8'), 'safe\n');
  assert.equal(operation.items.length, 1);
  assert.equal(operation.skippedCount, 1);
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-partial-')), false);
});

test('替换冲突先保留旧目标，成功后提交新内容且不残留隐藏备份', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const source = path.join(sourceDirectory, 'notes.md');
  const target = path.join(destinationDirectory, 'notes.md');
  fs.writeFileSync(source, 'new\n');
  fs.writeFileSync(target, 'old\n');

  const preview = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'replace' });
  const operation = await service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'copy',
    conflictPolicy: 'replace'
  });

  assert.equal(fs.readFileSync(source, 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new\n');
  assert.equal(operation.undoable, false);
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-replaced-')), false);
});

test('替换提交失败会恢复原目标并清理准备副本', async (t) => {
  let shouldFail = true;
  const { managedRoot, service } = createFixture(t, {
    hooks: {
      beforeTargetCommit: () => {
        if (shouldFail) throw new Error('simulated commit failure');
      }
    }
  });
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const source = path.join(sourceDirectory, 'notes.md');
  const target = path.join(destinationDirectory, 'notes.md');
  fs.writeFileSync(source, 'new\n');
  fs.writeFileSync(target, 'old\n');

  const preview = await service.previewTransfer([source], destinationDirectory, 'copy', { conflictPolicy: 'replace' });
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'copy',
    conflictPolicy: 'replace'
  }), /simulated commit failure/);
  shouldFail = false;

  assert.equal(fs.readFileSync(source, 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'old\n');
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-')), false);
});

test('移动项目根目录或 Git 结构前必须显式确认风险', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const source = path.join(managedRoot, 'project-a');
  const destination = path.join(managedRoot, 'destination');
  fs.mkdirSync(path.join(source, '.gitfinder'), { recursive: true });
  fs.mkdirSync(path.join(source, 'packages', 'api', '.git'), { recursive: true });
  fs.writeFileSync(path.join(source, '.gitfinder', 'project.json'), '{}\n');
  fs.mkdirSync(destination);

  const preview = await service.previewTransfer([source], destination, 'move');
  assert.equal(preview.requiresStructureRiskAcknowledgement, true);
  assert.equal(preview.structureRiskCount, 2);
  assert.match(preview.items[0].structureRisks.join(' '), /项目身份/);
  assert.match(preview.items[0].structureRisks.join(' '), /Git 仓库/);

  const request = {
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory: destination,
    mode: 'move',
    conflictPolicy: preview.conflictPolicy
  };
  await assert.rejects(() => service.applyTransfer(request), /风险/);
  assert.equal(fs.existsSync(source), true);

  await service.applyTransfer({ ...request, structureRiskAcknowledged: true });
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(path.join(destination, 'project-a')), true);
});

test('复制拒绝受管根之外的目标和复制到目录自身内部', async (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const source = path.join(managedRoot, 'project-a');
  const outside = path.join(tempRoot, 'outside');
  fs.mkdirSync(source);
  fs.mkdirSync(outside);

  await assert.rejects(() => service.copy([source], outside), /不在受管开发目录中/);
  await assert.rejects(() => service.copy([source], source), /自身内部/);
  assert.deepEqual(fs.readdirSync(source), []);
});

test('外部导入预览零写入并明确规划同名副本', async (t) => {
  const { tempRoot, managedRoot, historyDir, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside');
  const source = path.join(outside, 'notes.md');
  const existing = path.join(managedRoot, 'notes.md');
  fs.mkdirSync(outside);
  fs.writeFileSync(source, 'external\n');
  fs.writeFileSync(existing, 'managed\n');
  const before = fs.readdirSync(managedRoot).sort();

  const preview = await service.previewImport([source], managedRoot);

  assert.equal(preview.mode, 'copy');
  assert.equal(preview.overwrite, false);
  assert.equal(preview.conflictCount, 1);
  assert.equal(preview.items[0].targetName, 'notes 副本.md');
  assert.equal(preview.items[0].renamedForConflict, true);
  assert.equal(preview.validations.every(item => item.passed), true);
  assert.match(preview.previewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readdirSync(managedRoot).sort(), before);
  assert.equal(fs.existsSync(historyDir), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'external\n');
});

test('确认外部导入后复制文件和目录，重复请求幂等且可撤销', async (t) => {
  const { tempRoot, managedRoot, trashDir, service } = createFixture(t);
  const outside = path.join(tempRoot, 'outside');
  const sourceFile = path.join(outside, 'notes.md');
  const sourceDirectory = path.join(outside, 'sample-project');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(sourceFile, 'external notes\n');
  fs.writeFileSync(path.join(sourceDirectory, 'README.md'), '# Imported\n');
  fs.writeFileSync(path.join(managedRoot, 'notes.md'), 'existing notes\n');

  const preview = await service.previewImport([sourceFile, sourceDirectory], managedRoot);
  const request = {
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: preview.items.map(item => item.source),
    destinationDirectory: preview.destination
  };
  const operation = await service.applyImport(request);
  const repeated = await service.applyImport(request);

  assert.equal(operation.type, 'import');
  assert.equal(repeated.idempotent, true);
  assert.equal(service.getHistory().filter(item => item.id === operation.id).length, 1);
  assert.equal(fs.readFileSync(path.join(managedRoot, 'notes.md'), 'utf8'), 'existing notes\n');
  assert.equal(fs.readFileSync(path.join(managedRoot, 'notes 副本.md'), 'utf8'), 'external notes\n');
  assert.equal(fs.readFileSync(path.join(managedRoot, 'sample-project', 'README.md'), 'utf8'), '# Imported\n');
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'external notes\n');
  assert.equal(fs.existsSync(sourceDirectory), true);

  await service.undo(operation.id);
  assert.equal(fs.existsSync(path.join(managedRoot, 'notes 副本.md')), false);
  assert.equal(fs.existsSync(path.join(managedRoot, 'sample-project')), false);
  assert.equal(operation.undoTrashItems.every(item => item.target.startsWith(trashDir + path.sep)), true);
  assert.equal(operation.undoTrashItems.every(item => fs.existsSync(item.target)), true);
});

test('目标冲突或来源内容在预览后变化时拒绝导入且不覆盖', async (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const source = path.join(tempRoot, 'draft.txt');
  fs.writeFileSync(source, 'draft\n');

  const conflictPreview = await service.previewImport([source], managedRoot);
  const target = path.join(managedRoot, 'draft.txt');
  fs.writeFileSync(target, 'arrived later\n');
  await assert.rejects(() => service.applyImport({
    operationId: conflictPreview.operationId,
    previewToken: conflictPreview.previewToken,
    sourcePaths: [source],
    destinationDirectory: managedRoot
  }), /预览已过期/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'arrived later\n');
  assert.equal(fs.existsSync(path.join(managedRoot, 'draft 副本.txt')), false);

  const changedSource = path.join(tempRoot, 'changed.txt');
  fs.writeFileSync(changedSource, 'before\n');
  const sourcePreview = await service.previewImport([changedSource], managedRoot);
  fs.appendFileSync(changedSource, 'after\n');
  await assert.rejects(() => service.applyImport({
    operationId: sourcePreview.operationId,
    previewToken: sourcePreview.previewToken,
    sourcePaths: [changedSource],
    destinationDirectory: managedRoot
  }), /预览已过期/);
  assert.equal(fs.existsSync(path.join(managedRoot, 'changed.txt')), false);
});

test('外部导入拒绝磁盘根、符号链接、过量来源和非受管目标', async (t) => {
  const { tempRoot, managedRoot, service } = createFixture(t);
  const outsideDirectory = path.join(tempRoot, 'outside');
  const source = path.join(outsideDirectory, 'source.txt');
  const link = path.join(tempRoot, 'source-link.txt');
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(source, 'source\n');
  fs.symlinkSync(source, link);

  await assert.rejects(() => service.previewImport([path.parse(tempRoot).root], managedRoot), /磁盘根目录/);
  await assert.rejects(() => service.previewImport([link], managedRoot), /符号链接/);
  await assert.rejects(() => service.previewImport(Array.from({ length: 101 }, () => source), managedRoot), /一次最多导入 100 项/);
  await assert.rejects(() => service.previewImport([source], outsideDirectory), /不在受管开发目录中/);
});

test('传输预检递归统计内容并区分同卷原子移动与跨卷复制删除', async (t) => {
  let destinationDirectory = '';
  const { managedRoot, historyDir, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0
  });
  const sameVolumeDestination = path.join(managedRoot, 'same-volume');
  destinationDirectory = path.join(managedRoot, 'other-volume');
  const sourceDirectory = path.join(managedRoot, 'project-a');
  fs.mkdirSync(path.join(sourceDirectory, 'src'), { recursive: true });
  fs.mkdirSync(sameVolumeDestination);
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(path.join(sourceDirectory, 'README.md'), '12345');
  fs.writeFileSync(path.join(sourceDirectory, 'src', 'index.js'), '1234567');

  const crossVolume = await service.previewTransfer([sourceDirectory], destinationDirectory, 'move');
  assert.equal(crossVolume.items[0].transferKind, 'copy-delete');
  assert.equal(crossVolume.crossVolumeCount, 1);
  assert.equal(crossVolume.sameVolumeCount, 0);
  assert.equal(crossVolume.totalBytes, 12);
  assert.equal(crossVolume.requiredBytes, 12);
  assert.equal(crossVolume.fileCount, 2);
  assert.equal(crossVolume.directoryCount, 2);
  assert.equal(crossVolume.spaceSufficient, true);
  assert.equal(fs.existsSync(path.join(destinationDirectory, 'project-a')), false);
  assert.equal(fs.existsSync(historyDir), false);

  const sameVolume = await service.previewTransfer([sourceDirectory], sameVolumeDestination, 'move');
  assert.equal(sameVolume.items[0].transferKind, 'atomic-move');
  assert.equal(sameVolume.requiredBytes, 0);
});

test('目标卷空间不足时应用传输在写入前拒绝', async (t) => {
  let destinationDirectory = '';
  const { managedRoot, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 2, bsize: 1 }),
    spaceReserveBytes: 0
  });
  destinationDirectory = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'large.bin');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(source, Buffer.alloc(16, 7));

  const preview = await service.previewTransfer([source], destinationDirectory, 'move');
  assert.equal(preview.spaceSufficient, false);
  assert.equal(preview.validations.find(item => item.key === 'space').passed, false);
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'move'
  }), /可用空间不足/);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(path.join(destinationDirectory, 'large.bin')), false);
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-partial-')), false);
});

test('跨卷移动先准备并提交完整目标，随后才删除来源', async (t) => {
  let destinationDirectory = '';
  let source = '';
  const observations = [];
  const { managedRoot, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0,
    hooks: {
      beforeCommit: preview => observations.push({
        phase: 'before-commit',
        sourceExists: fs.existsSync(source),
        targetExists: fs.existsSync(preview.items[0].target)
      }),
      beforeDeleteSource: item => observations.push({
        phase: 'before-delete-source',
        sourceExists: fs.existsSync(item.source),
        targetExists: fs.existsSync(item.target),
        targetContent: fs.readFileSync(item.target, 'utf8')
      })
    }
  });
  destinationDirectory = path.join(managedRoot, 'destination');
  source = path.join(managedRoot, 'notes.txt');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(source, 'cross-volume-safe\n');

  const preview = await service.previewTransfer([source], destinationDirectory, 'move');
  const operation = await service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'move'
  });

  assert.deepEqual(observations, [
    { phase: 'before-commit', sourceExists: true, targetExists: false },
    { phase: 'before-delete-source', sourceExists: true, targetExists: true, targetContent: 'cross-volume-safe\n' }
  ]);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(path.join(destinationDirectory, 'notes.txt'), 'utf8'), 'cross-volume-safe\n');
  assert.equal(operation.transfer.crossVolumeCount, 1);
});

test('复制后逐文件校验字节，内容被改写时拒绝提交最终目标', async (t) => {
  let destinationDirectory = '';
  const { managedRoot, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0,
    hooks: {
      afterCopyFile: ({ target }) => fs.writeFileSync(target, 'XXXXXXXXXXXXXX')
    }
  });
  destinationDirectory = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'notes.txt');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(source, 'original-bytes');

  const preview = await service.previewTransfer([source], destinationDirectory, 'copy');
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'copy'
  }), /字节校验失败/);

  assert.equal(fs.readFileSync(source, 'utf8'), 'original-bytes');
  assert.equal(fs.existsSync(path.join(destinationDirectory, 'notes.txt')), false);
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-partial-')), false);
  assert.equal(service.getTransferStatus(preview.operationId).state, 'failed');
});

test('活动传输读取历史时不会被启动恢复误删临时副本', async (t) => {
  let destinationDirectory = '';
  let recoveryDuringTransfer = null;
  let serviceReference = null;
  const { managedRoot, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0,
    hooks: {
      beforeCommit: () => {
        serviceReference.getHistory();
        recoveryDuringTransfer = serviceReference.getRecoveryStatus();
      }
    }
  });
  serviceReference = service;
  destinationDirectory = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'notes.txt');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(source, 'safe while active\n');

  const preview = await service.previewTransfer([source], destinationDirectory, 'copy');
  await service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'copy'
  });

  assert.equal(recoveryDuringTransfer.active, true);
  assert.equal(fs.readFileSync(path.join(destinationDirectory, 'notes.txt'), 'utf8'), 'safe while active\n');
});

test('操作历史写入失败会回滚文件并反向恢复路径关联', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const source = path.join(managedRoot, 'project-a');
  const destinationDirectory = path.join(managedRoot, 'archive');
  const target = path.join(destinationDirectory, 'project-a');
  fs.mkdirSync(source);
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(path.join(source, 'README.md'), '# rollback\n');
  service._record = () => { throw new Error('history write failed'); };

  const preview = await service.previewTransfer([source], destinationDirectory, 'move');
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'move'
  }), /history write failed/);

  assert.equal(fs.readFileSync(path.join(source, 'README.md'), 'utf8'), '# rollback\n');
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(calls.filter(call => call.type === 'rebind'), [
    { type: 'rebind', mappings: [{ from: source, to: target }] },
    { type: 'rebind', mappings: [{ from: target, to: source }] }
  ]);
  assert.equal(service.getTransferStatus(preview.operationId).state, 'failed');
});

test('准备阶段取消会清理临时内容并完整保留来源', async (t) => {
  let destinationDirectory = '';
  let serviceReference = null;
  const { managedRoot, service } = createFixture(t, {
    deviceForPath: (candidatePath, stat) => candidatePath.startsWith(destinationDirectory) ? 22 : (stat?.dev || 11),
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0,
    copyChunkBytes: 1024,
    onTransferProgress: status => {
      if (status.phase === 'preparing' && status.bytesTransferred >= 1024 && !status.cancelRequested) {
        serviceReference.cancelTransfer(status.operationId);
      }
    }
  });
  serviceReference = service;
  destinationDirectory = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'large.bin');
  fs.mkdirSync(destinationDirectory);
  fs.writeFileSync(source, Buffer.alloc(32 * 1024, 9));

  const preview = await service.previewTransfer([source], destinationDirectory, 'move');
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [source],
    destinationDirectory,
    mode: 'move'
  }), /已取消/);

  const status = service.getTransferStatus(preview.operationId);
  assert.equal(status.state, 'cancelled');
  assert.equal(status.bytesTransferred >= 1024, true);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(path.join(destinationDirectory, 'large.bin')), false);
  assert.equal(fs.readdirSync(destinationDirectory).some(name => name.startsWith('.gitfinder-partial-')), false);
});

test('传输预览会因目录内文件变化而过期且保持零写入', async (t) => {
  const { managedRoot, service } = createFixture(t, {
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 }),
    spaceReserveBytes: 0
  });
  const sourceDirectory = path.join(managedRoot, 'source');
  const destinationDirectory = path.join(managedRoot, 'destination');
  fs.mkdirSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory);
  const nestedFile = path.join(sourceDirectory, 'nested.txt');
  fs.writeFileSync(nestedFile, 'before\n');

  const preview = await service.previewTransfer([sourceDirectory], destinationDirectory, 'copy');
  fs.appendFileSync(nestedFile, 'after\n');
  await assert.rejects(() => service.applyTransfer({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [sourceDirectory],
    destinationDirectory,
    mode: 'copy'
  }), /预览已过期/);
  assert.equal(fs.existsSync(path.join(destinationDirectory, 'source')), false);
});

test('启动恢复只清理记录中的隐藏临时项，不触碰来源或最终目标', (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'source.txt');
  const target = path.join(destination, 'source.txt');
  const staging = path.join(destination, '.gitfinder-partial-deadbeef');
  fs.mkdirSync(destination);
  fs.writeFileSync(source, 'source\n');
  fs.writeFileSync(staging, 'partial\n');
  fs.mkdirSync(historyDir);
  fs.writeFileSync(path.join(historyDir, 'active-file-transfer.json'), JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_deadbeef',
    operationType: 'move',
    destination,
    phase: 'preparing',
    items: [{ source, target, staging, transferKind: 'copy-delete', state: 'copying' }]
  }));

  const recovery = service.getRecoveryStatus();
  assert.deepEqual(recovery.cleanedStagingPaths, [staging]);
  assert.deepEqual(recovery.needsReview, []);
  assert.equal(fs.existsSync(staging), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'source\n');
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(historyDir, 'active-file-transfer.json')), false);
});

test('中断后来源与目标均存在时恢复流程原样保留并要求人工检查', (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'source.txt');
  const target = path.join(destination, 'source.txt');
  const staging = path.join(destination, '.gitfinder-partial-feedface');
  fs.mkdirSync(destination);
  fs.writeFileSync(source, 'source\n');
  fs.writeFileSync(target, 'source\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-file-transfer.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_feedface',
    operationType: 'move',
    destination,
    phase: 'committing',
    items: [{ source, target, staging, transferKind: 'copy-delete', state: 'target-committed' }]
  }));

  const recovery = service.getRecoveryStatus();
  assert.equal(recovery.needsReview.length, 1);
  assert.match(recovery.needsReview[0].reason, /来源和目标均存在/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'source\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'source\n');
  assert.equal(fs.existsSync(journalPath), true);
});

test('文件已经完整移动但历史未落盘时会补齐路径关联和撤销记录', async (t) => {
  const { managedRoot, historyDir, calls, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'source.txt');
  const target = path.join(destination, 'source.txt');
  const staging = path.join(destination, '.gitfinder-partial-completed');
  fs.mkdirSync(destination);
  fs.writeFileSync(target, 'completed move\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-file-transfer.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_c0ffee12',
    operationType: 'move',
    destination,
    previewToken: 'a'.repeat(64),
    phase: 'committing',
    items: [{ source, target, staging, transferKind: 'atomic-move', state: 'target-committed' }]
  }));

  const recovery = service.getRecoveryStatus();

  assert.equal(recovery.completedOperationId, 'transfer_1234567890123_c0ffee12');
  assert.equal(recovery.recoveredAction, 'completed-committed-transfer');
  assert.equal(recovery.configRebound, true);
  assert.deepEqual(recovery.needsReview, []);
  assert.deepEqual(calls.filter(call => call.type === 'rebind'), [
    { type: 'rebind', mappings: [{ from: source, to: target }] }
  ]);
  assert.equal(service.getHistory()[0].id, recovery.completedOperationId);
  assert.equal(service.getHistory()[0].recoveredAt > 0, true);
  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'completed move\n');

  await service.undo(recovery.completedOperationId);
  assert.equal(fs.readFileSync(source, 'utf8'), 'completed move\n');
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(calls.filter(call => call.type === 'rebind').at(-1), {
    type: 'rebind', mappings: [{ from: target, to: source }]
  });
});

test('文件已经完整复制但历史未落盘时会补齐可撤销记录', async (t) => {
  const { managedRoot, historyDir, calls, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'source.txt');
  const target = path.join(destination, 'source.txt');
  const staging = path.join(destination, '.gitfinder-partial-copydone');
  fs.mkdirSync(destination);
  fs.writeFileSync(source, 'completed copy\n');
  fs.writeFileSync(target, 'completed copy\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-file-transfer.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_c0a1d00e',
    operationType: 'copy',
    destination,
    previewToken: 'b'.repeat(64),
    phase: 'committing',
    items: [{ source, target, staging, transferKind: 'copy', state: 'target-committed' }]
  }));

  const recovery = service.getRecoveryStatus();

  assert.equal(recovery.completedOperationId, 'transfer_1234567890123_c0a1d00e');
  assert.equal(recovery.configRebound, false);
  assert.deepEqual(calls.filter(call => call.type === 'rebind'), []);
  assert.equal(service.getHistory()[0].type, 'copy');
  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'completed copy\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'completed copy\n');

  await service.undo(recovery.completedOperationId);
  assert.equal(fs.readFileSync(source, 'utf8'), 'completed copy\n');
  assert.equal(fs.existsSync(target), false);
});

test('批量传输只完成部分项目时不会清除记录或猜测回滚', (t) => {
  const { managedRoot, historyDir, calls, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const firstSource = path.join(managedRoot, 'first.txt');
  const firstTarget = path.join(destination, 'first.txt');
  const secondSource = path.join(managedRoot, 'second.txt');
  const secondTarget = path.join(destination, 'second.txt');
  fs.mkdirSync(destination);
  fs.writeFileSync(firstTarget, 'first committed\n');
  fs.writeFileSync(secondSource, 'second untouched\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-file-transfer.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_aa11bb22',
    operationType: 'move',
    destination,
    phase: 'committing',
    items: [
      { source: firstSource, target: firstTarget, staging: path.join(destination, '.gitfinder-partial-first'), transferKind: 'atomic-move', state: 'target-committed' },
      { source: secondSource, target: secondTarget, staging: path.join(destination, '.gitfinder-partial-second'), transferKind: 'atomic-move', state: 'pending-atomic-move' }
    ]
  }));

  const recovery = service.getRecoveryStatus();

  assert.equal(recovery.needsReview.length, 2);
  assert.equal(recovery.completedOperationId, null);
  assert.equal(calls.some(call => call.type === 'rebind'), false);
  assert.equal(fs.existsSync(journalPath), true);
  assert.equal(fs.readFileSync(firstTarget, 'utf8'), 'first committed\n');
  assert.equal(fs.readFileSync(secondSource, 'utf8'), 'second untouched\n');
});

test('来源和目标均缺失时保留可能是唯一副本的传输临时项', (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const destination = path.join(managedRoot, 'destination');
  const source = path.join(managedRoot, 'missing.txt');
  const target = path.join(destination, 'missing.txt');
  const staging = path.join(destination, '.gitfinder-partial-onlycopy');
  fs.mkdirSync(destination);
  fs.writeFileSync(staging, 'only remaining copy\n');
  fs.mkdirSync(historyDir);
  fs.writeFileSync(path.join(historyDir, 'active-file-transfer.json'), JSON.stringify({
    version: 1,
    operationId: 'transfer_1234567890123_0a1cc0f1',
    operationType: 'move',
    destination,
    phase: 'committing',
    items: [{ source, target, staging, transferKind: 'copy-delete', state: 'copying' }]
  }));

  const recovery = service.getRecoveryStatus();

  assert.equal(recovery.needsReview.length >= 1, true);
  assert.match(recovery.needsReview[0].reason, /唯一副本/);
  assert.equal(fs.readFileSync(staging, 'utf8'), 'only remaining copy\n');
});

test('损坏的传输恢复记录不会触碰任何文件', (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const source = path.join(managedRoot, 'source.txt');
  const staging = path.join(managedRoot, '.gitfinder-partial-preserved');
  fs.writeFileSync(source, 'source\n');
  fs.writeFileSync(staging, 'partial\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-file-transfer.json');
  fs.writeFileSync(journalPath, '{broken transfer journal', { mode: 0o600 });

  const recovery = service.getRecoveryStatus();

  assert.equal(recovery.needsReview.length, 1);
  assert.match(recovery.needsReview[0].reason, /恢复记录损坏/);
  assert.equal(fs.readFileSync(journalPath, 'utf8'), '{broken transfer journal');
  assert.equal(fs.readFileSync(source, 'utf8'), 'source\n');
  assert.equal(fs.readFileSync(staging, 'utf8'), 'partial\n');
});

test('批量重命名预览零写入，应用后可完整撤销和重做', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const first = path.join(managedRoot, 'draft-one.txt');
  const second = path.join(managedRoot, 'draft-two.txt');
  fs.writeFileSync(first, 'one\n');
  fs.writeFileSync(second, 'two\n');

  const preview = await service.previewBatchRename([first, second], {
    mode: 'replace',
    searchText: 'draft',
    replacementText: 'final'
  });

  assert.equal(preview.canApply, true);
  assert.equal(preview.changedCount, 2);
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
  assert.equal(fs.existsSync(path.join(managedRoot, 'final-one.txt')), false);

  const operation = await service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [first, second],
    options: preview.options
  });
  const finalOne = path.join(managedRoot, 'final-one.txt');
  const finalTwo = path.join(managedRoot, 'final-two.txt');
  assert.equal(operation.type, 'rename');
  assert.equal(operation.batch, true);
  assert.equal(fs.readFileSync(finalOne, 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(finalTwo, 'utf8'), 'two\n');
  assert.equal(calls.filter(call => call.type === 'rebind').length, 1);

  await service.undo(operation.id);
  assert.equal(fs.readFileSync(first, 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'two\n');
  await service.redo(operation.id);
  assert.equal(fs.readFileSync(finalOne, 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(finalTwo, 'utf8'), 'two\n');
});

test('批量格式化支持名称互换，并保持撤销重做安全', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const photoOne = path.join(managedRoot, 'Photo 1.txt');
  const photoTwo = path.join(managedRoot, 'Photo 2.txt');
  fs.writeFileSync(photoOne, 'original one\n');
  fs.writeFileSync(photoTwo, 'original two\n');

  const preview = await service.previewBatchRename([photoTwo, photoOne], {
    mode: 'format',
    formatName: 'Photo',
    startAt: 1,
    counterWidth: 1
  });
  const operation = await service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [photoTwo, photoOne],
    options: preview.options
  });

  assert.equal(fs.readFileSync(photoOne, 'utf8'), 'original two\n');
  assert.equal(fs.readFileSync(photoTwo, 'utf8'), 'original one\n');
  await service.undo(operation.id);
  assert.equal(fs.readFileSync(photoOne, 'utf8'), 'original one\n');
  assert.equal(fs.readFileSync(photoTwo, 'utf8'), 'original two\n');
  await service.redo(operation.id);
  assert.equal(fs.readFileSync(photoOne, 'utf8'), 'original two\n');
  assert.equal(fs.readFileSync(photoTwo, 'utf8'), 'original one\n');
});

test('批量重命名拒绝外部占用、重复目标和过期预览', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const first = path.join(managedRoot, 'draft-one.txt');
  const second = path.join(managedRoot, 'draft-two.txt');
  const occupied = path.join(managedRoot, 'final-one.txt');
  fs.writeFileSync(first, 'one\n');
  fs.writeFileSync(second, 'two\n');
  fs.writeFileSync(occupied, 'occupied\n');

  const conflict = await service.previewBatchRename([first, second], {
    mode: 'replace',
    searchText: 'draft',
    replacementText: 'final'
  });
  assert.equal(conflict.canApply, false);
  assert.equal(conflict.invalidCount, 1);
  assert.equal(fs.readFileSync(occupied, 'utf8'), 'occupied\n');

  const duplicateFirst = path.join(managedRoot, 'one-copy.txt');
  const duplicateSecond = path.join(managedRoot, 'one-copy-copy.txt');
  fs.writeFileSync(duplicateFirst, 'duplicate one\n');
  fs.writeFileSync(duplicateSecond, 'duplicate two\n');
  const duplicate = await service.previewBatchRename([duplicateFirst, duplicateSecond], {
    mode: 'replace',
    searchText: '-copy',
    replacementText: ''
  });
  assert.equal(duplicate.canApply, false);
  assert.equal(duplicate.invalidCount, 2);

  fs.rmSync(occupied);
  const preview = await service.previewBatchRename([first, second], {
    mode: 'replace',
    searchText: 'draft',
    replacementText: 'final'
  });
  fs.appendFileSync(first, 'changed after preview\n');
  await assert.rejects(() => service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [first, second],
    options: preview.options
  }), /预览已过期/);
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
});

test('批量重命名执行失败会回滚全部项目并清理临时路径', async (t) => {
  const { managedRoot, service } = createFixture(t, {
    hooks: {
      afterBatchRenameCommit: (_item, index) => {
        if (index === 0) throw new Error('simulated commit failure');
      }
    }
  });
  const first = path.join(managedRoot, 'draft-one.txt');
  const second = path.join(managedRoot, 'draft-two.txt');
  fs.writeFileSync(first, 'one\n');
  fs.writeFileSync(second, 'two\n');
  const preview = await service.previewBatchRename([first, second], {
    mode: 'replace', searchText: 'draft', replacementText: 'final'
  });

  await assert.rejects(() => service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [first, second],
    options: preview.options
  }), /simulated commit failure/);
  assert.equal(fs.readFileSync(first, 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'two\n');
  assert.equal(fs.readdirSync(managedRoot).some(name => name.startsWith('.gitfinder-rename-')), false);
  assert.equal(service.getHistory().length, 0);
});

test('项目或 Git 结构批量重命名前必须显式确认风险', async (t) => {
  const { managedRoot, service } = createFixture(t);
  const repo = path.join(managedRoot, 'repo-one');
  const folder = path.join(managedRoot, 'repo-two');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(folder);
  const preview = await service.previewBatchRename([repo, folder], {
    mode: 'replace', searchText: 'repo', replacementText: 'project'
  });

  assert.equal(preview.requiresStructureRiskAcknowledgement, true);
  await assert.rejects(() => service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [repo, folder],
    options: preview.options
  }), /显式确认风险/);
  assert.equal(fs.existsSync(repo), true);
  assert.equal(fs.existsSync(folder), true);

  await service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [repo, folder],
    options: preview.options,
    structureRiskAcknowledged: true
  });
  assert.equal(fs.existsSync(path.join(managedRoot, 'project-one', '.git')), true);
  assert.equal(fs.existsSync(path.join(managedRoot, 'project-two')), true);
});

test('批量重命名请求可安全重试，且只有一个名称变化时仍清理日志', async (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const first = path.join(managedRoot, 'alpha.txt');
  const second = path.join(managedRoot, 'beta.txt');
  fs.writeFileSync(first, 'alpha\n');
  fs.writeFileSync(second, 'beta\n');
  const preview = await service.previewBatchRename([first, second], {
    mode: 'replace', searchText: 'alpha', replacementText: 'final'
  });
  const request = {
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [first, second],
    options: preview.options
  };

  const operation = await service.applyBatchRename(request);
  const retried = await service.applyBatchRename(request);
  assert.equal(operation.itemCount, 1);
  assert.equal(retried.id, operation.id);
  assert.equal(retried.idempotent, true);
  assert.equal(fs.readFileSync(path.join(managedRoot, 'final.txt'), 'utf8'), 'alpha\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'beta\n');
  assert.equal(fs.existsSync(path.join(historyDir, 'active-batch-rename.json')), false);
});

test('批量重命名历史写入失败会回滚文件和路径关联', async (t) => {
  const { managedRoot, calls, service } = createFixture(t);
  const first = path.join(managedRoot, 'draft-one.txt');
  const second = path.join(managedRoot, 'draft-two.txt');
  fs.writeFileSync(first, 'one\n');
  fs.writeFileSync(second, 'two\n');
  const preview = await service.previewBatchRename([first, second], {
    mode: 'replace', searchText: 'draft', replacementText: 'final'
  });
  service._record = () => { throw new Error('history unavailable'); };

  await assert.rejects(() => service.applyBatchRename({
    operationId: preview.operationId,
    previewToken: preview.previewToken,
    sourcePaths: [first, second],
    options: preview.options
  }), /history unavailable/);
  assert.equal(fs.readFileSync(first, 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'two\n');
  const rebinds = calls.filter(call => call.type === 'rebind');
  assert.equal(rebinds.length, 2);
  assert.deepEqual(rebinds[1].mappings, [...rebinds[0].mappings].reverse().map(mapping => ({
    from: mapping.to,
    to: mapping.from
  })));
});

test('启动恢复会回滚只完成暂存的批量重命名', (t) => {
  const { managedRoot, historyDir, service } = createFixture(t);
  const first = path.join(managedRoot, 'first.txt');
  const second = path.join(managedRoot, 'second.txt');
  const firstTarget = path.join(managedRoot, 'renamed-first.txt');
  const secondTarget = path.join(managedRoot, 'renamed-second.txt');
  const firstStaging = path.join(managedRoot, '.gitfinder-rename-first');
  const secondStaging = path.join(managedRoot, '.gitfinder-rename-second');
  fs.writeFileSync(firstStaging, 'first\n');
  fs.writeFileSync(second, 'second\n');
  fs.mkdirSync(historyDir);
  const journalPath = path.join(historyDir, 'active-batch-rename.json');
  fs.writeFileSync(journalPath, JSON.stringify({
    version: 1,
    operationId: 'batchrename_1234567890123_aabbccdd',
    operationType: 'rename',
    phase: 'staging',
    items: [
      { source: first, target: firstTarget, staging: firstStaging, state: 'staged' },
      { source: second, target: secondTarget, staging: secondStaging, state: 'source' }
    ]
  }));

  const recovery = service.getRecoveryStatus();
  assert.equal(recovery.recoveredAction, 'rolled-back-interrupted-batch-rename');
  assert.equal(fs.readFileSync(first, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second\n');
  assert.equal(fs.existsSync(firstStaging), false);
  assert.equal(fs.existsSync(journalPath), false);
});

test('启动恢复会为已提交的批量重命名补齐配置和撤销记录', (t) => {
  const { managedRoot, historyDir, calls, service } = createFixture(t);
  const first = path.join(managedRoot, 'first.txt');
  const second = path.join(managedRoot, 'second.txt');
  const firstTarget = path.join(managedRoot, 'renamed-first.txt');
  const secondTarget = path.join(managedRoot, 'renamed-second.txt');
  const firstStaging = path.join(managedRoot, '.gitfinder-rename-first');
  const secondStaging = path.join(managedRoot, '.gitfinder-rename-second');
  fs.writeFileSync(firstTarget, 'first\n');
  fs.writeFileSync(secondTarget, 'second\n');
  fs.mkdirSync(historyDir);
  fs.writeFileSync(path.join(historyDir, 'active-batch-rename.json'), JSON.stringify({
    version: 1,
    operationId: 'batchrename_1234567890123_ddeeff00',
    operationType: 'rename',
    phase: 'committing',
    items: [
      { source: first, target: firstTarget, staging: firstStaging, state: 'target' },
      { source: second, target: secondTarget, staging: secondStaging, state: 'target' }
    ]
  }));

  const recovery = service.getRecoveryStatus();
  assert.equal(recovery.recoveredAction, 'completed-committed-batch-rename');
  assert.equal(recovery.completedOperationId, 'batchrename_1234567890123_ddeeff00');
  assert.equal(calls.filter(call => call.type === 'rebind').length, 1);
  assert.equal(service.getHistory()[0].batch, true);
  assert.equal(fs.readFileSync(firstTarget, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(secondTarget, 'utf8'), 'second\n');
});
