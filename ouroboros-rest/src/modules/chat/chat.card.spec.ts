import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fallbackText, intervalSeconds, shortDuration, statsLine } from "./chat.card";
import { ARCHETYPES, FixtureChatBackend, UI_URL, plainLines } from "./chat.fixture";

/**
 * The card model (#536): mockup 19's archetypes as plain data, drawn by a backend that is not
 * Slack — which is what makes the Block Kit backend replaceable.
 */

describe("mockup 19's archetypes, field for field", () => {
  it("is the finished loop: ok, the issue, a full stats line and two links", () => {
    expect(ARCHETYPES.loop_finished).toEqual({
      kind: "card",
      severity: "ok",
      mark: "✓",
      headline: "Loop #1846 finished — PR #512 merged",
      lines: ["#474 Debounce e-stop interrupt handler"],
      stats: "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
      actions: [
        {
          type: "link",
          id: "view_pr",
          label: "View PR ↗",
          url: `${UI_URL}/prs/a1370000-0000-4000-8000-000000000512`,
        },
        {
          type: "link",
          id: "run_console",
          label: "Run console",
          url: `${UI_URL}/runs/a1360000-0000-4000-8000-000000001846`,
        },
      ],
      footnote: null,
    });
  });

  it("is the question: warn, the kind's own words, its buttons in the kind's order and the countdown", () => {
    expect(ARCHETYPES.question).toEqual({
      kind: "card",
      severity: "warn",
      mark: "⏸",
      headline: "Allow a one-time edit to a protected path?",
      lines: [
        "The OTA rollback fix wants to add one line to boot/rollback_flag.c — a protected path. Diff is 3 lines, shown in the run console.",
        "loop #1851 · issue #479 · boot/rollback_flag.c",
      ],
      stats: null,
      actions: [
        {
          type: "answer",
          id: "allow_once",
          label: "Allow once",
          style: "primary",
          value: "signed:allow_once",
        },
        {
          type: "link",
          id: "view_diff",
          label: "View diff →",
          url: `${UI_URL}/runs/a1360000-0000-4000-8000-000000001851#run-changes`,
        },
        { type: "answer", id: "deny", label: "Deny", style: "default", value: "signed:deny" },
        {
          type: "link",
          id: "edit_protected_paths",
          label: "Edit protected paths →",
          url: `${UI_URL}/knowledge#repo-profile`,
        },
      ],
      footnote: "paused 4m · escalates to the Needs-you inbox in 26m",
    });
  });

  it("is the green build: accent, one headline, one link", () => {
    expect(ARCHETYPES.build_green).toMatchObject({
      severity: "accent",
      mark: "⟳",
      headline: "Loop #1847 build 3 green — 63/63 · publishing PR #514 rev 2",
      lines: [],
      stats: null,
      actions: [{ type: "link", label: "PR verification →" }],
      footnote: null,
    });
  });

  it("is the system line: who answered, with what, about what", () => {
    expect(ARCHETYPES.system_line).toEqual({
      kind: "line",
      text: "✓ Maya Chen answered: allow once — loop #1851",
    });
  });
});

describe("a backend that is not Slack", () => {
  const backend = new FixtureChatBackend();

  it.each(Object.entries(ARCHETYPES))(
    "draws the %s archetype from the model alone",
    (_name, model) => {
      const rendered = backend.render(model);

      expect((rendered.payload as { lines: string[] }).lines).toEqual(plainLines(model));
      expect(rendered.text).not.toBe("");
    },
  );

  it("draws the finished loop as text", () => {
    expect(plainLines(ARCHETYPES.loop_finished)).toEqual([
      "[ok] ✓ Loop #1846 finished — PR #512 merged",
      "#474 Debounce e-stop interrupt handler",
      "mono: 14/14 checks · 11m cycle · $0.94 · claude-fable-5",
      `(View PR ↗ → ${UI_URL}/prs/a1370000-0000-4000-8000-000000000512) (Run console → ${UI_URL}/runs/a1360000-0000-4000-8000-000000001846)`,
    ]);
  });

  it("finds no Slack in the model, the port or anything that composes or publishes a card", () => {
    // The interface a second platform implements must not need the first one. Every file of this
    // module except the module file itself (which is where Slack's backend is chosen) is held to
    // that: no import from `slack/`, and no Block Kit word.
    const files = readdirSync(__dirname).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".spec.ts") && file !== "chat.module.ts",
    );

    expect(files).toEqual(expect.arrayContaining(["chat.card.ts", "chat.backend.ts"]));

    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

      expect({ file, imports: /from "\.\.\/slack\//.test(code) }).toEqual({ file, imports: false });
      expect({ file, blocks: /mrkdwn|plain_text|block_id|attachments/.test(code) }).toEqual({
        file,
        blocks: false,
      });
    }
  });
});

describe("the helpers", () => {
  it("joins only the figures that exist, and draws no line from none", () => {
    expect(statsLine(["14/14 checks", null, "claude-fable-5"])).toBe(
      "14/14 checks · claude-fable-5",
    );
    expect(statsLine([null, "", null])).toBeNull();
    expect(statsLine([])).toBeNull();
  });

  it.each([
    [0, "0s"],
    [41, "41s"],
    [240, "4m"],
    [26 * 60 + 59, "26m"],
    [3600, "1h"],
    [3900, "1h 5m"],
    [86_400, "1d"],
    [86_400 + 3 * 3600, "1d 3h"],
    [-5, "0s"],
  ])("prints %i seconds as %s", (seconds, text) => {
    expect(shortDuration(seconds)).toBe(text);
  });

  it.each([
    ["00:30:00", 1800],
    ["1 day", 86_400],
    ["7 days", 604_800],
    ["1 day 02:00:00", 93_600],
    ["01:00:00.5", 3600],
  ])("reads the interval %s", (interval, seconds) => {
    expect(intervalSeconds(interval)).toBe(seconds);
  });

  it.each(["", "soon", "30 minutes", "1 mon"])("does not guess at the interval %j", (interval) => {
    expect(intervalSeconds(interval)).toBeNull();
  });

  it("falls back to the headline with its mark, or the line", () => {
    expect(fallbackText(ARCHETYPES.loop_finished)).toBe("✓ Loop #1846 finished — PR #512 merged");
    expect(fallbackText(ARCHETYPES.system_line)).toBe(
      "✓ Maya Chen answered: allow once — loop #1851",
    );
  });
});
