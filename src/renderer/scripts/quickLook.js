(function exposeQuickLook(root, factory) {
  let syntaxHighlight = root?.SyntaxHighlight || null;
  if (!syntaxHighlight && typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    syntaxHighlight = require('./syntaxHighlight');
  }
  const api = factory(syntaxHighlight);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuickLook = api;
})(typeof window !== 'undefined' ? window : globalThis, function createQuickLookApi(SyntaxHighlight) {
  const STRUCTURED_LANGUAGES = new Set(['yaml', 'toml', 'plist']);
  const MAX_SOURCE_LINES = 2000;
  const MAX_LOG_LINES = 1500;
  const MAX_OUTLINE_ITEMS = 120;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizedLines(content) {
    return String(content || '').replace(/\r\n?/g, '\n').split('\n');
  }

  function compactValue(value, limit = 72) {
    const compact = String(value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
  }

  function normalizeDepth(value) {
    return Math.max(0, Math.min(6, Number(value) || 0));
  }

  function yamlOutline(lines) {
    const items = [];
    for (let index = 0; index < lines.length && items.length < MAX_OUTLINE_ITEMS; index += 1) {
      const line = lines[index];
      if (!line.trim() || /^\s*#/.test(line) || /^\s*(---|\.\.\.)\s*$/.test(line)) continue;
      const match = line.match(/^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*:\s*(.*)$/);
      if (!match) continue;
      const label = match[2].replace(/^(?:"|')|(?:"|')$/g, '');
      const value = compactValue(match[3].replace(/\s+#.*$/, ''));
      items.push({ line: index + 1, depth: normalizeDepth(Math.floor(match[1].replace(/\t/g, '  ').length / 2)), label, value });
    }
    return items;
  }

  function tomlOutline(lines) {
    const items = [];
    let sectionDepth = 0;
    for (let index = 0; index < lines.length && items.length < MAX_OUTLINE_ITEMS; index += 1) {
      const line = lines[index];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const section = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/);
      if (section) {
        const label = section[1].trim();
        sectionDepth = normalizeDepth(Math.max(0, label.split('.').length - 1));
        items.push({ line: index + 1, depth: sectionDepth, label, value: '' });
        continue;
      }
      const assignment = line.match(/^\s*([A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*(.*)$/);
      if (!assignment) continue;
      items.push({
        line: index + 1,
        depth: normalizeDepth(sectionDepth + 1),
        label: assignment[1].replace(/^(?:"|')|(?:"|')$/g, ''),
        value: compactValue(assignment[2].replace(/\s+#.*$/, ''))
      });
    }
    return items;
  }

  function plistOutline(lines) {
    const items = [];
    let depth = 0;
    for (let index = 0; index < lines.length && items.length < MAX_OUTLINE_ITEMS; index += 1) {
      const line = lines[index];
      if (/<\/(dict|array)>/i.test(line)) depth = Math.max(0, depth - 1);
      const key = line.match(/<key>([\s\S]*?)<\/key>/i);
      if (key) {
        const trailing = line.slice((key.index || 0) + key[0].length);
        const value = trailing.match(/<(string|integer|real|date|data)>([\s\S]*?)<\/\1>/i);
        const booleanValue = trailing.match(/<(true|false)\s*\/>/i);
        items.push({
          line: index + 1,
          depth: normalizeDepth(depth),
          label: compactValue(key[1], 80),
          value: value ? compactValue(value[2]) : (booleanValue ? booleanValue[1].toLowerCase() : '')
        });
      }
      if (/<(dict|array)>/i.test(line) && !/<\/(dict|array)>/i.test(line)) depth += 1;
    }
    return items;
  }

  function buildStructureOutline(content, language) {
    const lines = normalizedLines(content);
    const normalizedLanguage = String(language || '').toLowerCase();
    const items = normalizedLanguage === 'yaml' ? yamlOutline(lines)
      : normalizedLanguage === 'toml' ? tomlOutline(lines)
        : normalizedLanguage === 'plist' ? plistOutline(lines)
          : [];
    return {
      language: normalizedLanguage,
      items,
      lineCount: lines.length,
      truncated: items.length >= MAX_OUTLINE_ITEMS
    };
  }

  function logSeverity(line) {
    const value = String(line || '');
    if (/\b(fatal|panic|critical|exception|error|err)\b/i.test(value)) return 'error';
    if (/\b(warn|warning)\b/i.test(value)) return 'warning';
    if (/\b(debug|trace|verbose)\b/i.test(value)) return 'debug';
    if (/\b(info|notice|success|ok)\b/i.test(value)) return 'info';
    return 'neutral';
  }

  function logTimestamp(line) {
    const match = String(line || '').match(/^\s*(\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+|\d{2}:\d{2}:\d{2}(?:\.\d+)?|\[[^\]]{5,32}\])/);
    return match ? match[1] : '';
  }

  function logMessage(line, timestamp = logTimestamp(line), severity = logSeverity(line)) {
    let message = String(line || '').trimStart();
    if (timestamp && message.startsWith(timestamp)) message = message.slice(timestamp.length).trimStart();
    if (severity !== 'neutral') {
      message = message.replace(/^(fatal|panic|critical|exception|error|err|warn|warning|debug|trace|verbose|info|notice|success|ok)\b\s*[:\]-]?\s*/i, '');
    }
    return message;
  }

  function sourceLines(content, limit = MAX_SOURCE_LINES) {
    const lines = normalizedLines(content);
    return {
      items: lines.slice(0, limit).map((text, index) => ({ line: index + 1, text })),
      total: lines.length,
      truncated: lines.length > limit
    };
  }

  function renderSourceLines(content, className = '', startLine = 1, language = 'text') {
    const source = sourceLines(content);
    const highlightState = SyntaxHighlight?.createState(language);
    const rows = source.items.map(item => `
      <div class="quick-look-code-line ${className}" role="row">
        <span class="quick-look-line-number" aria-hidden="true">${item.line + Math.max(0, Number(startLine) - 1 || 0)}</span>
        <code>${SyntaxHighlight?.highlightLine(item.text, language, highlightState) || escapeHtml(item.text) || '&nbsp;'}</code>
      </div>`).join('');
    return { ...source, html: rows };
  }

  function renderStructuredPreview(preview) {
    const language = String(preview?.language || '').toLowerCase();
    if (!STRUCTURED_LANGUAGES.has(language)) return null;
    const startLine = Math.max(1, Number(preview?.startLine) || 1);
    const outline = buildStructureOutline(preview.content, language);
    const source = renderSourceLines(preview.content, '', startLine, language);
    const languageLabel = SyntaxHighlight?.languageLabel(language) || language.toUpperCase();
    const outlineHtml = outline.items.map(item => `
      <div class="quick-look-outline-item depth-${normalizeDepth(item.depth)}" title="第 ${item.line + startLine - 1} 行">
        <span class="quick-look-outline-key">${escapeHtml(item.label)}</span>
        ${item.value ? `<span class="quick-look-outline-value">${escapeHtml(item.value)}</span>` : ''}
      </div>`).join('');
    return {
      icon: '⌘',
      html: `<div class="quick-look-developer quick-look-structured">
        <aside class="quick-look-structure-panel">
          <div class="quick-look-pane-title"><span>结构导航</span><small>${outline.items.length} 项</small></div>
          <div class="quick-look-outline-list">${outlineHtml || '<div class="quick-look-outline-empty">未识别到可导航的键；原文仍完整显示。</div>'}</div>
        </aside>
        <section class="quick-look-source-panel">
          <div class="quick-look-source-header"><span class="quick-look-language-badge">${escapeHtml(languageLabel)}</span><small>${startLine > 1 ? `从第 ${startLine} 行 · ` : ''}${source.total} 行</small></div>
          <div class="quick-look-code-lines" role="table" aria-label="${escapeHtml(languageLabel)} 原文">${source.html}</div>
        </section>
      </div>${preview.truncated || source.truncated ? `<div class="quick-look-truncated">${preview.paged ? '当前分段较大，仅显示安全行数范围' : '文件较大，仅显示安全预览范围'}</div>` : ''}`
    };
  }

  function renderLogPreview(preview) {
    if (String(preview?.language || '').toLowerCase() !== 'log') return null;
    const lines = normalizedLines(preview.content);
    const startLine = Math.max(1, Number(preview?.startLine) || 1);
    const visible = lines.slice(0, MAX_LOG_LINES);
    const rows = visible.map((line, index) => {
      const severity = logSeverity(line);
      const timestamp = logTimestamp(line);
      const message = logMessage(line, timestamp, severity);
      return `<div class="quick-look-log-line severity-${severity}" role="row">
        <span class="quick-look-line-number" aria-hidden="true">${startLine + index}</span>
        <span class="quick-look-log-level">${severity === 'neutral' ? '' : severity.toUpperCase()}</span>
        <span class="quick-look-log-time">${escapeHtml(timestamp)}</span>
        <code>${escapeHtml(message) || '&nbsp;'}</code>
      </div>`;
    }).join('');
    return {
      icon: '≡',
      html: `<div class="quick-look-developer quick-look-log-view">
        <div class="quick-look-source-header"><span class="quick-look-language-badge">LOG</span><small>${startLine > 1 ? `从第 ${startLine} 行 · ` : ''}${lines.length} 行</small></div>
        <div class="quick-look-log-lines" role="table" aria-label="日志内容">${rows}</div>
      </div>${preview.truncated || lines.length > MAX_LOG_LINES ? `<div class="quick-look-truncated">${preview.paged ? '当前日志分段较大，仅显示安全行数范围' : '日志较大，仅显示安全预览范围'}</div>` : ''}`
    };
  }

  function renderCodePreview(preview) {
    if (preview?.kind !== 'code') return null;
    const language = String(preview.language || 'text').toLowerCase();
    const languageLabel = SyntaxHighlight?.languageLabel(language) || language.toUpperCase();
    const startLine = Math.max(1, Number(preview.startLine) || 1);
    const source = renderSourceLines(preview.content, 'syntax-highlighted', startLine, language);
    return {
      icon: '⌘',
      html: `<div class="quick-look-developer quick-look-code-view">
        <div class="quick-look-source-header"><span class="quick-look-language-badge">${escapeHtml(languageLabel)}</span><small>${startLine > 1 ? `从第 ${startLine} 行 · ` : ''}${source.total} 行</small></div>
        <div class="quick-look-code-lines" role="table" aria-label="${escapeHtml(languageLabel)} 源码">${source.html}</div>
      </div>${preview.truncated || source.truncated ? `<div class="quick-look-truncated">${preview.paged ? '当前源码分段较大，仅显示安全行数范围' : '文件较大，仅显示安全预览范围'}</div>` : ''}`
    };
  }

  function renderDeveloperPreview(preview) {
    return renderStructuredPreview(preview) || renderLogPreview(preview) || renderCodePreview(preview);
  }

  return {
    STRUCTURED_LANGUAGES,
    buildStructureOutline,
    logSeverity,
    logTimestamp,
    logMessage,
    sourceLines,
    renderSourceLines,
    renderDeveloperPreview
  };
});
