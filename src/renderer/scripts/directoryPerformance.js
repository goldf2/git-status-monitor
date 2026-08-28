(function exposeDirectoryPerformance(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DirectoryPerformance = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDirectoryPerformanceApi() {
  const STRATEGY_LABELS = Object.freeze({
    loading: '正在读取',
    empty: '空目录',
    'direct-card': '直接图标',
    'direct-list': '直接列表',
    'direct-column': '直接分栏',
    'direct-gallery': '直接图库',
    'progressive-card': '渐进图标',
    'progressive-list': '渐进列表',
    'progressive-column': '渐进分栏',
    'progressive-gallery': '渐进图库',
    'virtual-list': '固定行虚拟列表',
    'virtual-card': '多列虚拟图标'
  });

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
  }

  function elapsed(from, to) {
    return Math.max(0, timestamp(to) - timestamp(from));
  }

  function roundMs(value) {
    if (value === null || value === undefined) return null;
    return Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
  }

  function begin(context = {}, startedAt = 0) {
    return {
      requestId: count(context.requestId),
      path: typeof context.path === 'string' ? context.path : '',
      style: typeof context.style === 'string' ? context.style : 'card',
      strategy: 'loading',
      startedAt: timestamp(startedAt),
      readAt: null,
      visibleAt: null,
      firstDomAt: null,
      completedAt: null,
      sourceItems: 0,
      visibleItems: 0,
      domItems: 0,
      itemsPerRow: 1,
      completed: false,
      cancelled: false
    };
  }

  function markRead(sample, sourceItems, at) {
    if (!sample || sample.cancelled || sample.completed) return sample;
    sample.sourceItems = count(sourceItems);
    sample.readAt = timestamp(at);
    return sample;
  }

  function markVisible(sample, visibleItems, at) {
    if (!sample || sample.cancelled || sample.completed) return sample;
    sample.visibleItems = count(visibleItems);
    sample.visibleAt = timestamp(at);
    return sample;
  }

  function setStrategy(sample, strategy, metadata = {}) {
    if (!sample || sample.cancelled || sample.completed) return sample;
    sample.strategy = Object.hasOwn(STRATEGY_LABELS, strategy) ? strategy : 'loading';
    if (metadata.itemsPerRow !== undefined) sample.itemsPerRow = Math.max(1, count(metadata.itemsPerRow));
    return sample;
  }

  function markFirstDom(sample, metrics = {}, at) {
    if (!sample || sample.cancelled || sample.completed || sample.firstDomAt !== null) return sample;
    sample.firstDomAt = timestamp(at);
    sample.domItems = count(metrics.domItems);
    if (metrics.itemsPerRow !== undefined) sample.itemsPerRow = Math.max(1, count(metrics.itemsPerRow));
    return sample;
  }

  function complete(sample, metrics = {}, at) {
    if (!sample || sample.cancelled || sample.completed) return sample;
    const completedAt = timestamp(at);
    if (sample.firstDomAt === null) markFirstDom(sample, metrics, completedAt);
    sample.domItems = count(metrics.domItems);
    if (metrics.itemsPerRow !== undefined) sample.itemsPerRow = Math.max(1, count(metrics.itemsPerRow));
    sample.completedAt = completedAt;
    sample.completed = true;
    return sample;
  }

  function cancel(sample, at) {
    if (!sample || sample.cancelled || sample.completed) return sample;
    sample.completedAt = timestamp(at);
    sample.cancelled = true;
    return sample;
  }

  function snapshot(sample) {
    if (!sample) return null;
    const readMs = sample.readAt === null ? null : elapsed(sample.startedAt, sample.readAt);
    const filterMs = sample.readAt === null || sample.visibleAt === null
      ? null
      : elapsed(sample.readAt, sample.visibleAt);
    const firstDomMs = sample.firstDomAt === null ? null : elapsed(sample.startedAt, sample.firstDomAt);
    const renderMs = sample.visibleAt === null || sample.completedAt === null
      ? null
      : elapsed(sample.visibleAt, sample.completedAt);
    const totalMs = sample.completedAt === null ? null : elapsed(sample.startedAt, sample.completedAt);
    return {
      requestId: sample.requestId,
      path: sample.path,
      style: sample.style,
      strategy: sample.strategy,
      sourceItems: sample.sourceItems,
      visibleItems: sample.visibleItems,
      domItems: sample.domItems,
      itemsPerRow: sample.itemsPerRow,
      readMs: roundMs(readMs),
      filterMs: roundMs(filterMs),
      firstDomMs: roundMs(firstDomMs),
      renderMs: roundMs(renderMs),
      totalMs: roundMs(totalMs),
      completed: sample.completed === true,
      cancelled: sample.cancelled === true
    };
  }

  function strategyLabel(strategy, itemsPerRow = 1) {
    const label = STRATEGY_LABELS[strategy] || STRATEGY_LABELS.loading;
    return strategy === 'virtual-card' ? `${label}（${Math.max(1, count(itemsPerRow))} 列）` : label;
  }

  function formatMs(value) {
    return value === null || value === undefined ? '—' : `${roundMs(value).toFixed(1)} ms`;
  }

  function diagnosticRows(sample) {
    const value = snapshot(sample);
    if (!value) return [];
    return [
      { label: '显示策略', value: strategyLabel(value.strategy, value.itemsPerRow) },
      { label: '目录项目', value: `${value.visibleItems.toLocaleString('zh-CN')} / ${value.sourceItems.toLocaleString('zh-CN')}` },
      { label: '当前 DOM', value: `${value.domItems.toLocaleString('zh-CN')} 项` },
      { label: '目录读取', value: formatMs(value.readMs) },
      { label: '筛选准备', value: formatMs(value.filterMs) },
      { label: '首批 DOM', value: formatMs(value.firstDomMs) },
      { label: '完整显示', value: formatMs(value.totalMs) }
    ];
  }

  return {
    STRATEGY_LABELS,
    begin,
    markRead,
    markVisible,
    setStrategy,
    markFirstDom,
    complete,
    cancel,
    snapshot,
    strategyLabel,
    diagnosticRows
  };
});
