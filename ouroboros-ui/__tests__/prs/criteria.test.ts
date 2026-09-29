import { describe, expect, it } from "vitest";

import type { PrCriterionWaived } from "@/app/api/pull-requests";
import { prEvidencePath } from "@/app/paths";
import {
  ANNOTATED,
  ANNOTATION_FAILED_NOTE,
  ANNOTATION_PENDING_NOTE,
  type CriteriaCardInput,
  FILES_ID,
  SOURCES,
  UNVERIFIED_PILL,
  VERIFIED_PILL,
  VERIFY_NEEDS_EVIDENCE,
  WAIVED_ANNOTATED_PILL,
  WAIVED_FAILED_PILL,
  WAIVED_PENDING_PILL,
  WAIVE_AGAIN_LABEL,
  WAIVE_LABEL,
  countsLine,
  criteriaCard,
  criteriaIntro,
  criterionRow,
  evidenceTarget,
  importOutcome,
  revisionLine,
  standing,
  statusView,
  waiveOutcome,
  withLocal,
} from "@/app/prs/criteria";
import { artifactUrl } from "@/app/test-results/artifacts";

import {
  PR_514_ID,
  REV_2_ID,
  TELEMETRY_PATH,
  THERMAL_REASON,
  TICKET_URL,
  WAIVE_COMMENT_URL,
  criterion,
  criterionId,
  evidence,
  evidenceId,
  matrix,
  matrixPage,
  mockupCriteria,
  waiver,
} from "../helpers/pull-requests";

/**
 * The acceptance criteria matrix as data (#366): where each evidence line leads, what each pill
 * says, what a reader of each role is offered, and how an answer stands until a read catches up.
 */

/**
 * What the card is decided from.
 *
 * @param over What to change.
 * @returns An owner's input over mockup 12's page, changed.
 */
function input(over: Partial<CriteriaCardInput> = {}): CriteriaCardInput {
  const page = over.page ?? matrixPage();

  return {
    page,
    criteria: page.criteria.criteria,
    mayContribute: true,
    mayWaive: true,
    originId: "dashboard",
    search: "?from=dashboard",
    ...over,
  };
}

describe("where an evidence line leads", () => {
  const [first, second, third] = mockupCriteria();

  it("leads a test to its resolver address, carrying where the page was opened from", () => {
    expect(evidenceTarget(first!.evidence[0]!, input())).toEqual({
      kind: "link",
      href: prEvidencePath(PR_514_ID, evidenceId(1), "dashboard"),
    });
  });

  it("leads a measurement to its resolver address", () => {
    expect(evidenceTarget(second!.evidence[0]!, input())).toEqual({
      kind: "link",
      href: prEvidencePath(PR_514_ID, evidenceId(3), "dashboard"),
    });
  });

  it("leads a hunk to this page's changed files, at the range, keeping the query", () => {
    const target = evidenceTarget(first!.evidence[1]!, input({ search: "?from=dashboard&rev=1" }));

    expect(target).toMatchObject({
      kind: "hunk",
      hunk: { path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 },
      where: `${TELEMETRY_PATH} · lines 41–66 · revision 2 · b7e41d0`,
    });

    const href = (target as { href: string }).href;
    const [query, hash] = href.split("#");

    expect(hash).toBe(FILES_ID);
    expect(new URLSearchParams(query).get("hunk")).toBe(`${TELEMETRY_PATH}:41-66`);
    expect(new URLSearchParams(query).get("rev")).toBe("1");
    expect(new URLSearchParams(query).get("from")).toBe("dashboard");
  });

  it("opens an analysis note in place, naming the revision it was read on", () => {
    expect(evidenceTarget(third!.evidence[0]!, input())).toEqual({
      kind: "note",
      readOn: "revision 2 · b7e41d0",
    });
    expect(evidenceTarget(evidence(), input())).toEqual({ kind: "note", readOn: null });
  });

  it("leads an artifact to its file", () => {
    const cited = evidence({ kind: "build_artifact", ref: { testArtifactId: "art-1" } });

    expect(evidenceTarget(cited, input())).toEqual({ kind: "link", href: artifactUrl("art-1") });
  });

  it("leads a test or a measurement nowhere on a PR no loop opened", () => {
    const page = matrixPage({ pullRequest: { run: null } });

    expect(evidenceTarget(first!.evidence[0]!, input({ page }))).toEqual({ kind: "none" });
    expect(evidenceTarget(second!.evidence[0]!, input({ page }))).toEqual({ kind: "none" });
  });

  it("leads nowhere from a reference that lacks what its kind requires", () => {
    expect(evidenceTarget(evidence({ kind: "test_case" }), input())).toEqual({ kind: "none" });
    expect(evidenceTarget(evidence({ kind: "hil_measurement" }), input())).toEqual({
      kind: "none",
    });
    expect(evidenceTarget(evidence({ kind: "build_artifact" }), input())).toEqual({
      kind: "none",
    });
    expect(
      evidenceTarget(evidence({ kind: "hunk", ref: { path: "a.c", lineStart: 9, lineEnd: 3 } }), input()),
    ).toEqual({ kind: "none" });
  });

  it("names no revision the PR does not have", () => {
    expect(revisionLine(matrixPage().revisions, REV_2_ID)).toBe("revision 2 · b7e41d0");
    expect(revisionLine(matrixPage().revisions, "unknown")).toBeNull();
    expect(revisionLine(matrixPage().revisions, null)).toBeNull();
  });
});

describe("the status pill", () => {
  it("says verified in words, in the ok tone", () => {
    expect(statusView(criterion({ status: "verified" }))).toMatchObject({
      label: VERIFIED_PILL,
      tone: "ok",
      href: null,
      note: null,
    });
  });

  it("draws unverified as a ring, so it differs from its neighbours by more than hue", () => {
    expect(statusView(criterion())).toMatchObject({
      label: UNVERIFIED_PILL,
      tone: "neutral",
      dot: "ring",
    });
  });

  it("links a waived claim to the host comment its waive posted", () => {
    expect(statusView(criterion({ status: "waived", waiver: waiver() }))).toMatchObject({
      label: WAIVED_ANNOTATED_PILL,
      tone: "warn",
      href: WAIVE_COMMENT_URL,
      note: null,
    });
  });

  it("draws no link when the host held the comment and did not say where", () => {
    const view = statusView(criterion({ status: "waived", waiver: waiver({ url: null }) }));

    expect(view.label).toBe(WAIVED_ANNOTATED_PILL);
    expect(view.href).toBeNull();
  });

  it("says when the host refused the annotation, and names the retry", () => {
    const refused = waiver({ state: "failed", url: null, commentId: null, annotatedAt: null });

    expect(statusView(criterion({ status: "waived", waiver: refused }))).toMatchObject({
      label: WAIVED_FAILED_PILL,
      href: null,
      note: ANNOTATION_FAILED_NOTE,
    });
  });

  it("says when nothing has tried to annotate — and never claims an annotation", () => {
    const pending = waiver({ state: "pending_pr_plane", url: null, commentId: null });

    expect(statusView(criterion({ status: "waived", waiver: pending }))).toMatchObject({
      label: WAIVED_PENDING_PILL,
      note: ANNOTATION_PENDING_NOTE,
    });
    expect(statusView(criterion({ status: "waived", waiver: null })).label).toBe(
      WAIVED_PENDING_PILL,
    );
  });
});

describe("a row", () => {
  it("labels each provenance, and extracted as reserved", () => {
    expect(criterionRow(criterion({ source: "manual" }), input()).source.label).toBe("manual");
    expect(criterionRow(criterion({ source: "plan" }), input()).source.label).toBe("plan");
    expect(criterionRow(criterion({ source: "extracted" }), input()).source).toEqual(
      SOURCES.extracted,
    );
    expect(SOURCES.extracted.reserved).toBe(true);
    expect(SOURCES.extracted.label).toContain("reserved");
    expect(SOURCES.extracted.title).toContain("#372");
  });

  it("draws the waiver's reason as the waived row's own line", () => {
    const row = criterionRow(mockupCriteria()[4]!, input());

    expect(row.waiverReason).toBe(THERMAL_REASON);
    expect(row.evidence).toEqual([]);
  });

  it("offers Verify inert, with the reason, while nothing is cited", () => {
    expect(criterionRow(criterion(), input()).verify).toEqual({ reason: VERIFY_NEEDS_EVIDENCE });
  });

  it("offers Verify once evidence is attached", () => {
    const cited = criterion({ evidence: [evidence()] });

    expect(criterionRow(cited, input()).verify).toEqual({ reason: undefined });
  });

  it("offers no Verify on a claim that is verified or waived", () => {
    expect(criterionRow(criterion({ status: "verified", evidence: [evidence()] }), input()).verify)
      .toBeNull();
    expect(criterionRow(criterion({ status: "waived", waiver: waiver() }), input()).verify)
      .toBeNull();
  });

  it("offers Waive to a reader who may waive — again on a waived claim", () => {
    expect(criterionRow(criterion(), input()).waive).toBe(WAIVE_LABEL);
    expect(criterionRow(criterion({ status: "waived", waiver: waiver() }), input()).waive).toBe(
      WAIVE_AGAIN_LABEL,
    );
  });

  it("offers a member everything but Waive", () => {
    const row = criterionRow(criterion(), input({ mayWaive: false }));

    expect(row.attach).toBe(true);
    expect(row.verify).not.toBeNull();
    expect(row.waive).toBeNull();
  });

  it("offers a viewer nothing", () => {
    const row = criterionRow(criterion(), input({ mayContribute: false, mayWaive: false }));

    expect(row.attach).toBe(false);
    expect(row.verify).toBeNull();
    expect(row.waive).toBeNull();
  });
});

describe("the card", () => {
  it("links the ticket and names it in the sentence beneath the head", () => {
    const card = criteriaCard(input());

    expect(card.ticket).toEqual({ label: "Issue #482 →", href: TICKET_URL });
    expect(card.intro).toBe(
      "Each claim from issue #482 is mapped to concrete evidence in this PR.",
    );
  });

  it("draws no ticket link on a PR with no ticket", () => {
    const card = criteriaCard(input({ page: matrixPage({ pullRequest: { ticket: null } }) }));

    expect(card.ticket).toBeNull();
    expect(card.intro).toBe(criteriaIntro(null));
  });

  it("draws the rows in the matrix's order and counts them", () => {
    const card = criteriaCard(input());

    expect(card.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5].map(criterionId));
    expect(card.counts).toBe("4 verified · 1 waived · 0 unverified");
    expect(countsLine([])).toBeNull();
  });

  it("offers Import from plan only when the payload says there is a plan", () => {
    const without = matrixPage();
    const withPlan = matrixPage({ criteria: matrix(mockupCriteria(), true) });

    expect(criteriaCard(input({ page: without })).importPlan).toBe(false);
    expect(criteriaCard(input({ page: withPlan })).importPlan).toBe(true);
  });

  it("offers a viewer neither Add claim nor Import from plan, whatever the plan", () => {
    const page = matrixPage({ criteria: matrix(mockupCriteria(), true) });
    const card = criteriaCard(input({ page, mayContribute: false, mayWaive: false }));

    expect(card.addClaim).toBe(false);
    expect(card.importPlan).toBe(false);
  });
});

describe("a finished PR (#370)", () => {
  it("is offered no authoring, whoever is reading — the matrix is what was claimed and shown", () => {
    for (const state of ["merged", "closed"] as const) {
      const base = matrixPage();
      const page = matrixPage({
        pullRequest: { state },
        criteria: { ...base.criteria, planContext: true },
      });
      const card = criteriaCard(input({ page }));

      expect(card.addClaim, state).toBe(false);
      expect(card.importPlan, state).toBe(false);
      expect(card.rows.length, state).toBeGreaterThan(0);
      for (const row of card.rows) {
        expect(row.attach, `${state} ${row.claim}`).toBe(false);
        expect(row.verify, `${state} ${row.claim}`).toBeNull();
        expect(row.waive, `${state} ${row.claim}`).toBeNull();
      }
    }
  });

  it("keeps every claim, its evidence and its pill on screen", () => {
    const open = criteriaCard(input());
    const merged = criteriaCard(input({ page: matrixPage({ pullRequest: { state: "merged" } }) }));

    expect(merged.counts).toBe(open.counts);
    expect(merged.rows.map((row) => [row.claim, row.status, row.evidence])).toEqual(
      open.rows.map((row) => [row.claim, row.status, row.evidence]),
    );
  });

  it("is offered everything again while the PR is open, in every open state", () => {
    for (const state of ["open", "verifying", "blocked", "armed"] as const) {
      const card = criteriaCard(input({ page: matrixPage({ pullRequest: { state } }) }));

      expect(card.addClaim, state).toBe(true);
      expect(card.rows.every((row) => row.attach && row.waive !== null), state).toBe(true);
    }
  });
});

describe("what this page just changed", () => {
  const polled = matrix([criterion(), criterion({ id: criterionId(2), sortOrder: 2 })]);
  const verified = criterion({ status: "verified", evidence: [evidence()] });
  const added = criterion({ id: criterionId(3), claim: "A new claim", sortOrder: 3 });

  it("replaces a row with its answer, and keeps the matrix's order", () => {
    const rows = withLocal(polled, [{ criterion: verified, at: 100 }], null);

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [criterionId(1), "verified"],
      [criterionId(2), "unverified"],
    ]);
  });

  it("draws a claim just added after the matrix's rows", () => {
    const rows = withLocal(polled, [{ criterion: added, at: 100 }], 50);

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3].map(criterionId));
  });

  it("keeps the newest of two answers about one claim", () => {
    const waived = criterion({ status: "waived", waiver: waiver() });
    const rows = withLocal(
      polled,
      [
        { criterion: verified, at: 100 },
        { criterion: waived, at: 200 },
      ],
      null,
    );

    expect(rows[0]!.status).toBe("waived");
  });

  it("gives way to a read made after the answer", () => {
    const locals = [{ criterion: verified, at: 100 }];

    expect(standing(locals, 99)).toEqual(locals);
    expect(standing(locals, 100)).toEqual(locals);
    expect(standing(locals, 101)).toEqual([]);
    expect(withLocal(polled, locals, 101)[0]!.status).toBe("unverified");
  });
});

describe("what an answer did", () => {
  it("says what an import wrote, skipped and could not write", () => {
    expect(
      importOutcome({
        draftId: "d",
        imported: [criterion(), criterion({ id: criterionId(2) })],
        alreadyPresent: ["x"],
        tooLong: ["y"],
      }),
    ).toEqual({
      text: "Imported 2 claims from the plan · 1 already present · 1 too long to be a claim.",
      failed: false,
    });
    expect(
      importOutcome({ draftId: "d", imported: [criterion()], alreadyPresent: [], tooLong: [] }).text,
    ).toBe("Imported 1 claim from the plan.");
  });

  it("says so when a repeated import wrote nothing new", () => {
    expect(
      importOutcome({ draftId: "d", imported: [], alreadyPresent: ["x", "y"], tooLong: [] }).text,
    ).toBe("Nothing new to import from the plan · 2 already present.");
  });

  /**
   * A waive's answer.
   *
   * @param annotation What the host did.
   * @returns The answer.
   */
  function waived(annotation: PrCriterionWaived["annotation"]): PrCriterionWaived {
    return { criterion: criterion({ status: "waived", waiver: waiver() }), annotation };
  }

  it("says a comment was posted on the first waive", () => {
    expect(waiveOutcome(waived({ state: "annotated", mode: "created", error: null }))).toEqual({
      text: ANNOTATED.created,
      failed: false,
    });
  });

  it("says no second comment was posted on a waive again", () => {
    const edited = waiveOutcome(waived({ state: "annotated", mode: "edited", error: null }));
    const unchanged = waiveOutcome(waived({ state: "annotated", mode: "unchanged", error: null }));

    expect(edited.text).toContain("no second comment");
    expect(unchanged.text).toContain("no second comment");
    expect(edited.failed).toBe(false);
  });

  it("says the claim is waived and the PR is not annotated, in the host's words", () => {
    const outcome = waiveOutcome(
      waived({
        state: "failed",
        mode: null,
        error: { code: "host_permission", message: "the token cannot comment on this repository" },
      }),
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain("the token cannot comment on this repository");
    expect(outcome.text).toContain("Waiving again retries it");
  });

  it("still says so when the host gave no reason", () => {
    const outcome = waiveOutcome(waived({ state: "failed", mode: null, error: null }));

    expect(outcome.failed).toBe(true);
    expect(outcome.text).toContain("the host gave no reason");
  });
});
