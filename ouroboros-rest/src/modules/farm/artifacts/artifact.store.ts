/**
 * `ArtifactStore` — where an uploaded artifact's bytes live (AT.2,
 * [#330](https://github.com/NobuData/ouroboros/issues/330), option **3-A**).
 *
 * An interface from day one, with two drivers behind it:
 *
 * ```
 * OURO_ARTIFACT_STORE=local   LocalArtifactStore   a REST-mounted volume (the default)
 * OURO_ARTIFACT_STORE=s3      S3ArtifactStore      S3 or MinIO, path-style, SigV4
 * ```
 *
 * The local volume is the default because requiring object storage in a self-hosted single-node
 * deployment contradicts the lightweight rule — and its honest limitation is that **it does not
 * scale horizontally**: two replicas do not share a disk. A deployment that needs scale flips
 * configuration, not code, and `test_artifacts.storage_ref` records `{driver, key}` per row, so
 * the two can coexist while a migration (AV.5, #347) moves the old rows.
 *
 * `artifact.store.contract.fixture.ts` is the one suite both drivers pass, unchanged — the
 * criterion that the swap is configuration only.
 */

import type { Readable } from "node:stream";

/** A storage key: `<organization>/<job>/<upload>/<name>` — see {@link artifactKey}. */
export type ArtifactKey = string;

/** The driver-neutral contract every artifact store keeps. */
export interface ArtifactStore {
  /** The driver's name, as `test_artifacts.storage_ref.driver` records it. */
  readonly driver: string;
  /**
   * Write an object, replacing any object already at the key. The bytes are visible under the key
   * only once the returned promise resolves — a failed write leaves nothing a reader could mistake
   * for the file.
   *
   * @param key - Where. Must satisfy {@link isArtifactKey}.
   * @param body - The bytes, streamed. Consumed completely on success.
   * @param sizeBytes - Exactly how many bytes `body` yields. A driver may need it up front (S3's
   *   `Content-Length`), and a body that yields a different count is a failed write.
   * @returns When the object is durable.
   * @throws {ArtifactStoreError} If the key is not a key, or the write failed.
   */
  put(key: ArtifactKey, body: Readable, sizeBytes: number): Promise<void>;
  /**
   * Read an object whole.
   *
   * @param key - Where.
   * @returns Its bytes.
   * @throws {ArtifactNotFoundError} If there is no object at the key.
   */
  get(key: ArtifactKey): Promise<Buffer>;
  /**
   * Remove an object. Removing one that is not there is not an error: cleanup after a failed
   * upload runs whether or not each write got as far as landing.
   *
   * @param key - Where.
   * @returns When it is gone.
   */
  delete(key: ArtifactKey): Promise<void>;
}

/** A store failed to do what it was asked — the disk, the network, or the object service. */
export class ArtifactStoreError extends Error {
  /**
   * @param message - What failed. Never carries a credential.
   * @param options - The underlying cause, when there is one.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactStoreError";
  }
}

/** A read named a key with no object behind it. */
export class ArtifactNotFoundError extends ArtifactStoreError {
  /**
   * @param key - The key.
   */
  constructor(readonly key: ArtifactKey) {
    super(`no artifact is stored at ${key}`);
    this.name = "ArtifactNotFoundError";
  }
}

/** The longest key any driver is handed — S3's own ceiling is 1024 bytes. */
export const ARTIFACT_KEY_MAX_BYTES = 1024;

/**
 * One segment of a key: something both a filesystem and S3 hold verbatim. No `.` or `..` (a local
 * path would resolve them), no separator, no control character, no backslash.
 */
const SEGMENT = /^(?!\.{1,2}$)[^/\\\p{Cc}]{1,255}$/u;

/**
 * Whether a string is a key every driver can hold safely — the check that keeps a key from ever
 * naming a path outside the local store's root.
 *
 * @param key - The candidate.
 * @returns True for one or more `/`-separated {@link SEGMENT}s, within {@link ARTIFACT_KEY_MAX_BYTES}.
 */
export function isArtifactKey(key: string): boolean {
  return (
    Buffer.byteLength(key) <= ARTIFACT_KEY_MAX_BYTES &&
    key.split("/").every((segment) => SEGMENT.test(segment))
  );
}

/**
 * The key an uploaded file is stored under.
 *
 * The upload's own id is a segment so that two requests racing with one token never write the
 * same object: the loser's bytes land beside the winner's, and the loser removes its own.
 *
 * @param organizationId - The workspace.
 * @param jobId - The build job.
 * @param uploadId - This request's id.
 * @param name - The file's manifest name — a relative path.
 * @returns `<organization>/<job>/<upload>/<name>`.
 * @throws {ArtifactStoreError} If the result is not a key.
 */
export function artifactKey(
  organizationId: string,
  jobId: string,
  uploadId: string,
  name: string,
): ArtifactKey {
  const key = `${organizationId}/${jobId}/${uploadId}/${name}`;

  if (!isArtifactKey(key)) {
    throw new ArtifactStoreError(`an artifact named ${JSON.stringify(name)} has no storage key`);
  }

  return key;
}
