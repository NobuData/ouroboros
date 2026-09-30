import { describe, expect, it } from "vitest";

import { DASHBOARD_PATH, DASHBOARD_QUEUE_HASH, ISSUES_PATH, runPath } from "@/app/paths";
import {
  CANDIDATE_REASONS,
  CREATE_ADMIN_REASON,
  LAUNCH_VIEWER_REASON,
  NAME_LONG,
  NAME_MAX,
  NAME_REQUIRED,
  NAME_TAKEN,
  candidateLine,
  createBody,
  createFailure,
  createReason,
  createdToast,
  derivedLine,
  draftFailure,
  filterLine,
  launchFailure,
  openingPlaybookForm,
  overrideLines,
  parseLabels,
  pinLabel,
  playbookFormProblems,
  queuedNote,
  rankCandidates,
  receiptText,
  receiptToast,
  recipesChip,
  runConsolePath,
  runCountLabel,
  runLine,
  runMeta,
} from "@/app/knowledge/playbooks";

import { SEEDED_COMPLETIONS, closedRun } from "../helpers/dashboard";
import {
  READ_AT,
  SEEDED_REPO,
  candidate,
  launchReceipt,
  mixedCandidates,
  playbook,
  playbookDraft,
  seededPlaybookRows,
  seededSkills,
} from "../helpers/knowledge";

/**
 * The playbooks card's decisions (#420): the counts and their sentences, the safety ranking with
 * each row's reason, the receipt and its links, the honest queued note, and the create-from-run
 * form's checks and body.
 */

describe("the card's figures", () => {
  it("counts the recipes and the runs in the mockup's words", () => {
    expect(recipesChip(3)).toBe("3 recipes");
    expect(recipesChip(1)).toBe("1 recipe");
    expect(runCountLabel(9)).toBe("run 9×");
    expect(pinLabel(playbook().workflow)).toBe("standard-fix v14");
  });

  it("says what the filter admits, or that it admits everything", () => {
    expect(filterLine(playbook())).toBe("Offers open issues labelled flaky.");
    expect(filterLine(playbook({ issueFilter: { labels: ["security", "dependencies"], repos: [SEEDED_REPO] } }))).toBe(
      `Offers open issues labelled security or dependencies · in ${SEEDED_REPO}.`,
    );
    expect(filterLine(playbook({ issueFilter: null }))).toBe("Offers every open issue.");
    expect(filterLine(playbook({ issueFilter: { labels: [], repos: null } }))).toBe("Offers every open issue.");
  });
});

describe("the safety ranking", () => {
  it("puts a sized, unqueued issue first and the queued one last, with the service's order kept within a rank", () => {
    const ranked = rankCandidates(mixedCandidates());

    expect(ranked.map((row) => row.candidate.number)).toEqual([485, 488, 490, 481, 483]);
    expect(ranked[0]).toMatchObject({ launchable: true, reason: null });
    expect(ranked.map((row) => row.reason)).toEqual([
      null,
      CANDIDATE_REASONS.estimating,
      CANDIDATE_REASONS.unsized,
      CANDIDATE_REASONS.needs_human,
      CANDIDATE_REASONS.queued,
    ]);
  });

  it("keeps newest first among the launchable ones", () => {
    const ranked = rankCandidates([candidate({ number: 2, id: "b" }), candidate({ number: 1, id: "a" })]);

    expect(ranked.map((row) => row.candidate.number)).toEqual([2, 1]);
  });

  it("names a queued issue queued whatever its sizing says", () => {
    const [row] = rankCandidates([candidate({ queued: true, sizingStatus: "unsized" })]);

    expect(row?.reason).toBe(CANDIDATE_REASONS.queued);
  });

  it("prints a candidate's line", () => {
    expect(candidateLine(candidate())).toBe("#485 — Watchdog reset on I²C bus lockup");
  });
});

describe("the launch", () => {
  it("writes the receipt out — what, under which pin, at which position — with the two links", () => {
    const receipt = launchReceipt();
    const text = receiptText(receipt, playbook());

    expect(text).toBe(
      "Queued #485 — Watchdog reset on I²C bus lockup — under Flaky test hunt (standard-fix v14), position 3 in the queue.",
    );
    expect(receiptToast(receipt, playbook())).toEqual({
      text,
      links: [
        { label: "Queue on the dashboard", href: `${DASHBOARD_PATH}#${DASHBOARD_QUEUE_HASH}` },
        { label: "Issues", href: ISSUES_PATH },
      ],
    });
  });

  it("prints the pin's slug alone when the item carries no version", () => {
    const receipt = launchReceipt();
    const unpinned = { ...receipt, item: { ...receipt.item, workflowVersion: null } };

    expect(receiptText(unpinned, playbook())).toContain("(standard-fix)");
  });

  it("notes what was queued beside the count, and never moves the count", () => {
    expect(queuedNote([])).toBeNull();
    expect(queuedNote([launchReceipt()])).toBe("#485 queued");
    expect(queuedNote([launchReceipt(), launchReceipt({ item: { ...launchReceipt().item, issueNumber: 490 } })])).toBe(
      "#485, #490 queued",
    );
  });

  it.each([
    ["forbidden", `Not queued: ${LAUNCH_VIEWER_REASON}`],
    ["queue_issues_conflict", "Not queued: the queue already holds this issue."],
    ["queue_issues_not_queueable", "Not queued: the issue is not sized yet."],
    ["playbook_issue_filtered", "Not queued: this playbook's filter no longer admits the issue."],
    ["queue_workflow_unknown", "Not queued: the playbook's workflow is no longer active."],
    ["internal_error", "Not queued: The service failed."],
  ])("says why a launch was refused — %s", (code, sentence) => {
    expect(launchFailure({ code, message: "The service failed.", details: {} })).toBe(sentence);
  });
});

describe("the run picker", () => {
  it("prints a run's line, meta and console path", () => {
    const run = closedRun();

    expect(runLine(run)).toBe("#474 — Debounce e-stop interrupt handler");
    expect(runMeta(run, new Date(run.finishedAt ?? ""))).toBe("standard-fix · merged · 0s ago");
    expect(runMeta(closedRun({ status: "needs_human", finishedAt: null }), new Date(READ_AT))).toBe(
      "standard-fix · needs human · still running",
    );
    expect(runConsolePath(run)).toBe(runPath(run.id, "knowledge"));
    expect(SEEDED_COMPLETIONS.map(runLine)[0]).toBe(runLine(run));
  });

  it.each([
    ["playbook_run_not_terminal", "This run has not finished; a playbook is learned from one that has."],
    ["playbook_run_unpinned", "This run has no published workflow version a playbook could pin."],
    ["playbook_run_not_found", "The run could not be read: No such run."],
  ])("says why a draft was refused — %s", (code, sentence) => {
    expect(draftFailure({ code, message: "No such run.", details: {} })).toBe(sentence);
  });
});

describe("what the run captured", () => {
  it("says where each part came from", () => {
    expect(derivedLine(playbookDraft())).toBe(
      `Loop #1791 — derived against ${SEEDED_REPO} from 3 injection records and 2 steers.`,
    );
    expect(derivedLine(playbookDraft({ derivedFrom: { repo: SEEDED_REPO, injections: 1, steers: 1 } }))).toContain(
      "1 injection record and 1 steer",
    );
  });

  it("names each override by the slug the page read, and by id when it did not", () => {
    const skills = seededSkills().skills;

    expect(overrideLines(playbookDraft(), skills)).toEqual({ enable: ["hil-safety"], disable: ["repo-map"] });
    expect(overrideLines(playbookDraft(), null)).toEqual({
      enable: ["5eed0410-0000-4000-8000-000000000004"],
      disable: ["5eed0410-0000-4000-8000-000000000002"],
    });
  });
});

describe("the form", () => {
  it("opens on the suggested description with no name", () => {
    expect(openingPlaybookForm(playbookDraft())).toEqual({
      name: "",
      description: "Learned from loop #1791 — Fix flaky CAN-bus telemetry test",
      labels: "",
    });
  });

  it("parses comma-separated labels, trimmed and de-duplicated", () => {
    expect(parseLabels(" flaky, ci ,flaky,, ")).toEqual(["flaky", "ci"]);
    expect(parseLabels("")).toEqual([]);
  });

  it("refuses an empty, long or taken name before a round trip", () => {
    const existing = seededPlaybookRows();

    expect(playbookFormProblems({ name: "", description: "", labels: "" }, existing)).toEqual({ name: "missing" });
    expect(playbookFormProblems({ name: "x".repeat(NAME_MAX + 1), description: "", labels: "" }, existing)).toEqual({ name: "long" });
    expect(playbookFormProblems({ name: "cve BUMP", description: "", labels: "" }, existing)).toEqual({ name: "taken" });
    expect(playbookFormProblems({ name: "Thermal hunt", description: "", labels: "" }, existing)).toEqual({});
    expect(createReason({ name: "missing" })).toBe(NAME_REQUIRED);
    expect(createReason({ name: "long" })).toBe(NAME_LONG);
    expect(createReason({ name: "taken" })).toBe(NAME_TAKEN);
    expect(createReason({})).toBeUndefined();
  });

  it("refuses no name as taken when the list could not be read — the service's 409 still lands", () => {
    expect(playbookFormProblems({ name: "CVE bump", description: "", labels: "" }, null)).toEqual({});
  });

  it("composes the body: the run, the name, a changed description, and a filter only when labels were typed", () => {
    const draft = playbookDraft();

    expect(createBody(draft, { name: " Flaky hunt ", description: draft.suggestedDescription, labels: "" })).toEqual({
      runId: draft.sourceRunId,
      name: "Flaky hunt",
    });
    expect(createBody(draft, { name: "Flaky hunt", description: "Own words", labels: "flaky, ci" })).toEqual({
      runId: draft.sourceRunId,
      name: "Flaky hunt",
      description: "Own words",
      issueFilter: { labels: ["flaky", "ci"] },
    });
  });

  it("lands a taken name under the box and anything else beneath the form", () => {
    expect(createFailure({ code: "playbook_name_taken", message: "Taken.", details: {} })).toEqual({ message: NAME_TAKEN, field: "name" });
    expect(createFailure({ code: "forbidden", message: "No.", details: {} })).toEqual({
      message: `Not saved: ${CREATE_ADMIN_REASON}`,
      field: null,
    });
    expect(createFailure({ code: "internal_error", message: "The service failed.", details: {} })).toEqual({
      message: "Not saved: The service failed.",
      field: null,
    });
  });

  it("leaves a toast naming the pin and the count", () => {
    expect(createdToast(playbook({ runCount: 0 }))).toEqual({
      text: "Saved Flaky test hunt — standard-fix v14, run 0×. Run it on an issue from its row.",
      links: [],
    });
  });
});
