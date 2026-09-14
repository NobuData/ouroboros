import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALIAS_INVALID,
  APPLIED_NOTE,
  APPLY_LABEL,
  BUDGET_INVALID,
  BUDGET_LABEL,
  DECLARED_NOTE,
  DELETE_LABEL,
  type JsonSchema,
  MANY_SELECTED_NOTE,
  MODE_WORDS,
  NOTHING_SELECTED_NOTE,
  PALETTE_NOTE,
  PERMISSION_WORDS,
  PIN_LABEL,
  PREDICATE_REQUIRED,
  PROMPT_REQUIRED,
  RETRIES_LABEL,
  ROUTING_FIELD,
  ROUTING_REQUIRED,
  SKILL_HINT,
  SKILL_REQUIRED,
  TASK_REQUIRED,
  VALUES_REQUIRED,
  branchSchema,
  budgetText,
  catalogType,
  draftErrors,
  emptyNote,
  fieldLabel,
  formatTokenBudget,
  generatedDefaults,
  genericFields,
  inheritLabel,
  inheritedModel,
  isConfigDirty,
  knownNames,
  paletteVariables,
  parseTokenBudget,
  propertySchema,
  readValue,
  referenceWarnings,
  resolveSchema,
  schemaBounds,
  schemaChoices,
  splitList,
  templateSegments,
  tooLong,
  unknownAlias,
  unknownSkill,
  unknownTask,
  variableToken,
  withValue,
} from "@/app/workflows/inspector/inspector";

import { seededAliases, seededTaskKinds } from "../../helpers/models";
import { configSchema, stageCatalog, standardFixDefinition } from "../../helpers/workflows";

/**
 * Every decision the inspector makes (#150), as functions over the published DSL schema, the
 * seeded `standard-fix` and the seeded routing matrix.
 *
 * The render suite (`inspector-panel.test.tsx`) shows these drawn; what is held here is what makes
 * the panel schema-driven and honest: choices and bounds come from the catalog's schema, a new node
 * type gets fields, unknown names warn without blocking, the budget accepts `400k`, and the copy is
 * the mockup's.
 */

/** Mockup 04, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "docs", "mockups", "04-workflow-builder.html"),
  "utf8",
);

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** One seeded node's config. */
function seededConfig(id: string): Record<string, unknown> {
  const node = (SEEDED.nodes as { id: string; config: Record<string, unknown> }[]).find((entry) => entry.id === id);
  if (node === undefined) throw new Error(`no seeded node ${id}`);
  return node.config;
}

/** The published config schemas, as the catalog serves them. */
const LLM = configSchema("llm_config") as JsonSchema;
const FLOW = configSchema("flow_config") as JsonSchema;
const TERM = configSchema("term_config") as JsonSchema;
const INFRA = configSchema("infra_config") as JsonSchema;
const TRIGGER = configSchema("trigger_config") as JsonSchema;

describe("reading the catalog's schema", () => {
  it("finds a node type's entry, and nothing for a type the catalog does not list", () => {
    expect(catalogType(stageCatalog(), "llm")?.glyph).toBe("◆");
    expect(catalogType(stageCatalog(), "sandbox")).toBeNull();
    expect(catalogType(null, "llm")).toBeNull();
  });

  it("reads the mode segment's choices and the limits' bounds from the llm schema", () => {
    expect(schemaChoices(propertySchema(LLM, "mode", LLM), LLM)).toEqual(["prompt", "skill"]);

    const limits = propertySchema(LLM, "limits", LLM);
    expect(schemaBounds(propertySchema(limits, "max_retries", LLM), LLM)).toMatchObject({ minimum: 0, maximum: 10 });
    expect(schemaBounds(propertySchema(limits, "token_budget", LLM), LLM)).toMatchObject({
      minimum: 1000,
      maximum: 10_000_000,
    });
  });

  it("follows $ref into $defs and if/then branches for a predicate's operators and values", () => {
    const predicate = propertySchema(FLOW, "predicate", FLOW);

    expect(schemaChoices(propertySchema(predicate, "kind", FLOW), FLOW)).toEqual([
      "always",
      "effort",
      "labels",
      "source",
      "checks",
    ]);
    const effort = branchSchema(predicate, "kind", "effort", FLOW);
    expect(schemaChoices(propertySchema(effort, "op", FLOW), FLOW)).toEqual(["lt", "lte", "eq", "gte", "gt"]);
    expect(schemaChoices(propertySchema(effort, "value", FLOW), FLOW)).toEqual(["xs", "s", "m", "l", "xl"]);

    const source = branchSchema(predicate, "kind", "source", FLOW);
    expect(schemaChoices(propertySchema(source, "values", FLOW), FLOW)).toEqual(["github", "gitlab", "jira", "linear"]);
  });

  it("reads a terminal's options per action", () => {
    const merge = propertySchema(branchSchema(TERM, "action", "open_pr_automerge", TERM), "options", TERM);

    expect(schemaChoices(propertySchema(merge, "merge_method", TERM), TERM)).toEqual(["squash", "merge", "rebase"]);
    expect(branchSchema(TERM, "action", "no_such_action", TERM)).toEqual({});
  });

  it("gives up on a reference that leads nowhere or loops, rather than hanging", () => {
    expect(resolveSchema({ $ref: "#/$defs/missing" }, LLM)).toEqual({});
    expect(resolveSchema({ $ref: "#/$defs/a" }, { $defs: { a: { $ref: "#/$defs/a" } } })).toEqual({});
    expect(resolveSchema({ $ref: "https://elsewhere" }, LLM)).toEqual({});
    expect(resolveSchema("not a schema", LLM)).toEqual({});
  });
});

describe("the generated form — a new node type gets one for free", () => {
  it("draws an infra stage's two optional text fields", () => {
    expect(genericFields(INFRA, INFRA).map((field) => [field.name, field.widget, field.required])).toEqual([
      ["runner_pool", "text", false],
      ["command", "text", false],
    ]);
  });

  it("draws a terminal's merge options as a required select and a required toggle", () => {
    const options = propertySchema(branchSchema(TERM, "action", "open_pr_automerge", TERM), "options", TERM);
    const fields = genericFields(options, TERM);

    expect(fields.map((field) => [field.name, field.widget, field.required])).toEqual([
      ["merge_method", "select", true],
      ["delete_branch", "toggle", true],
    ]);
    expect(generatedDefaults(fields)).toEqual({ merge_method: "squash", delete_branch: false });
  });

  it("draws nothing for a trigger, whose config is closed and empty", () => {
    expect(genericFields(TRIGGER, TRIGGER)).toEqual([]);
  });

  it("draws every widget for a type this build has never heard of", () => {
    const sandbox: JsonSchema = {
      type: "object",
      required: ["depth"],
      properties: {
        depth: { type: "integer", minimum: 1, maximum: 9 },
        flavour: { enum: ["a", "b"] },
        dry: { type: "boolean" },
        note: { type: "string", title: "Operator note" },
        extra: { type: "object" },
      },
    };

    expect(genericFields(sandbox, sandbox).map((field) => [field.name, field.label, field.widget])).toEqual([
      ["depth", "Depth", "number"],
      ["flavour", "Flavour", "select"],
      ["dry", "Dry", "toggle"],
      ["note", "Operator note", "text"],
      ["extra", "Extra", "json"],
    ]);
    expect(genericFields({ type: "object" }, {})).toEqual([]);
  });

  it("labels a property by its words", () => {
    expect(fieldLabel("runner_pool")).toBe("Runner pool");
    expect(fieldLabel("delete-branch")).toBe("Delete branch");
    expect(fieldLabel("_")).toBe("_");
  });
});

describe("editing a config", () => {
  it("sets a nested value without touching the input, creating what is missing", () => {
    const config = { limits: { max_retries: 2 } };
    const next = withValue(config, ["limits", "token_budget"], 1000);

    expect(next).toEqual({ limits: { max_retries: 2, token_budget: 1000 } });
    expect(config).toEqual({ limits: { max_retries: 2 } });
    expect(withValue({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
    expect(withValue(config, [], 1)).toBe(config);
  });

  it("removes a key when given undefined", () => {
    expect(withValue({ mode: "prompt", skill: "x" }, ["skill"], undefined)).toEqual({ mode: "prompt" });
  });

  it("reads a nested value, and undefined past a missing step", () => {
    expect(readValue(seededConfig("implement"), ["limits", "token_budget"])).toBe(400_000);
    expect(readValue({ a: 1 }, ["a", "b"])).toBeUndefined();
  });

  it("is dirty for a changed value and not for a reordered one", () => {
    expect(isConfigDirty({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(false);
    expect(isConfigDirty({ a: 1 }, { a: 2 })).toBe(true);
    expect(isConfigDirty({ a: undefined }, {})).toBe(true);
  });

  it("splits a comma-separated list", () => {
    expect(splitList(" build, test ,, review ")).toEqual(["build", "test", "review"]);
  });
});

describe("the token budget accepts shorthand", () => {
  it.each([
    ["400k", 400_000],
    ["1.5m", 1_500_000],
    ["250000", 250_000],
    [" 2K ", 2000],
    ["0.5k", 500],
  ])("reads %j as %d", (text, value) => {
    expect(parseTokenBudget(text)).toBe(value);
  });

  it.each(["", "lots", "1.0005k", "-4k", "4 thousand"])("refuses %j", (text) => {
    expect(parseTokenBudget(text)).toBeNull();
  });

  it("renders the stored number as the mockup's shorthand when it is exact", () => {
    expect(formatTokenBudget(400_000)).toBe("400k");
    expect(formatTokenBudget(1_000_000)).toBe("1m");
    expect(formatTokenBudget(1500)).toBe("1500");
    expect(budgetText(seededConfig("implement"))).toBe("400k");
    expect(budgetText({})).toBe("");
  });
});

describe("what blocks Apply", () => {
  it("finds nothing wrong with any seeded stage", () => {
    for (const id of ["implement", "analyze", "plan"]) {
      expect(draftErrors("llm", seededConfig(id), LLM, budgetText(seededConfig(id))), id).toEqual({});
    }
    expect(draftErrors("flow", seededConfig("effort-recheck"), FLOW, "")).toEqual({});
    expect(draftErrors("flow", seededConfig("checks-green"), FLOW, "")).toEqual({});
    expect(draftErrors("infra", seededConfig("test"), INFRA, "")).toEqual({});
    expect(draftErrors("term", seededConfig("open-pr"), TERM, "")).toEqual({});
  });

  it("checks nothing when the catalog could not be read", () => {
    expect(draftErrors("llm", {}, null, "")).toEqual({});
  });

  it("requires a skill in skill mode, a prompt, and a routing choice", () => {
    const base = seededConfig("implement");

    expect(draftErrors("llm", { ...base, skill: " " }, LLM, "400k").skill).toBe(SKILL_REQUIRED);
    expect(draftErrors("llm", { ...base, prompt_template: "" }, LLM, "400k").prompt_template).toBe(PROMPT_REQUIRED);
    expect(draftErrors("llm", { ...base, prompt_template: "x".repeat(20_001) }, LLM, "400k").prompt_template).toBe(
      tooLong(20_000),
    );
    expect(draftErrors("llm", { ...base, routing: { inherit_task: "" } }, LLM, "400k")[ROUTING_FIELD]).toBe(
      TASK_REQUIRED,
    );
    expect(draftErrors("llm", { ...base, routing: {} }, LLM, "400k")[ROUTING_FIELD]).toBe(ROUTING_REQUIRED);
  });

  it("refuses a pinned alias the schema's pattern refuses", () => {
    const config = { ...seededConfig("analyze"), routing: { pinned_model: { alias: "Coder Max" } } };

    expect(draftErrors("llm", config, LLM, "200k")[ROUTING_FIELD]).toBe(ALIAS_INVALID);
  });

  it("holds the limits to the schema's bounds, and the budget to a whole number", () => {
    const base = seededConfig("implement");

    expect(draftErrors("llm", withValue(base, ["limits", "max_retries"], 11), LLM, "400k")).toHaveProperty(
      "limits.max_retries",
      "A whole number from 0 to 10.",
    );
    expect(draftErrors("llm", base, LLM, "lots")).toHaveProperty("limits.token_budget", BUDGET_INVALID);
    expect(draftErrors("llm", base, LLM, "500")).toHaveProperty("limits.token_budget", "A whole number from 1k to 10m.");
  });

  it("requires a predicate kind, and a value for a predicate that needs a list", () => {
    expect(draftErrors("flow", { kind: "decision" }, FLOW, "")).toHaveProperty("predicate.kind", PREDICATE_REQUIRED);
    expect(
      draftErrors("flow", { kind: "decision", predicate: { kind: "labels", op: "any", values: [] } }, FLOW, ""),
    ).toHaveProperty("predicate.values", VALUES_REQUIRED);
  });

  it("holds a generated text field to its length", () => {
    expect(draftErrors("infra", { command: "x".repeat(2001) }, INFRA, "")).toEqual({ command: tooLong(2000) });
  });

  it("holds a generated number to its bounds, and requires required text", () => {
    const sandbox: JsonSchema = {
      type: "object",
      required: ["name"],
      properties: { depth: { type: "integer", minimum: 1 }, name: { type: "string" } },
    };

    expect(draftErrors("sandbox", { depth: 0 }, sandbox, "")).toEqual({
      depth: "A whole number of at least 1.",
      name: "Required.",
    });
  });
});

describe("names the workspace does not list — warnings, never blocks (P7)", () => {
  const known = knownNames(stageCatalog(), { ok: true, value: seededAliases() });

  it("reads what the workspace lists from the catalog and the registry", () => {
    expect(known.skills).toEqual(["repo-map", "zephyr-conventions"]);
    expect(known.taskRoutes).toContain("implement");
    expect(known.aliases).toContain("coder-max");
    expect(knownNames(null, { ok: false, reason: "away" })).toEqual({ skills: [], taskRoutes: [], aliases: null });
  });

  it("says nothing about the seeded stages", () => {
    for (const id of ["implement", "analyze", "plan", "split"]) {
      expect(referenceWarnings("llm", seededConfig(id), known), id).toEqual(
        id === "split" ? { [ROUTING_FIELD]: unknownTask("split") } : {},
      );
    }
  });

  it("warns about an unknown skill, task and alias in the service's own words", () => {
    const base = seededConfig("implement");

    expect(referenceWarnings("llm", { ...base, skill: "nope" }, known)).toEqual({ skill: unknownSkill("nope") });
    expect(referenceWarnings("llm", { ...base, routing: { inherit_task: "deploy" } }, known)).toEqual({
      [ROUTING_FIELD]: unknownTask("deploy"),
    });
    expect(referenceWarnings("llm", { ...base, routing: { pinned_model: { alias: "ghost" } } }, known)).toEqual({
      [ROUTING_FIELD]: unknownAlias("ghost"),
    });
    expect(unknownAlias("ghost")).toMatch(/Publishing will refuse it/);
  });

  it("checks nothing against a list that is empty or was not read", () => {
    const blind = { skills: [], taskRoutes: [], aliases: null };

    expect(
      referenceWarnings("llm", { mode: "skill", skill: "nope", routing: { pinned_model: { alias: "ghost" } } }, blind),
    ).toEqual({});
    expect(referenceWarnings("flow", { skill: "nope" }, known)).toEqual({});
  });
});

describe("routing and variables", () => {
  it("resolves an inherited route to its primary model — the mockup's pill", () => {
    expect(inheritedModel(seededTaskKinds(), "implement")).toBe("claude-fable-5");
    expect(inheritedModel(seededTaskKinds(), "deploy")).toBeNull();
  });

  it("offers the run-context names and the stages before this one", () => {
    expect(paletteVariables(SEEDED, "implement")).toEqual({
      context: ["issue.title", "issue.body", "diff"],
      stages: ["analyze", "plan"],
    });
  });

  it("splits a template into text and placeholders, losing nothing", () => {
    const template = seededConfig("implement").prompt_template as string;
    const segments = templateSegments(template);

    expect(segments.map((segment) => segment.text).join("")).toBe(template);
    expect(segments.filter((segment) => segment.variable).map((segment) => segment.text)).toEqual([
      "{{issue.title}}",
      "{{plan}}",
    ]);
    expect(variableToken("diff")).toBe("{{diff}}");
    expect(templateSegments("")).toEqual([]);
  });
});

describe("the copy", () => {
  it("is the mockup's wherever the mockup draws it", () => {
    for (const phrase of [
      MODE_WORDS.prompt,
      MODE_WORDS.skill,
      SKILL_HINT,
      PERMISSION_WORDS.push_fixup,
      PERMISSION_WORDS.touch_ci,
      inheritLabel("implement"),
      PIN_LABEL,
      RETRIES_LABEL,
      BUDGET_LABEL,
      DELETE_LABEL,
      APPLY_LABEL,
    ]) {
      expect(MOCKUP, phrase).toContain(phrase);
    }
  });

  it("says the permissions are declarations enforced at execution (P9), and nothing is saved yet", () => {
    expect(DECLARED_NOTE).toMatch(/^Declared now — enforced at execution \(T\.6, #160\)/);
    expect(PALETTE_NOTE).toMatch(/#160/);
    expect(APPLIED_NOTE).toMatch(/not saved/);
    expect(APPLIED_NOTE).toMatch(/#152/);
  });

  it("explains an empty panel by what is selected — an edge has a panel of its own since #151", () => {
    expect(emptyNote(null)).toBe(NOTHING_SELECTED_NOTE);
    expect(
      emptyNote({ kind: "edge", id: "a→b", connection: { from: "a", to: "b", kind: "default", label: null, condition: null } }),
    ).toBe(NOTHING_SELECTED_NOTE);
    expect(emptyNote({ kind: "many", nodes: 2, edges: 0 })).toBe(MANY_SELECTED_NOTE);
    expect(MANY_SELECTED_NOTE).toMatch(/Delete/);
  });
});
