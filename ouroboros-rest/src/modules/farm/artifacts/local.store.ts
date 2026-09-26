/**
 * The local-volume {@link ArtifactStore} — the default driver (#330, option **3-A**).
 *
 * Objects are files under one root directory, at their key's path. A write goes to a temporary
 * file beside its destination and is renamed into place only once every byte is on disk, so a
 * reader never sees half a file and a failed write leaves nothing under the key.
 *
 * It does not scale horizontally — two replicas do not share this directory — which is why it is a
 * driver behind an interface rather than the design.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  ArtifactNotFoundError,
  ArtifactStoreError,
  isArtifactKey,
  type ArtifactKey,
  type ArtifactStore,
} from "./artifact.store";

/** The driver name `test_artifacts.storage_ref` records. */
export const LOCAL_DRIVER = "local";

/** Stores artifacts as files under a root directory. */
export class LocalArtifactStore implements ArtifactStore {
  readonly driver = LOCAL_DRIVER;
  private readonly root: string;

  /**
   * @param root - The directory. Relative paths are resolved against the working directory; it
   *   is created on the first write.
   */
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** @inheritdoc */
  async put(key: ArtifactKey, body: Readable, sizeBytes: number): Promise<void> {
    const path = this.pathOf(key);
    const temporary = join(dirname(path), `.upload-${randomUUID()}`);

    try {
      await mkdir(dirname(path), { recursive: true });
      await pipeline(body, exactly(sizeBytes), createWriteStream(temporary, { flags: "wx" }));
      await rename(temporary, path);
    } catch (error) {
      // Best effort: the path that could not be written may not be removable either.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error instanceof ArtifactStoreError
        ? error
        : new ArtifactStoreError(`the artifact at ${key} could not be written`, { cause: error });
    }
  }

  /** @inheritdoc */
  async get(key: ArtifactKey): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ArtifactNotFoundError(key);
      throw new ArtifactStoreError(`the artifact at ${key} could not be read`, { cause: error });
    }
  }

  /** @inheritdoc */
  async delete(key: ArtifactKey): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /**
   * The file a key names — refused unless it is inside the root.
   *
   * @param key - The key.
   * @returns An absolute path under the root.
   * @throws {ArtifactStoreError} If the key is not a key.
   */
  private pathOf(key: ArtifactKey): string {
    const path = resolve(this.root, key);

    // isArtifactKey already refuses `..` segments; the prefix check is the second lock on the door.
    if (!isArtifactKey(key) || !path.startsWith(this.root + sep)) {
      throw new ArtifactStoreError(`${JSON.stringify(key)} is not an artifact key`);
    }

    return path;
  }
}

/**
 * A pass-through that fails unless exactly `sizeBytes` go through it — the local driver's
 * `Content-Length`, so both drivers refuse a body that disagrees with its declared size.
 *
 * @param sizeBytes - The count.
 * @returns The transform.
 */
export function exactly(sizeBytes: number): Transform {
  let seen = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > sizeBytes) {
        callback(new ArtifactStoreError(`the body is longer than its declared ${sizeBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(
        seen === sizeBytes
          ? null
          : new ArtifactStoreError(`the body is ${seen} bytes, not its declared ${sizeBytes}`),
      );
    },
  });
}
