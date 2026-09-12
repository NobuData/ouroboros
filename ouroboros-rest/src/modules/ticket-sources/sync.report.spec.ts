import {
  SOURCE_SKIPPED_UNSUPPORTED,
  SOURCE_SKIPS,
  SOURCE_SKIP_MESSAGES,
  cycleTotals,
  type SourceSyncOutcome,
  type SyncCycleReport,
} from "./sync.report";

/**
 * The report's own claims ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * Two of them are worth a suite. That **a skipped or failed source contributes to no row
 * count**, because a log line quoting `0 imported` across a cycle where nothing was polled
 * reads as *nothing changed* rather than as *nothing ran*. And that the skip vocabulary stays
 * small — every reason that could be a provider's belongs to the taxonomy, and a second word
 * appearing here is the SPI leaking back into the loop.
 */

/**
 * One outcome, with the zeroes a spec that is not about counting does not want to write.
 *
 * @param overrides - What differs.
 * @returns The outcome.
 */
function outcome(overrides: Partial<SourceSyncOutcome> = {}): SourceSyncOutcome {
  return {
    organizationId: "org-sources",
    sourceId: "b0390000-0000-0000-0000-00000000000a",
    kind: "github",
    displayName: "GitHub · acme-robotics",
    imported: 0,
    updated: 0,
    unchanged: 0,
    skippedClosed: 0,
    enqueued: 0,
    hasMore: false,
    ...overrides,
  };
}

/**
 * A cycle over these outcomes.
 *
 * @param sources - What each source did.
 * @returns The report.
 */
function report(sources: readonly SourceSyncOutcome[]): SyncCycleReport {
  return {
    startedAt: new Date("2026-09-12T10:00:00.000Z"),
    sources,
    pending: sources.some((source) => source.hasMore),
  };
}

describe("the skip vocabulary", () => {
  it("has exactly one word, because the SPI absorbed the rest", () => {
    // `backlog-sync/sync.report.ts` needs six reasons because that module *is* the GitHub
    // client. Every question of that shape is behind `TicketSourceProvider` here, and a second
    // word appearing in this list would mean the loop had learned something about a tracker.
    expect([...SOURCE_SKIPS]).toStrictEqual([SOURCE_SKIPPED_UNSUPPORTED]);
  });

  it.each(SOURCE_SKIPS)("writes a sentence for %s that a person can act on", (skip) => {
    const message = SOURCE_SKIP_MESSAGES[skip];

    expect(message.trim()).not.toBe("");
    // Says what is true — the source is configured, and nothing is polling it — rather than
    // implying the workspace did something wrong.
    expect(message).toContain("configured");
  });
});

describe("cycleTotals", () => {
  it("counts the three outcomes apart", () => {
    const totals = cycleTotals(
      report([
        outcome({ imported: 3 }),
        outcome({ skipped: SOURCE_SKIPPED_UNSUPPORTED }),
        outcome({ failure: { errorClass: "auth", reason: "credentials rejected" } }),
      ]),
    );

    expect(totals.polled).toBe(1);
    expect(totals.skipped).toBe(1);
    expect(totals.failed).toBe(1);
  });

  it("takes its row counts only from sources that were really polled", () => {
    // The property the log line depends on. A skipped source carries zeroes anyway today; what
    // this fixes in place is that a *future* outcome carrying a stale count could not leak into
    // the sentence an operator reads.
    const totals = cycleTotals(
      report([
        outcome({ imported: 2, updated: 1, unchanged: 5, enqueued: 2 }),
        outcome({ skipped: SOURCE_SKIPPED_UNSUPPORTED, imported: 99, enqueued: 99 }),
        outcome({
          failure: { errorClass: "upstream", reason: "tracker unavailable" },
          imported: 99,
        }),
      ]),
    );

    expect(totals).toStrictEqual({
      polled: 1,
      skipped: 1,
      failed: 1,
      imported: 2,
      updated: 1,
      unchanged: 5,
      enqueued: 2,
    });
  });

  it("is all zeroes for a cycle that found no source at all", () => {
    expect(cycleTotals(report([]))).toStrictEqual({
      polled: 0,
      skipped: 0,
      failed: 0,
      imported: 0,
      updated: 0,
      unchanged: 0,
      enqueued: 0,
    });
  });

  it("adds up across sources", () => {
    const totals = cycleTotals(
      report([outcome({ imported: 2, enqueued: 2 }), outcome({ imported: 3, enqueued: 1 })]),
    );

    expect(totals.polled).toBe(2);
    expect(totals.imported).toBe(5);
    expect(totals.enqueued).toBe(3);
  });
});
