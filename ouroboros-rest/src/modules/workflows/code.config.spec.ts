import { CONFIG_PREAMBLE, printWorkflowConfig, type ConfiguredWorkflow } from "./code.config";
import { syntaxErrors } from "./code.recover.fixture";

/**
 * `ouroboros.config.ts` — U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)),
 * decision **C6**.
 *
 * The file is a projection of the registry and nothing more, so what is held here is that it
 * lists exactly the rows it was given, in their order, as TypeScript the compiler reads without a
 * complaint, and that no value — however it is spelled — can change the file's shape.
 */

/** Mockup 04's rail, trimmed: an active workflow, the paused one, and one never published. */
const RAIL: readonly ConfiguredWorkflow[] = [
  { slug: "standard-fix", name: "Standard Fix", status: "active", current_version: 14 },
  { slug: "hotfix-p0", name: "Hotfix P0", status: "paused", current_version: 3 },
  { slug: "release-train", name: "Release train", status: "active", current_version: null },
];

/** U+2028, built from its code point so this file never holds it raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("ouroboros.config.ts", () => {
  it("lists the workspace's workflows, their statuses and versions, in the rail's order", () => {
    expect(printWorkflowConfig("acme-robotics", RAIL)).toBe(
      [
        ...CONFIG_PREAMBLE,
        "",
        "export default {",
        '  workspace: "acme-robotics",',
        "  workflows: [",
        '    { slug: "standard-fix", name: "Standard Fix", status: "active", version: 14 },',
        '    { slug: "hotfix-p0", name: "Hotfix P0", status: "paused", version: 3 },',
        '    { slug: "release-train", name: "Release train", status: "active", version: null },',
        "  ],",
        "};",
        "",
      ].join("\n"),
    );
  });

  it("lists no workflows for a workspace with none, rather than inventing a default", () => {
    const text = printWorkflowConfig("empty-works", []);

    expect(text).toContain("  workflows: [],\n");
    expect(text).not.toContain("standard-fix");
  });

  it("says it is read-only, and where its values are changed", () => {
    expect(CONFIG_PREAMBLE.join(" ")).toMatch(/read-only/);
    expect(CONFIG_PREAMBLE.join(" ")).toMatch(/studio/);
  });

  it("is TypeScript the compiler reads without a diagnostic", () => {
    expect(syntaxErrors(printWorkflowConfig("acme-robotics", RAIL))).toEqual([]);
    expect(syntaxErrors(printWorkflowConfig("acme-robotics", []))).toEqual([]);
  });

  it("imports nothing, so it claims nothing about @ouroboros/sdk", () => {
    expect(printWorkflowConfig("acme-robotics", RAIL)).not.toMatch(/^import /m);
  });

  it("keeps a name with quotes and line breaks to one line, and reads it back exactly", () => {
    const name = `Say "hi"\nthen${LINE_SEPARATOR}go`;
    const text = printWorkflowConfig("acme-robotics", [{ ...RAIL[0], name }]);
    const entry = text.split("\n").find((line) => line.includes('slug: "standard-fix"'));
    const literal = /name: ("(?:[^"\\]|\\.)*")/.exec(entry ?? "")?.[1];

    // As many lines as the same file with a plain name: the escapes kept the entry on its line.
    expect(text.split("\n")).toHaveLength(
      printWorkflowConfig("acme-robotics", [RAIL[0]]).split("\n").length,
    );
    expect(syntaxErrors(text)).toEqual([]);
    expect(JSON.parse(literal ?? "null")).toBe(name);
  });

  it("prints the same bytes for the same rows", () => {
    expect(printWorkflowConfig("acme-robotics", RAIL)).toBe(
      printWorkflowConfig("acme-robotics", [...RAIL]),
    );
  });
});
