import {
  buildFailedCard,
  buildGreenCard,
  digestRecordCard,
  loopFinishedCard,
} from "./chat.cards.events";
import { BUILD_1847, LOOP_1846, UI_URL } from "./chat.fixture";
import {
  buildRecord,
  loopFinishedRecord,
  recordedBuild,
  recordedDigest,
  recordedLoopFinished,
  type RecordSubject,
} from "./chat.record";

/**
 * What an event card's row records, and its reading back (#542): a card composed from the
 * record of a card is the same card — which is what lets the channel mirror say what Slack was
 * sent — and a figure that was not printed is neither recorded nor printed again.
 */

const LOOP_SUBJECT: RecordSubject = {
  runId: LOOP_1846.runId,
  loopSeq: LOOP_1846.loopSeq,
  prId: LOOP_1846.prId,
  prNumber: LOOP_1846.prNumber,
};
const BUILD_SUBJECT: RecordSubject = {
  runId: BUILD_1847.runId,
  loopSeq: BUILD_1847.loopSeq,
  prId: BUILD_1847.prId,
  prNumber: BUILD_1847.prNumber,
};

describe("a finished loop's record", () => {
  it("reads back to the card that was posted", () => {
    const record = loopFinishedRecord(LOOP_1846);

    expect(loopFinishedCard(recordedLoopFinished(record, LOOP_SUBJECT), UI_URL)).toEqual(
      loopFinishedCard(LOOP_1846, UI_URL),
    );
  });

  it("survives its trip through jsonb", () => {
    const record = JSON.parse(JSON.stringify(loopFinishedRecord(LOOP_1846))) as Record<
      string,
      unknown
    >;

    expect(loopFinishedCard(recordedLoopFinished(record, LOOP_SUBJECT), UI_URL).stats).toBe(
      "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
    );
  });

  it.each([
    ["nothing was priced", { costCents: null, unpricedEvents: 0 }],
    ["only part of it was priced", { costCents: "94", unpricedEvents: 2 }],
  ])("records no cost when %s, and prints none again", (_why, spend) => {
    const facts = { ...LOOP_1846, ...spend };
    const record = loopFinishedRecord(facts);

    expect(record).not.toHaveProperty("cost_cents");
    expect(loopFinishedCard(recordedLoopFinished(record, LOOP_SUBJECT), UI_URL)).toEqual(
      loopFinishedCard(facts, UI_URL),
    );
  });

  it("reads back a card with only a loop number when the record holds nothing else", () => {
    const bare = {
      ...LOOP_1846,
      issueNumber: null,
      issueTitle: null,
      prNumber: null,
      prId: null,
      checksPassed: null,
      checksTotal: null,
      cycleSeconds: null,
      costCents: null,
      model: null,
    };
    const record = loopFinishedRecord(bare);

    expect(record).toEqual({ outcome: "merged" });
    expect(loopFinishedCard(recordedLoopFinished(record, LOOP_SUBJECT), UI_URL)).toEqual(
      loopFinishedCard(bare, UI_URL),
    );
  });

  it("names no merged pull request the record does not name, whatever the refs resolve to", () => {
    const read = recordedLoopFinished({ outcome: "merged" }, LOOP_SUBJECT);

    expect(read.prNumber).toBeNull();
    expect(read.prId).toBeNull();
  });

  it("reads a fact of the wrong type as absent, not as a figure", () => {
    const read = recordedLoopFinished(
      { issue_number: "474", checks_passed: -1, checks_total: 14, cycle_seconds: 1.5, model: 7 },
      LOOP_SUBJECT,
    );

    expect(read).toMatchObject({
      issueNumber: null,
      checksPassed: null,
      cycleSeconds: null,
      model: null,
    });
  });
});

describe("a build's record", () => {
  it("reads back to the card that was posted, green or failed", () => {
    const failing = { ...BUILD_1847, passed: 61 };

    expect(buildGreenCard(recordedBuild(buildRecord(BUILD_1847), BUILD_SUBJECT)!, UI_URL)).toEqual(
      buildGreenCard(BUILD_1847, UI_URL),
    );
    expect(buildFailedCard(recordedBuild(buildRecord(failing), BUILD_SUBJECT)!, UI_URL)).toEqual(
      buildFailedCard(failing, UI_URL),
    );
  });

  it("records which build and revision only when the reporting plane said", () => {
    expect(buildRecord(BUILD_1847)).toEqual({
      passed: 63,
      total: 63,
      build_number: 3,
      revision: 2,
    });
    expect(buildRecord({ ...BUILD_1847, buildNumber: null, revision: null })).toEqual({
      passed: 63,
      total: 63,
    });
  });

  it.each([[{}], [{ passed: 3 }], [{ passed: 3, total: 2 }], [{ passed: "3", total: 3 }]])(
    "reads nothing from a record with no counts to print (%j)",
    (facts) => {
      expect(recordedBuild(facts, BUILD_SUBJECT)).toBeUndefined();
    },
  );
});

describe("a digest's record", () => {
  const FACTS = {
    window_from: "2026-10-05",
    window_to: "2026-10-11",
    merged_prs: 1,
    interventions: 0,
  };

  it("reads back its week and its two counts, which is all the record card says", () => {
    const week = recordedDigest(FACTS);

    expect(week).toEqual({
      window: { from: "2026-10-05", to: "2026-10-11" },
      mergedPrs: 1,
      interventions: 0,
    });
    expect(digestRecordCard(week!, UI_URL)).toEqual({
      kind: "card",
      severity: "info",
      mark: "✦",
      headline: "Weekly insights — 1 PR merged this week. None needed a human.",
      lines: [],
      stats: null,
      actions: [
        {
          type: "link",
          id: "open_insights",
          label: "Open Insights",
          url: `${UI_URL}/insights?range=7d`,
        },
      ],
      footnote: "Oct 5 – Oct 11, 2026",
    });
  });

  it.each([
    [{ ...FACTS, window_from: undefined }],
    [{ ...FACTS, window_to: "last week" }],
    [{ ...FACTS, merged_prs: "1" }],
    [{ ...FACTS, interventions: -1 }],
  ])("reads nothing from a record that names no week or count (%j)", (facts) => {
    expect(recordedDigest(facts)).toBeUndefined();
  });
});
