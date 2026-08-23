import {
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_REDIRECT,
  PROVIDER_URL_SCHEMES,
  describeRedirectRefused,
  describeRefusal,
  describeUnreachable,
  discardBody,
  isRedirect,
  readCappedBody,
  resolveProviderAddress,
} from "./provider.address";

/**
 * The address policy — AC.3's ([#218](https://github.com/NobuData/ouroboros/issues/218)) third
 * acceptance criterion, as the module rather than as the adapter.
 *
 * *"SSRF policy tested: a `file:` URL is rejected, a redirect is not followed, and a
 * private-range URL **is** accepted."* All three are here, and the third is the one worth
 * having a suite for: it is a **deliberate allow**, and the way it breaks is somebody adding a
 * reflexive private-range check months from now and every self-hosted card going dark. A test
 * that asserts `10.0.4.20` is accepted is the thing that stops that being a quiet change.
 *
 * `openai-compatible.adapter.spec.ts` and `ollama.adapter.spec.ts` assert the same policy from
 * the outside — that each adapter really routes through here, that no socket is opened for a
 * refused scheme, and that a `302` costs exactly one request. Both halves are needed: this one
 * says the rules are right, those say they are reached.
 *
 * The last two suites below cover the two *sentences* the module owns, moved here by AC.4
 * ([#219](https://github.com/NobuData/ouroboros/issues/219)) when the second address-taking
 * adapter would otherwise have written each of them a second time.
 */

describe("the scheme allow-list", () => {
  it("is http and https, and nothing else", () => {
    expect(PROVIDER_URL_SCHEMES).toEqual(["http:", "https:"]);
  });

  it.each([
    ["http://10.0.4.20:8000/v1"],
    ["https://models.example.com/v1"],
    ["HTTP://10.0.4.20:8000/v1"],
  ])("accepts %s", (raw) => {
    expect(resolveProviderAddress(raw).ok).toBe(true);
  });

  it.each([
    ["file:///etc/passwd", "file:"],
    ["gopher://10.0.4.20:70/_models", "gopher:"],
    ["ftp://10.0.4.20/models", "ftp:"],
    ["data:text/plain,models", "data:"],
    ["ws://10.0.4.20:8000/v1", "ws:"],
    ["javascript:alert(1)", "javascript:"],
  ])("refuses %s and names the scheme it saw", (raw, scheme) => {
    // An allow-list rather than a deny-list, because the set of schemes a runtime might learn
    // tomorrow is not one this module can enumerate. The scheme is named because it is the
    // diagnosis a person needs.
    expect(resolveProviderAddress(raw)).toEqual({
      ok: false,
      violation: `the address scheme "${scheme}" is not http or https`,
    });
  });
});

describe("private ranges", () => {
  it.each([
    ["http://10.0.4.20:8000/v1", "RFC-1918 class A — the mockup's own card"],
    ["http://172.16.0.9:8000/v1", "RFC-1918 class B"],
    ["http://192.168.1.50:8000/v1", "RFC-1918 class C"],
    ["http://127.0.0.1:11434", "loopback"],
    ["http://localhost:1234/v1", "loopback by name"],
    ["http://[::1]:8000/v1", "loopback over IPv6"],
    ["http://ken-station.local:11434", "an mDNS name on the operator's own network"],
    ["http://169.254.169.254/latest", "even link-local — see below"],
  ])("accepts %s deliberately (%s)", (raw) => {
    // **This is the decision, not an oversight.** These two adapter kinds exist to reach a model
    // server the customer runs themselves; an adapter that refused RFC-1918 could not do the
    // only job it has. `docs/SECURITY_MODEL.md` §6.1 states what remains and why the boundary
    // that is actually defended is *who may configure a connection*.
    //
    // Link-local is in the list for honesty rather than enthusiasm: nothing here inspects an
    // address range, so `169.254.169.254` typed into the field is accepted the same as any
    // other. What the policy stops is an endpoint *redirecting* this service there, which is a
    // different thing and is the case immediately below.
    expect(resolveProviderAddress(raw).ok).toBe(true);
  });
});

describe("addresses that are not addresses", () => {
  it.each([
    ["", "no address configured"],
    ["   ", "no address configured"],
    ["not a url at all", "the address is not a URL"],
    ["/v1/models", "the address is not a URL"],
    // The commonest mistake of all: a host typed with no scheme in front of it. Its "scheme"
    // starts with a digit, so it does not parse at all rather than reaching the allow-list.
    ["10.0.4.20:8000/v1", "the address is not a URL"],
  ])("refuses %p", (raw, violation) => {
    expect(resolveProviderAddress(raw)).toEqual({ ok: false, violation });
  });

  it("needs no host check, because a special-scheme URL cannot lack one", () => {
    // `http` and `https` are the URL standard's special schemes: `new URL("http://")` throws,
    // and `http:///v1` is read as the host `v1`. There is no branch for a missing host because
    // nothing could reach it.
    expect(() => new URL("http://")).toThrow();

    const odd = resolveProviderAddress("http:///v1");
    expect(odd.ok && odd.url.hostname).toBe("v1");
  });

  it("refuses an address carrying a credential, and says where the key goes", () => {
    // A pasted `http://key:secret@host/v1` would put a credential into
    // `provider_connections.config`, which is the one column in V015 designed to be readable.
    // The message names the supported field rather than only refusing.
    for (const raw of [
      "http://user:hunter2@10.0.4.20:8000/v1",
      "http://sk-vllm-abcdef@10.0.4.20:8000/v1",
    ]) {
      expect(resolveProviderAddress(raw)).toEqual({
        ok: false,
        violation: "the address must not carry a credential — use the API key field",
      });
    }
  });

  it("takes surrounding whitespace off before deciding anything", () => {
    // A pasted URL frequently arrives with a trailing newline, and that is not a configuration
    // error worth showing somebody.
    const resolved = resolveProviderAddress("  http://10.0.4.20:8000/v1\n");

    expect(resolved.ok && resolved.root).toBe("http://10.0.4.20:8000/v1");
  });
});

describe("the resolved address", () => {
  it.each([
    ["http://10.0.4.20:8000/v1/", "http://10.0.4.20:8000/v1"],
    ["http://10.0.4.20:8000/v1///", "http://10.0.4.20:8000/v1"],
    // A bare host is the case that catches a naive implementation: assigning the stripped path
    // back onto the URL is a no-op, because the parser puts the `/` straight back.
    ["http://10.0.4.20:8000/", "http://10.0.4.20:8000"],
    ["http://10.0.4.20:8000", "http://10.0.4.20:8000"],
    ["http://10.0.4.20:8000/openai/v1/", "http://10.0.4.20:8000/openai/v1"],
    // https keeps its implicit port off the address, the way a browser writes it.
    ["https://models.example.com/", "https://models.example.com"],
    // A listing route takes no query and no fragment.
    ["http://10.0.4.20:8000/v1?debug=1", "http://10.0.4.20:8000/v1"],
    ["http://10.0.4.20:8000/v1#models", "http://10.0.4.20:8000/v1"],
  ])("reduces %s to the root %s", (raw, root) => {
    // Reduced once, here, so every caller joins a path the same way: `…/v1/` concatenated with
    // `/models` gives a double slash, which vLLM answers and a stricter server does not.
    const resolved = resolveProviderAddress(raw);

    expect(resolved.ok && resolved.root).toBe(root);
  });

  it("keeps the host and port a caller has to be able to print", () => {
    const resolved = resolveProviderAddress("http://10.0.4.20:8000/v1");

    expect(resolved.ok && resolved.url.host).toBe("10.0.4.20:8000");
  });
});

describe("the redirect rule", () => {
  it("is manual, so a 3xx arrives as a refusal rather than as a closed socket", () => {
    // `manual` rather than `error`: Node's `fetch` hands the 3xx back intact, which makes it an
    // ordinary refusal the shared taxonomy classifies as `config`. With `error` it would arrive
    // as a `TypeError` indistinguishable from a refused socket, and an address pointing one
    // level above an API would be reported as *unreachable*.
    expect(PROVIDER_REDIRECT).toBe("manual");
  });

  it.each([
    [299, false],
    [300, true],
    [302, true],
    [308, true],
    [399, true],
    [400, false],
    [503, false],
  ])("reads %s as a redirect: %s", (status, expected) => {
    expect(isRedirect(status)).toBe(expected);
  });

  it("says the redirect was refused rather than that the server answered oddly", () => {
    expect(describeRedirectRefused(302)).toBe("redirect not followed (302)");
  });

  it("never names where the redirect pointed", () => {
    // Echoing the `Location` would print wherever an endpoint tried to steer this service,
    // which is the exfiltration shape the rule exists to close.
    expect(describeRedirectRefused(307)).not.toContain("169.254");
  });
});

describe("discardBody", () => {
  it("gives the socket back without reading anything", async () => {
    const response = Response.json({ data: [] });

    await discardBody(response);

    expect(response.bodyUsed || response.body?.locked).toBeTruthy();
  });

  it("survives a body that has already gone", async () => {
    // A `401` must not be reported as a `network` failure because tidying up after it threw.
    const response = Response.json({ data: [] });
    await response.text();

    await expect(discardBody(response)).resolves.toBeUndefined();
  });

  it("survives a response with no body at all", async () => {
    await expect(discardBody(new Response(null, { status: 204 }))).resolves.toBeUndefined();
  });
});

describe("readCappedBody", () => {
  it("reads a body that is comfortably inside the cap", async () => {
    const body = '{"object":"list","data":[]}';

    expect(await readCappedBody(new Response(body), PROVIDER_MAX_RESPONSE_BYTES)).toEqual({
      read: true,
      text: body,
    });
  });

  it("reads an empty body as the empty string", async () => {
    expect(
      await readCappedBody(new Response(null, { status: 204 }), PROVIDER_MAX_RESPONSE_BYTES),
    ).toEqual({ read: true, text: "" });
  });

  it("refuses a body that declares itself too large, without reading one", async () => {
    // The fast path. The body here is tiny, so what is being checked is the header.
    const response = new Response("{}", {
      headers: { "content-length": (PROVIDER_MAX_RESPONSE_BYTES + 1).toString() },
    });

    expect(await readCappedBody(response, PROVIDER_MAX_RESPONSE_BYTES)).toEqual({
      read: false,
      violation: `the response exceeded ${PROVIDER_MAX_RESPONSE_BYTES.toString()} bytes`,
    });
  });

  it("refuses a body that floods without declaring anything", async () => {
    // The enforcement. A header can be absent, wrong, or a lie; the byte count is what holds.
    const chunk = new TextEncoder().encode("x".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);

        if (sent > 64 * 1024) {
          controller.close();
        }
      },
    });

    expect(await readCappedBody(new Response(stream), 4096)).toEqual({
      read: false,
      violation: "the response exceeded 4096 bytes",
    });
  });

  it("cancels the stream rather than draining it", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(512)));
      },
      cancel() {
        cancelled = true;
      },
    });

    await readCappedBody(new Response(stream), 128);

    expect(cancelled).toBe(true);
  });

  it("decodes a character split across two chunks", async () => {
    // `stream: true` on the decoder. Decoding each chunk independently would replace a
    // straddling multi-byte character with U+FFFD — in a model id, silently.
    const encoded = new TextEncoder().encode('{"id":"café"}');
    const split = encoded.length - 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, split));
        controller.enqueue(encoded.slice(split));
        controller.close();
      },
    });

    expect(await readCappedBody(new Response(stream), PROVIDER_MAX_RESPONSE_BYTES)).toEqual({
      read: true,
      text: '{"id":"café"}',
    });
  });

  it("reports a connection that died part way through the body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
        controller.error(new Error("ECONNRESET while reading from 10.0.4.20:8000"));
      },
    });

    const body = await readCappedBody(new Response(stream), PROVIDER_MAX_RESPONSE_BYTES);

    expect(body).toEqual({ read: false, violation: "the response ended part way through" });
    // Nothing about the runtime's own message reaches a caller — it carries the host, the port
    // and sometimes the request headers.
    expect(body.read || body.violation).not.toContain("10.0.4.20");
  });

  it("ignores a content-length that is not a number", async () => {
    const response = new Response('{"data":[]}', { headers: { "content-length": "lots" } });

    expect(await readCappedBody(response, PROVIDER_MAX_RESPONSE_BYTES)).toEqual({
      read: true,
      text: '{"data":[]}',
    });
  });
});

describe("the cap itself", () => {
  it("is a mebibyte — three orders of magnitude past any real model listing", () => {
    expect(PROVIDER_MAX_RESPONSE_BYTES).toBe(1_048_576);
  });
});

describe("describeRefusal", () => {
  it.each([
    [401, "key rejected (401)"],
    [403, "key rejected (403)"],
    [429, "rate limited (429)"],
    [500, "500 upstream"],
    [503, "503 upstream"],
    [408, "timed out (408)"],
    [404, "responded 404"],
    [400, "responded 400"],
  ])("hands %p to the shared taxonomy unchanged", (status, expected) => {
    // It does not fork `describeHttpRefusal`. Everything that is not a redirect reads exactly as
    // it would from an adapter talking to a fixed host.
    expect(describeRefusal(status)).toBe(expected);
  });

  it.each([301, 302, 303, 307, 308])(
    "says a %p was not followed, rather than answered",
    (status) => {
      // The one status whose outcome this service caused. `responded 302` is true and sends a
      // reader looking for a server that answered oddly.
      expect(describeRefusal(status)).toBe(describeRedirectRefused(status));
      expect(describeRefusal(status)).toBe(`redirect not followed (${status.toString()})`);
    },
  );

  it("refuses a success, because a 200 reaching here is a bug rather than a phrase", () => {
    expect(() => describeRefusal(200)).toThrow(RangeError);
  });
});

describe("describeUnreachable", () => {
  it("echoes the host, which is the half an operator running several endpoints needs", () => {
    expect(
      describeUnreachable(
        "10.0.4.20:8000",
        new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
        10_000,
      ),
    ).toBe("10.0.4.20:8000 unreachable (ECONNREFUSED)");
  });

  it("names the deadline it was given, rather than one of its own", () => {
    // A parameter because each adapter sets its own, and a constant here would print the wrong
    // number for whichever one did not match.
    const timedOut = new DOMException("The operation was aborted due to timeout", "TimeoutError");

    expect(describeUnreachable("ken-station.local:11434", timedOut, 10_000)).toBe(
      "ken-station.local:11434 timed out after 10000 ms",
    );
    expect(describeUnreachable("ken-station.local:11434", timedOut, 5_000)).toBe(
      "ken-station.local:11434 timed out after 5000 ms",
    );
  });

  it("surfaces no raw socket error, only a symbolic code", () => {
    // The runtime's own message carries a resolved address, a port and sometimes the request
    // headers — which is the half that must never reach a card.
    const message = "connect ECONNREFUSED 10.0.4.20:8000 — no route from pod ouroboros-rest-7f9";

    expect(
      describeUnreachable(
        "10.0.4.20:8000",
        new TypeError(message, { cause: { code: "ECONNREFUSED" } }),
        10_000,
      ),
    ).not.toContain("no route");
  });

  it("falls back to a bare phrase when the runtime hangs no code on it", () => {
    expect(describeUnreachable("10.0.4.20:8000", new TypeError("fetch failed"), 10_000)).toBe(
      "10.0.4.20:8000 unreachable",
    );
  });
});
