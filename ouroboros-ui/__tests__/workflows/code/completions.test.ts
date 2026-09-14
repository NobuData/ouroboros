import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { CodeSymbolTable } from "@/app/api/workflows";
import { SUGGESTION_DETAIL, dslCompletions } from "@/app/workflows/code/completions";

import { atCursor, CODE_SYMBOLS, loop, stage } from "../../helpers/code-symbols";

/**
 * Schema-driven completions (W.1, [#177](https://github.com/NobuData/ouroboros/issues/177)),
 * through CodeMirror's own `CompletionContext` over the service's golden table.
 *
 * The ticket's fixtures are the three tables below — the trigger block, each stage's options and
 * every predicate form — and each expected list is written out rather than read from the table,
 * so a table that lost an entry fails here as well as in `ouroboros-rest`.
 */

/**
 * Ask the completion source at a fixture's cursor.
 *
 * @param source A fixture with its cursor marked.
 * @param options `explicit` for Ctrl-Space rather than typing (default), and the table to read.
 * @returns What the source answered.
 */
function complete(
  source: string,
  { explicit = true, table = CODE_SYMBOLS }: { explicit?: boolean; table?: CodeSymbolTable } = {},
): CompletionResult | null {
  const { text, pos } = atCursor(source);
  const context = new CompletionContext(EditorState.create({ doc: text }), pos, explicit);
  return dslCompletions(table)(context) as CompletionResult | null;
}

/**
 * The labels offered at a fixture's cursor.
 *
 * @param source A fixture with its cursor marked.
 * @param options See {@link complete}.
 * @returns The labels in order, or `null` when nothing is offered.
 */
function labels(
  source: string,
  options?: { explicit?: boolean; table?: CodeSymbolTable },
): string[] | null {
  return complete(source, options)?.options.map((option) => option.label) ?? null;
}

/** What every predicate-valued key offers. */
const PREDICATE_FORMS = [
  "() => true",
  "(i) => i.effort.",
  "(i) => i.labels.",
  "(i) => i.source.",
  "(i) => i.checks.",
];

/** The effort constants, in the schema's order. */
const EFFORT = ["XS", "S", "M", "L", "XL"];

/** The trackers, in the schema's order. */
const TRACKERS = ["github", "gitlab", "jira", "linear"];

describe("fixtures — the trigger block", () => {
  it.each<[string, string, string[]]>([
    ["defineLoop's keys", loop("  ¦"), ["dsl", "trigger", "stages"]],
    ["the dsl version", loop('  dsl: "¦'), ["1.0"]],
    ["the trigger's keys", loop("  trigger: {\n    ¦"), ["on", "when"]],
    ["the event", loop("  trigger: {\n    on: ¦"), ["issue.queued"]],
    [
      "the condition forms",
      loop("  trigger: {\n    when: ¦"),
      ["(i) => i.effort.", "(i) => i.labels.", "(i) => i.source."],
    ],
    ["the subjects", loop("  trigger: {\n    when: (i) => i.¦"), ["effort", "labels", "source"]],
    ["the effort condition", loop("  trigger: {\n    when: (i) => i.effort.¦"), ["lte"]],
    ["the labels condition", loop("  trigger: {\n    when: (i) => i.labels.¦"), ["all"]],
    ["the source condition", loop("  trigger: {\n    when: (i) => i.source.¦"), ["is"]],
    ["an effort constant", loop("  trigger: {\n    when: (i) => i.effort.lte(effort.¦"), EFFORT],
    ["a tracker", loop('  trigger: {\n    when: (i) => i.source.is("¦'), TRACKERS],
  ])("offers %s", (_case, source, expected) => {
    expect(labels(source)).toEqual(expected);
  });
});

describe("fixtures — each stage's options", () => {
  it("offers every stage call inside `stages`", () => {
    expect(labels(stage("¦"))).toEqual([
      "trigger",
      "llm",
      "infra",
      "decision",
      "gate",
      "openPr",
      "backToQueue",
      "needsReview",
    ]);
  });

  it.each<[string, string[]]>([
    ["trigger", ["title", "description", "next", "branches", "onFail"]],
    [
      "llm",
      [
        "title",
        "description",
        "skill",
        "model",
        "retries",
        "tokenBudget",
        "permissions",
        "prompt",
        "next",
        "branches",
        "onFail",
      ],
    ],
    ["infra", ["title", "description", "farm", "cmd", "next", "branches", "onFail"]],
    ["decision", ["title", "description", "require", "when", "next", "branches", "onFail"]],
    ["gate", ["title", "description", "require", "when", "next", "branches", "onFail"]],
    ["openPr", ["title", "description", "merge", "deleteBranch"]],
    ["backToQueue", ["title", "description"]],
    ["needsReview", ["title", "description"]],
  ])("offers only %s's options inside its call", (callee, expected) => {
    expect(labels(stage(`${callee}("implement", {\n      ¦`))).toEqual(expected);
  });

  it.each<[string, string, string[]]>([
    ["the merge methods", 'openPr("p", {\n      merge: ¦', ["squash", "merge", "rebase"]],
    ["true and false", 'openPr("p", {\n      deleteBranch: ¦', ["true", "false"]],
    ["the permission flags", 'llm("a", {\n      permissions: { ¦', ["pushFixup", "touchCi"]],
    ["the route snippets", 'llm("a", {\n      model: ¦', ['route.task("")', 'route.alias("")']],
    ["the route methods", 'llm("a", {\n      model: route.¦', ["task", "alias"]],
    [
      "the workspace's task routes",
      'llm("a", {\n      model: route.task("¦',
      ["analyze", "plan", "implement", "review"],
    ],
    ["the configured skills", 'llm("a", {\n      skill: "¦', ["repo-map", "zephyr-conventions"]],
  ])("offers %s", (_case, call, expected) => {
    expect(labels(stage(call))).toEqual(expected);
  });
});

describe("fixtures — every predicate form", () => {
  it.each<[string, string, string[]]>([
    ["the forms in a decision", 'decision("d", {\n      when: ¦', PREDICATE_FORMS],
    ["the forms in a gate", 'gate("g", {\n      when: ¦', PREDICATE_FORMS],
    ["the forms in a branch", 'decision("d", {\n      branches: [\n        { to: "a", when: ¦', PREDICATE_FORMS],
    ["the forms in onFail", 'gate("g", {\n      onFail: [\n        { to: "a", when: ¦', PREDICATE_FORMS],
    ["an edge entry's keys", 'gate("g", {\n      branches: [\n        { ¦', ["to", "when"]],
    ["the subjects", 'decision("d", {\n      when: (i) => i.¦', ["effort", "labels", "source", "checks"]],
    ["the effort methods", 'decision("d", {\n      when: (i) => i.effort.¦', ["lt", "lte", "eq", "gte", "gt"]],
    ["the labels methods", 'decision("d", {\n      when: (i) => i.labels.¦', ["any", "all", "none"]],
    ["the source methods", 'decision("d", {\n      when: (i) => i.source.¦', ["in", "notIn"]],
    ["the checks methods", 'gate("g", {\n      when: (i) => i.checks.¦', ["allPassed", "anyFailed"]],
    ["an effort constant", 'decision("d", {\n      when: (i) => i.effort.gt(effort.¦', EFFORT],
    ["a tracker in a list", 'decision("d", {\n      when: (i) => i.source.in(["github", "¦', TRACKERS],
  ])("offers %s", (_case, call, expected) => {
    expect(labels(stage(call))).toEqual(expected);
  });
});

describe("context", () => {
  it("offers implement's keys inside implement, and no other stage's", () => {
    const offered = labels(stage('llm("implement", {\n      ¦'));

    expect(offered).not.toContain("merge");
    expect(offered).not.toContain("farm");
    expect(offered).not.toContain("require");
  });

  it("offers a terminal's keys inside the terminal, and not implement's", () => {
    const offered = labels(stage('llm("implement", {\n      retries: 2,\n    }),\n    openPr("open-pr", {\n      ¦'));

    expect(offered).toEqual(["title", "description", "merge", "deleteBranch"]);
  });

  it("offers a key the table gains with no change here", () => {
    const table: CodeSymbolTable = {
      ...CODE_SYMBOLS,
      scopes: CODE_SYMBOLS.scopes.map((scope) =>
        scope.scope === "stage.infra.options"
          ? { ...scope, completions: [...scope.completions, { label: "timeoutSeconds", kind: "property" }] }
          : scope,
      ),
    };

    expect(labels(stage('infra("build", {\n      ¦'), { table })).toContain("timeoutSeconds");
  });
});

describe("what a completion inserts and says", () => {
  it("quotes a string value outside quotes, and not inside them", () => {
    const bare = complete(stage('openPr("p", {\n      merge: ¦'))!;
    const quoted = complete(stage('openPr("p", {\n      merge: "¦'))!;

    expect(bare.options[0]).toMatchObject({ label: "squash", apply: '"squash"', type: "enum" });
    expect(quoted.options[0]).toMatchObject({ label: "squash", apply: "squash" });
  });

  it("inserts a constant, a key and a snippet as written", () => {
    expect(complete(stage('openPr("p", {\n      deleteBranch: ¦'))!.options[0]).not.toHaveProperty(
      "apply",
    );
    expect(complete(stage('llm("a", {\n      model: ¦'))!.options[0]).toMatchObject({
      label: 'route.task("")',
      type: "text",
    });
  });

  it("prints a symbol's signature beside it, and its doc as info", () => {
    const [task] = complete(stage('llm("a", {\n      model: ¦'))!.options;
    const budget = complete(stage('llm("a", {\n      ¦'))!.options.find(
      (option) => option.label === "tokenBudget",
    );

    expect(task).toMatchObject({
      detail: "(name: TaskKind): ModelRoute",
      info: "Resolves the model assigned to a task kind in Model Routing.",
    });
    expect(budget).toMatchObject({ type: "property", detail: ": integer" });
    expect(budget?.info).toMatch(/^Tokens, as a number\./);
  });

  it("gives an option the schema does not describe no info at all", () => {
    const retries = complete(stage('llm("a", {\n      ¦'))!.options.find(
      (option) => option.label === "retries",
    );

    expect(retries).toMatchObject({ detail: ": integer" });
    expect(retries).not.toHaveProperty("info");
  });

  it("labels a workspace name as a suggestion, and nothing more", () => {
    const [analyze] = complete(stage('llm("a", {\n      model: route.task("¦'))!.options;

    expect(analyze).toEqual({
      label: "analyze",
      type: "enum",
      detail: SUGGESTION_DETAIL,
      apply: "analyze",
    });
  });

  it("replaces from the start of the word being typed", () => {
    const { text, pos } = atCursor(stage('llm("a", {\n      tok¦'));
    const result = dslCompletions(CODE_SYMBOLS)(
      new CompletionContext(EditorState.create({ doc: text }), pos, false),
    ) as CompletionResult;

    expect(result.from).toBe(pos - 3);
    expect(result.validFor).toBeInstanceOf(RegExp);
    expect((result.validFor as RegExp).test("tokenB")).toBe(true);
    expect((result.validFor as RegExp).test("token:")).toBe(false);
  });
});

describe("when it opens", () => {
  it("does not open unasked at an empty position", () => {
    expect(labels(stage('llm("a", {\n      ¦'), { explicit: false })).toBeNull();
  });

  it("opens unasked after a word, a dot or a quote", () => {
    expect(labels(stage('llm("a", {\n      ret¦'), { explicit: false })).not.toBeNull();
    expect(labels(stage('llm("a", {\n      model: route.¦'), { explicit: false })).toEqual([
      "task",
      "alias",
    ]);
    expect(labels(stage('openPr("p", {\n      merge: "¦'), { explicit: false })).not.toBeNull();
  });
});

describe("where nothing is offered", () => {
  it.each([
    ["inside a comment", loop("  // ¦")],
    ["inside a prompt", stage('llm("a", {\n      prompt: `Scope the issue ¦')],
    ["for a callee the grammar does not have", stage('review("r", {\n      ¦')],
    ["for a free string", stage('infra("b", {\n      cmd: "¦')],
    ["for an alias name, which nothing suggests", stage('llm("a", {\n      model: route.alias("¦')],
    ["for a node id", stage('llm("a", {\n      next: "¦')],
  ])("offers nothing %s", (_case, source) => {
    expect(complete(source)).toBeNull();
  });

  it("offers nothing for a suggestion scope with nothing to suggest", () => {
    const table: CodeSymbolTable = {
      ...CODE_SYMBOLS,
      scopes: CODE_SYMBOLS.scopes.map((scope) =>
        scope.scope === "route.task" ? { ...scope, completions: [] } : scope,
      ),
    };

    expect(complete(stage('llm("a", {\n      model: route.task("¦'), { table })).toBeNull();
  });
});
