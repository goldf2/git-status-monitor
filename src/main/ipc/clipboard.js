const path = require('node:path');
const { clipboard } = require('electron');
const { registerTrustedHandler } = require('./security');
const { assertManagedWorkspacePath } = require('./filesystem');
const fileService = require('../services/fileService');

const MAX_PATHNAME_COUNT = 2000;
const MAX_CLIPBOARD_TEXT_BYTES = 2 * 1024 * 1024;

function copyManagedPathnames(candidatePaths, options = {}) {
  if (!Array.isArray(candidatePaths) || candidatePaths.length === 0) {
    throw new Error('请先选择文件或文件夹');
  }
  if (candidatePaths.length > MAX_PATHNAME_COUNT) {
    throw new Error(`一次最多复制 ${MAX_PATHNAME_COUNT} 个路径名`);
  }

  const service = options.fileService || fileService;
  const platform = options.platform || process.platform;
  const uniqueKeys = new Set();
  const safePaths = [];
  for (const candidatePath of candidatePaths) {
    const safePath = assertManagedWorkspacePath(candidatePath, ['file', 'directory'], service);
    const key = platform === 'win32' ? safePath.toLowerCase() : safePath;
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);
    safePaths.push(path.normalize(safePath));
  }

  const text = safePaths.join('\n');
  if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new Error('所选路径名总长度过大，请减少选择后重试');
  }
  const writeText = options.writeText || (value => clipboard.writeText(value));
  writeText(text);
  return { count: safePaths.length };
}

function registerClipboardIPC() {
  registerTrustedHandler('clipboard:copyPathnames', async (event, candidatePaths) => {
    return copyManagedPathnames(candidatePaths);
  });
}

module.exports = {
  MAX_PATHNAME_COUNT,
  MAX_CLIPBOARD_TEXT_BYTES,
  copyManagedPathnames,
  registerClipboardIPC
};
