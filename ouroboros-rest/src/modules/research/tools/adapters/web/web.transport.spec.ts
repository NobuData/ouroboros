import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { InternalAllowlist } from "../../../../webhooks/webhook.ssrf";
import { GuardedPageTransport, PageTransportError } from "./web.transport";

describe("the guarded page transport", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/slow") {
        setTimeout(() => response.end("late"), 2000);
        return;
      }
      if (request.url === "/big") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("x".repeat(10_000));
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html",
        "x-echo-agent": request.headers["user-agent"] ?? "",
      });
      response.end("<p>hello</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const allowed = () => new GuardedPageTransport(new InternalAllowlist(["127.0.0.1"]));

  it("refuses a loopback address the operator has not allowed", async () => {
    const transport = new GuardedPageTransport(new InternalAllowlist([]));

    await expect(
      transport.get({
        url: new URL(`http://127.0.0.1:${String(port)}/`),
        headers: {},
        timeoutMs: 2000,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ failure: "blocked" });
  });

  it("refuses the cloud metadata address and private literals before connecting", async () => {
    const transport = new GuardedPageTransport(new InternalAllowlist([]));

    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/admin",
      "http://[::1]/",
    ]) {
      await expect(
        transport.get({ url: new URL(url), headers: {}, timeoutMs: 2000, maxBytes: 1024 }),
      ).rejects.toMatchObject({ failure: "blocked" });
    }
  });

  it("refuses a hostname that resolves inward", async () => {
    const transport = new GuardedPageTransport(new InternalAllowlist([]), () =>
      Promise.resolve([{ address: "10.1.2.3", family: 4 }]),
    );

    await expect(
      transport.get({
        url: new URL("http://rebind.example.test/"),
        headers: {},
        timeoutMs: 2000,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ failure: "blocked" });
  });

  it("reads an allowed internal address, passing the headers it was given", async () => {
    const response = await allowed().get({
      url: new URL(`http://127.0.0.1:${String(port)}/`),
      headers: { "user-agent": "OuroborosResearch/1.0" },
      timeoutMs: 2000,
      maxBytes: 1024,
    });

    expect(response).toMatchObject({ status: 200, truncated: false });
    expect(response.headers["x-echo-agent"]).toBe("OuroborosResearch/1.0");
    expect(response.body.toString()).toBe("<p>hello</p>");
  });

  it("stops reading at the byte cap", async () => {
    const response = await allowed().get({
      url: new URL(`http://127.0.0.1:${String(port)}/big`),
      headers: {},
      timeoutMs: 2000,
      maxBytes: 100,
    });

    expect(response.body.length).toBe(100);
    expect(response.truncated).toBe(true);
  });

  it("times out a page that does not answer", async () => {
    await expect(
      allowed().get({
        url: new URL(`http://127.0.0.1:${String(port)}/slow`),
        headers: {},
        timeoutMs: 200,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("refuses a scheme it does not read and a URL carrying credentials", async () => {
    for (const url of ["ftp://127.0.0.1/x", `http://u:p@127.0.0.1:${String(port)}/`]) {
      const error = await allowed()
        .get({ url: new URL(url), headers: {}, timeoutMs: 200, maxBytes: 1024 })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PageTransportError);
      expect((error as PageTransportError).failure).toBe("blocked");
    }
  });
});
