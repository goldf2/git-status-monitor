(function exposeFileTransfers(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileTransfers = api;
})(typeof window !== 'undefined' ? window : globalThis, function createFileTransfersApi() {
  function transferKindLabel(kind) {
    if (kind === 'atomic-move') return '同卷原子移动';
    if (kind === 'copy-delete') return '跨卷复制后删除';
    if (kind === 'skip') return '跳过';
    return '安全复制';
  }

  function conflictActionLabel(action) {
    if (action === 'replace') return '替换';
    if (action === 'skip') return '跳过';
    if (action === 'keep-both') return '保留两者';
    return '';
  }

  function operationLabel(preview) {
    if (preview?.operationType === 'import') return '导入';
    return preview?.mode === 'move' ? '移动' : '复制';
  }

  function progressPresentation(status, preview) {
    const operation = operationLabel(preview);
    if (!status) {
      return {
        tone: 'neutral',
        title: `正在重新核对${operation}计划…`,
        detail: '此阶段只读取来源与目标信息',
        progress: 0,
        indeterminate: true,
        cancellable: false,
        finished: false
      };
    }
    const progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
    if (status.state === 'completed') {
      return { tone: 'success', title: `${operation}完成`, detail: '目标已提交，操作已写入可撤销历史', progress: 100, indeterminate: false, cancellable: false, finished: true };
    }
    if (status.state === 'cancelled') {
      return { tone: 'neutral', title: `${operation}已取消`, detail: '隐藏临时项已清理，来源保持不变', progress, indeterminate: false, cancellable: false, finished: true };
    }
    if (status.state === 'needs-review') {
      return { tone: 'danger', title: '传输需要人工检查', detail: status.error || '来源与目标已原样保留', progress, indeterminate: false, cancellable: false, finished: true };
    }
    if (status.state === 'failed') {
      return { tone: 'danger', title: `${operation}失败`, detail: status.error || '未提交最终目标', progress, indeterminate: false, cancellable: false, finished: true };
    }
    if (status.phase === 'committing') {
      return { tone: 'accent', title: '正在完成提交…', detail: '目标已校验，此短暂阶段不再接受取消', progress: 100, indeterminate: true, cancellable: false, finished: false };
    }
    return {
      tone: 'accent',
      title: status.cancelRequested ? '正在安全取消…' : `正在准备${operation}内容…`,
      detail: status.currentSource || '来源在准备阶段保持不变',
      progress,
      indeterminate: false,
      cancellable: Boolean(status.cancellable && !status.cancelRequested),
      finished: false
    };
  }

  return { transferKindLabel, conflictActionLabel, operationLabel, progressPresentation };
});
