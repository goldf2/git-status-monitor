const test = require('node:test');
const assert = require('node:assert/strict');

const FileLabels = require('../src/shared/fileLabels');

test('文件标签定义规范化名称颜色并拒绝重名', () => {
  const created = FileLabels.createLabel(FileLabels.defaultStore(), {
    name: '  待   处理  ',
    color: '#FF5F57'
  }, { idFactory: () => 'fl_pending', now: 100 });
  assert.deepEqual(created.label, {
    id: 'fl_pending',
    name: '待 处理',
    color: '#ff5f57',
    createdAt: 100
  });
  assert.throws(() => FileLabels.createLabel(created.store, {
    name: '待 处理', color: '#000000'
  }, { idFactory: () => 'fl_duplicate' }), /名称已存在/);
});

test('多路径标签分配支持增删且不覆盖未触及标签', () => {
  const store = {
    version: 1,
    labels: [
      { id: 'fl_pending', name: '待处理', color: '#ff5f57', createdAt: 1 },
      { id: 'fl_client', name: '客户', color: '#0a84ff', createdAt: 2 }
    ],
    assignments: {
      '/work/a': ['fl_pending'],
      '/work/b': ['fl_client']
    }
  };
  const next = FileLabels.updateAssignments(store, ['/work/a', '/work/b'], {
    addIds: ['fl_client'],
    removeIds: ['fl_pending']
  });
  assert.deepEqual(next.assignments, {
    '/work/a': ['fl_client'],
    '/work/b': ['fl_client']
  });
  assert.deepEqual(FileLabels.labelsForPaths(next, ['/work/a'])['/work/a'].map(label => label.name), ['客户']);
});

test('删除标签会同步移除所有路径上的孤立分配', () => {
  const store = {
    version: 1,
    labels: [
      { id: 'fl_keep', name: '保留', color: '#30d158', createdAt: 1 },
      { id: 'fl_remove', name: '删除', color: '#ff5f57', createdAt: 2 }
    ],
    assignments: {
      '/work/a': ['fl_remove'],
      '/work/b': ['fl_keep', 'fl_remove']
    }
  };
  const next = FileLabels.deleteLabel(store, 'fl_remove');
  assert.deepEqual(next.labels.map(label => label.id), ['fl_keep']);
  assert.deepEqual(next.assignments, { '/work/b': ['fl_keep'] });
});

test('损坏标签配置按数量和引用边界恢复', () => {
  const labels = Array.from({ length: FileLabels.MAX_LABELS + 5 }, (_, index) => ({
    id: `fl_label_${index}`,
    name: `标签 ${index}`,
    color: '#123456',
    createdAt: index + 1
  }));
  const normalized = FileLabels.normalizeStore({
    version: 99,
    labels,
    assignments: {
      '/work/a': ['fl_label_0', 'missing', 'fl_label_0'],
      '': ['fl_label_1']
    }
  });
  assert.equal(normalized.version, FileLabels.VERSION);
  assert.equal(normalized.labels.length, FileLabels.MAX_LABELS);
  assert.deepEqual(normalized.assignments, { '/work/a': ['fl_label_0'] });
});

test('标签集合按 OR 语义返回路径并统计每个标签的直接分配数', () => {
  const store = {
    version: 1,
    labels: [
      { id: 'fl_pending', name: '待处理', color: '#ff5f57', createdAt: 1 },
      { id: 'fl_client', name: '客户', color: '#0a84ff', createdAt: 2 }
    ],
    assignments: {
      '/work/a': ['fl_pending'],
      '/work/b': ['fl_client'],
      '/work/c': ['fl_pending', 'fl_client']
    }
  };
  assert.deepEqual(FileLabels.pathsForLabelIds(store, ['fl_pending', 'fl_client']), [
    '/work/a', '/work/b', '/work/c'
  ]);
  assert.deepEqual(FileLabels.assignmentCounts(store), {
    fl_pending: 2,
    fl_client: 2
  });
  assert.deepEqual(FileLabels.pathsForLabelIds(store, ['missing']), []);
});
