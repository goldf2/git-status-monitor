const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  Scanner,
  pathIsWithin
} = require('../src/renderer/scripts/repositoryRootScanner');

function createHarness(overrides = {}) {
  const calls = [];
  const roots = overrides.roots || [
    { path: '/managed/online', name: 'online' },
    { path: '/managed/offline', name: 'offline' }
  ];
  const bridge = {
    platform: overrides.platform || 'darwin',
    fs: {
      inspectWorkspaceDirectories: async paths => {
        calls.push(['inspect', paths]);
        if (overrides.inspectionError) throw new Error('inspection failed');
        return {
          directories: paths.map(rootPath => ({
            path: rootPath,
            available: !rootPath.includes('offline')
          }))
        };
      },
      findGitRepos: async rootPath => {
        calls.push(['scan', rootPath]);
        return overrides.discovered?.[rootPath] || [
          { path: `${rootPath}/repo`, name: `${rootPath.split('/').at(-1)}-repo`, isGitRepo: true }
        ];
      }
    }
  };
  return {
    scanner: new Scanner({ bridge, platform: overrides.platform }),
    bridge,
    roots,
    calls
  };
}

test('只扫描当前可用受管根，并保留断开根的既有仓库', async () => {
  const { scanner, roots, calls } = createHarness();
  const existing = [
    { path: '/managed/online/old', name: 'old' },
    { path: '/managed/offline/keep', name: 'keep' },
    { path: '/removed/drop', name: 'drop' }
  ];

  const result = await scanner.scan(roots, existing, { depth: 3 });
  assert.deepEqual(calls.filter(call => call[0] === 'scan'), [['scan', '/managed/online']]);
  assert.deepEqual(result.repos.map(repo => repo.path), [
    '/managed/online/repo',
    '/managed/offline/keep'
  ]);
  assert.deepEqual(result.availableRoots.map(root => root.path), ['/managed/online']);
  assert.deepEqual(result.unavailableRoots.map(root => root.path), ['/managed/offline']);
  assert.equal(result.complete, false);
});

test('全部根可用时返回完整扫描并去重嵌套结果', async () => {
  const roots = [{ path: '/managed/a' }, { path: '/managed/b' }];
  const shared = { path: '/managed/a/repo', name: 'repo' };
  const { scanner } = createHarness({
    roots,
    discovered: {
      '/managed/a': [shared],
      '/managed/b': [shared, { path: '/managed/b/repo', name: 'other' }]
    }
  });
  scanner.bridge.fs.inspectWorkspaceDirectories = async paths => ({
    directories: paths.map(rootPath => ({ path: rootPath, available: true }))
  });

  const result = await scanner.scan(roots, [], { depth: 2 });
  assert.equal(result.complete, true);
  assert.deepEqual(result.repos.map(repo => repo.path), ['/managed/a/repo', '/managed/b/repo']);
});

test('可用性检查失败时零扫描并保留仍属于配置根的仓库', async () => {
  const { scanner, roots, calls } = createHarness({ inspectionError: true });
  const result = await scanner.scan(roots, [
    { path: '/managed/online/keep-a', name: 'a' },
    { path: '/managed/offline/keep-b', name: 'b' },
    { path: '/outside/drop', name: 'drop' }
  ]);

  assert.equal(calls.some(call => call[0] === 'scan'), false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.repos.map(repo => repo.path), [
    '/managed/online/keep-a',
    '/managed/offline/keep-b'
  ]);
});

test('Windows 断开根仓库匹配忽略大小写和分隔符', async () => {
  assert.equal(pathIsWithin('c:/WORK/OFFLINE/repo', 'C:\\work\\offline', 'win32'), true);
  const roots = [{ path: 'C:\\work\\offline' }];
  const { scanner } = createHarness({ platform: 'win32', roots });
  scanner.bridge.fs.inspectWorkspaceDirectories = async () => ({
    directories: [{ path: 'C:\\work\\offline', available: false }]
  });
  const result = await scanner.scan(roots, [{ path: 'c:/WORK/OFFLINE/repo', name: 'repo' }]);
  assert.deepEqual(result.repos.map(repo => repo.path), ['c:/WORK/OFFLINE/repo']);
});

test('App 的后台核对、仓库集合和仪表盘共用可用根扫描，部分结果不覆盖持久索引', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/scripts/app.js'), 'utf8');

  assert.match(html, /repositoryRootScanner\.js[\s\S]*app\.js/);
  assert.match(appSource, /setupRepositoryRootScanner/);
  assert.match(appSource, /scanManagedRepositories/);
  assert.equal((appSource.match(/scanManagedRepositories\(/g) || []).length, 4);
  assert.match(appSource, /if \(scan\.complete\)[\s\S]*repos\.set/);
});
