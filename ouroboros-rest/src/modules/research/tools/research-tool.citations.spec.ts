import {
  SOURCE_LIMITS,
  jsonbTextBytes,
  locatorValid,
  resultViolations,
  sourceRecordViolations,
} from "./research-tool.citations";

/** A source the ledger accepts — mockup 22's [12]. */
const SOURCE = {
  kind: "web",
  title: 'Skylink firmware 6.2 release notes — "gust-adaptive final approach"',
  locator: "https://skylink.example.com/releases/6.2",
  retrievedAt: "2026-10-04T10:00:00.000Z",
  contentHash: `sha256:${"0".repeat(64)}`,
  excerpt: "Gust-adaptive final approach.",
  meta: { watch: "skylink-releases" },
};

describe("locators", () => {
  it("accepts the mockup's locators, external and internal, for their kinds — V108's cases", () => {
    expect(locatorValid("web", "https://droneanalysts.example.com/s4-teardown")).toBe(true);
    expect(locatorValid("doc", "https://arxiv.example.org/abs/2605.11423")).toBe(true);
    expect(locatorValid("competitor_diff", "https://skylink.example.com/releases/6.2")).toBe(true);
    expect(locatorValid("ticket", "issue-index://support/churn-2026-q2")).toBe(true);
    expect(locatorValid("ticket", "https://github.com/acme/helios-firmware/issues/482")).toBe(true);
    expect(locatorValid("code", "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214")).toBe(
      true,
    );
    expect(
      locatorValid("code", "git://acme/helios-firmware@8c1b2e4f00/src/dock/dock_ctrl.c#L200-L230"),
    ).toBe(true);
    expect(locatorValid("telemetry", "telemetry://dock.success_rate/30d")).toBe(true);
    expect(
      locatorValid("telemetry", "telemetry://hil/dock.abort_count/2026-08-01..2026-09-01"),
    ).toBe(true);
  });

  it("accepts a converged bisect as a code source, as V118 does (#617)", () => {
    const job = "a1180004-0000-4000-8000-000000000001";
    const culprit = "a41f2c9".padEnd(40, "0");
    const bisect = `bisect://acme-robotics/helios-firmware@${culprit}?jobs=${job}`;

    expect(locatorValid("code", bisect)).toBe(true);
    expect(locatorValid("code", `${bisect},${job.replace(/1$/, "2")}`)).toBe(true);
    expect(locatorValid("web", bisect)).toBe(false);
    expect(locatorValid("code", `bisect://acme-robotics/helios-firmware@a41f2c9?jobs=${job}`)).toBe(
      false,
    );
    expect(locatorValid("code", `bisect://helios-firmware@${culprit}?jobs=${job}`)).toBe(false);
    expect(locatorValid("code", `bisect://acme-robotics/helios-firmware@${culprit}`)).toBe(false);
    expect(locatorValid("code", `bisect://acme-robotics/..@${culprit}?jobs=${job}`)).toBe(false);
    expect(
      locatorValid(
        "code",
        `bisect://acme-robotics/helios-firmware@${culprit}?jobs=${Array(33).fill(job).join(",")}`,
      ),
    ).toBe(false);
  });

  it("refuses what V108 refuses", () => {
    expect(locatorValid("code", "git://helios-firmware/src/dock/dock_ctrl.c")).toBe(false);
    expect(locatorValid("code", "git://helios-firmware@8c1b2e4/src/../etc/passwd")).toBe(false);
    expect(locatorValid("code", "git://helios-firmware@8c1b2e4/src/dock.c#L0")).toBe(false);
    expect(locatorValid("telemetry", "telemetry://dock.success_rate")).toBe(false);
    expect(locatorValid("ticket", "issue-index://support")).toBe(false);
    expect(locatorValid("web", "javascript:alert(1)")).toBe(false);
    expect(locatorValid("web", "issue-index://support/churn-2026-q2")).toBe(false);
    expect(locatorValid("web", "https://a.example.com/with space")).toBe(false);
    expect(
      locatorValid("web", `https://a.example.com/${"x".repeat(SOURCE_LIMITS.locatorChars)}`),
    ).toBe(false);
  });
});

describe("a source record", () => {
  it("is accepted in the ledger's shape", () => {
    expect(sourceRecordViolations(SOURCE)).toEqual([]);
  });

  it("names every problem at once", () => {
    expect(
      sourceRecordViolations(
        {
          kind: "video",
          title: "",
          locator: 7,
          retrievedAt: "yesterday",
          contentHash: "x",
          excerpt: "",
          meta: [],
        },
        "source 3",
      ),
    ).toEqual([
      "source 3: kind must be one of web, competitor_diff, code, ticket, telemetry, doc",
      "source 3: title must be non-blank and at most 300 characters",
      "source 3: locator must be a string",
      "source 3: retrievedAt must be an ISO-8601 timestamp",
      "source 3: contentHash must be sha256:<64 lowercase hex>",
      "source 3: excerpt must be non-blank and at most 4096 bytes",
      "source 3: meta must be an object",
    ]);
  });

  it("bounds the excerpt in bytes, not characters", () => {
    expect(sourceRecordViolations({ ...SOURCE, excerpt: "x".repeat(4096) })).toEqual([]);
    expect(sourceRecordViolations({ ...SOURCE, excerpt: "é".repeat(2049) })).toEqual([
      "source: excerpt must be non-blank and at most 4096 bytes",
    ]);
  });

  it("bounds meta by its jsonb text, which is wider than JSON", () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe(Buffer.byteLength('{"a": 1, "b": [1, 2]}'));
    expect(sourceRecordViolations({ ...SOURCE, meta: { page: "x".repeat(8200) } })).toEqual([
      "source: meta must be at most 8192 bytes",
    ]);
  });

  it("requires a competitor_diff source to name its snapshot, and only it", () => {
    expect(sourceRecordViolations({ ...SOURCE, kind: "competitor_diff" })).toEqual([
      "source: a competitor_diff source must name the snapshot it cites (snapshotId, a uuid)",
    ]);
    expect(
      sourceRecordViolations({
        ...SOURCE,
        kind: "competitor_diff",
        snapshotId: "a1120000-0000-0000-0000-000000000032",
      }),
    ).toEqual([]);
    expect(
      sourceRecordViolations({ ...SOURCE, snapshotId: "a1120000-0000-0000-0000-000000000032" }),
    ).toEqual(["source: only a competitor_diff source names a snapshot"]);
  });

  it("refuses something that is not an object at all", () => {
    expect(sourceRecordViolations(null)).toEqual(["source: must be an object"]);
  });
});

describe("a result", () => {
  it("is accepted with a payload, its sources and its usage", () => {
    expect(
      resultViolations({ payload: { hits: [] }, sources: [SOURCE], usage: { tokens: 0 } }, null),
    ).toEqual([]);
  });

  it("fails a payload with no sources — data with no evidence is not an answer", () => {
    expect(
      resultViolations({ payload: { hits: [1] }, sources: [], usage: { tokens: 0 } }, null),
    ).toEqual(["an operation that returns a payload must return at least one source record"]);
  });

  it("accepts the empty answer, a null payload with no sources", () => {
    expect(resultViolations({ payload: null, sources: [], usage: { tokens: 0 } }, null)).toEqual(
      [],
    );
  });

  it("fails a missing payload, missing sources and a bad usage report", () => {
    expect(resultViolations({ usage: { tokens: -1 } }, null)).toEqual([
      "result must carry a payload (null for an empty answer)",
      "sources must be an array",
      "usage.tokens must be a non-negative integer",
    ]);
    expect(resultViolations("text", null)).toEqual([
      "result must be an object of {payload, sources, usage}",
    ]);
  });

  it("fails usage past the ceiling and accepts it at the ceiling", () => {
    expect(
      resultViolations({ payload: 1, sources: [SOURCE], usage: { tokens: 501 } }, 500),
    ).toEqual(["usage.tokens (501) exceeds the call's ceiling of 500"]);
    expect(
      resultViolations({ payload: 1, sources: [SOURCE], usage: { tokens: 500 } }, 500),
    ).toEqual([]);
  });
});
