const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveFileLabelCollection, resolveManagedFileLabelPaths } = require('../src/main/ipc/config');

test('文件标签 IPC 只接受真实受管文件和文件夹并保持顺序去重', () => {
  const resolver = {
    resolveWorkspacePath(candidatePath) {
      const values = {
        '/work/a': { ok: true, path: '/work/a', type: 'directory' },
        '/work/b.txt': { ok: true, path: '/work/b.txt', type: 'file' }
      };
      return values[candidatePath] || { ok: false, message: '路径不在受管开发目录中' };
    }
  };
  assert.deepEqual(resolveManagedFileLabelPaths(['/work/a', '/work/b.txt', '/work/a'], resolver), [
    '/work/a', '/work/b.txt'
  ]);
  assert.throws(() => resolveManagedFileLabelPaths(['/outside'], resolver), /受管开发目录/);
  assert.throws(() => resolveManagedFileLabelPaths([], resolver), /1–2000/);
});

test('文件标签 IPC 拒绝符号链接越界和非普通文件类型', () => {
  assert.throws(() => resolveManagedFileLabelPaths(['/work/link'], {
    resolveWorkspacePath: () => ({ ok: false, code: 'symlink-escape', message: '路径通过符号链接离开受管开发目录' })
  }), /符号链接/);
  assert.throws(() => resolveManagedFileLabelPaths(['/work/socket'], {
    resolveWorkspacePath: () => ({ ok: true, path: '/work/socket', type: 'other' })
  }), /文件标签只适用于/);
});

test('文件标签集合只从配置派生候选路径并逐项重新验证受管边界', () => {
  const configService = {
    getFileLabels: () => ({
      version: 1,
      labels: [
        { id: 'fl_pending', name: '待处理', color: '#ff5f57', createdAt: 1 },
        { id: 'fl_client', name: '客户', color: '#0a84ff', createdAt: 2 }
      ],
      assignments: {
        '/work/a': ['fl_pending'],
        '/work/b.txt': ['fl_client'],
        '/outside/missing': ['fl_pending']
      }
    })
  };
  const fileService = {
    resolveWorkspacePath(candidatePath) {
      if (candidatePath === '/outside/missing') return { ok: false, message: '路径不在受管目录' };
      return { ok: true, path: candidatePath, type: candidatePath.endsWith('.txt') ? 'file' : 'directory' };
    },
    getFileInfo(candidatePath) {
      return {
        name: candidatePath.split('/').at(-1),
        path: candidatePath,
        type: candidatePath.endsWith('.txt') ? 'file' : 'directory',
        size: 10,
        modifiedTime: '2026-08-28T00:00:00.000Z',
        isGitRepo: candidatePath === '/work/a'
      };
    }
  };
  const result = resolveFileLabelCollection(['fl_pending', 'fl_client'], { configService, fileService });
  assert.deepEqual(result.items.map(item => item.path), ['/work/a', '/work/b.txt']);
  assert.deepEqual(result.items[0].fileLabels.map(label => label.id), ['fl_pending']);
  assert.deepEqual(result.items[0].gitStatus, { overallStatus: 'none', branch: 'Git' });
  assert.equal(result.totalAssigned, 3);
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.truncatedCount, 0);
  assert.throws(() => resolveFileLabelCollection(['fl_missing'], { configService, fileService }), /不存在/);
});

test('文件标签集合限制单次返回数量并报告截断项', () => {
  const configService = {
    getFileLabels: () => ({
      version: 1,
      labels: [{ id: 'fl_pending', name: '待处理', color: '#ff5f57', createdAt: 1 }],
      assignments: {
        '/work/a': ['fl_pending'],
        '/work/b': ['fl_pending']
      }
    })
  };
  const fileService = {
    resolveWorkspacePath: candidatePath => ({ ok: true, path: candidatePath, type: 'file' }),
    getFileInfo: candidatePath => ({ name: candidatePath.split('/').at(-1), path: candidatePath, type: 'file' })
  };
  const result = resolveFileLabelCollection(['fl_pending'], { configService, fileService, maxItems: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.totalAssigned, 2);
  assert.equal(result.truncatedCount, 1);
});
