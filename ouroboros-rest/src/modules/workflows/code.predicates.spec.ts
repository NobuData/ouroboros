/**
 * Predicates as arrow functions — U.1 ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * The issue's requirement is that the rendering is **bijective**, not merely convertible. So
 * every predicate form is spelled here exactly, every spelling is read back by the compiler
 * into the structure it came from, and no two structures share a spelling.
 */

import { PREDICATE_METHODS } from "./code.grammar";
import { effortConstant, printPredicate, printTriggerWhen, usesEffort } from "./code.predicates";
import {
  expressionOf,
  predicateFrom,
  syntaxErrors,
  triggerConditionsFrom,
} from "./code.recover.fixture";
import { PREDICATE_KINDS, PREDICATE_SCHEMAS, type Predicate, type TriggerSpec } from "./dsl.schema";

/** Every predicate kind and operator, and its exact spelling. */
const PREDICATES: [Predicate, string][] = [
  [{ kind: "always" }, "() => true"],
  [{ kind: "effort", op: "lt", value: "xs" }, "(i) => i.effort.lt(effort.XS)"],
  [{ kind: "effort", op: "lte", value: "s" }, "(i) => i.effort.lte(effort.S)"],
  [{ kind: "effort", op: "eq", value: "m" }, "(i) => i.effort.eq(effort.M)"],
  [{ kind: "effort", op: "gte", value: "l" }, "(i) => i.effort.gte(effort.L)"],
  [{ kind: "effort", op: "gt", value: "xl" }, "(i) => i.effort.gt(effort.XL)"],
  [{ kind: "labels", op: "any", values: ["regression"] }, '(i) => i.labels.any(["regression"])'],
  [{ kind: "labels", op: "all", values: ["bug", "p0"] }, '(i) => i.labels.all(["bug", "p0"])'],
  [{ kind: "labels", op: "none", values: ["wontfix"] }, '(i) => i.labels.none(["wontfix"])'],
  [
    { kind: "source", op: "in", values: ["github", "gitlab"] },
    '(i) => i.source.in(["github", "gitlab"])',
  ],
  [{ kind: "source", op: "not_in", values: ["jira"] }, '(i) => i.source.notIn(["jira"])'],
  [{ kind: "checks", op: "all_passed" }, "(i) => i.checks.allPassed()"],
  [{ kind: "checks", op: "all_passed", names: ["build"] }, '(i) => i.checks.allPassed(["build"])'],
  [{ kind: "checks", op: "any_failed" }, "(i) => i.checks.anyFailed()"],
  [
    { kind: "checks", op: "any_failed", names: ["build", "test"] },
    '(i) => i.checks.anyFailed(["build", "test"])',
  ],
];

/** Every trigger-condition combination, and its exact `when` — or none. */
const TRIGGERS: { about: string; conditions: TriggerSpec["conditions"]; when?: string }[] = [
  { about: "no conditions", conditions: {} },
  {
    about: "an effort bound",
    conditions: { effort_lte: "m" },
    when: "(i) => i.effort.lte(effort.M)",
  },
  { about: "labels", conditions: { labels: ["docs"] }, when: '(i) => i.labels.all(["docs"])' },
  { about: "a source", conditions: { source: "github" }, when: '(i) => i.source.is("github")' },
  {
    about: "an effort bound and labels",
    conditions: { effort_lte: "s", labels: ["docs"] },
    when: '(i) => i.effort.lte(effort.S) && i.labels.all(["docs"])',
  },
  {
    about: "labels and a source",
    conditions: { labels: ["bug", "regression"], source: "linear" },
    when: '(i) => i.labels.all(["bug", "regression"]) && i.source.is("linear")',
  },
  {
    about: "an effort bound and a source",
    conditions: { effort_lte: "xl", source: "jira" },
    when: '(i) => i.effort.lte(effort.XL) && i.source.is("jira")',
  },
  {
    about: "all three",
    conditions: { effort_lte: "l", labels: ["bug", "regression"], source: "github" },
    when: '(i) => i.effort.lte(effort.L) && i.labels.all(["bug", "regression"]) && i.source.is("github")',
  },
];

describe("printPredicate", () => {
  it("is exercised over every predicate kind and every operator", () => {
    const kinds = new Set(PREDICATES.map(([predicate]) => predicate.kind));
    expect([...kinds].sort()).toEqual([...PREDICATE_KINDS].sort());

    for (const [kind, operators] of Object.entries(PREDICATE_METHODS)) {
      const covered = PREDICATES.flatMap(([predicate]) =>
        predicate.kind === kind && "op" in predicate ? [predicate.op] : [],
      );
      expect(new Set(covered)).toEqual(new Set(Object.keys(operators)));
    }
  });

  it.each(PREDICATES)("uses predicates the schema accepts: %j", (predicate) => {
    expect(PREDICATE_SCHEMAS[predicate.kind].safeParse(predicate).success).toBe(true);
  });

  it.each(PREDICATES)("spells %j as %s", (predicate, spelling) => {
    expect(printPredicate(predicate)).toBe(spelling);
  });

  it.each(PREDICATES)("spells %j as TypeScript the compiler reads", (predicate) => {
    expect(syntaxErrors(`const when = ${printPredicate(predicate)};`)).toEqual([]);
  });

  it.each(PREDICATES)("reads %j back from its spelling", (predicate) => {
    expect(predicateFrom(expressionOf(printPredicate(predicate)))).toStrictEqual(predicate);
  });

  it("gives no two predicates the same spelling", () => {
    const spellings = PREDICATES.map(([predicate]) => printPredicate(predicate));
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  it("does not depend on the order a predicate's keys arrived in", () => {
    expect(printPredicate({ value: "m", op: "gt", kind: "effort" })).toBe(
      "(i) => i.effort.gt(effort.M)",
    );
  });
});

describe("printTriggerWhen", () => {
  it("spells mockup 05's trigger exactly", () => {
    expect(printTriggerWhen({ effort_lte: "m" })).toBe("(i) => i.effort.lte(effort.M)");
  });

  it.each(TRIGGERS)("spells $about", ({ conditions, when }) => {
    expect(printTriggerWhen(conditions)).toBe(when);
  });

  it.each(TRIGGERS.filter((entry) => entry.when !== undefined))(
    "reads $about back from its spelling",
    ({ conditions, when }) => {
      expect(syntaxErrors(`const when = ${when};`)).toEqual([]);
      expect(triggerConditionsFrom(expressionOf(when as string))).toStrictEqual(conditions);
    },
  );

  it("conjoins in the grammar's order, not the order the conditions arrived in", () => {
    expect(printTriggerWhen({ source: "github", labels: ["bug"], effort_lte: "s" })).toBe(
      '(i) => i.effort.lte(effort.S) && i.labels.all(["bug"]) && i.source.is("github")',
    );
  });
});

describe("effortConstant", () => {
  it.each([
    ["xs", "effort.XS"],
    ["s", "effort.S"],
    ["m", "effort.M"],
    ["l", "effort.L"],
    ["xl", "effort.XL"],
  ] as const)("spells %s as %s", (value, constant) => {
    expect(effortConstant(value)).toBe(constant);
  });
});

describe("usesEffort", () => {
  it("is true for an effort comparison and nothing else", () => {
    expect(usesEffort({ kind: "effort", op: "lte", value: "m" })).toBe(true);
    expect(usesEffort({ kind: "labels", op: "any", values: ["effort"] })).toBe(false);
    expect(usesEffort({ kind: "always" })).toBe(false);
    expect(usesEffort(undefined)).toBe(false);
  });
});
