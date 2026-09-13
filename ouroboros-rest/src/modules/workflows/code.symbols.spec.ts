import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StageSuggestions } from "./catalog.resources";
import { DslSchemaError, readPublishedDslSchema, type JsonSchema } from "./catalog.schema";
import {
  DEFINE_LOOP_FIELD,
  DEFINE_LOOP_FIELDS,
  DEFINE_LOOP_OPTIONS,
  EDGE_ENTRY_FIELDS,
  EFFORT_FIELD,
  NODE_ID_FIELD,
  PERMISSION_KEYS,
  PERMISSIONS_FIELD,
  PREDICATE_FIELD,
  PREDICATE_METHODS,
  ROUTE_SIGNATURES,
  ROUTING_FIELD,
  SOURCE_KIND_FIELD,
  STAGE_CALLEE_FIELDS,
  STAGE_CALLEES,
  STAGE_OPTION_FIELDS,
  STAGE_OPTIONS,
  TRIGGER_CONDITIONS_FIELD,
  TRIGGER_FIELDS,
  TRIGGER_OPTIONS,
} from "./code.grammar";
import {
  buildCodeSymbols,
  codeSymbolTable,
  SUGGESTION_SCOPES,
  type CodeSymbolTable,
  type StageOptionsTable,
} from "./code.symbols";
import { locate } from "./code.symbols.schema";
import { FIXTURES_DIR } from "./dsl.golden.fixture";

/**
 * The code view's symbol table — W.1 ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * The ticket's criteria, one block each: completions for the trigger block, each stage's options
 * and every predicate form; context (a stage's scope offers that stage's keys and no other's);
 * mockup 05's `route.task` card; nothing documented that the schema does not say; and a key, a
 * value or a description added at the source surfacing with no other edit. The golden file is
 * the answer `ouroboros-ui`'s suites are written against.
 */

/** The committed schema, as the service reads it. */
const SCHEMA = readPublishedDslSchema();

/** The static table built from it. */
const TABLE = buildCodeSymbols(SCHEMA);

/** The table `fixtures/code-symbols/table.json` records: mockup 05's four task routes. */
const GOLDEN_SUGGESTIONS: StageSuggestions = {
  skills: ["repo-map", "zephyr-conventions"],
  taskRoutes: ["analyze", "plan", "implement", "review"],
};

/** Where the golden table lives. */
const GOLDEN = join(FIXTURES_DIR, "code-symbols", "table.json");

/**
 * The labels offered at a scope.
 *
 * @param table - A symbol table.
 * @param scope - The scope.
 * @returns The labels in order, or `undefined` when the table has no such scope.
 */
function offered(table: CodeSymbolTable, scope: string): string[] | undefined {
  return table.scopes.find((entry) => entry.scope === scope)?.completions.map((c) => c.label);
}

/**
 * A symbol's card.
 *
 * @param table - A symbol table.
 * @param symbol - The symbol.
 * @returns The card, or `undefined`.
 */
function card(table: CodeSymbolTable, symbol: string) {
  return table.symbols.find((entry) => entry.symbol === symbol);
}

/**
 * A symbol's signature, as one string.
 *
 * @param table - A symbol table.
 * @param symbol - The symbol.
 * @returns The joined text, or `undefined` for a symbol the table does not describe.
 */
function signature(table: CodeSymbolTable, symbol: string): string | undefined {
  return card(table, symbol)
    ?.signature.map((part) => part.text)
    .join("");
}

/**
 * Every `description` anywhere in a schema.
 *
 * @param value - A schema or any part of one.
 * @returns The descriptions.
 */
function descriptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(descriptions);
  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, child]) =>
    key === "description" && typeof child === "string" ? [child] : descriptions(child),
  );
}

/**
 * A clone of the committed schema, and a way to edit a location in it.
 *
 * @returns The clone, and `at(pointer)` answering the mutable object there.
 */
function editableSchema(): {
  schema: JsonSchema;
  at: (pointer: string) => Record<string, unknown>;
} {
  const schema = structuredClone(SCHEMA);
  return { schema, at: (pointer) => locate(schema, pointer) };
}

/** The route snippets `model:` offers. */
const ROUTE_SNIPPETS = ['route.task("")', 'route.model("")'];

/** What every predicate-valued key offers. */
const PREDICATE_FORMS = [
  "() => true",
  "(i) => i.effort.",
  "(i) => i.labels.",
  "(i) => i.source.",
  "(i) => i.checks.",
];

describe("the grammar's schema pointers", () => {
  it("all resolve in the committed schema", () => {
    const pointers = [
      DEFINE_LOOP_FIELD,
      NODE_ID_FIELD,
      PREDICATE_FIELD,
      TRIGGER_CONDITIONS_FIELD,
      EFFORT_FIELD,
      SOURCE_KIND_FIELD,
      ROUTING_FIELD,
      ...Object.values(DEFINE_LOOP_FIELDS),
      ...Object.values(TRIGGER_FIELDS),
      ...Object.values(EDGE_ENTRY_FIELDS),
      ...Object.values(STAGE_CALLEE_FIELDS),
      ...Object.values(ROUTE_SIGNATURES).map((route) => route.field),
      ...Object.keys(PERMISSION_KEYS).map((field) => `${PERMISSIONS_FIELD}/${field}`),
      ...Object.values(STAGE_OPTION_FIELDS).flatMap((fields) => Object.values(fields)),
    ];

    const unresolved = pointers.filter((pointer) => {
      try {
        locate(SCHEMA, pointer);
        return false;
      } catch {
        return true;
      }
    });

    expect(unresolved).toEqual([]);
  });

  it("give every option each stage call takes a schema location", () => {
    const unplaced = STAGE_CALLEES.flatMap((callee) =>
      STAGE_OPTIONS[callee]
        .filter((key) => !Object.hasOwn(STAGE_OPTION_FIELDS[callee], key))
        .map((key) => `${callee}.${key}`),
    );

    expect(unplaced).toEqual([]);
  });
});

describe("the Types card — mockup 05", () => {
  it("signs route.task exactly as the mockup prints it, in the mockup's colours", () => {
    expect(card(TABLE, "route.task")?.signature).toEqual([
      { text: "route.task", role: "name" },
      { text: "(name: ", role: "text" },
      { text: "TaskKind", role: "type" },
      { text: "): ", role: "text" },
      { text: "ModelRoute", role: "type" },
    ]);
  });

  it("documents it with the schema's sentence", () => {
    expect(card(TABLE, "route.task")?.doc).toBe(
      "Resolves the model assigned to a task kind in Model Routing.",
    );
  });

  it("does not claim the fallback chain routing does not have", () => {
    // Mockup 05's second sentence, "Falls back to the tenant default chain.", describes a
    // behaviour `ResolutionService.resolve` does not have: an unrouted task kind is
    // `route_not_found`. The table says what the schema says, and no more.
    expect(JSON.stringify(TABLE)).not.toMatch(/default chain/i);
  });

  it("signs route.model beside it", () => {
    expect(signature(TABLE, "route.model")).toBe("route.model(name: ModelId): ModelRoute");
  });
});

describe("nothing invented", () => {
  it("documents a symbol only with a description the schema carries, verbatim", () => {
    const published = new Set(descriptions(SCHEMA));

    expect(
      TABLE.symbols.filter((symbol) => symbol.doc !== undefined && !published.has(symbol.doc)),
    ).toEqual([]);
  });

  it("gives a symbol whose location has no description a signature and no doc", () => {
    const retries = card(TABLE, "stage.llm.retries");

    expect(retries?.signature.map((part) => part.text).join("")).toBe("retries: integer");
    expect(retries).not.toHaveProperty("doc");
  });

  it.each(["route.pool", "stage.analyze", "stage.llm.cache", "effort.XXL", "i.effort"])(
    "has no card for %s, which the grammar does not have",
    (symbol) => {
      expect(card(TABLE, symbol)).toBeUndefined();
    },
  );

  it("names, from every completion, only symbols it describes", () => {
    const described = new Set(TABLE.symbols.map((symbol) => symbol.symbol));
    const dangling = TABLE.scopes.flatMap(({ completions }) =>
      completions.filter((c) => c.symbol !== undefined && !described.has(c.symbol)),
    );

    expect(dangling).toEqual([]);
  });

  it("names every scope and every symbol once", () => {
    const scopes = TABLE.scopes.map((entry) => entry.scope);
    const symbols = TABLE.symbols.map((entry) => entry.symbol);

    expect(new Set(scopes).size).toBe(scopes.length);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("is frozen, so no answer can edit the next one", () => {
    expect(Object.isFrozen(TABLE)).toBe(true);
    expect(Object.isFrozen(TABLE.scopes[0].completions)).toBe(true);
    expect(Object.isFrozen(TABLE.symbols[0].signature)).toBe(true);
  });
});

describe("completions — the trigger block", () => {
  it("offers defineLoop's keys, and the one dsl version", () => {
    expect(offered(TABLE, "loop.options")).toEqual([...DEFINE_LOOP_OPTIONS]);
    expect(offered(TABLE, "loop.dsl")).toEqual(["1.0"]);
  });

  it("offers the trigger's keys, and its event as the code view writes it", () => {
    expect(offered(TABLE, "trigger.options")).toEqual([...TRIGGER_OPTIONS]);
    expect(offered(TABLE, "trigger.on")).toEqual(["issue.queued"]);
    expect(signature(TABLE, "trigger.on")).toBe('on: "issue.queued"');
  });

  it("offers one form per condition in `when`, then each condition's one method", () => {
    expect(offered(TABLE, "trigger.when")).toEqual([
      "(i) => i.effort.",
      "(i) => i.labels.",
      "(i) => i.source.",
    ]);
    expect(offered(TABLE, "condition.subjects")).toEqual(["effort", "labels", "source"]);
    expect(offered(TABLE, "condition.effort")).toEqual(["lte"]);
    expect(offered(TABLE, "condition.labels")).toEqual(["all"]);
    expect(offered(TABLE, "condition.source")).toEqual(["is"]);
  });

  it("signs each condition method from the schema's condition", () => {
    expect(signature(TABLE, "condition.effort.lte")).toBe("effort.lte(value: Effort)");
    expect(signature(TABLE, "condition.labels.all")).toBe("labels.all(values: string[])");
    expect(signature(TABLE, "condition.source.is")).toBe("source.is(value: SourceKind)");
  });
});

describe("completions — each stage's options", () => {
  it("offers every stage call in `stages`", () => {
    expect(offered(TABLE, "loop.stages")).toEqual([...STAGE_CALLEES]);
  });

  it.each(STAGE_CALLEES)("offers %s's options, in the grammar's order", (callee) => {
    expect(offered(TABLE, `stage.${callee}.options`)).toEqual([...STAGE_OPTIONS[callee]]);
  });

  it("scopes options to their stage: implement's keys are not openPr's", () => {
    expect(offered(TABLE, "stage.openPr.options")).not.toContain("retries");
    expect(offered(TABLE, "stage.llm.options")).not.toContain("merge");
    expect(offered(TABLE, "stage.llm.options")).not.toContain("farm");
  });

  it("offers the schema's values where a key takes a list of them", () => {
    expect(offered(TABLE, "stage.openPr.merge")).toEqual(["squash", "merge", "rebase"]);
    expect(offered(TABLE, "stage.openPr.deleteBranch")).toEqual(["true", "false"]);
    expect(offered(TABLE, "permissions.options")).toEqual(["pushFixup", "touchCi"]);
    expect(offered(TABLE, "permissions.touchCi")).toEqual(["true", "false"]);
  });

  it("offers the two routes as `model:`, and the methods after `route.`", () => {
    expect(offered(TABLE, "stage.llm.model")).toEqual(ROUTE_SNIPPETS);
    expect(offered(TABLE, "route.methods")).toEqual(["task", "model"]);
  });

  it("offers the edge entry's keys in `branches` and `onFail`", () => {
    expect(offered(TABLE, "edge.options")).toEqual(["to", "when"]);
  });

  it("offers nothing for a free value, rather than a guess", () => {
    for (const scope of [
      "stage.decision.require",
      "stage.infra.cmd",
      "edge.to",
      "stage.llm.next",
    ]) {
      expect({ scope, offered: offered(TABLE, scope) }).toEqual({ scope, offered: undefined });
    }
  });

  it("signs stage calls and their options from the schema", () => {
    expect(signature(TABLE, "stage.llm")).toBe("llm(id: string, options)");
    expect(card(TABLE, "stage.llm")?.doc).toBe(
      "A model stage — the inspector's exact field set (mockup 04).",
    );
    expect(signature(TABLE, "stage.llm.tokenBudget")).toBe("tokenBudget: integer");
    expect(card(TABLE, "stage.llm.tokenBudget")?.doc).toMatch(/^Tokens, as a number\./);
    expect(signature(TABLE, "stage.openPr.merge")).toBe('merge: "squash" | "merge" | "rebase"');
    expect(signature(TABLE, "stage.llm.permissions")).toBe("permissions");
    expect(signature(TABLE, "defineLoop")).toBe("defineLoop(slug, options)");
  });
});

describe("completions — every predicate form", () => {
  it.each(["stage.decision.when", "stage.gate.when", "edge.when"])(
    "offers every form at %s",
    (scope) => {
      expect(offered(TABLE, scope)).toEqual(PREDICATE_FORMS);
    },
  );

  it("offers the subjects after `i.`", () => {
    expect(offered(TABLE, "predicate.subjects")).toEqual(["effort", "labels", "source", "checks"]);
  });

  it.each(Object.entries(PREDICATE_METHODS))("offers every %s method", (kind, methods) => {
    expect(offered(TABLE, `predicate.${kind}`)).toEqual(Object.values(methods));
  });

  it("signs each method from the schema's branch for its kind", () => {
    expect(signature(TABLE, "predicate.effort.lte")).toBe("effort.lte(value: Effort): Predicate");
    expect(signature(TABLE, "predicate.labels.none")).toBe(
      "labels.none(values: string[]): Predicate",
    );
    expect(signature(TABLE, "predicate.source.notIn")).toBe(
      "source.notIn(values: SourceKind[]): Predicate",
    );
    expect(signature(TABLE, "predicate.checks.allPassed")).toBe(
      "checks.allPassed(names?: string[]): Predicate",
    );
  });

  it("offers the effort constants and the tracker kinds a predicate compares", () => {
    expect(offered(TABLE, "effort.constants")).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(signature(TABLE, "effort.M")).toBe("effort.M: Effort");
    expect(offered(TABLE, "source.values")).toEqual(["github", "gitlab", "jira", "linear"]);
  });
});

describe("what the sources add, with no other edit", () => {
  it("offers an option key added to the grammar, with a name-only card", () => {
    const options: StageOptionsTable = {
      ...STAGE_OPTIONS,
      infra: [...STAGE_OPTIONS.infra, "timeoutSeconds"],
    };

    const table = buildCodeSymbols(SCHEMA, options);

    expect(offered(table, "stage.infra.options")).toContain("timeoutSeconds");
    expect(card(table, "stage.infra.timeoutSeconds")).toEqual({
      symbol: "stage.infra.timeoutSeconds",
      signature: [{ text: "timeoutSeconds", role: "name" }],
    });
  });

  it("offers a value added to a schema enum", () => {
    const { schema, at } = editableSchema();
    const merge = "/$defs/term_config/allOf/0/then/properties/options/properties/merge_method";
    (at(merge).enum as string[]).push("fast_forward");

    const table = buildCodeSymbols(schema);

    expect(offered(table, "stage.openPr.merge")).toEqual([
      "squash",
      "merge",
      "rebase",
      "fast_forward",
    ]);
    expect(signature(table, "stage.openPr.merge")).toContain('"fast_forward"');
  });

  it("documents a symbol once the schema describes it", () => {
    const { schema, at } = editableSchema();
    at("/$defs/llm_config/properties/limits/properties/max_retries").description =
      "How many times the stage is retried.";

    expect(card(buildCodeSymbols(schema), "stage.llm.retries")?.doc).toBe(
      "How many times the stage is retried.",
    );
  });

  it("does not offer a schema value the grammar cannot spell", () => {
    const { schema, at } = editableSchema();
    (at(EFFORT_FIELD).enum as string[]).push("xxl");
    (at(`${PREDICATE_FIELD}/allOf/0/then/properties/op`).enum as string[]).push("ne");

    const table = buildCodeSymbols(schema);

    expect(offered(table, "effort.constants")).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(offered(table, "predicate.effort")).toEqual(["lt", "lte", "eq", "gte", "gt"]);
  });

  it("fails the build for a location the grammar points at and the schema lost", () => {
    const { schema, at } = editableSchema();
    delete at("/$defs/llm_config/properties/limits/properties").token_budget;

    expect(() => buildCodeSymbols(schema)).toThrow(DslSchemaError);
  });
});

describe("the suggestions", () => {
  it("keeps each suggestion scope in the static table, empty", () => {
    for (const scope of Object.values(SUGGESTION_SCOPES)) {
      expect({ scope, offered: offered(TABLE, scope) }).toEqual({ scope, offered: [] });
    }
  });

  it("offers the workspace's task routes and skills as advice", () => {
    const table = codeSymbolTable(TABLE, GOLDEN_SUGGESTIONS);

    expect(table.scopes.find((entry) => entry.scope === "route.task")?.completions).toEqual(
      GOLDEN_SUGGESTIONS.taskRoutes.map((label) => ({ label, kind: "value", suggestion: true })),
    );
    expect(offered(table, "stage.llm.skill")).toEqual(GOLDEN_SUGGESTIONS.skills);
  });

  it("leaves the static table as it was, and shares its symbols", () => {
    const table = codeSymbolTable(TABLE, GOLDEN_SUGGESTIONS);

    expect(offered(TABLE, "route.task")).toEqual([]);
    expect(table.symbols).toBe(TABLE.symbols);
    expect(table.schemaId).toBe(TABLE.schemaId);
  });
});

describe("the golden table", () => {
  it("is what ouroboros-ui's suites read, byte for byte in meaning", () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as unknown;

    expect(codeSymbolTable(TABLE, GOLDEN_SUGGESTIONS)).toEqual(golden);
  });
});
