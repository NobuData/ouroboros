import type { Fact } from "../db/schema";
import {
  factDetail,
  factResource,
  latestInto,
  needsYouFeed,
  provenanceOf,
  statusCounts,
  type FactRecord,
  type FactTransitionRow,
} from "./facts.resources";

/**
 * The fact mappers (#411): stamps rendered from the audit, the counted-or-frozen use count, the
 * stated sweep coverage, and the needs-you feed's contract.
 */

const AT = new Date("2026-09-01T00:00:00.000Z");

/**
 * @param minutes - Minutes after {@link AT}.
 * @returns The instant.
 */
function after(minutes: number): Date {
  return new Date(AT.getTime() + minutes * 60_000);
}

/**
 * @param overrides - Columns that differ from a fresh proposal.
 * @returns A `facts` row.
 */
function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-1",
    organization_id: "org",
    repo_ref: null,
    text: "CI needs `west update` before first build of the day",
    status: "proposed",
    proposer: "manual",
    provenance: { line: "from build-farm failure pattern", refs: [] },
    confirmed_by: null,
    confirmed_at: null,
    expired_reason: null,
    previous_use_count: null,
    relearned_from_fact_id: null,
    status_changed_by: null,
    status_reason: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/**
 * @param to - The status moved to.
 * @param minutes - When.
 * @param actor - Who, or null.
 * @returns An audit row.
 */
function moved(
  to: Fact["status"],
  minutes: number,
  actor: string | null = "ken",
): FactTransitionRow {
  return {
    fact_id: "fact-1",
    from_status: null,
    to_status: to,
    actor_id: actor,
    actor_name: actor === null ? null : actor.toUpperCase(),
    reason: null,
    at: after(minutes),
  };
}

/**
 * @param row - The fact.
 * @param rest - Everything else.
 * @returns A record.
 */
function record(row: Fact, rest: Partial<FactRecord> = {}): FactRecord {
  return { fact: row, usedCount: 0, anchors: [], transitions: [], relearnedBy: [], ...rest };
}

describe("the fact resources", () => {
  it("renders 'confirmed by' from the newest audit row into confirmed", () => {
    const resource = factResource(
      record(fact({ status: "confirmed", confirmed_at: after(30), confirmed_by: "maya" }), {
        transitions: [
          moved("confirmed", 10, "ken"),
          moved("stale", 20, null),
          moved("confirmed", 30, "maya"),
        ],
      }),
    );

    expect(resource.confirmation).toEqual({
      actor: { id: "maya", name: "MAYA" },
      at: after(30).toISOString(),
      reason: null,
    });
    expect(resource.staleness).toBeNull();
  });

  it("falls back to the columns' stamp when the audit has no confirmation row", () => {
    const resource = factResource(
      record(fact({ status: "confirmed", confirmed_at: after(5), confirmed_by: "ken" })),
    );

    expect(resource.confirmation).toEqual({
      actor: { id: "ken", name: null },
      at: after(5).toISOString(),
      reason: null,
    });
  });

  it("counts use live, and answers the frozen snapshot once expired", () => {
    expect(
      factResource(record(fact({ status: "confirmed", confirmed_at: AT }), { usedCount: 48 }))
        .usedCount,
    ).toBe(48);

    const expired = factResource(
      record(
        fact({
          status: "expired",
          confirmed_at: AT,
          expired_reason: "Zephyr 4.1 migration",
          previous_use_count: 31,
        }),
        { usedCount: 99, transitions: [moved("expired", 60, "ken")] },
      ),
    );

    expect(expired.usedCount).toBe(31);
    expect(expired.expiry).toEqual({
      reason: "Zephyr 4.1 migration",
      previousUseCount: 31,
      stamp: { actor: { id: "ken", name: "KEN" }, at: after(60).toISOString(), reason: null },
    });
  });

  it("states that an anchor-less fact is not swept", () => {
    expect(factResource(record(fact())).sweep).toEqual({ covered: false, reason: "no_anchors" });
    expect(
      factResource(
        record(fact(), {
          anchors: [
            {
              id: "a",
              fact_id: "fact-1",
              kind: "dependency",
              value: "west",
              last_checked_at: null,
              created_at: AT,
            },
          ],
        }),
      ).sweep,
    ).toEqual({ covered: true, reason: null });
  });

  it("orders a detail's history oldest first", () => {
    const detail = factDetail(
      record(fact({ status: "confirmed", confirmed_at: after(10) }), {
        transitions: [moved("confirmed", 10), moved("proposed", 0)],
      }),
    );

    expect(detail.history.map((row) => row.to)).toEqual(["proposed", "confirmed"]);
  });

  it("reads provenance defensively", () => {
    expect(provenanceOf({ line: "x", refs: [{ kind: "run", id: "r" }] })).toEqual({
      line: "x",
      refs: [{ kind: "run", id: "r" }],
    });
    expect(provenanceOf({})).toEqual({ line: "", refs: [] });
  });

  it("counts every status, zero included", () => {
    expect(statusCounts([{ status: "proposed", count: 2 }])).toEqual({
      proposed: 2,
      confirmed: 0,
      rejected: 0,
      stale: 0,
      expired: 0,
    });
  });

  it("finds the newest row into a status", () => {
    const rows = [moved("confirmed", 1), moved("confirmed", 3), moved("stale", 2)];

    expect(latestInto(rows, "confirmed")?.at).toEqual(after(3));
    expect(latestInto(rows, "rejected")).toBeUndefined();
  });
});

describe("the needs-you feed contract", () => {
  it("files proposals and stale facts only, at info, oldest wait first", () => {
    const proposal = factResource(record(fact({ id: "p", created_at: after(50) })));
    const stale = factResource(
      record(fact({ id: "s", status: "stale", confirmed_at: AT, created_at: after(1) }), {
        transitions: [{ ...moved("stale", 40, null), reason: "path_glob anchor matched" }],
      }),
    );
    const confirmed = factResource(
      record(fact({ id: "c", status: "confirmed", confirmed_at: AT })),
    );

    const feed = needsYouFeed([proposal, confirmed, stale]);

    expect(feed.count).toBe(2);
    expect(feed.items).toEqual([
      {
        kind: "fact_review",
        severity: "info",
        factId: "s",
        reason: "stale",
        text: stale.text,
        repoRef: null,
        provenanceLine: "from build-farm failure pattern",
        staleness: { actor: null, at: after(40).toISOString(), reason: "path_glob anchor matched" },
        since: after(40).toISOString(),
      },
      {
        kind: "fact_review",
        severity: "info",
        factId: "p",
        reason: "awaiting_review",
        text: proposal.text,
        repoRef: null,
        provenanceLine: "from build-farm failure pattern",
        staleness: null,
        since: after(50).toISOString(),
      },
    ]);
  });

  it("is an empty feed, not an absent one, when nothing waits", () => {
    expect(needsYouFeed([])).toEqual({ count: 0, items: [] });
  });
});
