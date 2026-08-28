const test = require('node:test');
const assert = require('node:assert/strict');

const ContentFilterController = require('../src/renderer/scripts/contentFilterController');
const SmartCollectionsController = require('../src/renderer/scripts/smartCollectionsController');

test('内容筛选控制器不依赖测试注入也能使用运行环境默认对象', () => {
  assert.doesNotThrow(() => new ContentFilterController.Controller({ app: {}, state: {} }));
});

test('智能集合控制器不依赖测试注入也能使用运行环境默认对象', () => {
  assert.doesNotThrow(() => new SmartCollectionsController.Controller({ app: {}, state: {} }));
});
