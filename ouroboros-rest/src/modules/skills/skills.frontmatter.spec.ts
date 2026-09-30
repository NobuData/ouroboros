import {
  FrontmatterSchema,
  MAX_TRIGGERS,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  parseSkillDocument,
  printSkillDocument,
} from "./skills.frontmatter";

/**
 * A skill as a document (#410): markdown with YAML frontmatter, read into V069's typed shape and
 * printed back canonically.
 */

/** The seeded zephyr-conventions version's frontmatter (R__dev_seed_workspace_knowledge.sql). */
const ZEPHYR = {
  name: "zephyr-conventions",
  description: "Kconfig, devicetree & ISR-safety house rules",
  scope: "repo",
  load: "on_trigger",
  triggers: ["Kconfig", "devicetree", "ISR"],
} as const;

const FILE = [
  "---",
  "name: zephyr-conventions",
  "description: Kconfig, devicetree & ISR-safety house rules",
  "scope: repo",
  "load: on_trigger",
  "triggers:",
  "  - Kconfig",
  "  - devicetree",
  "  - ISR",
  "---",
  "",
  "# Zephyr conventions",
  "",
  "Prefer `k_msgq` over `k_fifo` in ISR paths.",
].join("\n");

/**
 * The document parsed, or a failure naming why not.
 *
 * @param text - The file.
 * @returns The parsed document.
 */
function parsed(text: string) {
  const result = parseSkillDocument(text);

  if (!result.ok) throw new Error(`expected ${JSON.stringify(text)} to parse`);

  return result.document;
}

/**
 * The issues a refused file carries.
 *
 * @param text - The file.
 * @returns Its issues.
 */
function issues(text: string) {
  const result = parseSkillDocument(text);

  if (result.ok) throw new Error(`expected ${JSON.stringify(text)} to be refused`);

  return result.issues;
}

describe("reading a skill document", () => {
  it("splits the frontmatter from the markdown, typed", () => {
    const document = parsed(FILE);

    expect(document.frontmatter).toEqual(ZEPHYR);
    expect(document.body).toBe(
      "# Zephyr conventions\n\nPrefer `k_msgq` over `k_fifo` in ISR paths.",
    );
  });

  it("reads Windows line endings as the same document", () => {
    expect(parsed(FILE.replaceAll("\n", "\r\n"))).toEqual(parsed(FILE));
  });

  it("keeps a body with no blank line after the fence whole", () => {
    expect(parsed("---\nname: a\ndescription: b\n---\nfirst line").body).toBe("first line");
  });

  it("accepts an empty body — a draft may be empty while it is being written", () => {
    expect(parsed("---\nname: a\ndescription: b\n---\n").body).toBe("");
  });

  it("refuses a file that does not open with the fence, on line 1", () => {
    const [issue, ...rest] = issues("name: a\n---\n");

    expect(rest).toEqual([]);
    expect(issue.line).toBe(1);
    expect(issue.message).toMatch(/opens with a ---/);
  });

  it("refuses a frontmatter that is never closed", () => {
    expect(issues("---\nname: a\n").map((issue) => issue.message)).toEqual([
      expect.stringMatching(/never closed/) as string,
    ]);
  });

  it("refuses YAML that does not parse, with the file's line", () => {
    const refused = issues("---\nname: a\ndescription: [unclosed\n---\nbody");

    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0].line).not.toBeNull();
  });

  it("refuses a frontmatter that is not a mapping", () => {
    expect(issues("---\n- a\n- b\n---\nbody").map((issue) => issue.message)).toEqual([
      expect.stringMatching(/key: value/) as string,
    ]);
  });

  it("requires the name and description the registry row mirrors", () => {
    expect(
      issues("---\n---\nbody")
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(["description", "name"]);
  });

  it("anchors a bad key on the line it is written on", () => {
    const refused = issues("---\nname: a\ndescription: b\nscope: galaxy\n---\nbody");

    expect(refused).toEqual([expect.objectContaining({ path: "scope", line: 4 })]);
  });
});

describe("the frontmatter's shape agrees with V069's skill_frontmatter_typed", () => {
  // Each row is a frontmatter the database would accept or refuse (beside the name and
  // description this service requires on top), so the service refuses first and never lets a
  // CHECK violation reach a person as a 500.
  const BASE = { name: "a", description: "b" };

  it.each([
    ["the base document", {}, true],
    ["a declared scope", { scope: "workflow" }, true],
    ["an unknown scope", { scope: "galaxy" }, false],
    ["an unknown key", { owner: "ken" }, false],
    ["a blank name", { name: "  " }, false],
    ["a non-string description", { description: 3 }, false],
    ["load: always without triggers", { load: "always" }, true],
    ["load: on_trigger without triggers", { load: "on_trigger" }, false],
    ["load: on_trigger with a trigger", { load: "on_trigger", triggers: ["ISR"] }, true],
    ["an unknown load", { load: "sometimes" }, false],
    ["an empty trigger list", { triggers: [] }, false],
    ["a blank trigger", { triggers: ["ISR", " "] }, false],
    [
      "the most triggers",
      { triggers: Array.from({ length: MAX_TRIGGERS }, (_, i) => `t${i}`) },
      true,
    ],
    [
      "one trigger too many",
      { triggers: Array.from({ length: MAX_TRIGGERS + 1 }, (_, i) => `t${i}`) },
      false,
    ],
    ["import provenance", { provenance: { source: "CLAUDE.md", section: "Build" } }, true],
    ["provenance without a source", { provenance: { section: "Build" } }, false],
    ["provenance with an unknown key", { provenance: { source: "CLAUDE.md", line: 3 } }, false],
    ["a blank provenance section", { provenance: { source: "CLAUDE.md", section: "" } }, false],
  ])("%s", (_name, extra, accepted) => {
    expect(FrontmatterSchema.safeParse({ ...BASE, ...extra }).success).toBe(accepted);
  });

  it("holds name and description to the registry row's limits", () => {
    expect(
      FrontmatterSchema.safeParse({ name: "n".repeat(SKILL_NAME_MAX_LENGTH), description: "d" })
        .success,
    ).toBe(true);
    expect(
      FrontmatterSchema.safeParse({ name: "n".repeat(SKILL_NAME_MAX_LENGTH + 1), description: "d" })
        .success,
    ).toBe(false);
    expect(
      FrontmatterSchema.safeParse({
        name: "n",
        description: "d".repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe("printing a skill document", () => {
  it("round-trips: what is printed reads back as the same frontmatter and body", () => {
    const document = parsed(FILE);
    const printed = printSkillDocument(document.frontmatter, document.body);

    expect(parsed(printed)).toEqual(document);
  });

  it("round-trips a body that begins with blank lines", () => {
    const body = "\n\nIndented start";
    const printed = printSkillDocument(ZEPHYR, body);

    expect(parsed(printed).body).toBe(body);
  });

  it("writes the keys in one order, whatever order they were stored in", () => {
    const printed = printSkillDocument(
      { triggers: ["ISR"], load: "on_trigger", description: "b", name: "a" },
      "body",
    );

    expect(printed).toBe(
      "---\nname: a\ndescription: b\nload: on_trigger\ntriggers:\n  - ISR\n---\n\nbody",
    );
  });

  it("shows an unknown stored key rather than dropping it, so the next save can refuse it", () => {
    expect(printSkillDocument({ name: "a", description: "b", owner: "ken" }, "")).toContain(
      "owner: ken",
    );
  });

  it("prints an empty frontmatter as two fences", () => {
    expect(printSkillDocument({}, "body")).toBe("---\n---\n\nbody");
  });
});
