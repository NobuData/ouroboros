import { describe, expect, it } from "vitest";

import type { BacklogRow } from "@/app/api/backlog";
import type { WorkflowDryRunResult } from "@/app/api/workflows";
import {
  NO_SIZED_TICKETS,
  OUTCOME_CLASS,
  OUTCOME_WORDS,
  SEEDED_TICKET_NUMBER,
  VERDICT_TONES,
  VERDICT_WORDS,
  defaultTicket,
  dryRunFailure,
  dryRunTitle,
  edgeTarget,
  highlightOf,
  loopNote,
  ticketFacts,
  ticketLabel,
  ticketOptions,
  ticketsFailure,
} from "@/app/workflows/dry-run";

import { MOCKUP_ACTIVE_PATH } from "../helpers/workflows";

/**
 * The dry run's decisions (#152): which issues the picker offers and which it opens on, the path the canvas
 * paints, and how the sheet names verdicts, outcomes and loop bounds. The explanations themselves are the
 * engine's and are printed as they arrive, so nothing here composes one.
 */

/**
 * A backlog row, sized by default.
 *
 * @param overrides What this case is about.
 * @returns The row, with the fields the picker reads.
 */
function row(overrides: Partial<BacklogRow> = {}): BacklogRow {
  return {
    id: "5eed0018-0000-4000-8000-000000000485",
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    labels: ["bug", "i2c"],
    state: "open",
    sizingStatus: "sized",
    queued: false,
    estimate: { effort: "m", confidence: 0.8, suggestedWorkflow: "standard-fix", routedModel: "coder-std", estMinutes: 40 },
    ...overrides,
  } as BacklogRow;
}

describe("the picker", () => {
  it("offers open, sized issues with their effort, in the listing's order", () => {
    const options = ticketOptions([
      row({ id: "a", number: 483 }),
      row({ id: "b", number: 484, sizingStatus: "unsized", estimate: null }),
      row({ id: "c", number: 486, state: "closed" }),
      row({ id: "d", number: 487, sizingStatus: "estimating" }),
      row({ id: "e", number: 485 }),
    ]);

    expect(options.map((option) => option.number)).toEqual([483, 485]);
    expect(options[1]).toEqual({ id: "e", number: 485, title: "Watchdog reset on I²C bus lockup", effort: "m" });
  });

  it("opens on #485 when the workspace has it, else on the first issue, else on nothing", () => {
    const seeded = ticketOptions([row({ id: "a", number: 12 }), row({ id: "b", number: SEEDED_TICKET_NUMBER })]);

    expect(defaultTicket(seeded)?.id).toBe("b");
    expect(defaultTicket(ticketOptions([row({ id: "a", number: 12 })]))?.id).toBe("a");
    expect(defaultTicket([])).toBeNull();
    expect(NO_SIZED_TICKETS).toMatch(/sized/);
  });

  it("names an option by number, title and effort", () => {
    expect(ticketLabel({ id: "x", number: 485, title: "Watchdog reset", effort: "m" })).toBe("#485 · Watchdog reset · effort M");
  });

  it("says why the backlog could not be read, in the service's words", () => {
    expect(ticketsFailure({ code: "forbidden", message: "You may not read this.", details: {} })).toMatch(/You may not read this\.$/);
  });
});

describe("the overlay", () => {
  /** A walk of the seeded standard-fix for #485, reduced to its path. */
  const WALK: WorkflowDryRunResult = {
    ticket: { externalKey: "#485", source: "github", labels: ["bug"], estimate: { effort: "m" } },
    findings: [],
    steps: [],
    verdicts: [],
    highlightPath: [...MOCKUP_ACTIVE_PATH],
  };

  it("paints the path the engine walked, as it arrived", () => {
    expect(highlightOf(WALK)).toBe(WALK.highlightPath);
  });

  it("paints nothing for a draft that did not validate", () => {
    expect(
      highlightOf({ ...WALK, highlightPath: [], findings: [{ source: "engine", code: "x", message: "m", path: "" }] }),
    ).toBeNull();
  });
});

describe("the sheet", () => {
  it("is titled as the mockup's action, for the ticket walked", () => {
    expect(dryRunTitle("#485")).toBe("Dry run with issue #485");
  });

  it("states the facts the walk tested", () => {
    expect(ticketFacts({ externalKey: "#485", source: "github", labels: ["bug", "i2c"], estimate: { effort: "m" } })).toBe(
      "effort M · labels bug, i2c · GitHub",
    );
    expect(ticketFacts({ externalKey: "#9", source: "jira", labels: [], estimate: null })).toBe(
      "unsized · no labels · Jira",
    );
  });

  it("has a word and a tone for every verdict, and a word and a kebab-case class for every outcome", () => {
    for (const verdict of ["matched", "not_matched", "reached", "halted", "ended"] as const) {
      expect(VERDICT_WORDS[verdict]).not.toBe("");
      expect(VERDICT_TONES[verdict]).toBeDefined();
    }
    expect(OUTCOME_WORDS).toEqual({ taken: "Taken", not_taken: "Not taken", loop: "Loop" });
    for (const modifier of Object.values(OUTCOME_CLASS)) expect(modifier).toMatch(/^[a-z]+$/);
  });

  it("names where an edge goes, with its label when it has one", () => {
    const edge = {
      from: "effort-recheck",
      to: "plan",
      kind: "branch",
      label: "≤ M ↓",
      outcome: "taken" as const,
      explanation: "Taken.",
      evaluation: null,
      maxRetries: null,
    };
    const titles: Record<string, string> = { plan: "Plan the change" };

    expect(edgeTarget(edge, (id) => titles[id] ?? id)).toBe("→ Plan the change (≤ M ↓)");
    expect(edgeTarget({ ...edge, label: null, to: "split" }, (id) => titles[id] ?? id)).toBe("→ split");
  });

  it("states a loop's retry bound, and says so when the stage declares none", () => {
    expect(loopNote(2)).toMatch(/at most 2 times/);
    expect(loopNote(1)).toMatch(/at most 1 time —/);
    expect(loopNote(0)).toMatch(/at most 0 times/);
    expect(loopNote(null)).toMatch(/no retry bound/);
  });
});

describe("a refused dry run", () => {
  it.each([
    ["workflow_dry_run_issue_not_found", /Pick another/],
    ["workflow_draft_absent", /nothing to walk/],
    ["engine_unavailable", /engine could not walk/],
  ])("says %s in its own words", (code, sentence) => {
    expect(dryRunFailure({ code, message: "m", details: {} })).toMatch(sentence);
  });

  it("prints any other refusal as the service wrote it", () => {
    expect(dryRunFailure({ code: "forbidden", message: "Not for you.", details: {} })).toBe("Not for you.");
  });
});
