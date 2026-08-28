(function exposeGitPatchSelection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitPatchSelection = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createGitPatchSelection() {
  'use strict';

  const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
  const MAX_SELECTABLE_LINES = 2000;

  function unsupported(reason, preamble = [], hunks = []) {
    return { supported: false, reason, preamble, hunks, changedLines: [] };
  }

  function parseUnifiedDiff(diff) {
    if (typeof diff !== 'string' || !diff.trim()) return unsupported('没有可选择的文本差异');
    if (/^GIT binary patch$/m.test(diff) || /^Binary files .* differ$/m.test(diff)) {
      return unsupported('二进制文件仅支持整文件暂存');
    }
    if (/^@@@/m.test(diff)) return unsupported('合并差异暂不支持行级操作');

    const lines = diff.split('\n');
    const fileHeaders = lines.filter(line => line.startsWith('diff --git '));
    if (fileHeaders.length > 1) return unsupported('一次只能处理一个文件的差异');

    const firstHunkIndex = lines.findIndex(line => HUNK_HEADER.test(line));
    if (firstHunkIndex < 0) return unsupported('该差异没有可选择的文本行');

    const preamble = lines.slice(0, firstHunkIndex);
    if (!preamble.some(line => line.startsWith('--- ')) || !preamble.some(line => line.startsWith('+++ '))) {
      return unsupported('差异文件头不完整');
    }

    const hunks = [];
    const changedLines = [];
    let cursor = firstHunkIndex;
    while (cursor < lines.length) {
      if (cursor === lines.length - 1 && lines[cursor] === '') break;
      const match = lines[cursor].match(HUNK_HEADER);
      if (!match) return unsupported('差异包含无法识别的片段', preamble, hunks);

      const hunkIndex = hunks.length;
      const hunk = {
        index: hunkIndex,
        header: lines[cursor],
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        suffix: match[5] || '',
        body: []
      };
      cursor += 1;
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      let seenOld = 0;
      let seenNew = 0;

      while (cursor < lines.length && !HUNK_HEADER.test(lines[cursor])) {
        const raw = lines[cursor];
        if (cursor === lines.length - 1 && raw === '') {
          cursor += 1;
          break;
        }
        if (raw.startsWith('diff --git ')) return unsupported('一次只能处理一个文件的差异', preamble, hunks);

        const prefix = raw[0];
        const bodyIndex = hunk.body.length;
        const row = { raw, bodyIndex, hunkIndex, type: 'context', oldLine: null, newLine: null };
        if (prefix === ' ') {
          row.oldLine = oldLine++;
          row.newLine = newLine++;
          seenOld += 1;
          seenNew += 1;
        } else if (prefix === '-') {
          row.type = 'deletion';
          row.oldLine = oldLine++;
          seenOld += 1;
        } else if (prefix === '+') {
          row.type = 'addition';
          row.newLine = newLine++;
          seenNew += 1;
        } else if (prefix === '\\') {
          row.type = 'marker';
        } else {
          return unsupported('差异包含无法识别的行', preamble, hunks);
        }

        if (row.type === 'addition' || row.type === 'deletion') {
          row.id = `h${hunkIndex}:l${bodyIndex}`;
          row.content = raw.slice(1);
          changedLines.push({
            id: row.id,
            hunkIndex,
            bodyIndex,
            type: row.type,
            oldLine: row.oldLine,
            newLine: row.newLine,
            content: row.content
          });
        }
        hunk.body.push(row);
        cursor += 1;
      }

      if (seenOld !== hunk.oldCount || seenNew !== hunk.newCount) {
        return unsupported('差异范围与内容不一致，无法安全选择行', preamble, hunks);
      }
      hunks.push(hunk);
    }

    if (!changedLines.length) return unsupported('该差异没有可选择的文本行', preamble, hunks);
    if (changedLines.length > MAX_SELECTABLE_LINES) {
      return unsupported(`单个文件最多选择 ${MAX_SELECTABLE_LINES} 个变更行`, preamble, hunks);
    }
    return { supported: true, reason: '', preamble, hunks, changedLines };
  }

  function formatRange(start, count) {
    return count === 1 ? String(start) : `${start},${count}`;
  }

  function buildSelectionPatch(diff, selectedLineIds) {
    const parsed = parseUnifiedDiff(diff);
    if (!parsed.supported) throw new Error(parsed.reason);
    if (!Array.isArray(selectedLineIds) || selectedLineIds.length === 0) {
      throw new Error('请至少选择一个变更行');
    }

    const selected = new Set();
    for (const id of selectedLineIds) {
      if (typeof id !== 'string' || !/^h\d+:l\d+$/.test(id)) throw new Error('选择的变更行身份无效');
      selected.add(id);
    }
    const known = new Set(parsed.changedLines.map(line => line.id));
    for (const id of selected) {
      if (!known.has(id)) throw new Error('选择的变更行已不存在，请重新预览');
    }

    const patchHunks = [];
    let cumulativeDelta = 0;
    let additionCount = 0;
    let deletionCount = 0;
    for (const hunk of parsed.hunks) {
      const body = [];
      let oldCount = 0;
      let newCount = 0;
      let hunkSelected = 0;
      let previousEmitted = false;

      for (const row of hunk.body) {
        if (row.type === 'context') {
          body.push(row.raw);
          oldCount += 1;
          newCount += 1;
          previousEmitted = true;
          continue;
        }
        if (row.type === 'marker') {
          if (previousEmitted) body.push(row.raw);
          continue;
        }
        if (row.type === 'deletion') {
          if (selected.has(row.id)) {
            body.push(row.raw);
            oldCount += 1;
            deletionCount += 1;
            hunkSelected += 1;
          } else {
            body.push(` ${row.raw.slice(1)}`);
            oldCount += 1;
            newCount += 1;
          }
          previousEmitted = true;
          continue;
        }
        if (row.type === 'addition') {
          if (selected.has(row.id)) {
            body.push(row.raw);
            newCount += 1;
            additionCount += 1;
            hunkSelected += 1;
            previousEmitted = true;
          } else {
            previousEmitted = false;
          }
        }
      }

      if (!hunkSelected) continue;
      const newStart = hunk.oldStart + cumulativeDelta;
      patchHunks.push([
        `@@ -${formatRange(hunk.oldStart, oldCount)} +${formatRange(newStart, newCount)} @@${hunk.suffix}`,
        ...body
      ].join('\n'));
      cumulativeDelta += newCount - oldCount;
    }

    if (!patchHunks.length) throw new Error('所选行未形成可应用的补丁');
    return {
      patch: `${parsed.preamble.join('\n')}\n${patchHunks.join('\n')}\n`,
      selectedLineCount: selected.size,
      additionCount,
      deletionCount,
      hunkCount: patchHunks.length
    };
  }

  return {
    MAX_SELECTABLE_LINES,
    parseUnifiedDiff,
    buildSelectionPatch
  };
}));
