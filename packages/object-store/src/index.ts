import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import type { Readable } from "node:stream";

export interface ObjectStore {
  put(key: string, body: Uint8Array, meta?: Record<string, string>): Promise<void>;
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  url(key: string): Promise<string>;
}

export class FsObjectStore implements ObjectStore {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir);
  }

  async put(key: string, body: Uint8Array, _meta: Record<string, string> = {}): Promise<void> {
    const path = this.#safePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.#safePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.#safePath(key));
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  async url(key: string): Promise<string> {
    return this.#safePath(key);
  }

  #safePath(key: string): string {
    const normalized = normalize(key);
    if (normalized.startsWith("..") || normalized.includes("/../")) {
      throw new Error(`Unsafe object-store key: ${key}`);
    }
    return join(this.#baseDir, normalized);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
