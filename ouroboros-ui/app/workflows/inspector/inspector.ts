/**
 * Every decision the studio's inspector makes, and every sentence it says (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * The inspector is where a stage is configured, and it is drawn from **R.3's catalog**
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)): each node type arrives with the
 * JSON Schema of its `config`, so the choices a select offers, the bounds a number takes and the
 * fields an unknown type shows are read from the schema here rather than typed into a component.
 * A node type added to the DSL therefore gets a working form without a UI change
 * ({@link genericFields}).
 *
 * **Framework-free and pure**, like `app/workflows/view.ts`: nothing here imports React, so every
 * rule below is a unit test over small values.
 *
 * ### Three honesty rules this module keeps
 *
 * 1. **Unknown references warn and never block** (decision **P7**). A skill, task route or model
 *    alias the workspace does not list is flagged beside its field ({@link referenceWarnings}),
 *    and **Apply** still works — the lists are suggestions, and the one refusal that exists (an
 *    unknown alias at publish, #589) is named in the alias warning rather than enforced early.
 * 2. **Permissions are declarations** (decision **P9**). The toggles are stored on the stage and
 *    nothing enforces them until the execution bridge (T.6, #160); {@link DECLARED_NOTE} says so
 *    under the toggles.
 * 3. **An applied edit is not a saved one.** Apply writes into the draft the page holds; autosave
 *    is #152, and {@link APPLIED_NOTE} says so.
 */

import type { Reading } from "@/app/api/reading";
import type { RoutingAlias, RoutingTaskKind } from "@/app/api/routing";
import type { WorkflowDefinition, WorkflowStageCatalog, WorkflowStageType } from "@/app/api/workflows";
import { type CanvasSelection, upstreamStageIds } from "@/app/workflows/canvas/graph";

/* ------------------------------------------------------------------ reading a catalog schema */

/** A JSON Schema document, or one node of one. Read defensively: it is the service's to shape. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** A plain JSON object — a stage's config, or part of one. */
export type ConfigRecord = Readonly<Record<string, unknown>>;

/** What an absent or unreadable schema node reads as. */
const EMPTY_SCHEMA: JsonSchema = Object.freeze({});

/** How many `$ref` hops a lookup follows before giving up, so a cyclic schema cannot hang a render. */
const MAX_REF_HOPS = 16;

/**
 * Whether a value is a plain object.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The catalog's entry for one node type.
 *
 * @param catalog The catalog, or `null` when it could not be read.
 * @param type The node's `type`.
 * @returns The entry, or `null` when the catalog does not list the type.
 */
export function catalogType(catalog: WorkflowStageCatalog | null, type: string): WorkflowStageType | null {
  return catalog?.nodeTypes.find((entry) => entry.type === type) ?? null;
}

/**
 * The schema a node follows, with every local `$ref` it starts with followed.
 *
 * The catalog serves each config schema self-contained — the definition plus a `$defs` of what it
 * references under the published names — so `#/$defs/<name>` always resolves against the root.
 *
 * @param node A schema node, possibly `{ $ref }`.
 * @param root The document whose `$defs` a reference names.
 * @returns The node the reference leads to, or an empty schema when it leads nowhere.
 */
export function resolveSchema(node: unknown, root: JsonSchema): JsonSchema {
  let current = node;

  for (let hop = 0; hop < MAX_REF_HOPS && isRecord(current) && typeof current.$ref === "string"; hop += 1) {
    const match = /^#\/\$defs\/(.+)$/.exec(current.$ref);
    const defs = root.$defs;
    if (match === null || !isRecord(defs)) return EMPTY_SCHEMA;
    current = defs[match[1]];
  }

  return isRecord(current) && typeof current.$ref !== "string" ? current : EMPTY_SCHEMA;
}

/**
 * One property's schema.
 *
 * @param schema The object schema.
 * @param name The property.
 * @param root The document references resolve against.
 * @returns The property's schema, resolved, or an empty schema.
 */
export function propertySchema(schema: JsonSchema, name: string, root: JsonSchema): JsonSchema {
  const properties = resolveSchema(schema, root).properties;
  return isRecord(properties) ? resolveSchema(properties[name], root) : EMPTY_SCHEMA;
}

/**
 * The branch of an `allOf` of `if`/`then` pairs that applies when a discriminator has a value —
 * how the DSL says *options depend on the action* and *op depends on the predicate kind*.
 *
 * @param schema The schema holding the `allOf`.
 * @param discriminator The property the `if` tests.
 * @param value The value it is tested against.
 * @param root The document references resolve against.
 * @returns The matching `then`, resolved, or an empty schema when no branch names the value.
 */
export function branchSchema(
  schema: JsonSchema,
  discriminator: string,
  value: string,
  root: JsonSchema,
): JsonSchema {
  const all = resolveSchema(schema, root).allOf;
  if (!Array.isArray(all)) return EMPTY_SCHEMA;

  for (const entry of all) {
    if (!isRecord(entry) || !isRecord(entry.if) || !isRecord(entry.if.properties)) continue;
    const test = entry.if.properties[discriminator];
    if (isRecord(test) && test.const === value) return resolveSchema(entry.then, root);
  }

  return EMPTY_SCHEMA;
}

/**
 * The values a schema allows, when it is an enumeration — or its items', for an array.
 *
 * @param schema The schema.
 * @param root The document references resolve against.
 * @returns The allowed strings, in the schema's order; empty when it is not an enumeration.
 */
export function schemaChoices(schema: JsonSchema, root: JsonSchema): readonly string[] {
  const resolved = resolveSchema(schema, root);
  const values = resolved.type === "array" ? resolveSchema(resolved.items, root).enum : resolved.enum;

  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

/** A schema's numeric and length bounds, each `null` when the schema sets none. */
export interface SchemaBounds {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly minItems: number | null;
}

/**
 * A schema's bounds.
 *
 * @param schema The schema.
 * @param root The document references resolve against.
 * @returns The bounds.
 */
export function schemaBounds(schema: JsonSchema, root: JsonSchema): SchemaBounds {
  const resolved = resolveSchema(schema, root);
  const read = (key: string): number | null => (typeof resolved[key] === "number" ? (resolved[key] as number) : null);

  return {
    minimum: read("minimum"),
    maximum: read("maximum"),
    minLength: read("minLength"),
    maxLength: read("maxLength"),
    minItems: read("minItems"),
  };
}

/**
 * The properties an object schema requires.
 *
 * @param schema The schema.
 * @param root The document references resolve against.
 * @returns The names.
 */
export function requiredProperties(schema: JsonSchema, root: JsonSchema): readonly string[] {
  const required = resolveSchema(schema, root).required;
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : [];
}

/**
 * A property name as a label — `runner_pool` → *Runner pool*.
 *
 * @param name The property name.
 * @returns The label.
 */
export function fieldLabel(name: string): string {
  const words = name.split(/[_-]/).filter((word) => word !== "").join(" ");
  return words === "" ? name : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/* ------------------------------------------------------------------ the generated form */

/** How a generated field is drawn. `json` is a value no simple control can edit honestly. */
export type GenericWidget = "select" | "toggle" | "number" | "text" | "json";

/** One field of a form generated from a schema. */
export interface GenericField {
  /** The property name. */
  readonly name: string;
  /** What the label says. */
  readonly label: string;
  /** How it is drawn. */
  readonly widget: GenericWidget;
  /** Whether the schema requires it. */
  readonly required: boolean;
  /** The options, for a `select`. */
  readonly choices: readonly string[];
  /** The bounds the schema sets. */
  readonly bounds: SchemaBounds;
}

/**
 * The form an object schema describes — one field per property, in the schema's order.
 *
 * This is what makes *a new node type gets a form for free* true: an `infra` stage, a terminal's
 * options and any type this build has never heard of are drawn from here, with nothing about
 * them written into a component.
 *
 * @param schema The object schema.
 * @param root The document references resolve against.
 * @returns The fields. Empty for a schema with no properties — a trigger's, which is closed.
 */
export function genericFields(schema: JsonSchema, root: JsonSchema): readonly GenericField[] {
  const resolved = resolveSchema(schema, root);
  if (!isRecord(resolved.properties)) return [];

  const required = new Set(requiredProperties(resolved, root));
  const properties = resolved.properties;

  return Object.keys(properties).map((name) => {
    const property = resolveSchema(properties[name], root);
    const choices = schemaChoices(property, root);
    const widget: GenericWidget =
      choices.length > 0 && property.type !== "array"
        ? "select"
        : property.type === "boolean"
          ? "toggle"
          : property.type === "integer" || property.type === "number"
            ? "number"
            : property.type === "string"
              ? "text"
              : "json";

    return {
      name,
      label: typeof property.title === "string" ? property.title : fieldLabel(name),
      widget,
      required: required.has(name),
      choices,
      bounds: schemaBounds(property, root),
    };
  });
}

/**
 * The starting value of an object a generated form will edit — what a terminal's options become
 * when its action changes: the first choice for a select, `false` for a toggle, nothing otherwise.
 *
 * @param fields The fields.
 * @returns The object.
 */
export function generatedDefaults(fields: readonly GenericField[]): ConfigRecord {
  return Object.fromEntries(
    fields.flatMap((field): [string, unknown][] => {
      if (!field.required) return [];
      if (field.widget === "select" && field.choices.length > 0) return [[field.name, field.choices[0]]];
      if (field.widget === "toggle") return [[field.name, false]];
      return [];
    }),
  );
}

/* ------------------------------------------------------------------ editing a config */

/**
 * A copy of an object with one value set at a path — or removed, when the value is `undefined`.
 *
 * @param record The object.
 * @param path The keys, outermost first.
 * @param value The value, or `undefined` to remove the key.
 * @returns The new object. Intermediate objects that did not exist are created.
 */
export function withValue(record: ConfigRecord, path: readonly string[], value: unknown): ConfigRecord {
  if (path.length === 0) return record;

  const [head, ...rest] = path;
  const child = isRecord(record[head]) ? record[head] : {};
  const next = rest.length === 0 ? value : withValue(child, rest, value);

  if (next === undefined) {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== head));
  }

  return { ...record, [head]: next };
}

/**
 * The value at a path.
 *
 * @param record The object.
 * @param path The keys, outermost first.
 * @returns The value, or `undefined` when any step is missing.
 */
export function readValue(record: ConfigRecord, path: readonly string[]): unknown {
  let current: unknown = record;

  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

/**
 * A value as a string with its keys sorted at every depth, so two configs that differ only in key
 * order compare equal.
 *
 * @param value Anything JSON.
 * @returns The canonical string.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Whether a draft config differs from the stage's stored one — the footer's *unapplied changes*.
 *
 * @param draft The draft.
 * @param stored The config the document holds.
 * @returns `true` when they differ in anything but key order.
 */
export function isConfigDirty(draft: ConfigRecord, stored: ConfigRecord): boolean {
  return canonical(draft) !== canonical(stored);
}

/**
 * A comma-separated list as the entries it holds.
 *
 * @param text What the field holds.
 * @returns The trimmed, non-empty entries, in order.
 */
export function splitList(text: string): readonly string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/* ------------------------------------------------------------------ the token budget */

/** `400k`, `1.5m`, `250000` — a number with an optional thousand or million suffix. */
const BUDGET_SHORTHAND = /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i;

/**
 * A token budget as typed, as the integer the document stores — `400k` → `400000`.
 *
 * @param text What the field holds.
 * @returns The number of tokens, or `null` for text that is not a whole number of tokens.
 */
export function parseTokenBudget(text: string): number | null {
  const match = BUDGET_SHORTHAND.exec(text);
  if (match === null) return null;

  const unit = match[2]?.toLowerCase();
  const scale = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1;
  const value = Number(match[1]) * scale;
  const whole = Math.round(value);

  return Math.abs(value - whole) < 1e-6 ? whole : null;
}

/**
 * A token budget as the field shows it — `400000` → `400k`, the mockup's spelling.
 *
 * @param value The stored number.
 * @returns The shorthand when it is exact, the plain number otherwise.
 */
export function formatTokenBudget(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}m`;
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}k`;
  return String(value);
}

/**
 * The text the token-budget field opens with.
 *
 * @param config A model stage's config.
 * @returns The stored budget as shorthand, or `""` when there is none.
 */
export function budgetText(config: ConfigRecord): string {
  const value = readValue(config, ["limits", "token_budget"]);
  return typeof value === "number" ? formatTokenBudget(value) : "";
}

/* ------------------------------------------------------------------ what is wrong */

/** Messages keyed by the path of the field they belong to — `prompt_template`, `limits.token_budget`. */
export type FieldMessages = Readonly<Record<string, string>>;

/** The field a message about the whole routing choice is shown beside. */
export const ROUTING_FIELD = "routing";

/**
 * What stops a draft from being applied: values the schema refuses outright. Warnings about names
 * the workspace does not list are {@link referenceWarnings}, and never block.
 *
 * @param type The node's type.
 * @param config The draft config.
 * @param root The type's config schema, or `null` when the catalog could not be read — nothing is
 *   checked then, because nothing is known.
 * @param budget The token-budget field's text, for a model stage.
 * @returns The messages; empty when the draft may be applied.
 */
export function draftErrors(
  type: string,
  config: ConfigRecord,
  root: JsonSchema | null,
  budget: string,
): FieldMessages {
  if (root === null) return {};

  const errors: Record<string, string> = {};

  switch (type) {
    case "llm":
      llmErrors(config, root, budget, errors);
      break;
    case "flow":
      flowErrors(config, root, errors);
      break;
    default:
      genericErrors(config, root, errors);
  }

  return errors;
}

/**
 * A model stage's errors.
 *
 * @param config The draft config.
 * @param root The config schema.
 * @param budget The token-budget field's text.
 * @param errors Where to write them.
 */
function llmErrors(config: ConfigRecord, root: JsonSchema, budget: string, errors: Record<string, string>): void {
  if (config.mode === "skill" && (typeof config.skill !== "string" || config.skill.trim() === "")) {
    errors.skill = SKILL_REQUIRED;
  }

  const template = propertySchema(root, "prompt_template", root);
  const text = typeof config.prompt_template === "string" ? config.prompt_template : "";
  const templateBounds = schemaBounds(template, root);
  if (text.trim() === "") errors.prompt_template = PROMPT_REQUIRED;
  else if (templateBounds.maxLength !== null && text.length > templateBounds.maxLength) {
    errors.prompt_template = tooLong(templateBounds.maxLength);
  }

  const routing = isRecord(config.routing) ? config.routing : {};
  if (typeof routing.inherit_task === "string") {
    if (routing.inherit_task.trim() === "") errors[ROUTING_FIELD] = TASK_REQUIRED;
  } else if (isRecord(routing.pinned_model)) {
    const alias = routing.pinned_model.alias;
    const pattern = resolveSchema({ $ref: "#/$defs/alias_name" }, root).pattern;
    if (typeof alias !== "string" || alias === "") errors[ROUTING_FIELD] = ALIAS_REQUIRED;
    else if (typeof pattern === "string" && !new RegExp(pattern).test(alias)) errors[ROUTING_FIELD] = ALIAS_INVALID;
  } else {
    errors[ROUTING_FIELD] = ROUTING_REQUIRED;
  }

  const limits = propertySchema(root, "limits", root);
  const retries = readValue(config, ["limits", "max_retries"]);
  const retryBounds = schemaBounds(propertySchema(limits, "max_retries", root), root);
  if (!isWithin(retries, retryBounds)) {
    errors["limits.max_retries"] = wholeNumberBetween(retryBounds);
  }

  const budgetBounds = schemaBounds(propertySchema(limits, "token_budget", root), root);
  const parsed = parseTokenBudget(budget);
  if (parsed === null) errors["limits.token_budget"] = BUDGET_INVALID;
  else if (!isWithin(parsed, budgetBounds)) errors["limits.token_budget"] = wholeNumberBetween(budgetBounds);
}

/**
 * A flow node's errors: a predicate that needs a list and has none.
 *
 * @param config The draft config.
 * @param root The config schema.
 * @param errors Where to write them.
 */
function flowErrors(config: ConfigRecord, root: JsonSchema, errors: Record<string, string>): void {
  const predicate = isRecord(config.predicate) ? config.predicate : {};
  if (typeof predicate.kind !== "string") {
    errors["predicate.kind"] = PREDICATE_REQUIRED;
    return;
  }

  const branch = branchSchema(propertySchema(root, "predicate", root), "kind", predicate.kind, root);
  if (requiredProperties(branch, root).includes("values")) {
    if (!Array.isArray(predicate.values) || predicate.values.length === 0) {
      errors["predicate.values"] = VALUES_REQUIRED;
    }
  }
}

/**
 * A generated form's errors: required text left empty, numbers out of bounds, text too long.
 *
 * @param config The draft config.
 * @param root The config schema.
 * @param errors Where to write them.
 */
function genericErrors(config: ConfigRecord, root: JsonSchema, errors: Record<string, string>): void {
  for (const field of genericFields(root, root)) {
    const value = config[field.name];

    if (field.widget === "number" && value !== undefined && !isWithin(value, field.bounds)) {
      errors[field.name] = wholeNumberBetween(field.bounds);
    }
    if (field.widget === "text" && typeof value === "string") {
      if (field.bounds.maxLength !== null && value.length > field.bounds.maxLength) {
        errors[field.name] = tooLong(field.bounds.maxLength);
      }
    }
    if (field.required && field.widget === "text" && (typeof value !== "string" || value === "")) {
      errors[field.name] = REQUIRED;
    }
  }
}

/**
 * Whether a value is a whole number inside a schema's bounds.
 *
 * @param value Anything.
 * @param bounds The bounds.
 * @returns `true` for an integer at or between them.
 */
function isWithin(value: unknown, bounds: SchemaBounds): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (bounds.minimum === null || value >= bounds.minimum) &&
    (bounds.maximum === null || value <= bounds.maximum)
  );
}

/* ------------------------------------------------------------------ names the workspace does not list */

/** What the workspace lists, for {@link referenceWarnings}. An empty list, or `null`, checks nothing. */
export interface KnownNames {
  readonly skills: readonly string[];
  readonly taskRoutes: readonly string[];
  readonly aliases: readonly string[] | null;
}

/**
 * The names the workspace lists.
 *
 * @param catalog The catalog, or `null` when it could not be read.
 * @param aliases The registry's aliases, or `null` when they were not read.
 * @returns The names.
 */
export function knownNames(
  catalog: WorkflowStageCatalog | null,
  aliases: Reading<readonly RoutingAlias[]> | null,
): KnownNames {
  return {
    skills: catalog?.suggestions.skills ?? [],
    taskRoutes: catalog?.suggestions.taskRoutes ?? [],
    aliases: aliases?.ok === true ? aliases.value.map((alias) => alias.alias) : null,
  };
}

/**
 * Every reference a model stage makes that the workspace does not list (decision **P7**) — the
 * service's `checkReferences` (`ouroboros-rest/src/modules/workflows/dsl.references.ts`), in the
 * inspector, so the warning appears beside the field as it is typed.
 *
 * A list that is empty (or was not read) is *nothing to check against*, as it is in the service,
 * so a workspace with no configured skills is not told every skill is unknown.
 *
 * @param type The node's type — only a model stage makes references.
 * @param config The draft config.
 * @param known What the workspace lists.
 * @returns Warnings keyed by field: `skill`, and {@link ROUTING_FIELD}.
 */
export function referenceWarnings(type: string, config: ConfigRecord, known: KnownNames): FieldMessages {
  if (type !== "llm") return {};

  const warnings: Record<string, string> = {};
  const { skill } = config;

  if (config.mode === "skill" && typeof skill === "string" && skill !== "" && known.skills.length > 0) {
    if (!known.skills.includes(skill)) warnings.skill = unknownSkill(skill);
  }

  const routing = isRecord(config.routing) ? config.routing : {};
  const task = routing.inherit_task;
  if (typeof task === "string" && task !== "" && known.taskRoutes.length > 0 && !known.taskRoutes.includes(task)) {
    warnings[ROUTING_FIELD] = unknownTask(task);
  }

  const alias = isRecord(routing.pinned_model) ? routing.pinned_model.alias : undefined;
  if (typeof alias === "string" && alias !== "" && known.aliases !== null && !known.aliases.includes(alias)) {
    warnings[ROUTING_FIELD] = unknownAlias(alias);
  }

  return warnings;
}

/* ------------------------------------------------------------------ routing and variables */

/**
 * The model an inherited route resolves to — the mockup's `claude-fable-5` pill.
 *
 * @param routes The routing matrix's task kinds.
 * @param task The task the stage inherits.
 * @returns The primary hop's model id, or `null` when the task has no route.
 */
export function inheritedModel(routes: readonly RoutingTaskKind[], task: string): string | null {
  const route = routes.find((kind) => kind.name === task)?.route;
  return route?.hops.find((hop) => hop.position === 1)?.modelId ?? null;
}

/**
 * The run-context names the palette offers — the ones the seed's templates and the DSL docs use.
 * Suggestions, not a contract: the run context is defined by the execution bridge (#160).
 */
export const RUN_CONTEXT_VARIABLES = ["issue.title", "issue.body", "diff"] as const;

/** What the variable palette offers for one stage. */
export interface PaletteVariables {
  /** The run-context names. */
  readonly context: readonly string[];
  /** The ids of the stages that run before this one — `{{analyze}}`, `{{plan}}`. */
  readonly stages: readonly string[];
}

/**
 * The palette for one stage.
 *
 * @param definition The draft.
 * @param id The stage.
 * @returns The run-context names and the upstream stage ids.
 */
export function paletteVariables(definition: WorkflowDefinition, id: string): PaletteVariables {
  return { context: RUN_CONTEXT_VARIABLES, stages: upstreamStageIds(definition, id) };
}

/**
 * A variable as it is written in a template.
 *
 * @param name The variable.
 * @returns `{{name}}`.
 */
export function variableToken(name: string): string {
  return `{{${name}}}`;
}

/** One run of a template: plain text, or a `{{…}}` placeholder. */
export interface TemplateSegment {
  readonly text: string;
  readonly variable: boolean;
}

/**
 * A template split into plain text and placeholders — what the editor highlights.
 *
 * @param template The template.
 * @returns The runs, in order; joined, they are the template.
 */
export function templateSegments(template: string): readonly TemplateSegment[] {
  return template
    .split(/(\{\{[^{}]*\}\})/)
    .filter((text) => text !== "")
    .map((text) => ({ text, variable: /^\{\{[^{}]*\}\}$/.test(text) }));
}

/* ------------------------------------------------------------------ the copy */

/** The panel's accessible name. */
export const INSPECTOR_LABEL = "Inspector";

/** What the panel says with nothing selected. */
export const NOTHING_SELECTED_TITLE = "Select a stage";
export const NOTHING_SELECTED_NOTE = "Click a stage on the canvas, or Tab to one and press Enter, to configure it.";

/** …with an edge selected. */
export const EDGE_SELECTED_NOTE = "Editing an edge arrives with #151 — select a stage to configure it.";

/** …with more than one thing selected. */
export const MANY_SELECTED_NOTE = "Select one stage to configure it.";

/**
 * What the panel says when no single stage is selected.
 *
 * @param selection The canvas's selection.
 * @returns The note for an edge, for several things, or for nothing.
 */
export function emptyNote(selection: CanvasSelection): string {
  if (selection?.kind === "edge") return EDGE_SELECTED_NOTE;
  if (selection?.kind === "many") return MANY_SELECTED_NOTE;
  return NOTHING_SELECTED_NOTE;
}

/** The mode segment's legend, and what each mode is called. */
export const MODE_LABEL = "Mode";
export const MODE_WORDS: Readonly<Record<string, string>> = { prompt: "Direct prompt", skill: "Skill" };

/** The skill field. */
export const SKILL_LABEL = "Skill";
export const SKILL_HINT = "Loaded into context before the stage prompt.";

/** The prompt template's section, and its palette. */
export const PROMPT_LABEL = "Prompt template";
export const PALETTE_LABEL = "Insert a variable";
export const UPSTREAM_LABEL = "From earlier stages";
export const PALETTE_NOTE = "Suggestions — the run context is defined at execution (#160).";

/**
 * The palette button's accessible name.
 *
 * @param name The variable.
 * @returns *Insert {{issue.title}}*.
 */
export function insertLabel(name: string): string {
  return `Insert ${variableToken(name)}`;
}

/** The routing section. */
export const ROUTING_LABEL = "Model routing";
export const RECOMMENDED = "(recommended)";
export const PIN_LABEL = "Pin model";
export const TASK_LABEL = "Task";
export const ALIAS_LABEL = "Model alias";
export const NO_ROUTE_NOTE = "No route is configured for this task yet.";
export const ROUTES_UNREAD_NOTE = "The resolved model could not be read.";

/**
 * The inherit radio's label.
 *
 * @param task The task.
 * @returns *Inherit route for task "implement"*.
 */
export function inheritLabel(task: string): string {
  return `Inherit route for task "${task}"`;
}

/** The limits section. */
export const LIMITS_LABEL = "Limits";
export const RETRIES_LABEL = "Max retries";
export const BUDGET_LABEL = "Token budget";
export const BUDGET_HINT = "Shorthand works: 400k, 1.5m.";

/** The permissions section, and what each declaration is called. */
export const PERMISSIONS_LABEL = "Permissions";
export const PERMISSION_WORDS: Readonly<Record<string, string>> = {
  push_fixup: "May push fixup commits",
  touch_ci: "May touch CI config",
};

/** Decision **P9**, under the toggles. */
export const DECLARED_NOTE =
  "Declared now — enforced at execution (T.6, #160). Nothing checks these toggles until then.";

/** A trigger's panel — it has no config of its own. */
export const TRIGGER_NOTE =
  "A trigger has no stage settings: its predicate is the workflow's own trigger, described in the page head.";

/** A terminal action with no options. */
export const NO_OPTIONS_NOTE = "This action takes no options.";

/** A value no control here edits. */
export const JSON_NOTE = "Edit this value in the code view.";

/** The flow form. */
export const PREDICATE_LABEL = "Predicate";
export const OPERATOR_LABEL = "Operator";
export const VALUE_LABEL = "Value";
export const VALUES_LABEL = "Values";
export const LIST_HINT = "Comma-separated.";
export const CHECK_NAMES_HINT = "Comma-separated. Leave empty for every check the run produces.";

/** The footer. */
export const DELETE_LABEL = "Delete stage";
export const APPLY_LABEL = "Apply";
export const DIRTY_NOTE = "Unapplied changes";
export const APPLIED_NOTE = "Applied to the draft — not saved; autosave arrives with #152.";
export const MEMBER_REASON = "Only an owner or admin may change a workflow.";
export const INVALID_REASON = "Fix the fields marked in red before applying.";
export const CLEAN_REASON = "Nothing to apply yet.";

/** When the catalog is missing what the panel needs. */
export const CATALOG_UNREAD = "The stage catalog could not be read, so this stage has no form.";
export const TYPE_UNKNOWN = "The stage catalog does not describe this stage's type, so it has no form.";

/** The errors. */
export const REQUIRED = "Required.";
export const SKILL_REQUIRED = "Name the skill to load, or switch to Direct prompt.";
export const PROMPT_REQUIRED = "Write the stage prompt.";
export const TASK_REQUIRED = "Name the task whose route to inherit.";
export const ALIAS_REQUIRED = "Choose the model alias to pin.";
export const ALIAS_INVALID = "An alias is lower-case words joined by hyphens.";
export const ROUTING_REQUIRED = "Choose how this stage is routed.";
export const BUDGET_INVALID = "Enter a whole number of tokens, like 400k.";
export const PREDICATE_REQUIRED = "Choose what the predicate tests.";
export const VALUES_REQUIRED = "Name at least one value.";

/**
 * A length error.
 *
 * @param max The limit.
 * @returns The sentence.
 */
export function tooLong(max: number): string {
  return `At most ${max.toString()} characters.`;
}

/**
 * A numeric range error.
 *
 * @param bounds The bounds.
 * @returns The sentence.
 */
export function wholeNumberBetween(bounds: SchemaBounds): string {
  const min = bounds.minimum ?? 0;
  return bounds.maximum === null
    ? `A whole number of at least ${formatTokenBudget(min)}.`
    : `A whole number from ${formatTokenBudget(min)} to ${formatTokenBudget(bounds.maximum)}.`;
}

/**
 * The unknown-skill warning, as the service words it.
 *
 * @param skill The skill.
 * @returns The sentence.
 */
export function unknownSkill(skill: string): string {
  return `No skill named \`${skill}\` is defined in this workspace yet.`;
}

/**
 * The unknown-task warning, as the service words it.
 *
 * @param task The task.
 * @returns The sentence.
 */
export function unknownTask(task: string): string {
  return `No route is configured for the task \`${task}\`.`;
}

/**
 * The unknown-alias warning — the one unknown name publishing refuses (#589), which it says.
 *
 * @param alias The alias.
 * @returns The sentence.
 */
export function unknownAlias(alias: string): string {
  return `No alias named \`${alias}\` is in this workspace's model registry. Publishing will refuse it.`;
}
