import {
  clientAddress,
  currentClientAddress,
  IPV4_MAPPED_PREFIX,
  runWithAuditContext,
} from "./audit.context";

/**
 * Where a request came from, and the two claims made about it.
 *
 * **The address is normalised**, which is a correctness fix rather than cosmetics: a
 * dual-stack socket reports every IPv4 client as `::ffff:10.0.4.20`, PostgreSQL's `inet`
 * keeps that distinct from `10.0.4.20`, and its subnet operator does not match across the
 * two — so an un-normalised trail splits one host between two spellings and quietly halves
 * the answer to *everything from this network*.
 *
 * **The store is per request and honestly empty outside one**, because a background job and a
 * scheduled probe both write `null` into the column rather than inheriting whatever the last
 * request happened to leave behind.
 */

describe("normalising a client address", () => {
  it("unwraps the mapping a dual-stack listener reports IPv4 clients with", () => {
    expect(clientAddress({ socket: { remoteAddress: "::ffff:10.0.4.20" } })).toBe("10.0.4.20");
  });

  it("leaves a real IPv4 address alone", () => {
    expect(clientAddress({ socket: { remoteAddress: "198.51.100.24" } })).toBe("198.51.100.24");
  });

  it("leaves a real IPv6 address alone", () => {
    expect(clientAddress({ socket: { remoteAddress: "2001:db8::1" } })).toBe("2001:db8::1");
  });

  it("leaves an address that merely starts with the prefix alone", () => {
    // `::ffff:` followed by a hex tail is a legal IPv6 address that is *not* an IPv4
    // mapping, and a `slice` with no check would turn it into the nonsense `1:2` — an
    // address `inet` would then refuse, failing the operation rather than recording it.
    expect(clientAddress({ socket: { remoteAddress: `${IPV4_MAPPED_PREFIX}1:2` } })).toBe(
      "::ffff:1:2",
    );
  });

  it("has nothing to say about a request with no peer address", () => {
    // A closed socket, or a transport with no network under it. `undefined` becomes a `null`
    // column, which is the honest value — better than a guess, and better than a proxy's.
    expect(clientAddress({ socket: { remoteAddress: undefined } })).toBeUndefined();
    expect(clientAddress({ socket: {} })).toBeUndefined();
    expect(clientAddress({})).toBeUndefined();
    expect(clientAddress(undefined)).toBeUndefined();
    expect(clientAddress({ socket: { remoteAddress: "" } })).toBeUndefined();
  });

  it("reads the socket and nothing else", () => {
    // The security decision in this module: a forwarded header is a string the client wrote,
    // and nothing tells this service which proxies it sits behind. Trusting one would let
    // anybody who can reach the API choose what the audit trail says about them — a trail
    // that can be made to lie, which is worse than one whose address is less specific.
    const spoofed = {
      socket: { remoteAddress: "10.0.0.5" },
      headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" },
    };

    expect(clientAddress(spoofed)).toBe("10.0.0.5");
  });
});

describe("the per-request store", () => {
  it("answers with the address the request was opened with", () => {
    runWithAuditContext("198.51.100.24", () => {
      expect(currentClientAddress()).toBe("198.51.100.24");
    });
  });

  it("survives an await, which is the whole reason it is AsyncLocalStorage", () => {
    // A writer several layers below a controller reads this, long after the frame that
    // opened it returned. A property on the request would not reach it without being passed
    // through every method in between.
    return runWithAuditContext("198.51.100.24", async () => {
      await Promise.resolve();

      expect(currentClientAddress()).toBe("198.51.100.24");
    });
  });

  it("keeps two requests apart", async () => {
    const seen: (string | undefined)[] = [];

    await Promise.all([
      runWithAuditContext("198.51.100.24", async () => {
        await Promise.resolve();
        seen.push(currentClientAddress());
      }),
      runWithAuditContext("203.0.113.7", async () => {
        await Promise.resolve();
        seen.push(currentClientAddress());
      }),
    ]);

    expect(seen.sort()).toEqual(["198.51.100.24", "203.0.113.7"]);
  });

  it("answers with nothing outside a request", () => {
    // A background job, a shutdown hook, a unit test that opened no store. All three write
    // `null` into the column, which is the honest value for an event no client asked for.
    expect(currentClientAddress()).toBeUndefined();
  });

  it("answers with nothing inside a request whose socket reported none", () => {
    runWithAuditContext(undefined, () => {
      expect(currentClientAddress()).toBeUndefined();
    });
  });
});
