import {
  TRAFFIC_KEY,
  mergeHealth,
  readHealth,
  toSnapshot,
  type ProviderHealthRow,
} from "./snapshot";

/**
 * The `health` column's shape — and the two claims the ticket makes about it that are only
 * true if the *writer* keeps them.
 *
 * The first is *latency is stored only for checks actually performed*: absence has to survive
 * both crossings, so a probe with nothing to report writes no key and a column with no key
 * reads back as null rather than as zero.
 *
 * The second is *the shape accommodates AB.2's traffic-derived fields without a schema
 * change*. jsonb accommodates anything; what makes the reservation real is that this service
 * replaces only its own keys. Without {@link mergeHealth}, AB.2's first p95 window would be
 * erased by the next sweep sixty seconds later — and the person who found out would be AB.2's
 * author, six months from now, with no idea why.
 */

const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

describe("reading a health column", () => {
  it("reads nothing out of the empty object every unchecked row carries", () => {
    expect(readHealth({})).toEqual({
      check: null,
      latencyMs: null,
      models: null,
      detail: null,
      errorClass: null,
    });
  });

  it("reads a performed reachability check", () => {
    expect(readHealth({ check: "reachability", latency_ms: 12, models: 3 })).toEqual({
      check: "reachability",
      latencyMs: 12,
      models: 3,
      detail: null,
      errorClass: null,
    });
  });

  it("reads a failure's reason", () => {
    expect(readHealth({ check: "reachability", detail: "unreachable (ECONNREFUSED)" })).toEqual({
      check: "reachability",
      latencyMs: null,
      models: null,
      detail: "unreachable (ECONNREFUSED)",
      errorClass: null,
    });
  });

  it("reads the seeded degraded chip mockup 06 draws, which no probe wrote", () => {
    // Y.4's Copilot row. Nothing in this service can produce it — there is no check for that
    // kind — and the read still has to understand it, because the strip renders whatever the
    // row says.
    expect(readHealth({ detail: "degraded · elevated latency" })).toEqual({
      check: null,
      latencyMs: null,
      models: null,
      detail: "degraded · elevated latency",
      errorClass: null,
    });
  });

  describe("what it refuses to believe", () => {
    it("does not read a latency that arrived as a string", () => {
      // The column is jsonb; `"42"` is something written in the wrong shape, not a
      // measurement, and putting it on a chip would break the promise the chip makes.
      expect(readHealth({ latency_ms: "42" }).latencyMs).toBeNull();
    });

    it("does not read a non-finite latency", () => {
      expect(readHealth({ latency_ms: Number.NaN }).latencyMs).toBeNull();
    });

    it("does not read a check name it does not recognise", () => {
      expect(readHealth({ check: "vibes" }).check).toBeNull();
    });

    it("treats an empty detail as no detail", () => {
      expect(readHealth({ detail: "" }).detail).toBeNull();
    });

    it("survives a column carrying something entirely unexpected", () => {
      expect(readHealth({ [TRAFFIC_KEY]: { p95_latency_ms: 900 }, nonsense: [1, 2] })).toEqual({
        check: null,
        latencyMs: null,
        models: null,
        detail: null,
        errorClass: null,
      });
    });
  });
});

describe("writing a health column", () => {
  it("records what a successful check measured", () => {
    expect(mergeHealth({}, { check: "reachability", latency_ms: 12, models: 3 })).toEqual({
      check: "reachability",
      latency_ms: 12,
      models: 3,
    });
  });

  it("omits a latency the check did not measure, rather than defaulting it", () => {
    const written = mergeHealth({}, { check: "key_validation", detail: "key rejected (401)" });

    expect(written).toEqual({ check: "key_validation", detail: "key rejected (401)" });
    // V015 constrains `latency_ms` to a number when present, so a JSON null would be a
    // constraint violation dressed up as honesty. Absence is the only honest spelling.
    expect("latency_ms" in written).toBe(false);
  });

  it("clears a measurement the current check did not make", () => {
    // The stamp beside a number vouches for it. Leaving last cycle's 12ms next to this
    // cycle's fresh `last_checked_at` would be the row claiming a measurement it does not
    // have — worse than no measurement, because it looks current.
    const written = mergeHealth(
      { check: "reachability", latency_ms: 12, models: 3 },
      { check: "reachability", detail: "timed out after 5000 ms" },
    );

    expect(written).toEqual({ check: "reachability", detail: "timed out after 5000 ms" });
  });

  it("preserves the sub-object AB.2 will write, which is what makes the key reserved", () => {
    const traffic = { error_rate: 0.02, p95_latency_ms: 910, window: "1h" };

    const written = mergeHealth(
      { [TRAFFIC_KEY]: traffic, check: "key_validation", latency_ms: 900 },
      { check: "key_validation", latency_ms: 42 },
    );

    expect(written).toEqual({ [TRAFFIC_KEY]: traffic, check: "key_validation", latency_ms: 42 });
  });

  it("preserves anything else a seed or another surface put in the column", () => {
    const written = mergeHealth({ region: "us-east" }, { check: "key_validation", latency_ms: 42 });

    expect(written).toEqual({ region: "us-east", check: "key_validation", latency_ms: 42 });
  });

  it("does not mutate the value it was given", () => {
    const existing = { check: "reachability", latency_ms: 12 };

    mergeHealth(existing, { check: "reachability", latency_ms: 40 });

    expect(existing).toEqual({ check: "reachability", latency_ms: 12 });
  });
});

describe("a row as a snapshot", () => {
  const row: ProviderHealthRow = {
    id: CONNECTION,
    kind: "ollama",
    display_name: "Ollama",
    base_url: "http://workstation:11434",
    status: "active",
    last_checked_at: new Date("2026-08-23T10:00:00.000Z"),
    health: { check: "reachability", latency_ms: 4, models: 3 },
  };

  it("carries the connection, its address and what was measured", () => {
    expect(toSnapshot(row)).toEqual({
      connectionId: CONNECTION,
      kind: "ollama",
      displayName: "Ollama",
      baseUrl: "http://workstation:11434",
      status: "active",
      checkedAt: new Date("2026-08-23T10:00:00.000Z"),
      measured: { check: "reachability", latencyMs: 4, models: 3, detail: null, errorClass: null },
    });
  });

  it("carries no credential, and has nowhere to put one", () => {
    // The same probe `registry/resolution.ts` insists on for a resolution: what a consumer
    // gets is enough to *choose* a provider and nothing it needs to authenticate as one.
    expect(Object.keys(toSnapshot(row))).not.toContain("credentialsEncrypted");
    expect(JSON.stringify(toSnapshot(row))).not.toContain("ouro.v1");
  });

  it("says a connection nothing has checked has been checked at no time", () => {
    const snapshot = toSnapshot({ ...row, status: "unknown", last_checked_at: null, health: {} });

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.checkedAt).toBeNull();
    expect(snapshot.measured.latencyMs).toBeNull();
  });
});

describe("the class a test writes beside a failure (#230)", () => {
  it("reads one of the taxonomy's five", () => {
    expect(readHealth({ check: "key_validation", error_class: "upstream" }).errorClass).toBe(
      "upstream",
    );
  });

  it("refuses a word this build does not know, rather than drawing a pill for it", () => {
    expect(readHealth({ error_class: "gremlins" }).errorClass).toBeNull();
    expect(readHealth({ error_class: 503 }).errorClass).toBeNull();
  });

  it("is cleared by the next check, because it is a probe key and not a fact about the row", () => {
    expect(
      mergeHealth(
        { check: "key_validation", detail: "503 upstream", error_class: "upstream" },
        { check: "key_validation", latency_ms: 42 },
      ),
    ).toEqual({ check: "key_validation", latency_ms: 42 });
  });
});
