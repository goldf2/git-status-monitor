const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isTrustedSenderUrl(senderUrl, appRoot = path.resolve(__dirname, '..', '..', '..')) {
  if (typeof senderUrl !== 'string' || !senderUrl) return false;
  try {
    const url = new URL(senderUrl);
    if (url.protocol !== 'file:') return false;
    const senderPath = path.resolve(fileURLToPath(url));
    const rendererPath = path.resolve(appRoot, 'src', 'renderer', 'index.html');
    return senderPath === rendererPath;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!isTrustedSenderUrl(senderUrl)) {
    throw new Error('已拒绝来自非应用页面的 IPC 请求');
  }
}

function registerTrustedHandler(channel, handler) {
  const { ipcMain } = require('electron');
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

module.exports = {
  isTrustedSenderUrl,
  assertTrustedSender,
  registerTrustedHandler
};
