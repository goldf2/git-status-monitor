const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('../server');

test('Web 服务默认只监听本机且写操作默认关闭', async (t) => {
  const server = await startServer({ port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();

  assert.equal(address.address, '127.0.0.1');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/tmp', action: 'status' })
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Web 写操作默认关闭，请在可信本机环境显式启用'
  });
});
