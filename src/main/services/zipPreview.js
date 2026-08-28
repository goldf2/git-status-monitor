const fs = require('node:fs');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const CENTRAL_DIRECTORY_DIGITAL_SIGNATURE = 0x05054b50;
const EOCD_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_PREVIEW_ENTRIES = 500;

class ZipPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ZipPreviewError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ZipPreviewError(code, message);
}

function findEndOfCentralDirectory(buffer) {
  const firstCandidate = buffer.length - EOCD_MIN_BYTES;
  const lastCandidate = Math.max(0, buffer.length - EOCD_MIN_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = firstCandidate; offset >= lastCandidate; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_MIN_BYTES + commentLength === buffer.length) return offset;
  }
  fail('ZIP_EOCD_NOT_FOUND', '找不到 ZIP 中央目录结束记录');
}

function inspectEndOfCentralDirectory(buffer, options = {}) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    entriesOnDisk === 0xffff
    || totalEntries === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    fail('ZIP64_UNSUPPORTED', '当前只读预览暂不支持 Zip64');
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    fail('ZIP_MULTIDISK_UNSUPPORTED', '暂不支持分卷 ZIP 预览');
  }
  const maxCentralDirectoryBytes = Math.max(
    1024,
    Number(options.maxCentralDirectoryBytes) || DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES
  );
  const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
  if (centralDirectorySize > maxCentralDirectoryBytes) {
    fail('ZIP_CENTRAL_DIRECTORY_TOO_LARGE', 'ZIP 目录超过只读预览上限');
  }
  if (totalEntries > maxEntries) {
    fail('ZIP_TOO_MANY_ENTRIES', `ZIP 条目数超过只读预览上限 ${maxEntries}`);
  }
  return {
    eocdOffset,
    totalEntries,
    centralDirectorySize,
    centralDirectoryOffset
  };
}

function unicodePathFromExtra(extra) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    const end = offset + 4 + length;
    if (end > extra.length) break;
    if (id === 0x7075 && length >= 5 && extra[offset + 4] === 1) {
      return extra.subarray(offset + 9, end).toString('utf8');
    }
    offset = end;
  }
  return null;
}

function displayEntryName(nameBuffer, extra, flags) {
  const unicodeName = unicodePathFromExtra(extra);
  const decoded = unicodeName || nameBuffer.toString((flags & 0x0800) !== 0 ? 'utf8' : 'latin1');
  const normalized = decoded
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f\u007f]/g, '�');
  return normalized.length > 1024 ? `${normalized.slice(0, 1023)}…` : normalized;
}

function methodName(method) {
  if (method === 0) return '存储';
  if (method === 8) return 'Deflate';
  return `方法 ${method}`;
}

function parseCentralDirectory(buffer, totalEntries, options = {}) {
  const maxPreviewEntries = Math.max(
    1,
    Number(options.maxPreviewEntries) || DEFAULT_MAX_PREVIEW_ENTRIES
  );
  const entries = [];
  let cursor = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let encryptedCount = 0;
  let totalCompressedSize = 0;
  let totalUncompressedSize = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 中央目录结构不完整');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      fail('ZIP64_UNSUPPORTED', '当前只读预览暂不支持 Zip64');
    }
    if (diskStart !== 0) fail('ZIP_MULTIDISK_UNSUPPORTED', '暂不支持分卷 ZIP 预览');
    if (
      Number.isInteger(options.centralDirectoryOffset)
      && localHeaderOffset >= options.centralDirectoryOffset
    ) {
      fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 本地条目位置无效');
    }
    const variableLength = nameLength + extraLength + commentLength;
    if (cursor + 46 + variableLength > buffer.length) {
      fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 中央目录条目越界');
    }
    const nameStart = cursor + 46;
    const extraStart = nameStart + nameLength;
    const name = displayEntryName(
      buffer.subarray(nameStart, extraStart),
      buffer.subarray(extraStart, extraStart + extraLength),
      flags
    );
    const unixMode = externalAttributes >>> 16;
    const isDirectory = name.endsWith('/')
      || (externalAttributes & 0x10) === 0x10
      || (unixMode & 0xf000) === 0x4000;
    const encrypted = (flags & 0x0001) !== 0;
    if (isDirectory) directoryCount += 1;
    else fileCount += 1;
    if (encrypted) encryptedCount += 1;
    totalCompressedSize += compressedSize;
    totalUncompressedSize += uncompressedSize;
    if (entries.length < maxPreviewEntries) {
      entries.push({
        name,
        isDirectory,
        compressedSize,
        uncompressedSize,
        method: methodName(method),
        encrypted
      });
    }
    cursor += 46 + variableLength;
  }

  if (cursor < buffer.length) {
    const hasDigitalSignature = cursor + 6 <= buffer.length
      && buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_DIGITAL_SIGNATURE;
    const signatureLength = hasDigitalSignature ? buffer.readUInt16LE(cursor + 4) : -1;
    if (!hasDigitalSignature || cursor + 6 + signatureLength !== buffer.length) {
      fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 中央目录包含无法识别的数据');
    }
  }
  return {
    totalEntries,
    fileCount,
    directoryCount,
    encryptedCount,
    totalCompressedSize,
    totalUncompressedSize,
    entries,
    truncated: entries.length < totalEntries,
    readOnly: true
  };
}

function parseZipCentralDirectory(archiveBuffer, options = {}) {
  if (!Buffer.isBuffer(archiveBuffer) || archiveBuffer.length < EOCD_MIN_BYTES) {
    fail('ZIP_EOCD_NOT_FOUND', '找不到 ZIP 中央目录结束记录');
  }
  const eocd = inspectEndOfCentralDirectory(archiveBuffer, options);
  if (eocd.centralDirectoryOffset + eocd.centralDirectorySize > eocd.eocdOffset) {
    fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 中央目录位置无效');
  }
  const centralDirectory = archiveBuffer.subarray(
    eocd.centralDirectoryOffset,
    eocd.centralDirectoryOffset + eocd.centralDirectorySize
  );
  return parseCentralDirectory(centralDirectory, eocd.totalEntries, {
    ...options,
    centralDirectoryOffset: eocd.centralDirectoryOffset
  });
}

function sameFileRevision(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) break;
    offset += result.bytesRead;
  }
  if (offset !== length) fail('ZIP_CHANGED_DURING_PREVIEW', 'ZIP 在预览期间发生变化');
  return buffer;
}

async function readZipPreview(filePath, expectedStat, options = {}) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || (expectedStat && !sameFileRevision(expectedStat, openedStat))) {
      fail('ZIP_CHANGED_DURING_PREVIEW', 'ZIP 在预览期间发生变化');
    }
    if (openedStat.size < EOCD_MIN_BYTES) fail('ZIP_EOCD_NOT_FOUND', '找不到 ZIP 中央目录结束记录');
    const tailLength = Math.min(openedStat.size, EOCD_MIN_BYTES + MAX_ZIP_COMMENT_BYTES);
    const tailOffset = openedStat.size - tailLength;
    const tail = await readExactly(handle, tailLength, tailOffset);
    const eocd = inspectEndOfCentralDirectory(tail, options);
    const absoluteEocdOffset = tailOffset + eocd.eocdOffset;
    if (eocd.centralDirectoryOffset + eocd.centralDirectorySize > absoluteEocdOffset) {
      fail('ZIP_CENTRAL_DIRECTORY_INVALID', 'ZIP 中央目录位置无效');
    }
    const centralDirectory = await readExactly(
      handle,
      eocd.centralDirectorySize,
      eocd.centralDirectoryOffset
    );
    const finishedStat = await handle.stat();
    if (!sameFileRevision(openedStat, finishedStat)) {
      fail('ZIP_CHANGED_DURING_PREVIEW', 'ZIP 在预览期间发生变化');
    }
    return parseCentralDirectory(centralDirectory, eocd.totalEntries, {
      ...options,
      centralDirectoryOffset: eocd.centralDirectoryOffset
    });
  } finally {
    await handle.close();
  }
}

function describeZipPreviewError(error) {
  if (!(error instanceof ZipPreviewError)) return '无法安全读取 ZIP 目录';
  return error.message || '无法安全读取 ZIP 目录';
}

module.exports = {
  ZipPreviewError,
  parseZipCentralDirectory,
  readZipPreview,
  describeZipPreviewError
};
