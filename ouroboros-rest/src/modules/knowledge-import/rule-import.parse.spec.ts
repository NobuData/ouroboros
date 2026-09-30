/**
 * The deterministic parse ([#413](https://github.com/NobuData/ouroboros/issues/413)) — golden
 * output for the fixture `CLAUDE.md` and `.cursorrules`, then each rule on its own.
 */

import { CLAUDE_MD, CURSORRULES } from "./rule-import.fixture";
import {
  FACT_CANDIDATE_MAX_LENGTH,
  normalizeFactText,
  normalizeSkillBody,
  parseRuleFile,
} from "./rule-import.parse";

describe("the golden fixtures", () => {
  it("splits CLAUDE.md into its three ## sections, title and preamble outside them", () => {
    expect(parseRuleFile("CLAUDE.md", CLAUDE_MD).skills).toEqual([
      {
        file: "CLAUDE.md",
        section: "Kconfig",
        name: "Kconfig",
        description:
          "Every feature is gated behind a Kconfig symbol, declared in the module that owns it.",
        body: [
          "Every feature is gated behind a **Kconfig** symbol,",
          "declared in the module that owns it.",
          "",
          "- Use `CONFIG_HELIOS_` as the prefix for every new symbol.",
          "- Never enable `CONFIG_ASSERT` in release builds.",
        ].join("\n"),
      },
      {
        file: "CLAUDE.md",
        section: "Devicetree",
        name: "Devicetree",
        description: "Imported from CLAUDE.md — Devicetree.",
        body: [
          "- Board overlays:",
          "  - Keep one overlay per board under `boards/`.",
          "",
          "```sh",
          "# west build -b nrf52840dk",
          "- use this line as code, not a rule",
          "```",
        ].join("\n"),
      },
      {
        file: "CLAUDE.md",
        section: "ISR safety",
        name: "ISR safety",
        description: "Interrupt handlers must never block.",
        body: [
          "Interrupt handlers must never block.",
          "",
          "- Prefer `k_msgq` over `k_fifo` in ISR paths.",
          "- Avoid `printk` inside an ISR;",
          "  defer logging to a work queue.",
          "- ISR stacks are 2 KiB on every board.",
          "",
          "### Checklist",
          "",
          "1. Check `k_is_in_isr()` before sleeping.",
        ].join("\n"),
      },
    ]);
  });

  it("takes CLAUDE.md's short imperative bullets as facts, with their sections", () => {
    expect(parseRuleFile("CLAUDE.md", CLAUDE_MD).facts).toEqual([
      {
        file: "CLAUDE.md",
        section: null,
        text: "Run `west update` before the first build of the day.",
      },
      {
        file: "CLAUDE.md",
        section: "Kconfig",
        text: "Use `CONFIG_HELIOS_` as the prefix for every new symbol.",
      },
      {
        file: "CLAUDE.md",
        section: "Kconfig",
        text: "Never enable `CONFIG_ASSERT` in release builds.",
      },
      {
        file: "CLAUDE.md",
        section: "Devicetree",
        text: "Keep one overlay per board under `boards/`.",
      },
      {
        file: "CLAUDE.md",
        section: "ISR safety",
        text: "Prefer `k_msgq` over `k_fifo` in ISR paths.",
      },
      {
        file: "CLAUDE.md",
        section: "ISR safety",
        text: "Avoid `printk` inside an ISR; defer logging to a work queue.",
      },
      { file: "CLAUDE.md", section: "ISR safety", text: "Check `k_is_in_isr()` before sleeping." },
    ]);
  });

  it("makes the heading-less .cursorrules one skill draft, not invented sections", () => {
    const { skills } = parseRuleFile(".cursorrules", CURSORRULES);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      file: ".cursorrules",
      section: null,
      name: ".cursorrules",
      description: "You are an expert embedded C engineer working on Zephyr RTOS.",
    });
    expect(skills[0].body).toBe(CURSORRULES.trim());
  });

  it("takes eight of .cursorrules' twelve bullets — the four that are not rules stay out", () => {
    expect(parseRuleFile(".cursorrules", CURSORRULES).facts.map((fact) => fact.text)).toEqual([
      "use CONFIG_HELIOS_ as the prefix for every new symbol",
      "Never enable `CONFIG_ASSERT` in release builds!",
      "Write unit tests with ztest for every driver change.",
      "Keep functions under 60 lines.",
      "Don't allocate from the heap in drivers.",
      "Always run `twister -T tests/` before pushing.",
      "Document every public API in its header.",
      "Name threads after their subsystem.",
    ]);
  });
});

describe("sections", () => {
  it("split at the shallowest level used more than once", () => {
    const text = "# A\n\nalpha\n\n# B\n\nbeta\n\n## B.1\n\nnested\n";

    expect(parseRuleFile("AGENTS.md", text).skills.map((s) => [s.section, s.body])).toEqual([
      ["A", "alpha"],
      ["B", "beta\n\n## B.1\n\nnested"],
    ]);
  });

  it("split at the shallowest level present when none repeats", () => {
    const text = "# Only\n\nbody\n\n## Inner\n\nmore\n";

    expect(parseRuleFile("AGENTS.md", text).skills.map((s) => s.section)).toEqual(["Only"]);
  });

  it("number a repeated heading so each (file, section) is unique", () => {
    const text = "## Style\n\none\n\n## Style\n\ntwo\n";

    expect(parseRuleFile("AGENTS.md", text).skills.map((s) => s.section)).toEqual([
      "Style",
      "Style (2)",
    ]);
  });

  it("skip a heading with nothing under it", () => {
    const text = "## Empty\n\n## Full\n\ntext\n";

    expect(parseRuleFile("AGENTS.md", text).skills.map((s) => s.section)).toEqual(["Full"]);
  });

  it("read closing #s, emphasis and links out of a heading's name", () => {
    const text = "## **Build** [rules](https://x.test) ##\n\ntext\n\n## Other\n\nmore\n";

    expect(parseRuleFile("AGENTS.md", text).skills[0].name).toBe("Build rules");
  });

  it("cut a long heading to V069's 120 characters, the section key with it", () => {
    const text = `## ${"x".repeat(300)}\n\ntext\n\n## Other\n\nmore\n`;
    const [first] = parseRuleFile("AGENTS.md", text).skills;

    expect(first.name).toHaveLength(120);
    expect(first.name.endsWith("…")).toBe(true);
    expect(first.section).toBe(first.name);
  });

  it("ignore a # line inside a fence, ``` or ~~~", () => {
    const text = "intro\n\n~~~\n# not a heading\n~~~\n\n```\n## nor this\n```\n";
    const { skills } = parseRuleFile("AGENTS.md", text);

    expect(skills).toHaveLength(1);
    expect(skills[0].section).toBeNull();
  });

  it("do not take `#tag` without a space as a heading", () => {
    expect(parseRuleFile("AGENTS.md", "#tag line\n").skills[0].section).toBeNull();
  });

  it("describe a section by its lead paragraph, cut to 300 characters", () => {
    const text = `## Long\n\n${"word ".repeat(100)}\n\n## Other\n\nx\n`;
    const [first] = parseRuleFile("AGENTS.md", text).skills;

    expect(first.description).toHaveLength(300);
    expect(first.description.endsWith("…")).toBe(true);
  });
});

describe("whole files", () => {
  it("answer nothing for an empty or blank file", () => {
    expect(parseRuleFile("CLAUDE.md", "")).toEqual({ skills: [], facts: [] });
    expect(parseRuleFile("CLAUDE.md", " \n\n\t\n")).toEqual({ skills: [], facts: [] });
  });

  it("drop a leading YAML frontmatter block", () => {
    const text = "---\napplyTo: '**'\n---\nUse tabs for indentation.\n";
    const [skill] = parseRuleFile(".github/copilot-instructions.md", text).skills;

    expect(skill.body).toBe("Use tabs for indentation.");
  });

  it("keep a leading --- that never closes", () => {
    const text = "---\nno closing fence\n";

    expect(parseRuleFile("CLAUDE.md", text).skills[0].body).toBe("---\nno closing fence");
  });

  it("read CRLF files as LF", () => {
    const text = "## A\r\n\r\n- Use CRLF-safe parsing.\r\n\r\n## B\r\n\r\nb\r\n";
    const parsed = parseRuleFile("CLAUDE.md", text);

    expect(parsed.skills.map((s) => s.body)).toEqual(["- Use CRLF-safe parsing.", "b"]);
    expect(parsed.facts.map((f) => f.text)).toEqual(["Use CRLF-safe parsing."]);
  });

  it("fall back to the source for a description when there is no prose", () => {
    expect(parseRuleFile("CLAUDE.md", "- Use tabs.\n").skills[0].description).toBe(
      "Imported from CLAUDE.md.",
    );
  });
});

describe("fact candidates", () => {
  /**
   * @param line - One bullet line.
   * @returns The texts taken from it.
   */
  const facts = (line: string): string[] =>
    parseRuleFile("CLAUDE.md", `${line}\n`).facts.map((fact) => fact.text);

  it.each([
    ["- Use tabs.", "Use tabs."],
    ["* Never push to main.", "Never push to main."],
    ["+ Prefer const.", "Prefer const."],
    ["3. Run the linter.", "Run the linter."],
    ["4) Run the tests.", "Run the tests."],
    ["- [ ] Update the changelog.", "Update the changelog."],
    ["- **Always** squash merge.", "Always squash merge."],
    ["- Don’t commit secrets.", "Don’t commit secrets."],
    ["- Use [the guide](https://x.test) for naming.", "Use the guide for naming."],
    ["  - Keep indented rules too.", "Keep indented rules too."],
  ])("take %j", (line, text) => {
    expect(facts(line)).toEqual([text]);
  });

  it.each([
    ["a description, not a rule", "- The HAL lives in `drivers/`."],
    ["an introduction to a sub-list", "- Always follow these:"],
    ["a single word", "- Use"],
    ["a horizontal rule", "* * *"],
    ["prose, not a list item", "Use tabs for indentation."],
    ["a quoted rule", "> - Use tabs."],
  ])("leave out %s", (_why, line) => {
    expect(facts(line)).toEqual([]);
  });

  it(`leave out a bullet past ${String(FACT_CANDIDATE_MAX_LENGTH)} characters`, () => {
    const long = `- Use ${"x".repeat(FACT_CANDIDATE_MAX_LENGTH)}`;

    expect(facts(long)).toEqual([]);
    expect(facts(`- Use ${"x".repeat(FACT_CANDIDATE_MAX_LENGTH - 4)}`)).toHaveLength(1);
  });

  it("join a bullet's continuation lines, and stop at a blank line", () => {
    const text = "- Avoid globals;\n  pass state explicitly.\n\n  Not part of it.\n";

    expect(parseRuleFile("CLAUDE.md", text).facts.map((f) => f.text)).toEqual([
      "Avoid globals; pass state explicitly.",
    ]);
  });

  it("never take a list item inside a fence", () => {
    expect(facts("```\n- Use this as code.\n```")).toEqual([]);
  });
});

describe("normalization", () => {
  it("treats case, markup, spacing and trailing punctuation as the same fact", () => {
    expect(normalizeFactText("Never enable `CONFIG_ASSERT`  in release builds!")).toBe(
      normalizeFactText("never enable CONFIG_ASSERT in release builds."),
    );
  });

  it("keeps different words different", () => {
    expect(normalizeFactText("Use tabs.")).not.toBe(normalizeFactText("Use spaces."));
  });

  it("treats trailing whitespace and blank-line runs as the same body", () => {
    expect(normalizeSkillBody("a  \r\n\r\n\r\n\r\nb\n\n")).toBe("a\n\nb");
  });
});
