const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SyntaxHighlight = require('../src/renderer/scripts/syntaxHighlight');
const QuickLook = require('../src/renderer/scripts/quickLook');

test('常用代码词法高亮先转义外部内容再添加受控 span', () => {
  const html = SyntaxHighlight.highlightLine(
    'const answer = build("<img src=x>", 42, true); // <script>alert(1)</script>',
    'javascript'
  );
  assert.match(html, /class="syntax-keyword">const<\/span>/);
  assert.match(html, /class="syntax-function">build<\/span>/);
  assert.match(html, /class="syntax-string">&quot;&lt;img src=x&gt;&quot;<\/span>/);
  assert.match(html, /class="syntax-number">42<\/span>/);
  assert.match(html, /class="syntax-literal">true<\/span>/);
  assert.match(html, /class="syntax-comment">\/\/ &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/span>/);
  assert.doesNotMatch(html, /<img|<script>/);
});

test('跨行注释状态保持且结束后恢复关键字识别', () => {
  const state = SyntaxHighlight.createState('typescript');
  const first = SyntaxHighlight.highlightLine('/* <script>', 'typescript', state);
  const second = SyntaxHighlight.highlightLine('still comment */ const ready = true;', 'typescript', state);
  assert.match(first, /syntax-comment/);
  assert.doesNotMatch(first, /<script>/);
  assert.match(second, /class="syntax-comment">still comment \*\/<\/span>/);
  assert.match(second, /class="syntax-keyword">const<\/span>/);
  assert.match(second, /class="syntax-literal">true<\/span>/);
});

test('HTML 与 XML 仅高亮标签和属性，不创建来自文件的节点', () => {
  const html = SyntaxHighlight.highlightLine(
    '<script data-value="<img src=x>" onclick="run()">alert(1)</script>',
    'html'
  );
  assert.equal((html.match(/class="syntax-tag"/g) || []).length, 2);
  assert.match(html, /class="syntax-attribute">data-value<\/span>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<script|<img/);
});

test('配置键、Shell 变量与超长单行遵守有限高亮边界', () => {
  const yaml = SyntaxHighlight.highlightLine('service_name: "api" # comment', 'yaml');
  const shell = SyntaxHighlight.highlightLine('if [ "$PROJECT_DIR" = "/tmp" ]; then echo $PROJECT_DIR', 'shell');
  assert.match(yaml, /class="syntax-key">service_name<\/span>/);
  assert.match(yaml, /class="syntax-comment"># comment<\/span>/);
  assert.match(shell, /class="syntax-keyword">if<\/span>/);
  assert.match(shell, /class="syntax-variable">\$PROJECT_DIR<\/span>/);

  const longLine = `<script>${'x'.repeat(SyntaxHighlight.MAX_HIGHLIGHT_LINE_CHARACTERS + 1)}</script>`;
  const escaped = SyntaxHighlight.highlightLine(longLine, 'javascript');
  assert.doesNotMatch(escaped, /class="syntax-/);
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);

  const manyTokens = SyntaxHighlight.highlightLine(Array.from({ length: 240 }, () => 'true').join(' '), 'javascript');
  assert.equal((manyTokens.match(/class="syntax-literal"/g) || []).length, SyntaxHighlight.MAX_TOKENS_PER_LINE);
  assert.match(manyTokens, /true true true$/);
});

test('普通代码 Quick Look 使用行号、语言标签和分页起始行', () => {
  const rendered = QuickLook.renderDeveloperPreview({
    kind: 'code',
    language: 'typescript',
    content: 'export function run(value: number) {\n  return value + 1;\n}',
    startLine: 401,
    paged: true,
    truncated: true
  });
  assert.match(rendered.html, /TypeScript/);
  assert.match(rendered.html, />401<\/span>/);
  assert.match(rendered.html, /class="syntax-keyword">export<\/span>/);
  assert.match(rendered.html, /class="syntax-function">run<\/span>/);
  assert.match(rendered.html, /当前源码分段较大/);
});

test('安全高亮模块在 Quick Look 之前加载且样式只作用于源码行', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const page = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'src/renderer/styles/content.css'), 'utf8');
  assert.ok(page.indexOf('scripts/syntaxHighlight.js') < page.indexOf('scripts/quickLook.js'));
  assert.match(css, /\.quick-look-code-line \.syntax-keyword/);
  assert.match(css, /\.quick-look-code-line \.syntax-comment/);
});
