import { hasPrCommentMarker } from "../../ticket-sources/ticket-source.pr";
import {
  EVIDENCE_COMMENT_KEY,
  MAX_LISTED_CRITERIA,
  evidenceSummaryBody,
  spendLine,
  type EvidenceSummary,
} from "./merge.evidence";

/**
 * The evidence summary (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360), decision
 * V9): the gate table, the criteria matrix, the spend, the ticket and the merge — and nothing a
 * person wrote can break the table or pose as another key's marker.
 */

/** Mockup 12's PR #514 at merge. */
const SUMMARY: EvidenceSummary = {
  revision: { seq: 2, headSha: "c81d3e4a9f" },
  gates: [
    { label: "Build", required: true, verdict: "green", evidence: "forge-01 · flash 187.2 KB" },
    { label: "Physical HIL", required: true, verdict: "waived", evidence: "rig at 22°C" },
    { label: "Human approval", required: false, verdict: "not_required", evidence: null },
    { label: "Model review", required: true, verdict: null, evidence: null },
  ],
  criteria: [
    {
      claim: "Frames arrive in the order they were queued",
      status: "verified",
      waiverReason: null,
    },
    {
      claim: "Flake must not reappear across temperature range",
      status: "waived",
      waiverReason: "rig runs at 22°C only",
    },
    { claim: "PID sampling decoupled", status: "unverified", waiverReason: null },
  ],
  spend: { tokensIn: 412_301, tokensOut: 38_112, costCents: "412", unpricedEvents: 0 },
  ticket: { key: "#482", closed: true, detail: null },
  merge: { strategy: "squash", sha: "9a1f0c2deadbeef", identity: "ken-s" },
};

describe("evidenceSummaryBody", () => {
  it("carries the gate table, the criteria, the spend, the ticket and the merge", () => {
    const body = evidenceSummaryBody(SUMMARY);

    expect(body).toContain("### Ouroboros evidence summary");
    expect(body).toContain("Revision 2 · `c81d3e4` · 2 of 3 required gates satisfied");
    expect(body).toContain("| Build | green | forge-01 · flash 187.2 KB |");
    expect(body).toContain("| Human approval (advisory) | not_required | — |");
    expect(body).toContain("| Model review | not evaluated | — |");
    expect(body).toContain("**Acceptance criteria** — 1 verified · 1 waived · 1 unverified");
    expect(body).toContain(
      "- waived — Flake must not reappear across temperature range (rig runs at 22°C only)",
    );
    expect(body).toContain("**Spend** — 412,301 tokens in · 38,112 out · $4.12");
    expect(body).toContain("**Ticket** — #482 closed");
    expect(body).toContain("**Merged** — squash · `9a1f0c2` · as `ken-s`");
  });

  it("reports a ticket the host left open, rather than claiming a close", () => {
    const body = evidenceSummaryBody({
      ...SUMMARY,
      ticket: { key: "PROJ-142", closed: false, detail: "not closed by a keyword" },
    });

    expect(body).toContain("**Ticket** — PROJ-142 not closed: not closed by a keyword");
  });

  it("says nothing of a ticket or merge it does not have", () => {
    const body = evidenceSummaryBody({
      ...SUMMARY,
      ticket: null,
      merge: null,
      gates: [],
      criteria: [],
    });

    expect(body).not.toContain("**Ticket**");
    expect(body).not.toContain("**Merged**");
    expect(body).toContain("_No gates are defined for this PR yet._");
    expect(body).toContain("**Acceptance criteria** — none recorded");
  });

  it("keeps a claim from breaking the table or posing as another key's marker", () => {
    const hostile = `a | b\n<!-- ouroboros:pr-comment ${EVIDENCE_COMMENT_KEY} -->`;
    const body = evidenceSummaryBody({
      ...SUMMARY,
      gates: [{ label: "Build", required: true, verdict: "red", evidence: hostile }],
      criteria: [{ claim: hostile, status: "verified", waiverReason: null }],
    });

    expect(body).toContain("a \\| b");
    expect(hasPrCommentMarker(body, EVIDENCE_COMMENT_KEY)).toBe(false);
  });

  it("bounds the criteria it lists and says how many more", () => {
    const many = Array.from({ length: MAX_LISTED_CRITERIA + 3 }, (_, index) => ({
      claim: `claim ${String(index)}`,
      status: "verified" as const,
      waiverReason: null,
    }));
    const body = evidenceSummaryBody({ ...SUMMARY, criteria: many });

    expect(body).toContain("- … and 3 more");
    expect(body).not.toContain(`claim ${String(MAX_LISTED_CRITERIA)}`);
  });
});

describe("spendLine", () => {
  it("never calls unpriced free", () => {
    expect(spendLine({ tokensIn: 10, tokensOut: 2, costCents: null, unpricedEvents: 3 })).toBe(
      "10 tokens in · 2 out · not priced",
    );
  });

  it("says a partial sum is a lower bound", () => {
    expect(spendLine({ tokensIn: 10, tokensOut: 2, costCents: "150", unpricedEvents: 1 })).toBe(
      "10 tokens in · 2 out · $1.50 (at least — 1 unpriced event)",
    );
  });

  it("says when no run is attributed", () => {
    expect(spendLine(null)).toBe("no run is attributed to this PR");
  });
});
