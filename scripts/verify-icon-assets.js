#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath));
}

function pngInfo(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25]
  };
}

const appPng = read('public/icon.png');
const masterPng = read('public/icon-master.png');
const icns = read('public/icon.icns');
const ico = read('public/icon.ico');
const appPngInfo = pngInfo(appPng);
const masterPngInfo = pngInfo(masterPng);

assert.deepEqual(appPngInfo, { width: 1024, height: 1024, bitDepth: 8, colorType: 6 });
assert.deepEqual(masterPngInfo, { width: 1254, height: 1254, bitDepth: 8, colorType: 6 });
assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
assert.equal(icns.readUInt32BE(4), icns.length);
assert.equal(ico.readUInt16LE(0), 0);
assert.equal(ico.readUInt16LE(2), 1);
assert.ok(ico.readUInt16LE(4) >= 1);
assert.equal(ico[6] || 256, 256);
assert.equal(ico[7] || 256, 256);

for (const relativePath of ['public/icon.png', 'public/icon.icns', 'public/icon.ico', 'public/icon-master.png']) {
  const buffer = read(relativePath);
  process.stdout.write(`${relativePath} ${buffer.length} bytes sha256=${crypto.createHash('sha256').update(buffer).digest('hex')}\n`);
}
