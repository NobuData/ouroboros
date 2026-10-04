import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { READ_LIMIT_BYTES } from "./webhook.capture";
import { InternalAllowlist, type HostResolver } from "./webhook.ssrf";
import { HttpsWebhookTransport, WebhookTransportError, type Requester } from "./webhook.transport";

/**
 * The transport, driven against a real local server (#487). The production requester is
 * `https.request`; here `http.request` stands in so no certificate is needed, and everything else
 * is the production path — **the SSRF guard is Node's `lookup`**, so the address the socket
 * connects to is the one the policy approved. `receiver.test` is mapped to `127.0.0.1` by the
 * injected resolver, and loopback is reachable only because the operator allowed the name.
 */

/** Plain HTTP in place of HTTPS; nothing else changes. */
const plainHttp: Requester = (options, callback) =>
  httpRequest({ ...options, protocol: "http:" }, callback);

/** What the server saw. */
interface Seen {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let port: number;
let respond: (res: import("node:http").ServerResponse) => void;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      respond(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  // The timeout case leaves a request the server never answered.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
  respond = (res) => res.writeHead(204).end();
});

/** A resolver whose answer for `receiver.test` the test controls. */
function resolverFor(answer: () => string): HostResolver {
  return (hostname) =>
    hostname === "receiver.test"
      ? Promise.resolve([{ address: answer(), family: 4 }])
      : Promise.reject(new Error("ENOTFOUND"));
}

/** A transport allowed to reach `receiver.test` on loopback. */
function transport(answer = () => "127.0.0.1", timeoutMs = 2000): HttpsWebhookTransport {
  return new HttpsWebhookTransport(
    new InternalAllowlist(["receiver.test"]),
    resolverFor(answer),
    plainHttp,
    timeoutMs,
  );
}

/** The thrown transport error. */
async function failure(promise: Promise<unknown>): Promise<WebhookTransportError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WebhookTransportError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("sending one attempt", () => {
  it("POSTs the body with the signed headers to the approved address", async () => {
    const response = await transport().send({
      url: `https://receiver.test:${String(port)}/hook?source=ouro`,
      headers: { "X-Ouro-Event": "run.merged", "Content-Type": "application/json" },
      body: '{"type":"run.merged"}',
    });

    expect(response.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe('{"type":"run.merged"}');
    expect(seen[0].headers["x-ouro-event"]).toBe("run.merged");
  });

  it("answers any status, and reads at most the read limit of the body", async () => {
    respond = (res) => res.writeHead(500).end("z".repeat(READ_LIMIT_BYTES * 4));

    const response = await transport().send({
      url: `https://receiver.test:${String(port)}/`,
      headers: {},
      body: "{}",
    });

    expect(response.status).toBe(500);
    expect(response.body.length).toBeLessThanOrEqual(READ_LIMIT_BYTES);
  });

  it("records a redirect as the answer, and does not follow it", async () => {
    respond = (res) => res.writeHead(302, { Location: "http://169.254.169.254/" }).end();

    const response = await transport().send({
      url: `https://receiver.test:${String(port)}/`,
      headers: {},
      body: "{}",
    });

    expect(response.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it("gives up after its timeout", async () => {
    respond = () => undefined; // never answers

    const error = await failure(
      transport(undefined, 200).send({
        url: `https://receiver.test:${String(port)}/`,
        headers: {},
        body: "{}",
      }),
    );

    expect(error.kind).toBe("timeout");
  });
});

describe("the SSRF guard at connect time", () => {
  it("refuses loopback when the operator did not allow it, and sends nothing", async () => {
    const strict = new HttpsWebhookTransport(
      new InternalAllowlist([]),
      resolverFor(() => "127.0.0.1"),
      plainHttp,
    );

    const error = await failure(
      strict.send({ url: `https://receiver.test:${String(port)}/`, headers: {}, body: "{}" }),
    );

    expect(error.kind).toBe("blocked");
    expect(error.message).toContain("internal_address");
    expect(seen).toHaveLength(0);
  });

  it("refuses a name that rebinds to the metadata address after it was saved", async () => {
    // The override names the host's loopback answer, not the metadata range: when the same name
    // starts answering 169.254.169.254 the guard refuses before any socket opens.
    let answer = "127.0.0.1";
    const rebinding = new HttpsWebhookTransport(
      new InternalAllowlist(["127.0.0.1"]),
      resolverFor(() => answer),
      plainHttp,
    );

    await expect(
      rebinding.send({ url: `https://receiver.test:${String(port)}/`, headers: {}, body: "{}" }),
    ).resolves.toMatchObject({ status: 204 });

    answer = "169.254.169.254";

    const error = await failure(
      rebinding.send({ url: `https://receiver.test:${String(port)}/`, headers: {}, body: "{}" }),
    );

    expect(error.kind).toBe("blocked");
    expect(seen).toHaveLength(1);
  });

  it("refuses an internal IP literal before any lookup, and http:// outright", async () => {
    expect(
      (await failure(transport().send({ url: "https://169.254.169.254/", headers: {}, body: "" })))
        .kind,
    ).toBe("blocked");
    expect(
      (await failure(transport().send({ url: "http://receiver.test/", headers: {}, body: "" })))
        .kind,
    ).toBe("blocked");
  });
});
