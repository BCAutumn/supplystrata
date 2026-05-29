import { gzipSync } from "node:zlib";

export function gzipByteLength(content) {
  return gzipSync(content).byteLength;
}

export function evaluateBundleSizeGate(input) {
  const gzipBytes = gzipByteLength(input.content);
  return {
    path: input.path,
    gzipBytes,
    maxGzipBytes: input.maxGzipBytes,
    ok: gzipBytes <= input.maxGzipBytes
  };
}
