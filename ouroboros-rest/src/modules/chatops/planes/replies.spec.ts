import {
  COPILOT_LABEL,
  copilotLink,
  counted,
  dollars,
  DRY_RUN_STARTED,
  dryRunResult,
  dryRunStillRunning,
  estimateLine,
  queuedLine,
  statusLine,
  tokenCount,
  type DryRunEnding,
} from "./replies";

/**
 * What the `/ouro` commands say back (#537). The two replies mockup 19 seeds are held to the
 * mockup's own text here; the rest is the wording's one home, so a change to a sentence is a
 * change to this file and nowhere else.
 */

const LINK = copilotLink("https://ouroboros.example", "standard-fix");

/** A clean, complete, priced run. */
const COMPLETE: DryRunEnding = {
  status: "complete",
  failureReason: null,
  durationMs: 174_000,
  costCents: 42,
  guardsClean: true,
  guardBlocks: 0,
  suggestions: 2,
};

describe("the /ouro replies", () => {
  describe("mockup 19's seeded lines", () => {
    it("prints the status line as the mockup boxes it", () => {
      expect(
        statusLine({
          loopsLive: 3,
          queued: 12,
          runnersOnline: 4,
          runnersTotal: 5,
          spendTodayCents: 1860,
          needsYou: 3,
        }),
      ).toBe("3 loops live · 12 queued · farm 4/5 online · spend today $18.60 · needs-you: 3");
    });

    it("prints the queue acknowledgement as the mockup has it", () => {
      expect(queuedLine(2, "standard-fix", 14)).toBe(
        "queued at position 2 (pinned standard-fix@v14)",
      );
    });

    it("acknowledges a dry run in the mockup's words", () => {
      expect(DRY_RUN_STARTED).toBe(
        "Dry run started — no writes, no PRs. Results in ~3 min → follow in Workflow Copilot",
      );
    });
  });

  describe("statusLine", () => {
    it("says one loop in the singular and an idle workspace in zeroes", () => {
      const idle = {
        loopsLive: 0,
        queued: 0,
        runnersOnline: 0,
        runnersTotal: 0,
        spendTodayCents: 0,
        needsYou: 0,
      };

      expect(statusLine(idle)).toBe(
        "0 loops live · 0 queued · farm 0/0 online · spend today $0.00 · needs-you: 0",
      );
      expect(statusLine({ ...idle, loopsLive: 1 })).toMatch(/^1 loop live · /);
    });
  });

  describe("queuedLine", () => {
    it("claims no pin for a workflow with nothing published", () => {
      expect(queuedLine(1, "deep-fix", null)).toBe(
        "queued at position 1 (deep-fix — nothing published to pin)",
      );
    });
  });

  describe("dollars", () => {
    it.each([
      [1860, "$18.60"],
      [0, "$0.00"],
      [5, "$0.05"],
      [100_000, "$1000.00"],
      // A fraction of a cent is rounded to the cent, not truncated.
      [41.6, "$0.42"],
    ])("prints %d cents as %s", (cents, printed) => {
      expect(dollars(cents)).toBe(printed);
    });
  });

  describe("counted", () => {
    it("pluralises with an s unless told the plural", () => {
      expect(counted(1, "loop")).toBe("1 loop");
      expect(counted(0, "loop")).toBe("0 loops");
      expect(counted(3, "loop")).toBe("3 loops");
      expect(counted(2, "entry", "entries")).toBe("2 entries");
    });
  });

  describe("tokenCount", () => {
    it.each([
      [850, "850"],
      [999, "999"],
      [1000, "1k"],
      [12_400, "12k"],
      [999_499, "999k"],
      [1_000_000, "1.0M"],
      [1_240_000, "1.2M"],
    ])("abbreviates %d as %s", (tokens, printed) => {
      expect(tokenCount(tokens)).toBe(printed);
    });
  });

  describe("copilotLink", () => {
    it("points at the workflow's Copilot page on the public origin", () => {
      expect(LINK).toEqual({
        label: "Workflow Copilot",
        url: "https://ouroboros.example/workflows/standard-fix/copilot",
      });
      expect(COPILOT_LABEL).toBe("Workflow Copilot");
    });

    it("encodes a slug into one path segment", () => {
      expect(copilotLink("https://ouroboros.example", "a/b c").url).toBe(
        "https://ouroboros.example/workflows/a%2Fb%20c/copilot",
      );
    });
  });

  describe("dryRunResult", () => {
    it("says the ending, the duration, the cost, the guards and the suggestions, with the link", () => {
      expect(dryRunResult("standard-fix on #486", COMPLETE, LINK)).toEqual({
        text: "Dry run of standard-fix on #486 complete · 2m 54s · $0.42 · guards clean · 2 suggestions → open in Workflow Copilot",
        link: LINK,
      });
    });

    it("names no cost when a stage had no price: unknown is not zero", () => {
      const { text } = dryRunResult("standard-fix on #486", { ...COMPLETE, costCents: null }, LINK);

      expect(text).toBe(
        "Dry run of standard-fix on #486 complete · 2m 54s · guards clean · 2 suggestions → open in Workflow Copilot",
      );
    });

    it("prints a cost of nothing as $0.00, which is a price", () => {
      const { text } = dryRunResult("standard-fix on #486", { ...COMPLETE, costCents: 0 }, LINK);

      expect(text).toContain(" · $0.00 · ");
    });

    it("leaves out a duration it does not have, and suggestions it has none of or could not read", () => {
      const bare = { ...COMPLETE, durationMs: null, costCents: null };

      expect(dryRunResult("x on #1", { ...bare, suggestions: 0 }, LINK).text).toBe(
        "Dry run of x on #1 complete · guards clean → open in Workflow Copilot",
      );
      expect(dryRunResult("x on #1", { ...bare, suggestions: null }, LINK).text).toBe(
        "Dry run of x on #1 complete · guards clean → open in Workflow Copilot",
      );
      expect(dryRunResult("x on #1", { ...bare, suggestions: 1 }, LINK).text).toBe(
        "Dry run of x on #1 complete · guards clean · 1 suggestion → open in Workflow Copilot",
      );
    });

    it("counts the writes the guards blocked rather than calling the run clean", () => {
      const blocked = { ...COMPLETE, guardsClean: false, suggestions: null };

      expect(dryRunResult("x on #1", { ...blocked, guardBlocks: 1 }, LINK).text).toBe(
        "Dry run of x on #1 complete · 2m 54s · $0.42 · 1 write blocked by the guards → open in Workflow Copilot",
      );
      expect(dryRunResult("x on #1", { ...blocked, guardBlocks: 3 }, LINK).text).toContain(
        " · 3 writes blocked by the guards → ",
      );
    });

    it.each([
      ["failed", "stage implement timed out", "failed: stage implement timed out"],
      ["failed", null, "failed"],
      ["budget_stopped", null, "stopped at its budget"],
      ["cancelled", null, "cancelled"],
    ] as const)("says a %s run (reason %s) as %s", (status, failureReason, words) => {
      const { text } = dryRunResult(
        "x on #1",
        {
          ...COMPLETE,
          status,
          failureReason,
          durationMs: null,
          costCents: null,
          suggestions: null,
        },
        LINK,
      );

      expect(text).toBe(`Dry run of x on #1 ${words} · guards clean → open in Workflow Copilot`);
    });
  });

  describe("dryRunStillRunning", () => {
    it("names no result, because there is none, and still carries the link", () => {
      expect(dryRunStillRunning("standard-fix on #486", LINK)).toEqual({
        text: "Dry run of standard-fix on #486 has not reported an ending yet — follow it in Workflow Copilot",
        link: LINK,
      });
    });
  });

  describe("estimateLine", () => {
    const estimate = {
      effort: "m",
      cycleMin: 20,
      cycleMax: 45,
      estMinutes: 30,
      estTokens: 12_400,
      confidence: 82.4,
      suggestedWorkflow: "standard-fix",
    };

    it("says the estimate in one line", () => {
      expect(estimateLine("#490", estimate)).toBe(
        "#490 — effort M · cycle 20–45 min · est. 30 min · ~12k tokens · confidence 82% · suggests standard-fix",
      );
    });

    it("names no dollar figure: an estimate stores none", () => {
      expect(estimateLine("#490", estimate)).not.toContain("$");
    });
  });
});
