#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { constants as zlibConstants, deflateRawSync } from 'node:zlib';

const [rootArg, outputArg] = process.argv.slice(2);
if (!rootArg || !outputArg) {
  console.error('Usage: node scripts/write-deterministic-zip.mjs <directory> <output.zip>');
  process.exit(2);
}

const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, the earliest ZIP timestamp.

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sortedEntries(directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`refusing to archive symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...sortedEntries(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
    else throw new Error(`refusing to archive non-regular file: ${relative}`);
  }
  return files;
}

function localHeader({ name, crc, compressedSize, uncompressedSize }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader({ name, crc, compressedSize, uncompressedSize, offset, mode }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4); // ZIP 2.0, created on Unix.
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of sortedEntries(root)) {
  const name = Buffer.from(`${path.basename(root)}/${file.relative}`, 'utf8');
  const content = fs.readFileSync(file.absolute);
  const compressed = deflateRawSync(content, {
    level: 9,
    memLevel: 9,
    strategy: zlibConstants.Z_FIXED,
  });
  const checksum = crc32(content);
  const mode = fs.statSync(file.absolute).mode & 0o111 ? 0o755 : 0o644;
  const local = localHeader({
    name,
    crc: checksum,
    compressedSize: compressed.length,
    uncompressedSize: content.length,
  });
  localParts.push(local, name, compressed);
  centralParts.push(
    centralHeader({
      name,
      crc: checksum,
      compressedSize: compressed.length,
      uncompressedSize: content.length,
      offset,
      mode,
    }),
    name,
  );
  offset += local.length + name.length + compressed.length;
}

const centralOffset = offset;
const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
const entryCount = centralParts.length / 2;
if (entryCount > 0xffff || centralOffset > 0xffffffff || centralSize > 0xffffffff) {
  throw new Error('ZIP64 is not supported by the deterministic package writer');
}

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(entryCount, 8);
end.writeUInt16LE(entryCount, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(centralOffset, 16);
end.writeUInt16LE(0, 20);

fs.writeFileSync(output, Buffer.concat([...localParts, ...centralParts, end]));
console.log(`built ${output} (${entryCount} files)`);
