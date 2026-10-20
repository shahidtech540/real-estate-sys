import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { env } from "@/core/config";

/**
 * `FileStore` — `ARCHITECTURE.md` §7.2. One interface, one Phase-1 driver
 * (local disk). The S3 driver is configuration, not a rewrite; it is not needed
 * for this deployment (§7.2 "Why local").
 */
export interface FileMeta {
  contentType: string;
  byteSize: number;
}

export interface StoredFile {
  key: string;
  byteSize: number;
}

export interface FileStore {
  put(key: string, data: Buffer, meta: FileMeta): Promise<StoredFile>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Files live outside the repository and outside any web root
 * (`ARCHITECTURE.md` §7.2). The key is content-addressed and never
 * user-controlled, so path traversal is impossible; `resolve` plus the prefix
 * check keeps that true even if a caller passes `..`.
 */
export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    const prefix = resolve(this.root) + "/";
    if (!full.startsWith(prefix))
      throw new Error(`invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer, meta: FileMeta): Promise<StoredFile> {
    void meta;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key, byteSize: data.byteLength };
  }

  get(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.pathFor(key)));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

let store: FileStore | undefined;

export function fileStore(): FileStore {
  store ??= new LocalFileStore(env().FILE_STORE_ROOT);
  return store;
}
