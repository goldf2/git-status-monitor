(function exposeBatchRename(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BatchRename = api;
})(typeof window !== 'undefined' ? window : globalThis, function createBatchRenameApi() {
  const MODES = Object.freeze(['replace', 'add', 'format']);
  const PLACEMENTS = Object.freeze(['before', 'after']);
  const MAX_TEXT_LENGTH = 160;
  const MAX_FORMAT_NAME_LENGTH = 120;
  const MAX_COUNTER = 999999;
  const MAX_COUNTER_WIDTH = 6;

  function cleanText(value, limit = MAX_TEXT_LENGTH) {
    return String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, limit);
  }

  function normalizeOptions(value = {}) {
    const mode = MODES.includes(value.mode) ? value.mode : 'replace';
    const placement = PLACEMENTS.includes(value.placement) ? value.placement : 'after';
    const startAt = Number(value.startAt);
    const counterWidth = Number(value.counterWidth);
    return {
      mode,
      searchText: cleanText(value.searchText),
      replacementText: cleanText(value.replacementText),
      text: cleanText(value.text),
      placement,
      formatName: cleanText(value.formatName, MAX_FORMAT_NAME_LENGTH).trim(),
      startAt: Number.isSafeInteger(startAt) && startAt >= 0 && startAt <= MAX_COUNTER ? startAt : 1,
      counterWidth: Number.isSafeInteger(counterWidth) && counterWidth >= 1 && counterWidth <= MAX_COUNTER_WIDTH
        ? counterWidth
        : 1
    };
  }

  function validateOptions(value) {
    const options = normalizeOptions(value);
    if (options.mode === 'replace' && !options.searchText) {
      return { ok: false, options, error: '请输入要查找的文本' };
    }
    if (options.mode === 'add' && !options.text) {
      return { ok: false, options, error: '请输入要添加的文本' };
    }
    if (options.mode === 'format' && !options.formatName) {
      return { ok: false, options, error: '请输入新名称的基本文本' };
    }
    return { ok: true, options, error: '' };
  }

  function splitFileName(name, isFile) {
    const source = String(name || '');
    if (!isFile || (source.startsWith('.') && !source.slice(1).includes('.'))) {
      return { stem: source, extension: '' };
    }
    const extensionIndex = source.lastIndexOf('.');
    if (extensionIndex <= 0) return { stem: source, extension: '' };
    return { stem: source.slice(0, extensionIndex), extension: source.slice(extensionIndex) };
  }

  function replaceAllLiteral(value, searchText, replacementText) {
    return String(value).split(searchText).join(replacementText);
  }

  function transformName(item, value, index = 0) {
    const validation = validateOptions(value);
    if (!validation.ok) throw new Error(validation.error);
    const options = validation.options;
    const name = String(item?.name || '');
    if (options.mode === 'replace') {
      return replaceAllLiteral(name, options.searchText, options.replacementText);
    }
    const parts = splitFileName(name, item?.isFile === true);
    if (options.mode === 'add') {
      return options.placement === 'before'
        ? `${options.text}${name}`
        : `${parts.stem}${options.text}${parts.extension}`;
    }
    const counter = options.startAt + Number(index || 0);
    if (!Number.isSafeInteger(counter) || counter > MAX_COUNTER) throw new Error('序号超出允许范围');
    const counterText = String(counter).padStart(options.counterWidth, '0');
    return `${options.formatName} ${counterText}${parts.extension}`;
  }

  function describeOptions(value) {
    const validation = validateOptions(value);
    if (!validation.ok) return validation.error;
    const options = validation.options;
    if (options.mode === 'replace') return `替换“${options.searchText}”为“${options.replacementText}”`;
    if (options.mode === 'add') return `${options.placement === 'before' ? '名称前' : '名称后'}添加“${options.text}”`;
    return `格式化为“${options.formatName} ${String(options.startAt).padStart(options.counterWidth, '0')}…”`;
  }

  return {
    MODES,
    PLACEMENTS,
    MAX_COUNTER,
    MAX_COUNTER_WIDTH,
    normalizeOptions,
    validateOptions,
    splitFileName,
    transformName,
    describeOptions
  };
});
