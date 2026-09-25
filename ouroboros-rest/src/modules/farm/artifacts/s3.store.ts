/**
 * The S3-compatible {@link ArtifactStore} — S3 or MinIO, selected by `OURO_ARTIFACT_STORE=s3`
 * (#330, option **3-A**).
 *
 * Path-style addressing (`<endpoint>/<bucket>/<key>`), which MinIO requires and S3 serves, and
 * SigV4 header signing (`sigv4.ts`). A put streams its body with an exact `Content-Length` and an
 * unsigned payload hash — the bytes are checksummed by the upload service as they pass, so hashing
 * them twice here would buy nothing but a second read.
 *
 * Plain `node:http`/`node:https` rather than `fetch`, because a streamed upload needs its
 * `Content-Length` sent as given, and `fetch` owns that header.
 */

import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  ArtifactNotFoundError,
  ArtifactStoreError,
  isArtifactKey,
  type ArtifactKey,
  type ArtifactStore,
} from "./artifact.store";
import { exactly } from "./local.store";
import {
  EMPTY_PAYLOAD_SHA256,
  encodePath,
  signRequest,
  UNSIGNED_PAYLOAD,
  type SigningCredentials,
} from "./sigv4";

/** The driver name `test_artifacts.storage_ref` records. */
export const S3_DRIVER = "s3";

/** How long one request may take before it is abandoned. */
export const S3_REQUEST_TIMEOUT_MS = 120_000;

/** Everything the S3 driver is configured with. */
export interface S3StoreOptions extends SigningCredentials {
  /** The endpoint's origin — `http://minio:9000`, `https://s3.eu-west-1.amazonaws.com`. */
  readonly endpoint: string;
  readonly bucket: string;
  /** The signing clock. The wall clock unless a suite pins it. */
  readonly now?: () => Date;
}

/** An S3 response, read whole. */
interface S3Response {
  readonly status: number;
  readonly body: Buffer;
}

/** Stores artifacts as objects in one bucket. */
export class S3ArtifactStore implements ArtifactStore {
  readonly driver = S3_DRIVER;
  private readonly endpoint: URL;

  /**
   * @param options - The endpoint, the bucket and the credentials.
   */
  constructor(private readonly options: S3StoreOptions) {
    this.endpoint = new URL(options.endpoint);
  }

  /** @inheritdoc */
  async put(key: ArtifactKey, body: Readable, sizeBytes: number): Promise<void> {
    const response = await this.send("PUT", key, {
      body,
      sizeBytes,
      headers: { "content-length": String(sizeBytes) },
    });

    if (response.status !== 200) throw this.failure("written", key, response);
  }

  /** @inheritdoc */
  async get(key: ArtifactKey): Promise<Buffer> {
    const response = await this.send("GET", key);

    if (response.status === 404) throw new ArtifactNotFoundError(key);
    if (response.status !== 200) throw this.failure("read", key, response);
    return response.body;
  }

  /** @inheritdoc */
  async delete(key: ArtifactKey): Promise<void> {
    const response = await this.send("DELETE", key);

    // S3 answers 204 whether or not the object existed.
    if (response.status !== 204 && response.status !== 404) {
      throw this.failure("deleted", key, response);
    }
  }

  /**
   * Whether the bucket exists and these credentials may use it — a boot check an operator can call.
   *
   * @returns True on a 200 for the bucket.
   */
  async reachable(): Promise<boolean> {
    try {
      return (await this.send("HEAD", undefined)).status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Sign and send one request, and read its response whole.
   *
   * @param method - The verb.
   * @param key - The object, or undefined for the bucket itself.
   * @param upload - A body to stream, its size and any extra headers.
   * @returns The status and the body.
   * @throws {ArtifactStoreError} When the request cannot be made or times out.
   */
  private async send(
    method: string,
    key: ArtifactKey | undefined,
    upload?: { body: Readable; sizeBytes: number; headers: Record<string, string> },
  ): Promise<S3Response> {
    if (key !== undefined && !isArtifactKey(key)) {
      throw new ArtifactStoreError(`${JSON.stringify(key)} is not an artifact key`);
    }

    const path = encodePath(`/${this.options.bucket}${key === undefined ? "" : `/${key}`}`);
    const headers: OutgoingHttpHeaders = signRequest(
      {
        method,
        host: this.endpoint.host,
        path,
        payloadHash: upload ? UNSIGNED_PAYLOAD : EMPTY_PAYLOAD_SHA256,
      },
      this.options,
      (this.options.now ?? (() => new Date()))(),
    );
    if (upload) Object.assign(headers, upload.headers);

    const send = this.endpoint.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<S3Response>((resolve, reject) => {
      const outgoing = send(
        {
          method,
          protocol: this.endpoint.protocol,
          hostname: this.endpoint.hostname,
          port: this.endpoint.port,
          path,
          headers,
          timeout: S3_REQUEST_TIMEOUT_MS,
        },
        (incoming: IncomingMessage) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () => {
            resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks) });
          });
          incoming.on("error", reject);
        },
      );

      outgoing.on("timeout", () => {
        outgoing.destroy(new ArtifactStoreError(`the object store did not answer a ${method}`));
      });
      outgoing.on("error", (error) => {
        reject(
          error instanceof ArtifactStoreError
            ? error
            : new ArtifactStoreError(`the object store could not be reached`, { cause: error }),
        );
      });

      if (upload) {
        pipeline(upload.body, exactly(upload.sizeBytes), outgoing).catch((error: unknown) => {
          outgoing.destroy();
          reject(
            error instanceof ArtifactStoreError
              ? error
              : new ArtifactStoreError(`the artifact at ${String(key)} could not be sent`, {
                  cause: error,
                }),
          );
        });
      } else {
        outgoing.end();
      }
    });
  }

  /**
   * A refusal from the object service, as an error that names the operation and S3's own code.
   *
   * @param verb - What was being done — "written", "read", "deleted".
   * @param key - The object.
   * @param response - What S3 answered.
   * @returns The error.
   */
  private failure(verb: string, key: ArtifactKey, response: S3Response): ArtifactStoreError {
    const code = /<Code>([^<]{1,64})<\/Code>/.exec(response.body.toString("utf8"))?.[1];

    return new ArtifactStoreError(
      `the artifact at ${key} could not be ${verb}: HTTP ${response.status}${code ? ` ${code}` : ""}`,
    );
  }
}
