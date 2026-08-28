(function exposeSyntaxHighlight(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SyntaxHighlight = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSyntaxHighlightApi() {
  const MAX_HIGHLIGHT_LINE_CHARACTERS = 4096;
  const MAX_TOKENS_PER_LINE = 192;
  const MARKUP_LANGUAGES = new Set(['html', 'xml', 'plist']);
  const CONFIG_LANGUAGES = new Set(['json', 'yaml', 'toml', 'ini', 'env', 'css', 'scss', 'less']);
  const HASH_COMMENT_LANGUAGES = new Set(['python', 'ruby', 'shell', 'yaml', 'toml', 'ini', 'env']);
  const SLASH_COMMENT_LANGUAGES = new Set([
    'javascript', 'typescript', 'json', 'java', 'kotlin', 'go', 'rust',
    'c', 'cpp', 'swift', 'css', 'scss', 'less'
  ]);
  const BLOCK_COMMENT_LANGUAGES = new Set([
    'javascript', 'typescript', 'json', 'java', 'kotlin', 'go', 'rust',
    'c', 'cpp', 'swift', 'css', 'scss', 'less'
  ]);
  const BACKTICK_LANGUAGES = new Set(['javascript', 'typescript', 'shell']);
  const LANGUAGE_LABELS = Object.freeze({
    javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', yaml: 'YAML', toml: 'TOML',
    plist: 'PLIST', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', less: 'LESS',
    python: 'Python', ruby: 'Ruby', go: 'Go', rust: 'Rust', java: 'Java', kotlin: 'Kotlin',
    c: 'C', cpp: 'C++', swift: 'Swift', shell: 'Shell', sql: 'SQL', ini: 'INI', env: 'ENV',
    csv: 'CSV', tsv: 'TSV', text: 'Text', log: 'LOG'
  });

  const COMMON_KEYWORDS = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do', 'else', 'enum',
    'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'new', 'return',
    'static', 'switch', 'throw', 'try', 'var', 'while', 'yield', 'async', 'await'
  ]);
  const KEYWORDS = Object.freeze({
    javascript: new Set([...COMMON_KEYWORDS, 'delete', 'from', 'get', 'instanceof', 'let', 'of', 'set', 'typeof', 'void', 'with']),
    typescript: new Set([...COMMON_KEYWORDS, 'abstract', 'as', 'declare', 'from', 'implements', 'infer', 'interface', 'keyof', 'let', 'namespace', 'of', 'private', 'protected', 'public', 'readonly', 'satisfies', 'type', 'typeof']),
    python: new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']),
    ruby: new Set(['alias', 'begin', 'break', 'case', 'class', 'def', 'defined', 'do', 'else', 'elsif', 'end', 'ensure', 'for', 'if', 'in', 'module', 'next', 'redo', 'rescue', 'retry', 'return', 'then', 'unless', 'until', 'when', 'while', 'yield']),
    shell: new Set(['case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'select', 'then', 'time', 'until', 'while']),
    sql: new Set(['alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case', 'commit', 'create', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'from', 'full', 'group', 'having', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join', 'left', 'like', 'limit', 'not', 'null', 'on', 'or', 'order', 'outer', 'primary', 'references', 'right', 'rollback', 'select', 'set', 'table', 'then', 'union', 'unique', 'update', 'values', 'when', 'where', 'with']),
    java: new Set([...COMMON_KEYWORDS, 'abstract', 'boolean', 'byte', 'char', 'double', 'final', 'float', 'implements', 'int', 'interface', 'long', 'native', 'package', 'private', 'protected', 'public', 'short', 'strictfp', 'super', 'synchronized', 'throws', 'transient', 'volatile']),
    kotlin: new Set([...COMMON_KEYWORDS, 'actual', 'as', 'by', 'companion', 'constructor', 'data', 'expect', 'fun', 'init', 'inline', 'internal', 'is', 'lateinit', 'object', 'open', 'operator', 'out', 'override', 'private', 'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec', 'typealias', 'val', 'var', 'when']),
    go: new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']),
    rust: new Set(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'type', 'unsafe', 'use', 'where', 'while']),
    c: new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while']),
    cpp: new Set(['alignas', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export', 'extern', 'float', 'for', 'friend', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'noexcept', 'operator', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while']),
    swift: new Set(['as', 'associatedtype', 'break', 'case', 'catch', 'class', 'continue', 'convenience', 'default', 'defer', 'deinit', 'do', 'else', 'enum', 'extension', 'fallthrough', 'fileprivate', 'for', 'func', 'guard', 'if', 'import', 'in', 'init', 'inout', 'internal', 'is', 'let', 'mutating', 'open', 'operator', 'private', 'protocol', 'public', 'repeat', 'required', 'rethrows', 'return', 'static', 'struct', 'subscript', 'super', 'switch', 'throw', 'throws', 'try', 'typealias', 'var', 'where', 'while'])
  });
  const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'none', 'nil', 'self', 'super', 'this']);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeLanguage(value) {
    return String(value || 'text').trim().toLowerCase();
  }

  function languageLabel(value) {
    const language = normalizeLanguage(value);
    return LANGUAGE_LABELS[language] || language.slice(0, 12).toUpperCase() || 'TEXT';
  }

  function span(className, value) {
    return `<span class="syntax-${className}">${escapeHtml(value)}</span>`;
  }

  function quotedEnd(line, start, quote) {
    let index = start + 1;
    while (index < line.length) {
      if (line[index] === '\\') {
        index += 2;
        continue;
      }
      if (line[index] === quote) return index + 1;
      index += 1;
    }
    return line.length;
  }

  function createState(language) {
    return { language: normalizeLanguage(language), blockCommentEnd: '', markupTag: false };
  }

  function highlightMarkupLine(line, state) {
    const output = [];
    let index = 0;
    let tokens = 0;
    while (index < line.length) {
      if (tokens >= MAX_TOKENS_PER_LINE) {
        output.push(escapeHtml(line.slice(index)));
        break;
      }
      if (state.blockCommentEnd === '-->') {
        const end = line.indexOf('-->', index);
        const stop = end === -1 ? line.length : end + 3;
        output.push(span('comment', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        if (end === -1) break;
        state.blockCommentEnd = '';
        continue;
      }
      if (line.startsWith('<!--', index)) {
        const end = line.indexOf('-->', index + 4);
        const stop = end === -1 ? line.length : end + 3;
        output.push(span('comment', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        if (end === -1) state.blockCommentEnd = '-->';
        continue;
      }
      const tag = line.slice(index).match(/^<(\/?|!?)([A-Za-z][A-Za-z0-9:.-]*)/);
      if (tag) {
        const prefix = `<${tag[1]}`;
        output.push(escapeHtml(prefix), span('tag', tag[2]));
        tokens += 1;
        index += tag[0].length;
        state.markupTag = true;
        continue;
      }
      if (state.markupTag && (line.startsWith('/>', index) || line[index] === '>')) {
        const punctuation = line.startsWith('/>', index) ? '/>' : '>';
        output.push(escapeHtml(punctuation));
        index += punctuation.length;
        state.markupTag = false;
        continue;
      }
      if (state.markupTag && (line[index] === '"' || line[index] === "'")) {
        const stop = quotedEnd(line, index, line[index]);
        output.push(span('string', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        continue;
      }
      if (state.markupTag) {
        const attribute = line.slice(index).match(/^[A-Za-z_:][A-Za-z0-9_:.-]*/);
        if (attribute) {
          output.push(span('attribute', attribute[0]));
          tokens += 1;
          index += attribute[0].length;
          continue;
        }
      }
      output.push(escapeHtml(line[index]));
      index += 1;
    }
    return output.join('');
  }

  function highlightCodeLine(line, language, state) {
    const output = [];
    const keywordSet = KEYWORDS[language] || new Set();
    const lineComments = language === 'sql' ? ['--']
      : HASH_COMMENT_LANGUAGES.has(language) ? ['#']
        : SLASH_COMMENT_LANGUAGES.has(language) ? ['//'] : [];
    let index = 0;
    let tokens = 0;
    while (index < line.length) {
      if (tokens >= MAX_TOKENS_PER_LINE) {
        output.push(escapeHtml(line.slice(index)));
        break;
      }
      if (state.blockCommentEnd === '*/') {
        const end = line.indexOf('*/', index);
        const stop = end === -1 ? line.length : end + 2;
        output.push(span('comment', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        if (end === -1) break;
        state.blockCommentEnd = '';
        continue;
      }
      const lineComment = lineComments.find(prefix => line.startsWith(prefix, index));
      if (lineComment) {
        output.push(span('comment', line.slice(index)));
        break;
      }
      if (BLOCK_COMMENT_LANGUAGES.has(language) && line.startsWith('/*', index)) {
        const end = line.indexOf('*/', index + 2);
        const stop = end === -1 ? line.length : end + 2;
        output.push(span('comment', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        if (end === -1) state.blockCommentEnd = '*/';
        continue;
      }
      const current = line[index];
      if (current === '"' || current === "'" || (current === '`' && BACKTICK_LANGUAGES.has(language))) {
        const stop = quotedEnd(line, index, current);
        const remainder = line.slice(stop);
        const isKey = CONFIG_LANGUAGES.has(language) && /^\s*[:=]/.test(remainder);
        output.push(span(isKey ? 'key' : 'string', line.slice(index, stop)));
        tokens += 1;
        index = stop;
        continue;
      }
      if (current === '$' && /^\$[A-Za-z_{]/.test(line.slice(index))) {
        const variable = line.slice(index).match(/^\$(?:\{[^}\r\n]{1,120}\}|[A-Za-z_][A-Za-z0-9_]*)/);
        if (variable) {
          output.push(span('variable', variable[0]));
          tokens += 1;
          index += variable[0].length;
          continue;
        }
      }
      if (current === '@') {
        const decorator = line.slice(index).match(/^@[A-Za-z_][A-Za-z0-9_.-]*/);
        if (decorator) {
          output.push(span('keyword', decorator[0]));
          tokens += 1;
          index += decorator[0].length;
          continue;
        }
      }
      if (['css', 'scss', 'less'].includes(language) && current === '#') {
        const color = line.slice(index).match(/^#[0-9a-fA-F]{3,8}\b/);
        if (color) {
          output.push(span('number', color[0]));
          tokens += 1;
          index += color[0].length;
          continue;
        }
      }
      const number = line.slice(index).match(/^(?:0[xob][0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) {
        output.push(span('number', number[0]));
        tokens += 1;
        index += number[0].length;
        continue;
      }
      const identifierPattern = CONFIG_LANGUAGES.has(language)
        ? /^[A-Za-z_][A-Za-z0-9_-]*/
        : /^[A-Za-z_][A-Za-z0-9_]*/;
      const identifier = line.slice(index).match(identifierPattern);
      if (identifier) {
        const value = identifier[0];
        const normalized = value.toLowerCase();
        const remainder = line.slice(index + value.length);
        let tokenClass = '';
        if (keywordSet.has(normalized)) tokenClass = 'keyword';
        else if (LITERALS.has(normalized)) tokenClass = 'literal';
        else if (CONFIG_LANGUAGES.has(language) && /^\s*[:=]/.test(remainder)) tokenClass = 'key';
        else if (/^\s*\(/.test(remainder)) tokenClass = 'function';
        else if (/^[A-Z]/.test(value) && !CONFIG_LANGUAGES.has(language)) tokenClass = 'type';
        output.push(tokenClass ? span(tokenClass, value) : escapeHtml(value));
        if (tokenClass) tokens += 1;
        index += value.length;
        continue;
      }
      output.push(escapeHtml(current));
      index += 1;
    }
    return output.join('');
  }

  function highlightLine(value, language, providedState) {
    const line = String(value ?? '');
    if (!line) return '';
    if (line.length > MAX_HIGHLIGHT_LINE_CHARACTERS) return escapeHtml(line);
    const normalizedLanguage = normalizeLanguage(language);
    const state = providedState || createState(normalizedLanguage);
    return MARKUP_LANGUAGES.has(normalizedLanguage)
      ? highlightMarkupLine(line, state)
      : highlightCodeLine(line, normalizedLanguage, state);
  }

  return {
    MAX_HIGHLIGHT_LINE_CHARACTERS,
    MAX_TOKENS_PER_LINE,
    createState,
    escapeHtml,
    highlightLine,
    languageLabel
  };
});
