const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateRepoGroupMetrics } = require('../src/shared/repoMetrics');

test('分类统计只计算当前扫描结果中的仓库', () => {
  const repos = [
    { path: '/projects/a' },
    { path: '/projects/b' },
    { path: '/projects/c' }
  ];
  const groups = [
    { id: 'active', repoPaths: ['/projects/a', '/projects/missing'] },
    { id: 'overlap', repoPaths: ['/projects/a', '/projects/b', '/projects/old'] }
  ];

  const metrics = calculateRepoGroupMetrics(repos, groups);

  assert.equal(metrics.allCount, 3);
  assert.equal(metrics.groupCounts.get('active'), 1);
  assert.equal(metrics.groupCounts.get('overlap'), 2);
  assert.equal(metrics.ungroupedCount, 1);
  assert.deepEqual([...metrics.groupedCurrentPaths].sort(), ['/projects/a', '/projects/b']);
});

test('旧分类路径多于当前仓库时未分类数量不会变成负数', () => {
  const metrics = calculateRepoGroupMetrics(
    [{ path: '/projects/current' }],
    [{ id: 'stale', repoPaths: ['/old/1', '/old/2', '/old/3'] }]
  );

  assert.equal(metrics.ungroupedCount, 1);
});
