import { EditorState } from "@codemirror/state";
import { highlightCode } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import {
  DSL_KEYWORDS,
  DSL_TOKEN_CLASSES,
  type DslTokenKind,
  dslHighlightStyle,
  dslLanguage,
  dslSyntax,
} from "@/app/workflows/code/dsl-language";

import { STANDARD_FIX as GOLDEN } from "../../helpers/code-symbols";

/**
 * The DSL's highlighter (V.2, #170): the five token classes mockup 05 colours — `c-kw`, `c-str`,
 * `c-num`, `c-fn`, `c-cm` — found where the mockup finds them, and nothing else coloured.
 *
 * The golden file is U.1's real print of the seed
 * (`schemas/workflow-dsl/fixtures/code/standard-fix.loop.ts`), so *the seeded projection is
 * highlighted* is asserted against the file the page actually shows.
 */

/** The kind each class names, read backwards. */
const KIND_OF_CLASS = new Map<string, DslTokenKind>(
  Object.entries(DSL_TOKEN_CLASSES).map(([kind, name]) => [name, kind as DslTokenKind]),
);

/** One highlighted run of text. */
interface Run {
  readonly text: string;
  readonly kind: DslTokenKind | null;
}

/**
 * Highlight a text the way the editor does, as runs.
 *
 * @param text The text.
 * @returns Every run, in order — a line break is its own `"\n"` run with no kind.
 */
function runs(text: string): Run[] {
  const out: Run[] = [];
  const tree = dslLanguage.parser.parse(text);

  highlightCode(
    text,
    tree,
    dslHighlightStyle,
    (run, classes) => {
      const kind = classes === "" ? null : (KIND_OF_CLASS.get(classes) ?? null);
      expect(classes === "" || kind !== null, `unknown class "${classes}"`).toBe(true);
      out.push({ text: run, kind });
    },
    () => out.push({ text: "\n", kind: null }),
  );

  return out;
}

/**
 * The texts of one kind, in order, trimmed.
 *
 * @param text The text to highlight.
 * @param kind The kind.
 * @returns The runs of that kind.
 */
function ofKind(text: string, kind: DslTokenKind): string[] {
  return runs(text)
    .filter((run) => run.kind === kind)
    .map((run) => run.text.trim())
    .filter((run) => run !== "");
}

describe("the five token classes, as mockup 05 colours them", () => {
  it("marks the import line's keywords and its module string", () => {
    const line = 'import { defineLoop, effort, route } from "@ouroboros/sdk";';

    expect(ofKind(line, "keyword")).toEqual(["import", "from"]);
    expect(ofKind(line, "string")).toEqual(['"@ouroboros/sdk"']);
    // The imported names are ink, not callees: nothing calls them here.
    expect(ofKind(line, "callee")).toEqual([]);
  });

  it("marks `export default defineLoop(\"standard-fix\", {` as the mockup's line 4 does", () => {
    const line = 'export default defineLoop("standard-fix", {';

    expect(ofKind(line, "keyword")).toEqual(["export", "default"]);
    expect(ofKind(line, "callee")).toEqual(["defineLoop"]);
    expect(ofKind(line, "string")).toEqual(['"standard-fix"']);
  });

  it("marks a method call's name but not its receiver, as `i.effort.lte(effort.M)`", () => {
    const line = "    when: (i) => i.effort.lte(effort.M),";

    expect(ofKind(line, "callee")).toEqual(["lte"]);
    expect(ofKind(line, "keyword")).toEqual([]);
    // `when`, `i`, `effort`, `M` — option names and references — stay ink.
    expect(runs(line).filter((run) => run.kind !== null)).toHaveLength(1);
  });

  it("marks numbers with separators whole", () => {
    expect(ofKind("      retries: 2,\n      tokenBudget: 400_000,", "number")).toEqual(["2", "400_000"]);
    expect(ofKind("x: 0x1F, y: 1.5e3", "number")).toEqual(["0x1F", "1.5e3"]);
  });

  it("does not read digits inside a name as a number", () => {
    expect(ofKind("pool2: v14,", "number")).toEqual([]);
  });

  it("marks a trailing line comment, and only the comment, on the gate's line", () => {
    const line = '    }), // the loop bites its tail';

    expect(ofKind(line, "comment")).toEqual(["// the loop bites its tail"]);
    expect(ofKind(line, "string")).toEqual([]);
  });

  it("marks `true` and `false` as keywords, as the mockup's `deleteBranch: true` is", () => {
    expect(ofKind("deleteBranch: true, pushFixup: false", "keyword")).toEqual(["true", "false"]);
  });

  it("does not mistake `//` inside a string for a comment", () => {
    const line = 'url: "https://example.test", // a note';

    expect(ofKind(line, "string")).toEqual(['"https://example.test"']);
    expect(ofKind(line, "comment")).toEqual(["// a note"]);
  });

  it("keeps an escaped quote inside its string", () => {
    expect(ofKind('title: "say \\"hi\\"", next: "x"', "string")).toEqual(['"say \\"hi\\""', '"x"']);
  });

  it("ends an unterminated string at the end of its line, so one typo colours one line", () => {
    const text = 'title: "half\nnext: "analyze",';

    expect(ofKind(text, "string")).toEqual(['"half', '"analyze"']);
  });

  it("marks a callee separated from its parenthesis by spaces", () => {
    expect(ofKind("llm  (\"analyze\")", "callee")).toEqual(["llm"]);
  });
});

describe("state carried across lines", () => {
  it("keeps a multi-line template-literal prompt a string until its closing backtick", () => {
    const text = [
      "      prompt: `Scope the issue.",
      "",
      "Issue: {{issue.title}} // not a comment",
      'Name the files "quoted" too.`,',
      '      next: "effort-recheck",',
    ].join("\n");

    const strings = ofKind(text, "string");

    expect(strings).toEqual([
      "`Scope the issue.",
      "Issue: {{issue.title}} // not a comment",
      'Name the files "quoted" too.`',
      '"effort-recheck"',
    ]);
    expect(ofKind(text, "comment")).toEqual([]);
    expect(ofKind(text, "callee")).toEqual([]);
  });

  it("does not close a template literal at an escaped backtick", () => {
    const text = "prompt: `a \\` b\nc`, next: \"d\"";

    expect(ofKind(text, "string")).toEqual(["`a \\` b", "c`", '"d"']);
  });

  it("keeps a block comment a comment across lines, and resumes ink after it", () => {
    const text = "/* one\ntwo */ trigger(\"x\")";

    expect(ofKind(text, "comment")).toEqual(["/* one", "two */"]);
    expect(ofKind(text, "callee")).toEqual(["trigger"]);
  });
});

describe("the seeded projection", () => {
  const golden = runs(GOLDEN);
  const coloured = (kind: DslTokenKind) => golden.filter((run) => run.kind === kind).map((run) => run.text);

  it("reproduces the text exactly — highlighting never adds or drops a character", () => {
    expect(golden.map((run) => run.text).join("")).toBe(GOLDEN);
  });

  it("colours every one of the five classes somewhere in the file", () => {
    for (const kind of Object.keys(DSL_TOKEN_CLASSES) as DslTokenKind[]) {
      expect(coloured(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it("marks every stage callee the printer writes, and the SDK's methods", () => {
    const callees = new Set(coloured("callee"));

    for (const name of ["defineLoop", "trigger", "llm", "decision", "gate", "infra", "openPr", "backToQueue", "lte", "gt", "alias", "task", "allPassed"]) {
      expect(callees, name).toContain(name);
    }
  });

  it("marks the loop's comment, the round-trip note and the whole layout block as comments", () => {
    const comments = coloured("comment");

    expect(comments).toContain("// the loop bites its tail");
    expect(comments).toContain("// @ouroboros/layout v1 — generated; the canvas owns these lines");
    expect(comments).toContain('// edge checks-green implement "fail ↺"');
  });

  it("marks the token budgets whole", () => {
    expect(coloured("number")).toEqual(expect.arrayContaining(["200_000", "400_000", "120_000"]));
  });

  it("colours no option name, so the keys stay ink as the mockup's do", () => {
    const colouredText = new Set(golden.filter((run) => run.kind !== null).map((run) => run.text.trim()));

    for (const key of ["title", "description", "tokenBudget", "permissions", "stages", "trigger:"]) {
      expect(colouredText.has(key), key).toBe(false);
    }
  });
});

describe("the module's shape", () => {
  it("gives each class a distinct CSS class in the editor's namespace", () => {
    const names = Object.values(DSL_TOKEN_CLASSES);

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^code-editor__[a-z]+$/);
  });

  it("styles nothing inline — the highlighter carries classes and no colours", () => {
    expect(dslHighlightStyle.module).toBeNull();
  });

  it("lists keywords in lower case, each a single word", () => {
    for (const word of DSL_KEYWORDS) expect(word).toMatch(/^[a-z]+$/);
  });

  it("installs into an editor state, and says `//` is its line comment", () => {
    const state = EditorState.create({ doc: GOLDEN, extensions: dslSyntax() });

    expect(state.languageDataAt<{ line: string }>("commentTokens", 0)[0]?.line).toBe("//");
  });
});
