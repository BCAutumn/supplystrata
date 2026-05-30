import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export function extractFirstZipEntry(bytes: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = readUint32LE(bytes, offset);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) break;
    const compressionMethod = readUint16LE(bytes, offset + 8);
    const compressedSize = readUint32LE(bytes, offset + 18);
    const fileNameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressionMethod === 0) return compressed;
    if (compressionMethod === 8) return inflateRawSync(compressed);
    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
  }
  throw new Error("ZIP archive did not contain a readable local file entry.");
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);
}
