import { describe, expect, it } from "vitest";

import {
  EMPTY_TITLE,
  OWN_PICK_LINE,
  PICKED_LINE,
  POLICY_NOT_READ_YET,
  STEP_DONE_TAG,
  STEP_PREVIEW_TAG,
  UNRANKED_NOTE,
  YOU_ARE_HERE,
  breakdownName,
  candidateName,
  componentLine,
  estimatorStatus,
  exclusionsPhrase,
  isIssueId,
  issueNumberOf,
  nextCandidate,
  noneSafeLine,
  pickLine,
  pickedLine,
  printableFragments,
  reasoningLine,
  safetyRowText,
  safetyRows,
  scoreLine,
  sheetNote,
  shownPick,
  sizingLine,
  stepPill,
  stillSizingLine,
  totalLine,
} from "@/app/get-started/first-issue-view";
import { INBOX_PATH, POLICIES_PATH } from "@/app/paths";

import {
  FIRST_ISSUE_READ_AT,
  ISSUE_488,
  candidate,
  candidate485,
  candidate491,
  dryRunOff,
  dryRunOn,
  dryRunUnset,
  emptyFirstIssue,
  estimatorStatus as estimator,
  firstIssueCard,
  noneSafeFirstIssue,
  pickedTicket,
  priced,
  seededAlternatives,
  seededFirstIssue,
  sizingFirstIssue,
} from "../helpers/onboarding";

/**
 * The first-issue card's pure rules (#393): the reasoning rendered from the score's fragments
 * with the cost only when priced, the breakdown's lines, which pick is on screen, the next
 * candidate, the cold states' sentences with the estimator's real status, and the safety rows
 * bound to the policy as read.
 */

describe("the head's pill", () => {
  it("follows step 4 on the rail — preview ahead, you are here, done", () => {
    expect(stepPill("todo")).toEqual({ text: STEP_PREVIEW_TAG, tone: "neutral" });
    expect(stepPill("active")).toEqual({ text: YOU_ARE_HERE, tone: "accent" });
    expect(stepPill("done")).toEqual({ text: STEP_DONE_TAG, tone: "ok" });
    expect(stepPill(null)).toBeNull();
  });
});

describe("the reasoning", () => {
  it("is the score's fragments joined — the mockup's line, with no cost when the model is unpriced", () => {
    expect(reasoningLine(candidate())).toBe("no code paths touched · est. 4 min");
    expect(printableFragments(candidate()).map((fragment) => fragment.source)).toEqual(["paths", "estimate"]);
  });

  it("prints the cost only when the estimate carries one", () => {
    expect(reasoningLine(priced())).toBe("no code paths touched · est. 4 min · est. $0.03");

    // A payload whose fragments name a cost the candidate does not carry: the fragment is dropped,
    // never printed as a placeholder.
    const uncosted = candidate({ reasoning: priced().reasoning });
    expect(uncosted).not.toHaveProperty("cost");
    expect(reasoningLine(uncosted)).toBe("no code paths touched · est. 4 min");
    expect(reasoningLine(uncosted)).not.toContain("$");
  });

  it("lists every term with its points, and the total against the bar", () => {
    expect(candidate().reasoning.components.map(componentLine)).toEqual([
      "XS effort — 35 of 35",
      "docs-loop workflow — 30 of 30",
      "no code paths touched — 25 of 25",
      "active 1d ago — 9.4 of 10",
    ]);
    expect(totalLine(candidate(), seededFirstIssue())).toBe("99.4 in all under safety-v1 · safety bar 45 · clears it");
    expect(totalLine(candidate485(), seededFirstIssue())).toBe("34.9 in all under safety-v1 · safety bar 45 · below it");
    expect(breakdownName(488)).toBe("Score breakdown for #488");
    expect(candidateName(candidate491())).toBe("#491 Add CRC32 to config persistence layer");
    expect(scoreLine(candidate491())).toBe("score 49.9");
  });
});

describe("the pick on screen", () => {
  it("is the picker's suggestion while nothing is stored", () => {
    expect(shownPick(firstIssueCard(), null)).toEqual({ kind: "ranked", candidate: candidate(), stored: false });
    expect(pickLine({ kind: "ranked", candidate: candidate(), stored: false }, seededFirstIssue())).toBe(PICKED_LINE);
  });

  it("is the stored ticket, resolved to its scored candidate — the person's own when it is not the picker's", () => {
    expect(shownPick(firstIssueCard(), pickedTicket())).toEqual({ kind: "ranked", candidate: candidate(), stored: true });
    expect(pickLine({ kind: "ranked", candidate: candidate(), stored: true }, seededFirstIssue())).toBe(PICKED_LINE);

    const own = shownPick(firstIssueCard(), pickedTicket({ externalKey: "#491", title: "Add CRC32 to config persistence layer" }));
    expect(own).toEqual({ kind: "ranked", candidate: candidate491(), stored: true });
    expect(pickLine(own!, seededFirstIssue())).toBe(OWN_PICK_LINE);
  });

  it("finds the stored pick in the picker's own answer when the ranking is empty", () => {
    const card = firstIssueCard({ alternatives: seededAlternatives({ candidates: [] }) });

    expect(shownPick(card, pickedTicket())).toEqual({ kind: "ranked", candidate: candidate(), stored: true });
  });

  it("draws a stored pick nothing scored as picked by hand, without inventing reasoning", () => {
    const shown = shownPick(firstIssueCard(), pickedTicket({ externalKey: "#512", title: "Rewrite the bootloader" }));

    expect(shown).toEqual({ kind: "unranked", key: "#512", title: "Rewrite the bootloader" });
    expect(pickLine(shown!, seededFirstIssue())).toBe(OWN_PICK_LINE);
    expect(UNRANKED_NOTE).toMatch(/no reasoning/);
    expect(shownPick(null, pickedTicket())).toEqual({ kind: "unranked", key: "#488", title: pickedTicket().title });
  });

  it("is nothing while the backlog has no pick and nothing is stored", () => {
    expect(shownPick(firstIssueCard({ firstIssue: sizingFirstIssue() }), null)).toBeNull();
    expect(shownPick(null, null)).toBeNull();
  });

  it("reads an issue number from a GitHub ticket's key, and nothing from any other", () => {
    expect(issueNumberOf("#488")).toBe(488);
    expect(issueNumberOf("PROJ-12")).toBeNull();
    expect(issueNumberOf("#")).toBeNull();
  });

  it("knows the picker's id grammar", () => {
    expect(isIssueId(ISSUE_488)).toBe(true);
    expect(isIssueId("issue-488")).toBe(false);
    expect(isIssueId(488)).toBe(false);
  });
});

describe("↻ another", () => {
  it("is the next candidate in safety order, wrapping round, and nothing when the ranking holds nothing else", () => {
    const { candidates } = seededAlternatives();

    expect(nextCandidate(candidates, 488)).toEqual(candidate491());
    expect(nextCandidate(candidates, 491)).toEqual(candidate485());
    expect(nextCandidate(candidates, 485)).toEqual(candidate());
    expect(nextCandidate(candidates, null)).toEqual(candidate());
    expect(nextCandidate(candidates, 512)).toEqual(candidate());
    expect(nextCandidate([candidate()], 488)).toBeNull();
    expect(nextCandidate([], null)).toBeNull();
  });

  it("says what a stored pick means for the launch", () => {
    expect(pickedLine(candidate491())).toBe("#491 picked. Run your first loop when you're ready.");
  });
});

describe("the cold states", () => {
  it("say the real counts while sizing, with the nightly estimator's status", () => {
    expect(sizingLine(sizingFirstIssue().backlog)).toBe(
      "3 open issues, none sized yet — the nightly estimator sizes them, and the safest sized one is picked.",
    );
    expect(sizingLine({ open: 1, sized: 0, sizing: 1, needsHuman: 0 })).toMatch(/^1 open issue, /);
    expect(estimatorStatus(estimator(), new Date(FIRST_ISSUE_READ_AT))).toBe(
      "Nightly estimator: last run 10h ago ✓ — 4 found here, 4 queued, 0 in flight · runs nightly at 02:00 UTC, up to 200 issues.",
    );
    expect(estimatorStatus(estimator({ lastRun: null }), new Date(FIRST_ISSUE_READ_AT))).toBe(
      "Nightly estimator: not run yet · runs nightly at 02:00 UTC, up to 200 issues.",
    );
  });

  it("point an empty backlog at planning", () => {
    expect(emptyFirstIssue().planning).toEqual({ path: "/planning" });
    expect(EMPTY_TITLE).toBe("No open issues to pick from");
  });

  it("state plainly what was set aside when nothing is safe enough", () => {
    expect(noneSafeLine(noneSafeFirstIssue())).toBe(
      "Of 3 sized issues, 1 touches a protected path, 1 is L or larger, 1 scored below the safety bar.",
    );
    expect(stillSizingLine(noneSafeFirstIssue().backlog)).toBe("1 more is still being sized.");
    expect(stillSizingLine({ open: 4, sized: 2, sizing: 2, needsHuman: 0 })).toBe("2 more are still being sized.");
    expect(stillSizingLine(seededFirstIssue({ backlog: { open: 1, sized: 1, sizing: 0, needsHuman: 0 } }).backlog)).toBeNull();
    expect(exclusionsPhrase({ protectedPath: 2, tooLarge: 2, belowBar: 0 })).toBe("2 touch a protected path, 2 are L or larger");
    expect(exclusionsPhrase({ protectedPath: 0, tooLarge: 0, belowBar: 0 })).toBeNull();
    expect(noneSafeLine(seededFirstIssue({ backlog: { open: 1, sized: 1, sizing: 0, needsHuman: 0 }, excluded: { protectedPath: 0, tooLarge: 0, belowBar: 0 } }))).toBe(
      "Of 1 sized issue, none qualifies.",
    );
  });
});

describe("the sheet's note", () => {
  it("names the weights, the bar, and what was disqualified — never the below-bar count, which the rows show", () => {
    expect(sheetNote(seededAlternatives())).toBe(
      "Safest first under safety-v1, each with its own reasoning; the safety bar is 45. 2 set aside: 2 are L or larger.",
    );
    expect(sheetNote(seededAlternatives({ excluded: { protectedPath: 0, tooLarge: 0, belowBar: 3 } }))).toBe(
      "Safest first under safety-v1, each with its own reasoning; the safety bar is 45.",
    );
  });
});

describe("the safety rows", () => {
  it("read dry-run on as the draft promise, with a link to the policy", () => {
    const [dryRun, inbox, policy] = safetyRows({ ok: true, value: dryRunOn() });

    expect(dryRun!.mark).toBe("ok");
    expect(safetyRowText(dryRun!)).toBe("Dry-run: opens a draft PR, never merges (policy)");
    expect(dryRun!.segments).toContainEqual({ kind: "term", text: "draft" });
    expect(dryRun!.segments).toContainEqual({ kind: "link", text: "policy", href: POLICIES_PATH });

    expect(inbox!.mark).toBe("ok");
    expect(safetyRowText(inbox!)).toBe("Decisions that need you wait in the Needs-you inbox.");
    expect(inbox!.segments).toContainEqual({ kind: "link", text: "Needs-you inbox", href: INBOX_PATH });

    expect(policy!.mark).toBe("ok");
    expect(safetyRowText(policy!)).toBe("Flip to auto-merge whenever you're ready — Settings → Policies");
    expect(policy!.segments).toContainEqual({ kind: "link", text: "Settings → Policies", href: POLICIES_PATH });
  });

  it("read dry-run off as not holding — the row says what will merge, and where to turn it on", () => {
    const [dryRun, , policy] = safetyRows({ ok: true, value: dryRunOff() });

    expect(dryRun!.mark).toBe("warn");
    expect(safetyRowText(dryRun!)).toBe(
      "Dry-run is off: PRs open ready for review, and a workflow that auto-merges will merge without a person — turn it on in Settings → Policies",
    );
    expect(dryRun!.segments.some((segment) => segment.kind === "term")).toBe(false);
    expect(safetyRowText(policy!)).toBe("Turn dry-run back on any time — Settings → Policies");
  });

  it("read a workspace that never answered as pending — the launch turns dry-run on", () => {
    const [dryRun] = safetyRows({ ok: true, value: dryRunUnset() });

    expect(dryRun!.mark).toBe("pending");
    expect(safetyRowText(dryRun!)).toBe(
      "Dry-run is not set yet — running your first loop turns it on, so the PR opens as a draft and never merges (policy)",
    );
    expect(dryRun!.mechanism).toMatch(/#388/);
  });

  it("say so when the policy could not be read, or was not read yet — never guessing", () => {
    const [unread] = safetyRows({ ok: false, reason: "The service is busy." });
    const [none] = safetyRows(null);

    expect(unread!.mark).toBe("unknown");
    expect(safetyRowText(unread!)).toBe("The dry-run policy could not be read. The service is busy. (policy)");
    expect(none!.mark).toBe("unknown");
    expect(safetyRowText(none!)).toBe(`${POLICY_NOT_READ_YET} (policy)`);
  });

  it("name the mechanism behind every row, so the words cannot widen without it", () => {
    for (const row of safetyRows({ ok: true, value: dryRunOn() })) expect(row.mechanism).toMatch(/#\d{3}/);
  });
});
