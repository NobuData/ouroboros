import { describe, expect, it } from "vitest";

import {
  FORMULAS_TERM,
  MECHANISM_WORDS,
  NOTHING_HELD_NOTE,
  PATH_TERM,
  READS_TERM,
  SAFETY_CLAIMS,
  SAFETY_CLAIM_COUNT,
  TOOLS_TERM,
  WRITES_TERM,
  mechanismButtonName,
  safetyColumns,
  withheldNote,
} from "@/app/workflows/copilot/safety";

import { drySafety, safetyColumn } from "../../helpers/workflow-copilot";

/**
 * The safety strip's decisions (CE.5, #569).
 *
 * The property the ticket is about: **the strip is derived, not written**. A claim is on the page
 * only while the payload asserts it, so every case here that takes a claim out of the payload
 * must take it off the strip — with no sentence left behind to stand in for it.
 */

describe("the claims", () => {
  it("are the issue's three sentences, verbatim", () => {
    expect(SAFETY_CLAIMS.simulated_writes).toEqual({
      key: "Simulated writes",
      sentence: "Diffs are drafted in memory — the repo is untouched.",
    });
    expect(SAFETY_CLAIMS.replayed_infra).toEqual({
      key: "Replayed infra",
      sentence: "Build & test are estimated from your history; the farm stays idle.",
    });
    expect(SAFETY_CLAIMS.real_models).toEqual({
      key: "Real models",
      sentence: "Prompts & routing are exercised for real — that's what you're testing.",
    });
    expect(SAFETY_CLAIM_COUNT).toBe(3);
  });
});

describe("the columns are the payload's", () => {
  it("draws all three, in the payload's order, when the harness backs all three", () => {
    expect(safetyColumns(drySafety()).map((column) => column.id)).toEqual([
      "simulated_writes",
      "replayed_infra",
      "real_models",
    ]);
  });

  it("follows the payload's order, not a list kept here", () => {
    const safety = drySafety({ columns: [safetyColumn("real_models"), safetyColumn("simulated_writes")] });

    expect(safetyColumns(safety).map((column) => column.id)).toEqual(["real_models", "simulated_writes"]);
  });

  it.each(["simulated_writes", "replayed_infra", "real_models"] as const)(
    "drops %s when the payload does not carry it — a removed claim is absent, not static text",
    (removed) => {
      const whole = drySafety();
      const safety = drySafety({ columns: whole.columns.filter((column) => column.id !== removed) });
      const columns = safetyColumns(safety);

      expect(columns).toHaveLength(2);
      expect(columns.map((column) => column.id)).not.toContain(removed);
      expect(JSON.stringify(columns)).not.toContain(SAFETY_CLAIMS[removed].sentence);
    },
  );

  it.each(["simulated_writes", "replayed_infra", "real_models"] as const)(
    "drops %s when its mechanism no longer holds",
    (weakened) => {
      const safety = drySafety({
        columns: drySafety().columns.map((column) =>
          column.id === weakened ? safetyColumn(weakened, { holds: false }) : column,
        ),
      });

      expect(safetyColumns(safety).map((column) => column.id)).not.toContain(weakened);
    },
  );

  it("draws nothing for an empty payload — there is no fallback", () => {
    expect(safetyColumns(drySafety({ columns: [] }))).toEqual([]);
  });

  it("draws nothing for a claim this build cannot word, and never reads one off the prototype", () => {
    const unknown = { ...safetyColumn("real_models"), id: "sandboxed_network" } as never;
    const inherited = { ...safetyColumn("real_models"), id: "constructor" } as never;

    expect(safetyColumns(drySafety({ columns: [unknown, inherited] }))).toEqual([]);
  });

  it("draws a claim once when the payload repeats it", () => {
    const safety = drySafety({ columns: [safetyColumn("real_models"), safetyColumn("real_models")] });

    expect(safetyColumns(safety)).toHaveLength(1);
  });
});

describe("each claim traces to its mechanism", () => {
  const [writes, infra, models] = safetyColumns(drySafety());

  it("names the overlay, with the tools that write to it and where writes and reads go", () => {
    expect(writes!.mechanism).toBe(MECHANISM_WORDS.overlay);
    expect(writes!.detail).toBe(safetyColumn("simulated_writes").mechanism.detail);
    expect(writes!.facts).toEqual([
      { term: TOOLS_TERM, value: "write_file · apply_patch", mono: true },
      { term: WRITES_TERM, value: "memory_overlay", mono: true },
      { term: READS_TERM, value: "pinned_commit", mono: true },
    ]);
  });

  it("names the estimator, with its tools, its path and its sample basis", () => {
    expect(infra!.mechanism).toBe(MECHANISM_WORDS.estimator_service);
    expect(infra!.facts).toEqual([
      { term: TOOLS_TERM, value: "run_build · run_tests", mono: true },
      { term: PATH_TERM, value: "/internal/dry-runs/{id}/replay-estimates", mono: true },
      {
        term: FORMULAS_TERM,
        value: "build_duration_replay v1 — median ± mad · test_duration_replay v1 — median ± mad",
        mono: true,
      },
    ]);
  });

  it("names the gateway's routing, with the path every model call goes through", () => {
    expect(models!.mechanism).toBe(MECHANISM_WORDS.gateway_routing);
    expect(models!.facts).toEqual([{ term: PATH_TERM, value: "/internal/llm/invoke", mono: true }]);
  });

  it("carries the service's own sentence as the detail, whatever it says", () => {
    const column = safetyColumn("simulated_writes");
    const safety = drySafety({
      columns: [{ ...column, mechanism: { ...column.mechanism, detail: "Edits go to a scratch tree." } }],
    });

    expect(safetyColumns(safety)[0]!.detail).toBe("Edits go to a scratch tree.");
  });

  it("leaves out a fact the payload does not carry, and one it cannot read", () => {
    const column = safetyColumn("replayed_infra");
    const safety = drySafety({
      columns: [
        {
          ...column,
          mechanism: { ...column.mechanism, tools: [], path: null },
          facts: { writes: 7, reads: "", formulas: [null, "text", { version: 1 }, { id: "bare" }] },
        },
      ],
    });

    expect(safetyColumns(safety)[0]!.facts).toEqual([{ term: FORMULAS_TERM, value: "bare", mono: true }]);
  });

  it("names the ⓘ for the claim it explains", () => {
    expect(mechanismButtonName("Simulated writes")).toBe("How “Simulated writes” is enforced");
  });
});

describe("what is withheld", () => {
  it("says nothing for a whole strip", () => {
    expect(withheldNote(3)).toBeNull();
  });

  it("says one claim is not shown, and why, without repeating it", () => {
    const note = withheldNote(2)!;

    expect(note).toBe(
      "1 of this strip's 3 claims is not shown: the installed dry-run harness does not back it, so the page does not make it.",
    );
    for (const claim of Object.values(SAFETY_CLAIMS)) {
      expect(note).not.toContain(claim.sentence);
      expect(note).not.toContain(claim.key);
    }
  });

  it("counts two", () => {
    expect(withheldNote(1)).toBe(
      "2 of this strip's 3 claims are not shown: the installed dry-run harness does not back them, so the page does not make them.",
    );
  });

  it("warns outright when none holds", () => {
    expect(withheldNote(0)).toBe(NOTHING_HELD_NOTE);
    expect(NOTHING_HELD_NOTE).toMatch(/Do not rely on a dry run being safe/);
  });
});
