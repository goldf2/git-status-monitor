const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { isTrustedSenderUrl } = require('../src/main/ipc/security');

test('IPC 只信任打包应用自己的渲染页面', () => {
  const appRoot = path.resolve('/Applications/GitFinder.app/Contents/Resources/app');
  const renderer = path.join(appRoot, 'src', 'renderer', 'index.html');

  assert.equal(isTrustedSenderUrl(pathToFileURL(renderer).href, appRoot), true);
  assert.equal(isTrustedSenderUrl('https://malicious.example/', appRoot), false);
  assert.equal(
    isTrustedSenderUrl(pathToFileURL(path.join(appRoot, '..', 'outside.html')).href, appRoot),
    false
  );
});
