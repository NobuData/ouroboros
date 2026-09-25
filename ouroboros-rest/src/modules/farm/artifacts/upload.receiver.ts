/**
 * Reading an upload's multipart body as it streams (#330) — never buffering it whole.
 *
 * ```
 * multipart/form-data
 *   manifest   (field, first, exactly once)   ─▶ onManifest(text)
 *   file       (part, filename = manifest name) ─▶ onFile(name, stream)   … once per file
 * ```
 *
 * The first failure stops the read: the request is unpiped and drained so a response can still be
 * written, and every in-flight file handler is allowed to settle before the failure is reported —
 * so the caller's cleanup never races a write that is still landing.
 */

import type { Readable } from "node:stream";

import busboy from "busboy";

import { manifestInvalid } from "./upload.errors";
import { MANIFEST_MAX_BYTES } from "./upload.policy";

/** The multipart field the manifest travels in. */
export const MANIFEST_FIELD = "manifest";

/** The multipart field every file travels in. */
export const FILE_FIELD = "file";

/** What the reader is told to do with each part. */
export interface UploadHandlers {
  /**
   * The manifest arrived. Throwing refuses the upload.
   *
   * @param text - The field's value.
   */
  onManifest(text: string): void;
  /**
   * A file arrived. The handler must consume `stream` completely (or `resume()` it), and rejects
   * to refuse the upload.
   *
   * @param name - The part's filename — its manifest name, directories kept.
   * @param stream - The bytes.
   * @returns When the file is dealt with.
   */
  onFile(name: string, stream: Readable): Promise<void>;
}

/** The reader's bounds. */
export interface UploadLimits {
  /** The most file parts. */
  readonly maxFiles: number;
  /** The most bytes any one file part may carry before it is cut. */
  readonly maxFileBytes: number;
}

/**
 * Read one upload body.
 *
 * @param body - The request stream.
 * @param contentType - Its `Content-Type`.
 * @param limits - The bounds.
 * @param handlers - What to do with each part.
 * @returns When every part has been handled.
 * @throws Whatever a handler threw, or `farm_artifact_manifest_invalid` for a body that is not a
 *   manifest followed by files.
 */
export function readUpload(
  body: Readable,
  contentType: string | undefined,
  limits: UploadLimits,
  handlers: UploadHandlers,
): Promise<void> {
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    return Promise.reject(manifestInvalid("the body must be multipart/form-data."));
  }

  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      // Keep the manifest name's directories — busboy strips them by default — and read the
      // filename as the UTF-8 it is, not busboy's default latin1.
      preservePath: true,
      defParamCharset: "utf8",
      limits: {
        fields: 1,
        fieldSize: MANIFEST_MAX_BYTES,
        files: limits.maxFiles,
        fileSize: limits.maxFileBytes,
        parts: limits.maxFiles + 1,
      },
    });
  } catch {
    return Promise.reject(manifestInvalid("the multipart body has no boundary."));
  }

  return new Promise<void>((resolve, reject) => {
    const pending: Promise<void>[] = [];
    const active = new Set<Readable>();
    let manifestSeen = false;
    let failure: Error | undefined;
    let settled = false;

    /** Settle once, after every in-flight handler has. */
    const finish = (): void => {
      if (settled) return;
      settled = true;
      void Promise.allSettled(pending).then(() => {
        if (failure === undefined) resolve();
        else reject(failure);
      });
    };

    /**
     * Stop reading, remember the first failure, and let the body drain. A file part still streaming
     * would never end once the parser stops being fed, so each is destroyed — which settles its
     * handler, and lets {@link finish} report.
     */
    const fail = (error: unknown): void => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      body.unpipe(parser);
      body.resume();
      for (const stream of active) stream.destroy(failure);
      finish();
    };

    parser.on("field", (name, value, info) => {
      if (failure !== undefined) return;
      if (name !== MANIFEST_FIELD || manifestSeen) {
        fail(manifestInvalid(`the only field is one ${MANIFEST_FIELD}, sent first.`));
        return;
      }
      if (info.valueTruncated) {
        fail(manifestInvalid(`the manifest is longer than ${String(MANIFEST_MAX_BYTES)} bytes.`));
        return;
      }
      manifestSeen = true;
      try {
        handlers.onManifest(value);
      } catch (error) {
        fail(error);
      }
    });

    parser.on("file", (name, stream, info) => {
      if (failure !== undefined) {
        stream.resume();
        return;
      }
      if (name !== FILE_FIELD || !manifestSeen) {
        stream.resume();
        fail(manifestInvalid(`files travel in "${FILE_FIELD}" parts, after the manifest.`));
        return;
      }
      active.add(stream);
      stream.once("close", () => active.delete(stream));
      pending.push(handlers.onFile(info.filename, stream).catch(fail));
    });

    for (const limit of ["filesLimit", "fieldsLimit", "partsLimit"] as const) {
      parser.on(limit, () => {
        fail(manifestInvalid(`the upload carries more parts than an upload may (${limit}).`));
      });
    }
    parser.on("error", () => {
      fail(manifestInvalid("the multipart body could not be read."));
    });
    parser.on("close", () => {
      if (!manifestSeen) failure ??= manifestInvalid("the manifest is missing.");
      finish();
    });

    body.on("error", fail);
    body.pipe(parser);
  });
}
