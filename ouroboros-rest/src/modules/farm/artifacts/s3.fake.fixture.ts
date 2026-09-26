/**
 * An in-process S3 stand-in for the unit suite (#330): path-style objects in one bucket, held in a
 * map, with every request's SigV4 signature checked against the credentials it was started with.
 *
 * It is not S3 — the real proof is `artifact.store.integration-spec.ts` against MinIO — but it
 * behaves where the driver depends on behaviour: a `Content-Length` that the body does not match
 * fails the request and stores nothing, a missing object is `404 NoSuchKey`, a delete is `204`
 * either way, and a request signed with the wrong secret is `403 SignatureDoesNotMatch`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { signRequest, type SigningCredentials } from "./sigv4";

/** A running stand-in. */
export interface FakeS3 {
  /** `http://127.0.0.1:<port>`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly credentials: SigningCredentials;
  /** Stored objects, by key. */
  readonly objects: Map<string, Buffer>;
  /** Stop listening. */
  close(): Promise<void>;
}

/**
 * Start a stand-in on a free loopback port.
 *
 * @param bucket - The one bucket it serves.
 * @returns It, listening.
 */
export async function startFakeS3(bucket = "ouroboros-artifacts"): Promise<FakeS3> {
  const credentials: SigningCredentials = {
    accessKeyId: "fake-access-key",
    secretAccessKey: "fake-secret-access-key",
    region: "us-east-1",
  };
  const objects = new Map<string, Buffer>();

  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });

  /** One request. */
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) chunks.push(chunk as Buffer);
    } catch {
      // The client gave up mid-body — S3 stores nothing, and there is nobody to answer.
      return;
    }
    const body = Buffer.concat(chunks);

    if (!signedCorrectly(request, credentials)) {
      reply(response, 403, "SignatureDoesNotMatch");
      return;
    }

    const path = request.url ?? "/";
    const prefix = `/${bucket}`;
    if (path === prefix && request.method === "HEAD") {
      response.writeHead(200).end();
      return;
    }
    if (!path.startsWith(`${prefix}/`)) {
      reply(response, 404, "NoSuchBucket");
      return;
    }
    const key = decodeURIComponent(path.slice(prefix.length + 1));

    switch (request.method) {
      case "PUT": {
        const declared = Number(request.headers["content-length"]);
        if (body.length !== declared) {
          reply(response, 400, "IncompleteBody");
          return;
        }
        objects.set(key, body);
        response.writeHead(200).end();
        return;
      }
      case "GET": {
        const object = objects.get(key);
        if (!object) {
          reply(response, 404, "NoSuchKey");
          return;
        }
        response.writeHead(200, { "content-length": object.length }).end(object);
        return;
      }
      case "DELETE":
        objects.delete(key);
        response.writeHead(204).end();
        return;
      default:
        reply(response, 405, "MethodNotAllowed");
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    bucket,
    credentials,
    objects,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Whether a request's `authorization` is the signature these credentials give it.
 *
 * @param request - The request, headers as received.
 * @param credentials - What the stand-in trusts.
 * @returns True when it verifies.
 */
function signedCorrectly(request: IncomingMessage, credentials: SigningCredentials): boolean {
  const authorization = request.headers.authorization ?? "";
  const signed = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? [];
  const amzDate = String(request.headers["x-amz-date"] ?? "");
  const at = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!at) return false;

  const extra: Record<string, string> = {};
  for (const name of signed) {
    if (name !== "host" && name !== "x-amz-date" && name !== "x-amz-content-sha256") {
      extra[name] = String(request.headers[name] ?? "");
    }
  }

  const expected = signRequest(
    {
      method: request.method ?? "GET",
      host: String(request.headers.host ?? ""),
      path: request.url ?? "/",
      headers: extra,
      payloadHash: String(request.headers["x-amz-content-sha256"] ?? ""),
    },
    credentials,
    new Date(`${at[1]}-${at[2]}-${at[3]}T${at[4]}:${at[5]}:${at[6]}Z`),
  );

  return expected.authorization === authorization;
}

/**
 * Answer with S3's error document.
 *
 * @param response - The response.
 * @param status - The status.
 * @param code - S3's code.
 */
function reply(response: ServerResponse, status: number, code: string): void {
  response
    .writeHead(status, { "content-type": "application/xml" })
    .end(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`);
}
