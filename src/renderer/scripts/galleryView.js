(function exposeGalleryView(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GalleryView = api;
})(typeof window !== 'undefined' ? window : globalThis, function createGalleryViewApi() {
  const MAX_TEXT_CHARACTERS = 8000;
  const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\r\n]+$/i;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function finiteCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
  }

  function defaultFileSize(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function defaultDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function previewDetail(preview, formatters = {}) {
    const formatFileSize = typeof formatters.formatFileSize === 'function'
      ? formatters.formatFileSize
      : defaultFileSize;
    const formatItemDate = typeof formatters.formatItemDate === 'function'
      ? formatters.formatItemDate
      : defaultDate;
    return [
      preview?.kind !== 'directory' && Number.isFinite(Number(preview?.size))
        ? formatFileSize(preview.size)
        : '',
      formatItemDate(preview?.modifiedTime),
      preview?.path || ''
    ].filter(Boolean).join(' · ');
  }

  function pickPreviewItem(items, selectedPaths, focusPath) {
    const candidates = Array.isArray(items) ? items : [];
    if (!candidates.length) return null;
    const byPath = new Map(candidates.map(item => [item.path, item]));
    if (focusPath && byPath.has(focusPath)) return byPath.get(focusPath);
    const selected = selectedPaths instanceof Set
      ? [...selectedPaths]
      : (Array.isArray(selectedPaths) ? selectedPaths : []);
    const selectedPath = selected.find(itemPath => byPath.has(itemPath));
    return selectedPath ? byPath.get(selectedPath) : candidates[0];
  }

  function isPreviewRequestCurrent(expected = {}, current = {}) {
    return Number(expected.requestId) === Number(current.requestId)
      && expected.directoryPath === current.directoryPath
      && current.mode === 'tree'
      && current.style === 'gallery';
  }

  function visibleText(content) {
    const source = String(content ?? '');
    return {
      content: source.slice(0, MAX_TEXT_CHARACTERS),
      truncated: source.length > MAX_TEXT_CHARACTERS
    };
  }

  function renderInlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '<span class="markdown-link" title="图库预览中不打开外部链接">$1</span>');
  }

  function renderMarkdown(content) {
    const lines = String(content || '').split(/\r?\n/);
    let html = '';
    let inCode = false;
    let inList = false;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${paragraph.map(renderInlineMarkdown).join(' ')}</p>`;
      paragraph = [];
    };
    const closeList = () => {
      if (!inList) return;
      html += '</ul>';
      inList = false;
    };

    for (const line of lines) {
      if (/^```/.test(line.trim())) {
        flushParagraph();
        closeList();
        html += inCode ? '</code></pre>' : '<pre><code>';
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        html += `${escapeHtml(line)}\n`;
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html += `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
        continue;
      }
      const list = line.match(/^\s*[-*]\s+(.+)$/);
      if (list) {
        flushParagraph();
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${renderInlineMarkdown(list[1])}</li>`;
        continue;
      }
      paragraph.push(line.trim());
    }
    flushParagraph();
    closeList();
    if (inCode) html += '</code></pre>';
    return html || '<div class="finder-gallery-empty-preview">暂无内容</div>';
  }

  function truncatedNotice(preview, domTruncated) {
    if (!preview?.truncated && !domTruncated) return '';
    const label = domTruncated
      ? `仅显示前 ${MAX_TEXT_CHARACTERS.toLocaleString('en-US')} 个字符`
      : '文件较大，仅显示安全预览范围';
    return `<div class="finder-gallery-truncated">${label}</div>`;
  }

  function basePresentation(preview, formatters = {}) {
    return {
      kind: String(preview?.kind || 'unsupported'),
      icon: '📄',
      title: String(preview?.name || '预览'),
      detail: previewDetail(preview || {}, formatters),
      html: '',
      domTruncated: false
    };
  }

  function renderPreview(preview, formatters = {}) {
    const result = basePresentation(preview, formatters);

    if (preview?.kind === 'image') {
      if (!SAFE_IMAGE_DATA_URL.test(String(preview.dataUrl || ''))) {
        return {
          ...result,
          kind: 'unsupported',
          icon: '🚫',
          html: '<div class="finder-gallery-empty-preview"><span aria-hidden="true">🚫</span><strong>图片预览格式不受支持</strong></div>'
        };
      }
      return {
        ...result,
        icon: '🖼️',
        html: `<div class="finder-gallery-image-wrap"><img class="finder-gallery-image" alt="${escapeHtml(preview.name)}" src="${preview.dataUrl}"></div>`
      };
    }

    if (preview?.kind === 'markdown') {
      const text = visibleText(preview.content);
      return {
        ...result,
        icon: '📝',
        html: `<article class="finder-gallery-markdown markdown-preview">${renderMarkdown(text.content)}</article>${truncatedNotice(preview, text.truncated)}`,
        domTruncated: text.truncated
      };
    }

    if (preview?.kind === 'code' || preview?.kind === 'text') {
      const text = visibleText(preview.content);
      const language = String(preview.language || (preview.kind === 'code' ? '代码' : '文本')).toUpperCase();
      return {
        ...result,
        icon: preview.kind === 'code' ? '⌘' : '📄',
        html: `<div class="finder-gallery-source"><div class="finder-gallery-source-label">${escapeHtml(language)}</div><pre><code>${escapeHtml(text.content)}</code></pre></div>${truncatedNotice(preview, text.truncated)}`,
        domTruncated: text.truncated
      };
    }

    if (preview?.kind === 'directory') {
      const samples = (Array.isArray(preview.samples) ? preview.samples : []).slice(0, 12).map(sample => `
        <div class="finder-gallery-sample" title="${escapeHtml(sample?.name)}">
          <span aria-hidden="true">${sample?.type === 'directory' ? '📁' : '📄'}</span>
          <span>${escapeHtml(sample?.name)}</span>
        </div>`).join('');
      return {
        ...result,
        icon: preview.isGitRepo ? '📦' : '📁',
        html: `<div class="finder-gallery-directory">
          ${preview.isGitRepo ? '<div class="quick-look-repository-badge">Git 仓库</div>' : ''}
          <div class="finder-gallery-stat-grid">
            <div><strong>${finiteCount(preview.directoryCount)}</strong><span>文件夹</span></div>
            <div><strong>${finiteCount(preview.fileCount)}</strong><span>文件</span></div>
            <div><strong>${finiteCount(preview.symlinkCount)}</strong><span>符号链接</span></div>
          </div>
          <div class="finder-gallery-samples">${samples || '<div class="finder-gallery-empty-preview">此目录没有可显示的普通项目</div>'}</div>
        </div>`
      };
    }

    return {
      ...result,
      kind: 'unsupported',
      icon: '🚫',
      html: `<div class="finder-gallery-empty-preview"><span aria-hidden="true">🚫</span><strong>${escapeHtml(preview?.reason || '暂不支持预览此文件')}</strong></div>`
    };
  }

  function renderLoading(item, formatters = {}) {
    return {
      kind: 'loading',
      icon: item?.type === 'directory' ? '📁' : '📄',
      title: String(item?.name || '正在载入预览'),
      detail: [
        item?.type === 'file' && Number.isFinite(Number(item?.size))
          ? (formatters.formatFileSize || defaultFileSize)(item.size)
          : '',
        (formatters.formatItemDate || defaultDate)(item?.modifiedTime),
        item?.path || ''
      ].filter(Boolean).join(' · '),
      html: '<div class="finder-gallery-empty-preview finder-gallery-loading"><span class="finder-gallery-spinner" aria-hidden="true"></span><strong>正在载入安全预览…</strong></div>',
      domTruncated: false
    };
  }

  function renderError(message) {
    return {
      kind: 'error',
      icon: '⚠',
      title: '无法预览',
      detail: '',
      html: `<div class="finder-gallery-empty-preview"><span aria-hidden="true">⚠</span><strong>${escapeHtml(message || '预览失败')}</strong></div>`,
      domTruncated: false
    };
  }

  return {
    MAX_TEXT_CHARACTERS,
    SAFE_IMAGE_DATA_URL,
    escapeHtml,
    pickPreviewItem,
    isPreviewRequestCurrent,
    renderMarkdown,
    renderPreview,
    renderLoading,
    renderError
  };
});
