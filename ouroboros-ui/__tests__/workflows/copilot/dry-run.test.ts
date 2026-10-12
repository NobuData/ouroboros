import { describe, expect, it } from "vitest";

import {
  ADVISORY_REASON,
  BUSY_REASON,
  CONTROL_ROLE_REASON,
  type CardState,
  DIFF_HEADLINE,
  type DryRunStreamEvent,
  IN_FLIGHT_REASON,
  LLM_LABEL,
  NO_STAGES_REASON,
  QUEUED_NOTE,
  REFUSED_HEADING,
  RUNNING_MARK,
  SIMULATED_PILL,
  SUGGESTION_ROLE_REASON,
  VERDICT_MARKS,
  adoptBoard,
  appliedNotice,
  applyPreview,
  applyReason,
  basisFacts,
  BUDGET_ADVICE_DRAFT_GUARD,
  BUDGET_ADVICE_FALLBACK,
  BUDGET_ADVICE_WORKSPACE_CAP,
  budgetAdvice,
  budgetLine,
  budgetSpentLine,
  bytesOf,
  cancelReason,
  cardReducer,
  confidenceText,
  diffLines,
  diffSummary,
  dryRunTitle,
  elapsedLine,
  estimateNote,
  factValue,
  factsOf,
  groupSuggestions,
  guardLine,
  historyLine,
  ignoreReason,
  isLive,
  latestProposal,
  matchCandidate,
  nextRevisionLine,
  openCard,
  overlayDiff,
  proposalLine,
  refusalFollowUp,
  refusalHeading,
  refusalRereads,
  rerunHint,
  resolvedLine,
  resultRows,
  ruleLine,
  runAnnouncement,
  runOutcome,
  shownAudit,
  sourceLine,
  startReason,
  suggestionRest,
  totalsParts,
  touchedStages,
  truncationLine,
} from "@/app/workflows/copilot/dry-run";

import {
  ADVISORY_SUGGESTION,
  BUILD_FORMULA_SUMMARY,
  BUILD_NOTE,
  CANDIDATE_490,
  DRY_RUN_ID,
  INSUFFICIENT_ESTIMATE,
  LLM_SUGGESTION,
  buildEstimate,
  dryRunCandidate,
  dryRunStage,
  dryRunSuggestion,
  emptyBoard,
  runningDryRun,
  seededBoard,
  seededDiff,
  seededDryRun,
  seededExplanation,
  seededHistory,
  seededMessages,
  seededStages,
  seededSuggestions,
} from "../../helpers/workflow-copilot";

/**
 * Every judgement the dry-run card makes (CE.4, #568), on small values: the marks, the totals,
 * a replayed row's provenance and its honest absence, which end a run reached, the diff's
 * summary and truncation, what an Apply will do before it does it, why a control cannot act, and
 * the fold over a run's stream — in order, duplicated and out of order.
 */

describe("the head", () => {
  it("titles the card for the run's ticket, and plainly before any run", () => {
    expect(dryRunTitle(null)).toBe("Dry run");
    expect(dryRunTitle(seededDryRun().ticket)).toBe("Dry run — #489 CAN arbitration-lost storm under full telemetry load");
  });

  it("keeps the pill verbatim", () => {
    expect(SIMULATED_PILL).toBe("simulated — no writes · no PRs · no merges");
  });

  it("draws the wall time and the cost — and no cost at all for an unpriced run, never a zero", () => {
    expect(totalsParts({ durationMs: 161_000, costCents: 31, tokens: 131_200 }).join(" · ")).toBe("2m 41s · $0.31");
    expect(totalsParts({ durationMs: 161_000, costCents: null, tokens: null })).toEqual(["2m 41s"]);
    expect(totalsParts({ durationMs: null, costCents: null, tokens: null })).toEqual([]);
    expect(totalsParts({ durationMs: 45_000, costCents: 0, tokens: 1 })).toEqual(["45s", "$0.00"]);
  });

  it("counts a run in flight from its start, and never backwards", () => {
    const started = "2026-09-13T15:05:00.000Z";

    expect(elapsedLine("running", started, Date.parse(started) + 72_000)).toBe("running · 1m 12s");
    expect(elapsedLine("precheck", started, Date.parse(started) + 4_000)).toBe("checking the draft · 4s");
    expect(elapsedLine("running", started, Date.parse(started) - 5_000)).toBe("running · 0s");
  });

  it("knows the two statuses a run has before it ends", () => {
    expect(["precheck", "running", "complete", "failed", "budget_stopped", "cancelled"].filter((status) => isLive(status as never))).toEqual([
      "precheck",
      "running",
    ]);
  });
});

describe("the rows", () => {
  it("marks each verdict: ✓ ok, ⏸ skipped, ○ not reached, ✕ failed", () => {
    expect(VERDICT_MARKS.ok).toMatchObject({ glyph: "✓", tone: "ok" });
    expect(VERDICT_MARKS.skipped).toMatchObject({ glyph: "⏸", tone: "warn" });
    expect(VERDICT_MARKS.not_reached).toMatchObject({ glyph: "○", tone: "idle" });
    expect(VERDICT_MARKS.failed).toMatchObject({ glyph: "✕", tone: "err" });
  });

  it("composes the seeded seven, with the service's `how` label and note on each, verbatim", () => {
    const rows = resultRows(seededStages());

    expect(rows.map((row) => [row.mark.glyph, row.name, row.how, row.note])).toEqual([
      ["✓", "analyze", null, "mapped 4 files · advisory DB skipped (no CVE on this issue)"],
      ["✓", "plan", null, "3 steps · would touch drivers/can/arbitration.c"],
      ["✓", "implement", "simulated", "diff drafted +41 −9 (below) · 84k tokens"],
      ["✓", "build", "replayed from history", BUILD_NOTE],
      ["⏸", "exploit-verify", "skipped", "no PoC exists: stage had nothing to do"],
      ["✓", "review ×2", null, "both approve · 1 style nit"],
      ["○", "open PR", null, "would open DRAFT PR · not merged (policy)"],
    ]);
    expect(rows.filter((row) => row.warn).map((row) => row.name)).toEqual(["exploit-verify"]);
    expect(rows.filter((row) => row.estimate !== null).map((row) => row.name)).toEqual(["build"]);
  });

  it("orders by `seq` whatever order the stages arrive in", () => {
    const rows = resultRows([...seededStages()].reverse());

    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("draws a started stage as running, in its place, and drops it once the stage has finished", () => {
    const started = [{ seq: 4, stageKey: "build", displayName: "build" }];
    const running = resultRows(seededStages().slice(0, 3), started);

    expect(running).toHaveLength(4);
    expect(running[3]).toMatchObject({ name: "build", running: true, mark: RUNNING_MARK, how: null, estimate: null });

    expect(resultRows(seededStages().slice(0, 4), started).filter((row) => row.running)).toEqual([]);
  });
});

describe("a replayed row's provenance", () => {
  it("states the estimate with its sample, spread, window and formula", () => {
    const note = estimateNote(buildEstimate());

    expect(note.estimated).toBe(true);
    expect(note.facts).toEqual([
      { term: "estimate", value: "3m 42s" },
      { term: "sample", value: "n = 217" },
      { term: "spread", value: "± 22s" },
      { term: "window", value: "30-day window" },
    ]);
    expect(note.formula).toBe(`formula build_duration_replay v1 — ${BUILD_FORMULA_SUMMARY}`);
    expect(note.lead).toMatch(/not a measurement/);
  });

  it("says there was not enough history — with no number anywhere", () => {
    const note = estimateNote(INSUFFICIENT_ESTIMATE);

    expect(note.estimated).toBe(false);
    expect(note.lead).toBe("Not enough history: 12 similar builds in the last 30 days, 20 needed.");
    expect(note.facts).toEqual([]);
    expect(note.lead).not.toMatch(/\d+m|\d+s\b|±/);
  });

  it("counts test runs as runs, and one of anything in the singular", () => {
    const test = { id: "test_duration_replay" as const, version: 2, summary: "s" };

    expect(estimateNote({ ...INSUFFICIENT_ESTIMATE, formula: test }).lead).toBe(
      "Not enough history: 12 similar runs in the last 30 days, 20 needed.",
    );
    expect(estimateNote({ ...INSUFFICIENT_ESTIMATE, sampleCount: 1 }).lead).toMatch(/1 similar build in/);
  });

  it("draws no formula line when the service could not tell which applies — it never guesses one", () => {
    expect(estimateNote(buildEstimate({ formula: null })).formula).toBeNull();
    expect(estimateNote(buildEstimate({ formula: null })).facts).toHaveLength(4);
    expect(estimateNote({ ...INSUFFICIENT_ESTIMATE, formula: null }).lead).toMatch(/12 similar runs/);
  });

  it("treats an estimate that carries no number as insufficient, whatever its status says", () => {
    expect(estimateNote(buildEstimate({ estimateMs: null })).estimated).toBe(false);
  });
});

describe("which end a run reached", () => {
  it("names each status as its own state", () => {
    expect(runOutcome(seededDryRun())).toBe("complete");
    expect(runOutcome(runningDryRun())).toBe("running");
    expect(runOutcome(runningDryRun({ status: "precheck" }))).toBe("precheck");
    expect(runOutcome(seededDryRun({ status: "budget_stopped" }))).toBe("budget_stopped");
    expect(runOutcome(seededDryRun({ status: "cancelled" }))).toBe("cancelled");
    expect(runOutcome(seededDryRun({ status: "failed", failureReason: "x" }))).toBe("failed");
  });

  it("tells a failed pre-check from a failed run by its findings", () => {
    const finding = { source: "dsl" as const, code: "unreachable_node", message: "plan is unreachable.", node: "plan" };

    expect(runOutcome(seededDryRun({ status: "failed", precheckFindings: [finding] }))).toBe("precheck_failed");
    expect(runOutcome(seededDryRun({ status: "failed", precheckFindings: [] }))).toBe("failed");
    expect(runOutcome(seededDryRun({ status: "failed", precheckFindings: null }))).toBe("failed");
  });

  it("puts a guard that had to hold above every other reading of the run", () => {
    const audit = [{ guard: "allow_list", call: "git push origin main", count: 2, stage_key: "implement" }];

    expect(runOutcome(seededDryRun({ status: "failed", guardAudit: audit, guardsClean: false }))).toBe("guard_violation");
    expect(runOutcome(seededDryRun({ guardsClean: false }))).toBe("guard_violation");
    expect(runOutcome(seededDryRun({ status: "failed", guardAudit: audit, guardsClean: false, precheckFindings: [{ source: "dsl", code: "c", message: "m" }] }))).toBe(
      "guard_violation",
    );
  });

  it("names each blocked call, its guard, how often and where", () => {
    expect(guardLine({ guard: "allow_list", call: "git push origin main", count: 2, stage_key: "implement" })).toBe(
      "git push origin main — refused by allow_list, 2 times, in stage implement",
    );
    expect(guardLine({ guard: "workspace_boundary", call: "write /etc/passwd", count: 1 })).toBe(
      "write /etc/passwd — refused by workspace_boundary, once",
    );
  });

  it("says which cap stopped a run, and whose it was", () => {
    expect(budgetLine({ capCents: 500, source: "draft_guard", workspaceCapCents: 1000, draftGuardCents: 500 })).toBe(
      "Its cap was $5.00 — the draft's own spend guard.",
    );
    expect(budgetLine({ capCents: 1000, source: "workspace_cap", workspaceCapCents: 1000, draftGuardCents: null })).toBe(
      "Its cap was $10.00 — the workspace's dry-run cap.",
    );
    expect(budgetLine(undefined)).toBeNull();
  });

  it("says what a budget-stopped run had spent, and nothing for an unpriced one (#569)", () => {
    expect(budgetSpentLine({ ...seededDryRun().totals, costCents: 498 })).toBe("It had spent $4.98 when it was stopped.");
    expect(budgetSpentLine({ ...seededDryRun().totals, costCents: null })).toBeNull();
  });

  it("says what to change, for the cap that stopped it (#569)", () => {
    expect(budgetAdvice({ capCents: 500, source: "draft_guard", workspaceCapCents: 1000, draftGuardCents: 500 })).toBe(
      BUDGET_ADVICE_DRAFT_GUARD,
    );
    expect(budgetAdvice({ capCents: 1000, source: "workspace_cap", workspaceCapCents: 1000, draftGuardCents: null })).toBe(
      BUDGET_ADVICE_WORKSPACE_CAP,
    );
    expect(budgetAdvice(undefined)).toBe(BUDGET_ADVICE_FALLBACK);
    expect(BUDGET_ADVICE_DRAFT_GUARD).toMatch(/spend cap/);
    expect(BUDGET_ADVICE_WORKSPACE_CAP).toMatch(/workspace owner/);
    for (const advice of [BUDGET_ADVICE_DRAFT_GUARD, BUDGET_ADVICE_WORKSPACE_CAP, BUDGET_ADVICE_FALLBACK]) {
      expect(advice).toMatch(/then re-run\.$/);
    }
  });

  it("announces a run's start and each of its ends in one sentence", () => {
    expect(runAnnouncement(runningDryRun())).toBe("Dry run on #489 started.");
    expect(runAnnouncement(seededDryRun())).toBe("Dry run on #489 finished.");
    expect(runAnnouncement(seededDryRun({ status: "cancelled" }))).toBe("Dry run on #489 was cancelled.");
    expect(runAnnouncement(seededDryRun({ status: "budget_stopped" }))).toBe("Dry run on #489 was stopped at its budget.");
    expect(runAnnouncement(seededDryRun({ status: "failed" }))).toBe("Dry run on #489 failed.");
    expect(runAnnouncement(seededDryRun({ guardsClean: false }))).toBe("Dry run on #489 was stopped by a guard.");
  });
});

describe("the simulated diff", () => {
  it("announces itself in the ticket's words", () => {
    expect(DIFF_HEADLINE).toBe("simulated diff (never written to repo)");
  });

  it("finds the overlay diff among the artifacts, and takes no excerpt for one", () => {
    const excerpt = seededDiff({ kind: "plan_excerpt", pathSummary: null });

    expect(overlayDiff([excerpt, seededDiff()])?.kind).toBe("overlay_diff");
    expect(overlayDiff([excerpt])).toBeNull();
    expect(overlayDiff([])).toBeNull();
  });

  it("summarises its files from the artifact's own record", () => {
    expect(diffSummary(seededDiff())).toEqual(["drivers/can/arbitration.c +41 −9"]);
    expect(diffSummary(seededDiff({ pathSummary: null }))).toEqual([]);
  });

  it("reads the seeded diff into file, hunk, removed and added lines", () => {
    expect(diffLines(seededDiff().content).map((line) => line.kind)).toEqual([
      "file",
      "file",
      "hunk",
      "del",
      "del",
      "add",
      "add",
      "add",
      "add",
    ]);
    expect(diffLines(" context\n+added\n")).toEqual([
      { kind: "ctx", text: " context" },
      { kind: "add", text: "+added" },
    ]);
  });

  it("states truncation with the shown and the original size, and says nothing of a whole diff", () => {
    expect(truncationLine(seededDiff())).toBeNull();
    expect(truncationLine(seededDiff({ content: "x".repeat(65_536), truncated: true, originalBytes: 217_498 }))).toBe(
      "Truncated — showing the first 64.0 KB of 212.4 KB.",
    );
    expect(bytesOf(812)).toBe("812 B");
    expect(bytesOf(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("the suggestions", () => {
  it("keeps the open ones as callouts and the settled ones as quiet lines, each in the service's order", () => {
    const [skip, review] = seededSuggestions();
    const groups = groupSuggestions([{ ...skip, status: "applied" }, review, LLM_SUGGESTION, { ...ADVISORY_SUGGESTION, status: "ignored" }]);

    expect(groups.open.map((suggestion) => suggestion.id)).toEqual([review.id, LLM_SUGGESTION.id]);
    expect(groups.resolved.map((suggestion) => suggestion.status)).toEqual(["applied", "ignored"]);
  });

  it("prints a rule's confidence, and never a percentage for the model's", () => {
    expect(seededSuggestions().map(confidenceText)).toEqual(["93%", "81%"]);
    expect(confidenceText(LLM_SUGGESTION)).toBeNull();
    expect(confidenceText({ source: "llm", confidence: 50 })).toBeNull();
  });

  it("names where a suggestion came from: the rule and its version, or the model, unscored", () => {
    expect(sourceLine(seededSuggestions()[0])).toBe("rule · skipped-nothing-to-do v1");
    expect(sourceLine(seededSuggestions()[1])).toBe("rule · reviewer-disagreement v1");
    expect(sourceLine(LLM_SUGGESTION)).toBe(LLM_LABEL);
    expect(LLM_LABEL).toBe("from the model · unscored");
  });

  it("draws the title once: the body's own repeat of it, and the dash, are dropped", () => {
    expect(suggestionRest(seededSuggestions()[1])).toBe("6 of 10 replayed review pairs disagreed on comment style, not substance.");
    expect(suggestionRest({ title: "A", body: "Something else entirely." })).toBe("Something else entirely.");
  });

  it("says what a settled suggestion became, and what ignoring means", () => {
    expect(resolvedLine({ status: "applied", title: "Make exploit-verify conditional" })).toBe(
      "Applied — Make exploit-verify conditional",
    );
    expect(resolvedLine({ status: "ignored", title: "Pin the skill" })).toBe(
      "Ignored — Pin the skill (it will not be raised again for this draft revision)",
    );
  });

  it("lays the scoring basis out as the service keyed it — the method, then every input", () => {
    const facts = basisFacts(seededSuggestions()[0].confidenceBasis);

    expect(facts[0]).toEqual({ term: "method", value: "rule_strength_x_sample_adequacy" });
    expect(facts.slice(1).map((fact) => `${fact.term}=${fact.value}`)).toEqual([
      "rule=skipped-nothing-to-do",
      "rule_version=1",
      "rule_strength=0.95",
      "sample_adequacy=0.98",
      "outcome=skipped_nothing_to_do",
      "deterministic=true",
      "observations=1",
    ]);
  });

  it("prints any value the evidence carries, renaming nothing", () => {
    expect(factsOf(seededExplanation().evidence).find((fact) => fact.term === "ticket_labels")).toEqual({
      term: "ticket_labels",
      value: "bug, can-bus",
    });
    expect(factValue(null)).toBe("—");
    expect(factValue([])).toBe("—");
    expect(factValue({ a: 1 })).toBe('{"a":1}');
    expect(ruleLine(seededExplanation().rule!)).toBe("skipped-nothing-to-do v1 · rule pack v1");
  });
});

describe("apply", () => {
  it("previews every typed operation in the order it runs, with its raw kind and params", () => {
    const preview = applyPreview(dryRunSuggestion().proposedOps);

    expect(preview.map((operation) => operation.phrase)).toEqual([
      "adding stage has-cve",
      "disconnecting test → exploit-verify",
      "connecting test → has-cve",
      "connecting has-cve → exploit-verify",
      "connecting has-cve → review-primary",
      "connecting has-cve → review-second",
    ]);
    expect(preview[1].kind).toBe("remove_edge");
    expect(JSON.parse(preview[1].params)).toEqual({ from: "test", to: "exploit-verify" });
  });

  it("collects the stages the operations touch, each once, in the order first touched", () => {
    expect(touchedStages(dryRunSuggestion().proposedOps)).toEqual([
      "has-cve",
      "test",
      "exploit-verify",
      "review-primary",
      "review-second",
    ]);
    expect(touchedStages(seededSuggestions()[1].proposedOps)).toEqual(["review-primary", "review-second"]);
  });

  it("links to no stage an operation removed, and to none for a trigger or an unknown kind", () => {
    expect(
      touchedStages([
        { kind: "add_edge", params: { edge: { from: "a", to: "b" } } },
        { kind: "remove_stage", params: { id: "b" } },
        { kind: "set_trigger", params: { trigger: {} } },
        { kind: "mystery" },
      ]),
    ).toEqual(["a"]);
  });

  it("names the revision an Apply makes, and the one it made", () => {
    expect(nextRevisionLine({ rev: 3, baseVersion: null })).toBe("This makes draft v0.4.");
    expect(nextRevisionLine({ rev: 1, baseVersion: 2 })).toBe("This makes draft v2.2.");
    expect(appliedNotice("v0.4")).toBe("Applied — the draft is now v0.4.");
  });
});

describe("the controls", () => {
  const able = { mayContribute: true, live: false, hasStages: true, busy: false };

  it("let a contributor start on a draft with stages when nothing is running", () => {
    expect(startReason(able)).toBeUndefined();
    expect(cancelReason(able)).toBeUndefined();
  });

  it("give one reason at a time, from what cannot change to what will pass", () => {
    const worst = { mayContribute: false, live: true, hasStages: false, busy: true };

    expect(startReason(worst)).toBe(CONTROL_ROLE_REASON);
    expect(startReason({ ...worst, mayContribute: true })).toBe(IN_FLIGHT_REASON);
    expect(startReason({ ...worst, mayContribute: true, live: false })).toBe(NO_STAGES_REASON);
    expect(startReason({ ...worst, mayContribute: true, live: false, hasStages: true })).toBe(BUSY_REASON);
    expect(IN_FLIGHT_REASON).toMatch(/^One dry run at a time/);
  });

  it("keep a viewer from cancelling, applying and ignoring, with the reason", () => {
    const viewer = { mayContribute: false, busy: false };

    expect(cancelReason(viewer)).toBe(CONTROL_ROLE_REASON);
    expect(applyReason(dryRunSuggestion(), viewer)).toBe(SUGGESTION_ROLE_REASON);
    expect(ignoreReason(viewer)).toBe(SUGGESTION_ROLE_REASON);
  });

  it("say advice is advice whoever reads it", () => {
    expect(applyReason(ADVISORY_SUGGESTION, able)).toBe(ADVISORY_REASON);
    expect(applyReason(ADVISORY_SUGGESTION, { mayContribute: false, busy: false })).toBe(ADVISORY_REASON);
    expect(applyReason(dryRunSuggestion(), able)).toBeUndefined();
    expect(ADVISORY_REASON).toBe("This suggestion is advice only — it proposes no change to apply.");
  });

  it("compose the history line, singular and plural", () => {
    expect(historyLine(seededHistory())).toBe("history: 1 dry run · draft v0.3 (2 copilot edits)");
    expect(historyLine({ count: 4, draft: { label: "v1.7", rev: 7, baseVersion: 1, copilotEdits: 1 } })).toBe(
      "history: 4 dry runs · draft v1.7 (1 copilot edit)",
    );
  });

  it("say which draft a re-run is on only when it is not the run's own", () => {
    expect(rerunHint("v0.3", "v0.3")).toBeNull();
    expect(rerunHint("v0.3", "v0.4")).toBe("re-runs on draft v0.4");
  });
});

describe("refusals", () => {
  it("head each kind of refused start, and leave the sentence to the service", () => {
    expect(refusalHeading({ code: "dry_run_in_progress", status: 409 })).toMatch(/already running/);
    expect(refusalHeading({ code: "dry_run_draft_stale", status: 409 })).toMatch(/draft changed/);
    expect(refusalHeading({ code: "dry_run_repository_unresolved", status: 422 })).toMatch(/no repository/);
    expect(refusalHeading({ code: "dry_run_source_unsupported", status: 422 })).toMatch(/tracker/);
    expect(refusalHeading({ code: "engine_unavailable", status: 502 })).toMatch(/engine/);
    expect(refusalHeading({ code: "github_unavailable", status: 502 })).toBe(REFUSED_HEADING);
  });

  it("re-read the page for a stale draft and an open run, and say the previous results stay otherwise", () => {
    expect(refusalRereads({ code: "dry_run_draft_stale" })).toBe(true);
    expect(refusalRereads({ code: "dry_run_in_progress" })).toBe(true);
    expect(refusalRereads({ code: "github_unavailable" })).toBe(false);
    expect(refusalFollowUp({ code: "dry_run_draft_stale" }, true)).toMatch(/read the draft again/);
    expect(refusalFollowUp({ code: "github_unavailable" }, true)).toBe("The previous run's results are still shown below.");
    expect(refusalFollowUp({ code: "github_unavailable" }, false)).toBeNull();
  });
});

describe("the empty state's proposal", () => {
  it("finds the newest dry run the copilot proposed, with its reason", () => {
    expect(latestProposal(seededMessages())).toEqual({
      ticket: "#489",
      reason: "security workflow × no-CVE issue — exercises the skip path",
    });
    expect(proposalLine(latestProposal(seededMessages())!)).toBe(
      "The copilot suggested dry-running #489 — security workflow × no-CVE issue — exercises the skip path",
    );
  });

  it("finds none in a conversation that proposed none, or in no conversation", () => {
    expect(latestProposal(seededMessages().slice(0, 3))).toBeNull();
    expect(latestProposal([])).toBeNull();
    expect(latestProposal([{ toolTrace: null }, {}])).toBeNull();
    expect(proposalLine({ ticket: "#7", reason: null })).toBe("The copilot suggested dry-running #7.");
  });

  it("matches the proposed ticket to a candidate by its key", () => {
    const candidates = [dryRunCandidate(), CANDIDATE_490];

    expect(matchCandidate(candidates, "#490")).toBe(CANDIDATE_490);
    expect(matchCandidate(candidates, "#491")).toBeNull();
  });
});

describe("the card's state", () => {
  /** The card, open on a run in flight with three rows. */
  function live(): CardState {
    return openCard(seededBoard({ run: runningDryRun(), suggestions: [] }));
  }

  /** Fold events of the seeded run. */
  function fold(state: CardState, ...events: DryRunStreamEvent[]): CardState {
    return events.reduce((held, event) => cardReducer(held, { type: "event", runId: DRY_RUN_ID, event }), state);
  }

  const BUILD_STARTED: DryRunStreamEvent = { kind: "stage_started", seq: 4, stageKey: "build", displayName: "build" };
  const BUILD_FINISHED: DryRunStreamEvent = { kind: "stage_finished", stage: seededStages()[3] };
  const DONE: DryRunStreamEvent = { kind: "done", dryRun: seededDryRun() };

  it("opens on what the route read", () => {
    expect(openCard(seededBoard())).toMatchObject({ run: { id: DRY_RUN_ID }, started: [], polling: false, refusal: null });
    expect(openCard(seededBoard()).suggestions).toHaveLength(2);
    expect(openCard(emptyBoard())).toMatchObject({ run: null, suggestions: [] });
    expect(openCard(seededBoard({ suggestions: null })).suggestions).toBeNull();
  });

  it("folds a stream in order: a stage starts, finishes, and the run ends with one announcement", () => {
    const started = fold(live(), BUILD_STARTED);
    expect(started.started).toEqual([{ seq: 4, stageKey: "build", displayName: "build" }]);
    expect(started.announcement).toBe("");

    const finished = fold(started, BUILD_FINISHED);
    expect(finished.started).toEqual([]);
    expect(finished.run?.stages.map((stage) => stage.seq)).toEqual([1, 2, 3, 4]);
    expect(finished.announcement).toBe("");

    const done = fold(finished, DONE);
    expect(done.run?.status).toBe("complete");
    expect(done.run?.stages).toHaveLength(7);
    expect(done.announcement).toBe("Dry run on #489 finished.");
  });

  it("changes nothing for a duplicated event", () => {
    const once = fold(live(), BUILD_STARTED, BUILD_FINISHED);
    const twice = fold(once, BUILD_STARTED, BUILD_FINISHED);

    expect(twice.run?.stages).toEqual(once.run?.stages);
    expect(twice.started).toEqual([]);
    expect(fold(fold(live(), DONE), DONE).run?.stages).toHaveLength(7);
  });

  it("survives events out of order: a start after its finish is ignored, and rows stay in `seq` order", () => {
    const review: DryRunStreamEvent = { kind: "stage_finished", stage: seededStages()[5] };
    const state = fold(live(), review, BUILD_FINISHED, BUILD_STARTED);

    expect(state.run?.stages.map((stage) => stage.seq)).toEqual([1, 2, 3, 4, 6]);
    expect(state.started).toEqual([]);
  });

  it("drops an account of the run that is behind the one held, and anything after the run ended", () => {
    const ahead = fold(live(), BUILD_FINISHED);
    const behind = fold(ahead, { kind: "accepted", dryRun: runningDryRun({ stages: seededStages().slice(0, 1) }) });
    expect(behind.run?.stages).toHaveLength(4);

    const ended = fold(ahead, DONE);
    expect(fold(ended, BUILD_STARTED, { kind: "accepted", dryRun: runningDryRun() })).toEqual(ended);
  });

  it("drops events of a run that is not the one shown", () => {
    const state = live();

    expect(cardReducer(state, { type: "event", runId: "another", event: BUILD_STARTED })).toBe(state);
    expect(fold(state, { kind: "done", dryRun: seededDryRun({ id: "another" }) })).toBe(state);
  });

  it("shows a blocked call the moment it happens, counted, and the run's own audit once it has one", () => {
    const blocked: DryRunStreamEvent = { kind: "guard_blocked", guard: "allow_list", call: "git push", stageKey: "implement" };
    const state = fold(live(), blocked, blocked);

    expect(shownAudit(state)).toEqual([{ guard: "allow_list", call: "git push", count: 2, stage_key: "implement" }]);

    const audit = [{ guard: "allow_list", call: "git push", count: 3, stage_key: "implement" }];
    const ended = fold(state, { kind: "done", dryRun: seededDryRun({ status: "failed", guardsClean: false, guardAudit: audit }) });
    expect(shownAudit(ended)).toEqual(audit);
    expect(ended.announcement).toBe("Dry run on #489 was stopped by a guard.");
  });

  it("falls back to polling when the stream drops, and a polled reading that ended ends the run", () => {
    const dropped = cardReducer(live(), { type: "dropped", runId: DRY_RUN_ID });
    expect(dropped.polling).toBe(true);

    const polled = cardReducer(dropped, { type: "detail", run: runningDryRun({ stages: seededStages().slice(0, 5) }) });
    expect(polled.run?.stages).toHaveLength(5);
    expect(polled.polling).toBe(true);

    const ended = cardReducer(polled, { type: "detail", run: seededDryRun({ status: "cancelled" }) });
    expect(ended.polling).toBe(false);
    expect(ended.announcement).toBe("Dry run on #489 was cancelled.");
    expect(cardReducer(openCard(seededBoard()), { type: "dropped", runId: DRY_RUN_ID }).polling).toBe(false);
  });

  it("takes a run this card started: no rows of the last one, no suggestions yet, no refusal, announced", () => {
    const refused = cardReducer(openCard(seededBoard()), { type: "refused", refusal: { status: 409, code: "c", message: "m" } });
    const run = runningDryRun({ id: "5eed008b-0000-4000-8000-000000000002", status: "precheck", stages: [] });
    const state = cardReducer(refused, { type: "started", run });

    expect(state).toMatchObject({ run, started: [], blocked: [], suggestions: null, refusal: null });
    expect(state.announcement).toBe("Dry run on #489 started.");
  });

  it("holds the suggestions as pending, then read, then settled one by one", () => {
    const state = cardReducer(openCard(seededBoard({ suggestions: null })), { type: "suggestions_pending", runId: DRY_RUN_ID });
    expect(state.suggestionsPending).toBe(true);

    const read = cardReducer(state, { type: "suggestions", runId: DRY_RUN_ID, suggestions: seededSuggestions() });
    expect(read).toMatchObject({ suggestionsPending: false });
    expect(read.suggestions).toHaveLength(2);

    const settled = cardReducer(read, { type: "settled", suggestion: { ...seededSuggestions()[0], status: "ignored" } });
    expect(settled.suggestions?.map((suggestion) => suggestion.status)).toEqual(["ignored", "open"]);
    expect(cardReducer(read, { type: "suggestions", runId: "another", suggestions: [] })).toBe(read);
  });

  it("keeps a refusal beside the run it did not replace, until it is dismissed", () => {
    const refusal = { status: 502, code: "github_unavailable", message: "GitHub could not be reached." };
    const refused = cardReducer(openCard(seededBoard()), { type: "refused", refusal });

    expect(refused.refusal).toEqual(refusal);
    expect(refused.run?.stages).toHaveLength(7);
    expect(cardReducer(refused, { type: "refused", refusal: null }).refusal).toBeNull();
  });
});

describe("a new read of the route", () => {
  it("is the same state for the same board", () => {
    const board = seededBoard();
    const state = openCard(board);

    expect(adoptBoard(state, board)).toBe(state);
  });

  it("always takes the history, so a re-run's hint follows an applied suggestion", () => {
    const state = openCard(seededBoard());
    const history = seededHistory({ draft: { label: "v0.4", rev: 4, baseVersion: null, copilotEdits: 2 } });

    expect(adoptBoard(state, seededBoard({ history })).board.history.draft.label).toBe("v0.4");
  });

  it("keeps the stream's account of a run it is following over an older read of it", () => {
    const state = cardReducer(openCard(seededBoard({ run: runningDryRun(), suggestions: [] })), {
      type: "event",
      runId: DRY_RUN_ID,
      event: { kind: "stage_finished", stage: seededStages()[3] },
    });
    const adopted = adoptBoard(state, seededBoard({ run: runningDryRun(), suggestions: [] }));

    expect(adopted.run?.stages).toHaveLength(4);
  });

  it("keeps knowing a run ended when a read from before still says running", () => {
    const ended = openCard(seededBoard());
    const adopted = adoptBoard(ended, seededBoard({ run: runningDryRun(), suggestions: [] }));

    expect(adopted.run?.status).toBe("complete");
    expect(adopted.suggestions).toHaveLength(2);
  });

  it("takes the read's run and suggestions once both agree it ended", () => {
    const state = { ...openCard(seededBoard({ suggestions: null })), suggestionsPending: true };
    const adopted = adoptBoard(state, seededBoard());

    expect(adopted.suggestions).toHaveLength(2);
    expect(adopted.suggestionsPending).toBe(false);
  });

  it("keeps a run this card started over a read that does not know it yet, and takes a newer one", () => {
    const mine = runningDryRun({ id: "5eed008b-0000-4000-8000-000000000002", startedAt: "2026-09-14T09:00:00.000Z", stages: [] });
    const state = cardReducer(openCard(seededBoard()), { type: "started", run: mine });

    expect(adoptBoard(state, seededBoard()).run?.id).toBe(mine.id);

    const newer = seededDryRun({ id: "5eed008b-0000-4000-8000-000000000003", startedAt: "2026-09-15T09:00:00.000Z" });
    expect(adoptBoard(state, seededBoard({ run: newer })).run?.id).toBe(newer.id);
  });

  it("opens on the first run a read brings to a card that had none, keeping a refusal on screen", () => {
    const refusal = { status: 409, code: "dry_run_in_progress", message: "Already running." };
    const state = cardReducer(openCard(emptyBoard()), { type: "refused", refusal });
    const adopted = adoptBoard(state, seededBoard({ run: runningDryRun(), suggestions: [] }));

    expect(adopted.run?.status).toBe("running");
    expect(adopted.refusal).toEqual(refusal);
  });
});

describe("the waiting lines", () => {
  it("say a run is queued behind its pre-check", () => {
    expect(QUEUED_NOTE).toMatch(/^Queued/);
    expect(dryRunStage().estimate).toBeNull();
  });
});
