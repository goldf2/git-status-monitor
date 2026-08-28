const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');

test('桌面 App 使用单实例锁，重复启动只恢复并聚焦现有窗口', () => {
  assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /app\.on\('second-instance'/);
  assert.match(mainSource, /mainWindow\.isMinimized\(\)[\s\S]*?mainWindow\.restore\(\)/);
  assert.match(mainSource, /mainWindow\.isVisible\(\)[\s\S]*?mainWindow\.show\(\)/);
  assert.match(mainSource, /mainWindow\.focus\(\)/);
  assert.match(mainSource, /if \(!hasSingleInstanceLock\) return;/);
});
