import { describe, expect, it } from "vitest";

import { completionPlace, hoverTarget } from "@/app/workflows/code/context";

import { after, atCursor, loop, stage, STANDARD_FIX, wordIn } from "../../helpers/code-symbols";

/**
 * Naming the cursor's place in a workflow file (W.1,
 * [#177](https://github.com/NobuData/ouroboros/issues/177)) — the half of completions and hover
 * docs that reads text. What each scope *offers* is the table's, and is asserted in
 * `completions.test.ts` and `hover.test.ts`; this suite asserts only that the right scope or
 * symbol is named, in fixtures and in the printer's golden `standard-fix.loop.ts`.
 */

/**
 * The completion place a fixture's cursor is at.
 *
 * @param source A fixture with its cursor marked.
 * @returns The place, or `null`.
 */
function placeOf(source: string) {
  const { text, pos } = atCursor(source);
  return completionPlace(text, pos);
}

/**
 * The scope a fixture's cursor is in.
 *
 * @param source A fixture with its cursor marked.
 * @returns The scope's name, or `null`.
 */
function scopeOf(source: string): string | null {
  return placeOf(source)?.scope ?? null;
}

describe("completion places — the trigger block", () => {
  it("names defineLoop's options", () => {
    expect(scopeOf(loop("  ¦"))).toBe("loop.options");
  });

  it("names a value inside quotes, replacing from the string's content", () => {
    const { text, pos } = atCursor(loop('  dsl: "¦'));

    expect(completionPlace(text, pos)).toEqual({ scope: "loop.dsl", from: pos, quoted: true });
  });

  it("names the trigger's options, replacing the word being typed", () => {
    const { text, pos } = atCursor(loop("  trigger: {\n    wh¦"));

    expect(completionPlace(text, pos)).toEqual({
      scope: "trigger.options",
      from: pos - 2,
      quoted: false,
    });
  });

  it.each([
    ["the event", '  trigger: {\n    on: "¦', "trigger.on"],
    ["the conditions", "  trigger: {\n    when: ¦", "trigger.when"],
    ["a condition's subject", "  trigger: {\n    when: (i) => i.¦", "condition.subjects"],
    ["the effort condition", "  trigger: {\n    when: (i) => i.effort.¦", "condition.effort"],
    ["an effort constant", "  trigger: {\n    when: (i) => i.effort.lte(effort.¦", "effort.constants"],
    ["a tracker", '  trigger: {\n    when: (i) => i.source.is("¦', "source.values"],
    [
      "the next conjunct",
      "  trigger: {\n    when: (i) => i.effort.lte(effort.M) && i.¦",
      "condition.subjects",
    ],
  ])("names %s", (_case, body, scope) => {
    expect(scopeOf(loop(body))).toBe(scope);
  });
});

describe("completion places — each stage's options", () => {
  it("names the stage calls inside `stages`", () => {
    expect(scopeOf(stage("¦"))).toBe("loop.stages");
    expect(scopeOf(stage('llm("a", { title: "A" }),\n    ¦'))).toBe("loop.stages");
  });

  it.each(["trigger", "llm", "infra", "decision", "gate", "openPr", "backToQueue", "needsReview"])(
    "names %s's options inside its call",
    (callee) => {
      expect(scopeOf(stage(`${callee}("id", {\n      ¦`))).toBe(`stage.${callee}.options`);
    },
  );

  it("names the stage the cursor is in, not the one before it", () => {
    expect(scopeOf(stage('llm("a", {\n      title: "A",\n    }),\n    openPr("b", {\n      ¦'))).toBe(
      "stage.openPr.options",
    );
  });

  it("returns to the stage's options after a nested value closes", () => {
    const source = stage(
      'llm("a", {\n      permissions: { pushFixup: true, touchCi: false },\n      ¦',
    );

    expect(scopeOf(source)).toBe("stage.llm.options");
  });

  it("reads past a prompt's braces, quotes and brackets as text", () => {
    const source = stage('llm("a", {\n      prompt: `Use {{plan}} and "quotes" (and [brackets`,\n      ¦');

    expect(scopeOf(source)).toBe("stage.llm.options");
  });

  it("does not let one missing quote swallow the rest of the file", () => {
    const source = stage('llm("a", {\n      title: "open,\n    }),\n    openPr("b", {\n      ¦');

    expect(scopeOf(source)).toBe("stage.openPr.options");
  });

  it.each([
    ["a merge method", 'openPr("p", {\n      merge: "¦', "stage.openPr.merge"],
    ["a boolean", 'openPr("p", {\n      deleteBranch: ¦', "stage.openPr.deleteBranch"],
    ["the permission flags", 'llm("a", {\n      permissions: { ¦', "permissions.options"],
    ["a permission's value", 'llm("a", {\n      permissions: { pushFixup: ¦', "permissions.pushFixup"],
    ["a model route", 'llm("a", {\n      model: ¦', "stage.llm.model"],
    ["a route method", 'llm("a", {\n      model: route.¦', "route.methods"],
    ["a task route", 'llm("a", {\n      model: route.task("¦', "route.task"],
    ["a skill", 'llm("a", {\n      skill: "¦', "stage.llm.skill"],
  ])("names %s", (_case, call, scope) => {
    expect(scopeOf(stage(call))).toBe(scope);
  });

  it("names a callee the grammar does not have, and leaves the table to offer nothing", () => {
    expect(scopeOf(stage('review("r", {\n      ¦'))).toBe("stage.review.options");
  });
});

describe("completion places — every predicate form", () => {
  it.each([
    ["a decision's predicate", 'decision("d", {\n      when: ¦', "stage.decision.when"],
    ["a gate's predicate", 'gate("g", {\n      when: ¦', "stage.gate.when"],
    ["a branch entry's keys", 'decision("d", {\n      branches: [\n        { ¦', "edge.options"],
    ["an onFail entry's keys", 'gate("g", {\n      onFail: [\n        { ¦', "edge.options"],
    ["a branch's predicate", 'decision("d", {\n      branches: [\n        { to: "a", when: ¦', "edge.when"],
    ["a subject", 'decision("d", {\n      when: (i) => i.¦', "predicate.subjects"],
    ["the effort methods", 'decision("d", {\n      when: (i) => i.effort.¦', "predicate.effort"],
    ["the labels methods", 'decision("d", {\n      when: (i) => i.labels.¦', "predicate.labels"],
    ["the source methods", 'decision("d", {\n      when: (i) => i.source.¦', "predicate.source"],
    ["the checks methods", 'gate("g", {\n      onFail: [{ to: "x", when: (i) => i.checks.¦', "predicate.checks"],
    ["an effort constant", 'decision("d", {\n      when: (i) => i.effort.gt(effort.¦', "effort.constants"],
    ["a tracker in a list", 'decision("d", {\n      when: (i) => i.source.notIn(["jira", "¦', "source.values"],
    ["a renamed, bare parameter", 'decision("d", {\n      when: ticket => ticket.labels.¦', "predicate.labels"],
  ])("names %s", (_case, call, scope) => {
    expect(scopeOf(stage(call))).toBe(scope);
  });

  it("ends the arrow's body at the comma", () => {
    expect(scopeOf(stage('decision("d", {\n      when: () => true,\n      ¦'))).toBe(
      "stage.decision.options",
    );
    expect(
      scopeOf(
        stage('decision("d", {\n      branches: [\n        { to: "a", when: (i) => i.effort.lte(effort.M) },\n        { ¦'),
      ),
    ).toBe("edge.options");
  });

  it("names nothing for a member of something that is not the parameter", () => {
    expect(scopeOf(stage('decision("d", {\n      when: (i) => j.¦'))).toBeNull();
  });
});

describe("completion places — where nothing applies", () => {
  it.each([
    ["the top of the file", "¦"],
    ["the import braces", "import { ¦"],
    ["a line comment", loop('  // stages: [ llm("a", { ¦')],
    ["an unclosed block comment", loop("  /* trigger: { ¦")],
    ["an object the grammar does not open", stage('llm("a", {\n      meta: { ¦')],
    ["a member of an unknown name", loop("  dsl: foo.¦")],
  ])("names nothing in %s", (_case, source) => {
    expect(placeOf(source)).toBeNull();
  });

  it("reads on after a closed block comment", () => {
    expect(scopeOf(loop("  /* note */ ¦"))).toBe("loop.options");
  });
});

describe("completion places — the golden standard-fix", () => {
  it.each([
    ["a stage's options", 'llm("implement", {\n', 0, "stage.llm.options"],
    ["a route method", "model: route.", 0, "route.methods"],
    ["the trigger's effort condition", "when: (i) => i.effort.", 0, "condition.effort"],
    ["a decision's effort methods", "when: (i) => i.effort.", 1, "predicate.effort"],
    ["a gate branch's checks methods", "when: (i) => i.checks.", 0, "predicate.checks"],
    ["the effort constants", "lte(effort.", 0, "effort.constants"],
  ])("names %s", (_case, needle, occurrence, scope) => {
    expect(completionPlace(STANDARD_FIX, after(STANDARD_FIX, needle, occurrence))?.scope).toBe(scope);
  });

  it.each([
    ["the task route", 'model: route.task("', "route.task"],
    ["the merge method", 'merge: "', "stage.openPr.merge"],
  ])("names %s inside its quotes", (_case, needle, scope) => {
    const pos = after(STANDARD_FIX, needle);

    expect(completionPlace(STANDARD_FIX, pos)).toEqual({ scope, from: pos, quoted: true });
  });

  it("names nothing in the layout block", () => {
    expect(completionPlace(STANDARD_FIX, after(STANDARD_FIX, "// node "))).toBeNull();
  });
});

describe("hover targets — the golden standard-fix", () => {
  it("names route.task over `task`, spanning the whole chain", () => {
    const from = wordIn(STANDARD_FIX, 'route.task("implement")', "route");

    expect(hoverTarget(STANDARD_FIX, from + "route.".length)).toEqual({
      symbol: "route.task",
      from,
      to: from + "route.task".length,
    });
  });

  it("names the same symbol from anywhere inside the word", () => {
    const start = wordIn(STANDARD_FIX, "retries: 2", "retries");

    expect(hoverTarget(STANDARD_FIX, start + 3)).toEqual(hoverTarget(STANDARD_FIX, start));
  });

  it.each([
    ["defineLoop", "export default defineLoop(", "defineLoop", "defineLoop"],
    ["a stage call", 'llm("implement"', "llm", "stage.llm"],
    ["a gate call", 'gate("checks-green"', "gate", "stage.gate"],
    ["a stage option", "retries: 2", "retries", "stage.llm.retries"],
    ["a terminal's option", 'merge: "squash"', "merge", "stage.openPr.merge"],
    ["the trigger's event key", 'on: "issue.queued"', "on", "trigger.on"],
    ["a permission flag", "permissions: { pushFixup", "pushFixup", "permissions.pushFixup"],
    ["an edge entry key", '{ to: "open-pr"', "to", "edge.to"],
    ["a trigger condition method", "i.effort.lte(effort.M)", "lte", "condition.effort.lte"],
    ["a predicate method", "i.checks.allPassed()", "allPassed", "predicate.checks.allPassed"],
  ])("names %s", (_case, needle, word, symbol) => {
    expect(hoverTarget(STANDARD_FIX, wordIn(STANDARD_FIX, needle, word))?.symbol).toBe(symbol);
  });

  it("names an effort constant, spanning `effort.M`", () => {
    const from = wordIn(STANDARD_FIX, "lte(effort.M)", "effort");

    expect(hoverTarget(STANDARD_FIX, from + "effort.".length)).toEqual({
      symbol: "effort.M",
      from,
      to: from + "effort.M".length,
    });
  });

  it.each([
    ["the namespace half of route.task", 'route.task("implement")', "route"],
    ["a node id", 'llm("implement"', "implement"],
    ["a word in a comment", "// the loop bites its tail", "loop"],
    ["a name in the import", "defineLoop, effort, route", "effort"],
    ["an arrow's parameter", "(i) => i.effort", "i"],
    ["a word in the layout block", "// node issue-queued", "node"],
    ["a word inside a description", '"Runs when a sized issue', "sized"],
  ])("names nothing over %s", (_case, needle, word) => {
    expect(hoverTarget(STANDARD_FIX, wordIn(STANDARD_FIX, needle, word))).toBeNull();
  });

  it("names nothing over a number or whitespace", () => {
    expect(hoverTarget(STANDARD_FIX, wordIn(STANDARD_FIX, "retries: 2", "2"))).toBeNull();
    expect(hoverTarget(STANDARD_FIX, wordIn(STANDARD_FIX, "retries: 2", " "))).toBeNull();
  });

  it("names a callee the grammar does not have, and leaves the table to describe nothing", () => {
    const text = stage('review("r", {\n      title: "R",\n    }),');

    expect(hoverTarget(text, wordIn(text, 'review("r"', "review"))?.symbol).toBe("stage.review");
  });
});
