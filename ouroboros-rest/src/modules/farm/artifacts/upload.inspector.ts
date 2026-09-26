/**
 * What an uploaded file is found to be as it streams past (#330): its SHA-256, its length, and its
 * first bytes for format detection — computed in one pass, on the way to the store.
 *
 * It also holds the file to its manifest entry's `size_bytes`: a part that runs past it, or ends
 * short of it, fails the stream with `farm_artifact_manifest_invalid` naming the file, so a store
 * never receives a body that disagrees with what was declared.
 */

import { createHash, type Hash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

import { manifestInvalid } from "./upload.errors";
import { DETECT_HEAD_BYTES } from "./upload.policy";

/** A pass-through that hashes, counts and keeps the head of what goes through it. */
export class UploadInspector extends Transform {
  private readonly hash: Hash = createHash("sha256");
  private readonly headChunks: Buffer[] = [];
  private headLength = 0;
  private seen = 0;
  private digest: string | undefined;

  /**
   * @param name - The manifest name, for the error a mismatch raises.
   * @param declaredBytes - The entry's `size_bytes`.
   */
  constructor(
    private readonly name: string,
    private readonly declaredBytes: number,
  ) {
    super();
  }

  /** `sha256:<hex>` of every byte — available once the stream has ended. */
  get checksum(): string {
    if (this.digest === undefined) throw new Error("the upload inspector has not finished");
    return `sha256:${this.digest}`;
  }

  /** The first {@link DETECT_HEAD_BYTES} bytes. */
  get head(): Buffer {
    return Buffer.concat(this.headChunks).subarray(0, DETECT_HEAD_BYTES);
  }

  /** @inheritdoc */
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > this.declaredBytes) {
      callback(manifestInvalid(`${this.name} is longer than its declared size_bytes.`, this.name));
      return;
    }

    this.hash.update(chunk);
    if (this.headLength < DETECT_HEAD_BYTES) {
      this.headChunks.push(chunk);
      this.headLength += chunk.length;
    }
    callback(null, chunk);
  }

  /** @inheritdoc */
  override _flush(callback: TransformCallback): void {
    if (this.seen !== this.declaredBytes) {
      callback(manifestInvalid(`${this.name} is shorter than its declared size_bytes.`, this.name));
      return;
    }

    this.digest = this.hash.digest("hex");
    callback();
  }
}
