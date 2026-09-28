import { describe, expect, it } from "vitest";

import type { PrGateRow, PullRequestPage } from "@/app/api/pull-requests";
import { BUILD_FARM_PATH, runPath, testsPath } from "@/app/paths";
import {
  APPROVED,
  AUTO_MERGE_ELIGIBLE,
  DECLINED,
  type GatesCardInput,
  PENDING_PILL,
  UNAVAILABLE_NOTE,
  VERDICT_MARKS,
  VERDICT_WORDS,
  approvalOffer,
  approvalOutcome,
  declineTitle,
  gateLink,
  gateRowView,
  gatesCard,
  gatesPill,
  rowReview,
} from "@/app/prs/gates";
import { gatesScope } from "@/app/prs/strip";

import {
  ATTEMPT_3_ID,
  ATTEMPT_4_ID,
  HIL_RED,
  REV_2_ID,
  TESTS_RED,
  gateRow,
  gateRows,
  review,
  revisionOne,
  revisionTwo,
  stripPage,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The Verification gates card's rules (#365), without rendering: every verdict's treatment, the
 * header pill from the payload's aggregate, where each evidence line leads, and what the
 * human-approval row offers by role and state.
 */

/**
 * What the card is decided from.
 *
 * @param page The page.
 * @param scoped The ordinal the reader chose, or `null`.
 * @param over What else to change.
 * @returns The input.
 */
function input(
  page: PullRequestPage = stripPage(),
  scoped: number | null = null,
  over: Partial<GatesCardInput> = {},
): GatesCardInput {
  return {
    page,
    scope: gatesScope(page, scoped)!,
    answeredReview: null,
    mayContribute: true,
    originId: "dashboard",
    ...over,
  };
}

/**
 * The page with Revision 2's rows replaced.
 *
 * @param over Verdicts and evidence, by gate key.
 * @returns The page.
 */
function withRows(
  over: Readonly<Record<string, readonly [PrGateRow["verdict"], string | null]>>,
): PullRequestPage {
  const two = revisionTwo();

  return stripPage({
    revisions: [revisionOne(), { ...two, gates: { ...two.gates, rows: gateRows(over) } }],
  });
}

/**
 * One row of the card.
 *
 * @param page The page.
 * @param key The gate.
 * @param over What else to change.
 * @returns The row.
 */
function rowOf(page: PullRequestPage, key: string, over: Partial<GatesCardInput> = {}) {
  return gatesCard(input(page, null, over)).rows.find((row) => row.key === key)!;
}

/**
 * A row citing what its evidence was composed from.
 *
 * @param key The gate.
 * @param kind What it cites.
 * @param id The cited row's id.
 * @returns The row.
 */
function citing(
  key: string,
  kind: NonNullable<PrGateRow["evidenceRef"]>["kind"],
  id = "5eed0050-0000-4000-8000-000000000001",
): PrGateRow {
  return { ...gateRow(key, "green"), evidenceRef: { kind, id } };
}

describe("the seeded card", () => {
  it("is mockup 12's seven rows, each with its mark and the engine's line", () => {
    const card = gatesCard(input());

    expect(card.rows.map((row) => [row.mark, row.label, row.evidence])).toEqual([
      ["✓", "Build", "forge-01 · zephyr.elf · FLASH 43.5%"],
      ["✓", "Test suite", "63/63 after attempt 4"],
      ["✓", "Physical HIL", "overshoot 1.7% ≤ 2.0% · rig helios-rig-02"],
      ["✓", "Diff vs plan", "all hunks map to planned files · 0 out-of-scope edits"],
      ["✓", "Secrets & license", "clean (headers + manifest delta)"],
      ["–", "Second-model review", "unavailable — arrives with the provider stack"],
      ["○", "Human approval", "not required by policy"],
    ]);
    expect(card.heading).toBe("Revision 2 · b7e41d0 · 5/7 gates green");
    expect(card.runConsole).toBe(runPath(SEEDED_RUN_ID, "dashboard"));
  });

  it("names no run console for a PR no loop opened", () => {
    expect(gatesCard(input(stripPage({ pullRequest: { run: null } }))).runConsole).toBeNull();
  });
});

describe("the header pill", () => {
  const aggregate = revisionTwo().gates.aggregate!;

  it("states the payload's aggregate — it counts nothing itself", () => {
    // Counts that disagree with the rows on purpose: the pill is the payload's, not a recount.
    const page = stripPage({
      revisions: [
        revisionOne(),
        revisionTwo({
          gates: {
            revisionId: REV_2_ID,
            aggregate: { ...aggregate, greenCount: 2, requiredCount: 9 },
            rows: gateRows(),
          },
        }),
      ],
    });

    expect(gatesCard(input(page)).pill?.label).toBe("2 / 9 green");
  });

  it("is warn while gates are outstanding, err while one is red, ok once merge-ready", () => {
    expect(gatesPill(aggregate)).toEqual({ label: "5 / 7 green", tone: "warn" });
    expect(gatesPill({ ...aggregate, greenCount: 3, redCount: 2 })?.tone).toBe("err");
    expect(gatesPill({ ...aggregate, greenCount: 7, mergeReady: true })?.tone).toBe("ok");
  });

  it("is the scoped revision's own aggregate", () => {
    expect(gatesCard(input(stripPage(), 1)).pill).toEqual({ label: "3 / 7 green", tone: "err" });
  });

  it("is not drawn without an aggregate, or with no required gate to count", () => {
    expect(gatesPill(null)).toBeNull();
    expect(gatesPill({ ...aggregate, requiredCount: 0, greenCount: 0 })).toBeNull();
  });
});

describe("the verdicts", () => {
  it("gives every verdict its own words, and every written mark its own shape", () => {
    const words = Object.values(VERDICT_WORDS);
    const marks = Object.values(VERDICT_MARKS).filter((mark) => mark !== null);

    expect(new Set(words).size).toBe(6);
    expect(new Set(marks).size).toBe(5);
    expect(VERDICT_MARKS.pending).toBeNull();
  });

  it("draws unavailable apart from pending: a still mark and the note, no pill", () => {
    const unavailable = rowOf(stripPage(), "model_review");
    const pending = rowOf(
      withRows({ model_review: ["pending", "cursor/composer-2 voting…"] }),
      "model_review",
    );

    expect(unavailable).toMatchObject({
      verdict: "unavailable",
      mark: "–",
      word: "unavailable",
      note: UNAVAILABLE_NOTE,
      pill: null,
    });
    expect(pending).toMatchObject({
      verdict: "pending",
      mark: null,
      word: "pending",
      note: null,
      pill: PENDING_PILL,
      evidence: "cursor/composer-2 voting…",
    });
    expect(UNAVAILABLE_NOTE).toBe("arrives with the provider stack");
  });

  it("draws not_required as policy, with the auto-merge eligible tag on human approval", () => {
    const row = rowOf(stripPage(), "human_approval");

    expect(row).toMatchObject({ mark: "○", word: "not required", tag: AUTO_MERGE_ELIGIBLE });
    expect(row.mark).not.toBe(VERDICT_MARKS.green);
  });

  it("keeps the tag off a gate that is not human approval", () => {
    const row = rowOf(withRows({ build: ["not_required", "not required by org config"] }), "build");

    expect(row).toMatchObject({ mark: "○", tag: null });
  });

  it("marks a waived row for its popover, and no other", () => {
    const page = withRows({
      physical_hil: ["waived", `waived: rig recalibration pending · ${HIL_RED}`],
    });

    expect(rowOf(page, "physical_hil")).toMatchObject({
      waived: true,
      mark: "⊘",
      evidence: `waived: rig recalibration pending · ${HIL_RED}`,
      source: "standard-fix@v14 pin",
    });
    expect(gatesCard(input(page)).rows.filter((row) => row.waived)).toHaveLength(1);
  });

  it("passes the engine's line through untouched — an absent one included", () => {
    const page = withRows({ build: ["red", null], test_suite: ["red", `  ${TESTS_RED}  `] });

    expect(rowOf(page, "build").evidence).toBeNull();
    expect(rowOf(page, "test_suite").evidence).toBe(`  ${TESTS_RED}  `);
  });
});

describe("scoping", () => {
  it("shows revision 1's two red gates rather than today's verdicts", () => {
    const card = gatesCard(input(stripPage(), 1));

    expect(card.scoped).toBe(true);
    expect(card.heading).toBe("Revision 1 · 3f9c2ae · 2 gates red");
    expect(card.rows.filter((row) => row.verdict === "red").map((row) => row.evidence)).toEqual([
      TESTS_RED,
      HIL_RED,
    ]);
  });
});

describe("where the evidence leads", () => {
  const page = stripPage();
  const scope = gatesScope(page, null)!;
  const head = page.pullRequest;

  it("routes each line by what it was composed from", () => {
    const tests = testsPath(SEEDED_RUN_ID, { from: "dashboard", attempt: 4 });

    expect(gateLink(citing("build", "build_job"), scope, head, "dashboard")).toEqual({
      label: "build farm →",
      href: BUILD_FARM_PATH,
    });
    expect(gateLink(citing("test_suite", "test_run", ATTEMPT_4_ID), scope, head, "dashboard")).toEqual(
      { label: "test results →", href: tests },
    );
    expect(gateLink(citing("physical_hil", "hil_measurement"), scope, head, "dashboard")).toEqual({
      label: "physical tests →",
      href: tests,
    });
    expect(
      gateLink(citing("diff_vs_plan", "guardrail_evaluation"), scope, head, "dashboard"),
    ).toEqual({ label: "guardrails →", href: runPath(SEEDED_RUN_ID, "dashboard") });
    expect(
      gateLink(citing("secrets_license", "guardrail_evaluation"), scope, head, "dashboard"),
    ).toEqual({ label: "guardrails →", href: runPath(SEEDED_RUN_ID, "dashboard") });
  });

  it("leads a scoped revision's lines to the attempt that revision was judged on", () => {
    const first = gatesScope(page, 1)!;

    expect(gateLink(citing("test_suite", "test_run", ATTEMPT_3_ID), first, head, "issues")?.href).toBe(
      testsPath(SEEDED_RUN_ID, { from: "issues", attempt: 3 }),
    );
  });

  it("routes a custom gate the same way — by what it cites, not by its key", () => {
    expect(gateLink(citing("custom:lint", "build_job"), scope, head, "dashboard")?.href).toBe(
      BUILD_FARM_PATH,
    );
  });

  it("draws no link where there is nowhere honest to lead", () => {
    const noLoop = { ...head, run: null };
    const noAttempt = gatesScope(
      stripPage({ revisions: [revisionOne(), revisionTwo({ testAttempt: null })] }),
      null,
    )!;

    // Nothing cited.
    expect(gateLink(gateRow("build", "green"), scope, head, "dashboard")).toBeNull();
    // A vote and an approval are answered on the row itself.
    expect(gateLink(citing("model_review", "vote"), scope, head, "dashboard")).toBeNull();
    expect(gateLink(citing("human_approval", "approval"), scope, head, "dashboard")).toBeNull();
    // No loop, so no test results and no run console.
    expect(gateLink(citing("test_suite", "test_run", ATTEMPT_4_ID), scope, noLoop, "x")).toBeNull();
    expect(gateLink(citing("physical_hil", "hil_measurement"), scope, noLoop, "x")).toBeNull();
    expect(gateLink(citing("diff_vs_plan", "guardrail_evaluation"), scope, noLoop, "x")).toBeNull();
    // The attempt is unknown, or is not the one the line cites.
    expect(gateLink(citing("test_suite", "test_run", ATTEMPT_4_ID), noAttempt, head, "x")).toBeNull();
    expect(gateLink(citing("physical_hil", "hil_measurement"), noAttempt, head, "x")).toBeNull();
    expect(gateLink(citing("test_suite", "test_run", ATTEMPT_3_ID), scope, head, "x")).toBeNull();
  });
});

describe("what the human-approval row offers", () => {
  const human = gateRow("human_approval", "not_required");

  it("offers a request while nobody is waiting, and a decision while somebody is", () => {
    expect(approvalOffer(human, input())).toBe("request");
    expect(approvalOffer(human, input(stripPage({ review: review() })))).toBe("decide");
  });

  it("reads a slot a press just opened, before the poll has", () => {
    expect(approvalOffer(human, input(stripPage(), null, { answeredReview: review() }))).toBe(
      "decide",
    );
  });

  it("reads an answer a press just gave over the page's older reading of the same slot", () => {
    const waiting = stripPage({ review: review() });
    const approved = review({ state: "approved" });

    expect(rowReview(review(), approved)).toBe(approved);
    expect(approvalOffer(human, input(waiting, null, { answeredReview: approved }))).toBeNull();
    expect(
      approvalOffer(
        gateRow("human_approval", "red"),
        input(waiting, null, { answeredReview: review({ state: "declined" }) }),
      ),
    ).toBe("request");
    expect(
      approvalOffer(
        gateRow("human_approval", "green"),
        input(waiting, null, { answeredReview: approved }),
      ),
    ).toBeNull();
    // The page's answered reading is never overruled by an older press.
    expect(rowReview(approved, review())).toBe(approved);
    // A different slot is decided by which was requested later.
    const later = review({ id: "5eed003c-0000-4000-8000-000000000002", requestedAt: "2026-09-27T15:00:00.000Z" });
    expect(rowReview(approved, later)).toBe(later);
    expect(rowReview(null, null)).toBeNull();
  });

  it("offers a request again once a review was declined, and nothing once it is green", () => {
    const declined = stripPage({ review: review({ state: "declined" }) });
    const approved = stripPage({ review: review({ state: "approved" }) });

    expect(approvalOffer(gateRow("human_approval", "red"), input(declined))).toBe("request");
    expect(approvalOffer(gateRow("human_approval", "green"), input(approved))).toBeNull();
  });

  it("offers nothing to a viewer", () => {
    const waiting = stripPage({ review: review() });

    expect(approvalOffer(human, input(waiting, null, { mayContribute: false }))).toBeNull();
    expect(approvalOffer(human, input(stripPage(), null, { mayContribute: false }))).toBeNull();
  });

  it("offers nothing on an earlier revision — an answer is honoured only on the latest", () => {
    expect(approvalOffer(human, input(stripPage({ review: review() }), 1))).toBeNull();
    // Scoped to the latest by name, it is still the latest.
    expect(approvalOffer(human, input(stripPage({ review: review() }), 2))).toBe("decide");
  });

  it("offers nothing on a merged or closed PR", () => {
    for (const state of ["merged", "closed"] as const) {
      const page = stripPage({ review: review(), pullRequest: { state } });

      expect(approvalOffer(human, input(page)), state).toBeNull();
    }
  });

  it("offers nothing on a gate that is not human approval", () => {
    expect(approvalOffer(gateRow("build", "red"), input(stripPage({ review: review() })))).toBeNull();
    expect(gateRowView(gateRow("build", "red"), input()).approval).toBeNull();
  });

  it("says what an answer did", () => {
    expect(approvalOutcome("approve")).toBe(APPROVED);
    expect(approvalOutcome("decline")).toBe(DECLINED);
    expect(declineTitle(514)).toBe("Decline the review of PR #514");
  });
});
