import { describe, expect, it } from "vitest";

import type { TicketSourceCatalog } from "@/app/api/sources";
import type { Reading } from "@/app/api/reading";
import {
  CATALOG_UNREAD_DIRECTION_REASON,
  NOT_CONNECTED,
  NO_PROVIDER_DIRECTION,
  READ_DIRECTION,
  TWO_WAY_DIRECTION,
  cadenceOf,
  cadenceTag,
  syncRows,
} from "@/app/planning/sync";
import { unsupportedReason } from "@/app/planning/generator";

import {
  SEEDED_POLL_INTERVAL_SECONDS,
  catalogPayload,
  githubEntry,
  jiraSource,
  source,
  sourcePage,
} from "../helpers/sources";
import { writableCatalog } from "../helpers/planning";

/**
 * The Tracker Sync card's judgements (AM.3, #285).
 *
 * The acceptance criterion this file exists for is the third one: **a read-only source never
 * reads `two-way sync`**, verified with a fixture source. The rest of the card's claims — the
 * cadence tag from real configuration, the honest line for a kind this build cannot sync, the
 * `not connected` row and its **connect ↗** — are the same kind of assertion on a small value.
 */

/** A catalog whose GitHub entry declares no write — the fixture the criterion asks for. */
function readOnlyCatalog(): Reading<TicketSourceCatalog> {
  return { ok: true, value: catalogPayload([githubEntry()]) };
}

/** A catalog that lists nothing at all, so every kind is one this build has no provider for. */
function emptyCatalog(): Reading<TicketSourceCatalog> {
  return { ok: true, value: catalogPayload([]) };
}

/** The row for a kind, out of a set of sources and a catalog. */
function rowFor(kind: string, sources = [source()], catalog = writableCatalog()) {
  const rows = syncRows(sources, { ok: true, value: catalog });

  return rows.find((row) => row.kind === kind);
}

describe("the cadence tag", () => {
  // The mockup says `every 60s`; the real default is 300. The criterion is that the tag is
  // configuration, not that it reproduces the mockup's number.
  it("spells the interval in the largest unit that divides it evenly", () => {
    expect(cadenceTag(300)).toBe("every 5m");
    expect(cadenceTag(60)).toBe("every 1m");
    expect(cadenceTag(3600)).toBe("every 1h");
    expect(cadenceTag(7200)).toBe("every 2h");
  });

  it("stays in seconds for an interval no minute divides", () => {
    expect(cadenceTag(90)).toBe("every 90s");
    expect(cadenceTag(125)).toBe("every 125s");
  });

  it("draws no tag for a figure that is not a positive interval", () => {
    expect(cadenceTag(0)).toBeNull();
    expect(cadenceTag(-60)).toBeNull();
    expect(cadenceTag(Number.NaN)).toBeNull();
  });

  it("is the listing's own figure, and nothing at all when the listing failed", () => {
    expect(cadenceOf({ ok: true, value: sourcePage() })).toBe("every 5m");
    expect(cadenceTag(SEEDED_POLL_INTERVAL_SECONDS)).toBe("every 5m");
    // A failed read has no cadence to publish, and inventing the default would be a claim.
    expect(cadenceOf({ ok: false, reason: "Sources failed." })).toBeNull();
  });
});

describe("the sub-line's direction", () => {
  it("says two-way only where write capability is live", () => {
    const row = rowFor("github");

    expect(row?.direction).toBe("two-way");
    expect(row?.sub).toBe(`${TWO_WAY_DIRECTION} · 42 issues`);
  });

  // The ticket's third acceptance criterion, verified with a fixture source.
  it("never says two-way for a read-only source — it says read sync", () => {
    const rows = syncRows([source()], readOnlyCatalog());
    const github = rows.find((row) => row.kind === "github");

    expect(github?.direction).toBe("read");
    expect(github?.sub).toBe(`${READ_DIRECTION} · 42 issues`);
    expect(github?.sub).not.toContain(TWO_WAY_DIRECTION);
    for (const row of rows) expect(row.sub).not.toContain(TWO_WAY_DIRECTION);
  });

  it("carries the catalog's own reason for a read-only tracker", () => {
    const github = syncRows([source()], readOnlyCatalog()).find((row) => row.kind === "github");

    expect(github?.reason).toBe(githubEntry().push.reason);
  });

  it("claims no direction at all for a kind this build has no provider for", () => {
    const rows = syncRows([source()], emptyCatalog());
    const github = rows.find((row) => row.kind === "github");

    expect(github?.direction).toBe("no-provider");
    expect(github?.sub).toBe(`${NO_PROVIDER_DIRECTION} · 42 issues`);
    expect(github?.reason).toBe(unsupportedReason("GitHub Issues"));
    // Nothing is polling it, so *active* would be a claim about work that is not happening.
    expect(github?.state).toBe("idle");
  });

  it("leaves the direction unsaid, with the reason, when the catalog could not be read", () => {
    const github = syncRows([source()], { ok: false, reason: "Catalog failed." }).find(
      (row) => row.kind === "github",
    );

    expect(github?.direction).toBe("unknown");
    expect(github?.sub).toBe("sync · 42 issues");
    expect(github?.reason).toBe(CATALOG_UNREAD_DIRECTION_REASON);
  });
});

describe("the issue count", () => {
  it("is the source's own open canonical count", () => {
    expect(rowFor("github", [source({ openTicketCount: 7 })])?.sub).toContain("7 issues");
  });

  it("says one issue in the singular, and zero in the plural", () => {
    expect(rowFor("github", [source({ openTicketCount: 1 })])?.sub).toBe(
      `${TWO_WAY_DIRECTION} · 1 issue`,
    );
    expect(rowFor("github", [source({ openTicketCount: 0 })])?.sub).toBe(
      `${TWO_WAY_DIRECTION} · 0 issues`,
    );
  });
});

describe("the rows", () => {
  it("draws the mockup's three kinds in its order, whatever is connected", () => {
    const kinds = syncRows([source()], { ok: true, value: writableCatalog() }).map(
      (row) => row.kind,
    );

    expect(kinds).toEqual(["github", "jira", "linear"]);
  });

  it("renders a kind nobody connected as `not connected`, with connect ↗", () => {
    const linear = rowFor("linear");

    expect(linear?.sub).toBe(NOT_CONNECTED);
    expect(linear?.direction).toBe("absent");
    expect(linear?.connect).toBe(true);
    expect(linear?.state).toBe("idle");
    expect(linear?.dot).toBe("ring");
  });

  it("offers connect ↗ on no row that has a source", () => {
    const rows = syncRows([source(), jiraSource()], { ok: true, value: writableCatalog() });

    for (const row of rows.filter((candidate) => candidate.kind !== "linear")) {
      expect(row.connect).toBe(false);
    }
  });

  // The mockup's `Jira · ACME workspace` is config context, and a display name already carries
  // it — so the row is named what the workspace named the source, not what the kind is called.
  it("names a connected source by its own display name", () => {
    expect(rowFor("github")?.name).toBe("GitHub · acme-robotics");

    const rows = syncRows(
      [source(), source({ id: "other", displayName: "GitHub · forge-io" })],
      { ok: true, value: writableCatalog() },
    );
    const github = rows.filter((row) => row.kind === "github");

    expect(github.map((row) => row.name)).toEqual(["GitHub · acme-robotics", "GitHub · forge-io"]);
  });

  it("names an unconnected kind by the kind, since there is no source to have named", () => {
    expect(rowFor("linear")?.name).toBe("Linear");
  });

  it("monograms and tints each kind exactly as the generator card does", () => {
    const rows = syncRows([], { ok: true, value: writableCatalog() });

    expect(rows.map((row) => [row.monogram, row.tint])).toEqual([
      ["GH", "gh"],
      ["JI", "ji"],
      ["LN", "ln"],
    ]);
  });

  it("gives every row a distinct key, so two sources of one kind are two rows", () => {
    const rows = syncRows(
      [source(), source({ id: "other", displayName: "GitHub · forge-io" })],
      { ok: true, value: writableCatalog() },
    );

    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("reads an empty workspace as three unconnected kinds rather than nothing", () => {
    const rows = syncRows([], { ok: true, value: writableCatalog() });

    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.sub).toBe(NOT_CONNECTED);
  });
});

describe("the status dot", () => {
  it("is the settings page's own three states", () => {
    expect(rowFor("github", [source({ status: "active" })])?.state).toBe("ok");
    expect(rowFor("github", [source({ status: "paused" })])?.state).toBe("paused");
    expect(rowFor("github", [source({ status: "error" })])?.state).toBe("error");
  });

  it("carries a word beside the hue on every row, never the hue alone", () => {
    for (const row of syncRows([source(), jiraSource()], { ok: true, value: writableCatalog() })) {
      expect(row.state).not.toBe("");
    }
  });

  it("says the loop's own reason before any capability note", () => {
    const failed = rowFor("github", [
      source({ status: "error", statusReason: "rate limited until 14:20 UTC" }),
    ]);

    expect(failed?.reason).toBe("rate limited until 14:20 UTC");
  });
});
