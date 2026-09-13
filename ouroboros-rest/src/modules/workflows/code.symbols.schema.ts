/**
 * The published DSL schema, read the way the code view's symbol table needs it — W.1
 * ([#177](https://github.com/NobuData/ouroboros/issues/177)).
 *
 * `code.grammar.ts` points at schema locations and `code.symbols.ts` assembles the table; this
 * file answers the three questions the assembly asks of a location: *what does it say about
 * itself* ({@link describe}), *which values does it take* ({@link enumeration}), and *how is its
 * type written* ({@link spellType}). Each answer follows `$ref` the way a reader of the schema
 * would, and each can be *nothing*, which the table then shows as nothing.
 *
 * Pure functions over the parsed document; nothing is copied out of `v1.json` into this file.
 */

import { DslSchemaError, isObject, type JsonSchema } from "./catalog.schema";

/** The prefix every `$ref` in the DSL schema carries. */
const LOCAL_DEFINITION = "#/$defs/";

/** How long a chain of `$ref`s may be before it is treated as a cycle. */
const MAX_REFERENCE_DEPTH = 16;

/** The JSON types a signature spells by name. */
const SCALAR_TYPES = new Set(["string", "integer", "number", "boolean"]);

/**
 * The value the code view writes for one schema enum member.
 *
 * `ticket_queued` is written `issue.queued` (`TRIGGER_EVENTS`); most values are written as they
 * are. A member the code view has no spelling for answers `undefined` and is left out, because
 * offering it would offer text the parser refuses.
 *
 * @param value - A member of a schema `enum`.
 * @returns The value as the code holds it, or `undefined`.
 */
export type ValueSpelling = (value: unknown) => unknown;

/** Every value written as the schema lists it. */
export const asListed: ValueSpelling = (value) => value;

/**
 * Resolve a JSON Pointer (RFC 6901) in the schema.
 *
 * @param schema - The published document.
 * @param pointer - `""` for the root, or `/`-separated tokens with `~1` and `~0` escapes.
 * @returns The object at that location.
 * @throws {DslSchemaError} If the pointer names nothing, or names something that is not an
 *   object — a grammar table pointing at a location the schema no longer has. Thrown at boot,
 *   where `catalog.schema.ts` throws for the same kind of mistake.
 */
export function locate(schema: JsonSchema, pointer: string): JsonSchema {
  if (pointer === "") return schema;
  if (!pointer.startsWith("/")) {
    throw new DslSchemaError(`\`${pointer}\` is not a JSON Pointer.`);
  }

  let node: unknown = schema;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) {
      node = node[Number(key)];
    } else {
      node = isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
    }
  }

  if (!isObject(node)) {
    throw new DslSchemaError(`The workflow DSL schema has no subschema at \`${pointer}\`.`);
  }

  return node;
}

/**
 * The definition a subschema's `$ref` names.
 *
 * @param schema - The published document.
 * @param node - A subschema.
 * @returns The definition's name and body, or `undefined` when the subschema has no `$ref`.
 * @throws {DslSchemaError} If the reference is not local or names no definition.
 */
export function referenced(
  schema: JsonSchema,
  node: JsonSchema,
): { readonly name: string; readonly node: JsonSchema } | undefined {
  if (typeof node.$ref !== "string") return undefined;
  if (!node.$ref.startsWith(LOCAL_DEFINITION)) {
    throw new DslSchemaError(`\`${node.$ref}\` is not a local definition.`);
  }

  const name = node.$ref.slice(LOCAL_DEFINITION.length);
  return { name, node: locate(schema, `/$defs/${name}`) };
}

/**
 * A subschema, then each definition its `$ref` chain reaches, nearest first.
 *
 * @param schema - The published document.
 * @param node - Where to start.
 * @returns The chain.
 * @throws {DslSchemaError} If the chain is longer than any the schema could mean.
 */
function referenceChain(schema: JsonSchema, node: JsonSchema): JsonSchema[] {
  const chain = [node];

  for (let target = referenced(schema, node); target; target = referenced(schema, target.node)) {
    if (chain.length > MAX_REFERENCE_DEPTH) {
      throw new DslSchemaError(`The \`$ref\` chain from \`${String(node.$ref)}\` does not end.`);
    }
    chain.push(target.node);
  }

  return chain;
}

/**
 * What a location says about itself.
 *
 * Its own `description` first — `inherit_task` documents `route.task`, although the `reference`
 * it points at documents something more general — and otherwise the nearest one along its
 * `$ref` chain.
 *
 * @param schema - The published document.
 * @param node - A subschema.
 * @returns The description, or `undefined` when nothing along the chain has one.
 */
export function describe(schema: JsonSchema, node: JsonSchema): string | undefined {
  for (const link of referenceChain(schema, node)) {
    if (typeof link.description === "string" && link.description !== "") return link.description;
  }

  return undefined;
}

/**
 * The values a location takes, when the schema lists them.
 *
 * @param schema - The published document.
 * @param node - A subschema.
 * @returns The nearest `enum` along the `$ref` chain, or `undefined`.
 */
export function enumeration(schema: JsonSchema, node: JsonSchema): readonly unknown[] | undefined {
  for (const link of referenceChain(schema, node)) {
    const values: unknown = link.enum;
    if (Array.isArray(values)) return values as readonly unknown[];
  }

  return undefined;
}

/**
 * The values a location takes, as the code view writes them.
 *
 * @param schema - The published document.
 * @param node - A subschema.
 * @param spell - How a member is written; a member it has no spelling for is left out.
 * @returns The written values in the schema's order, or `[]` when the location lists none.
 */
export function spelledValues(
  schema: JsonSchema,
  node: JsonSchema,
  spell: ValueSpelling = asListed,
): unknown[] {
  const listed: readonly unknown[] = enumeration(schema, node) ?? [];
  return listed.map(spell).filter((value) => value !== undefined);
}

/**
 * A definition name as a type name: `source_kind` → `SourceKind`.
 *
 * @param definition - A `$defs` key.
 * @returns The PascalCase spelling.
 */
export function typeName(definition: string): string {
  return definition
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * How a signature writes a location's type.
 *
 * Only what reads the same in the code as in the document is spelled: a scalar (`integer`), a
 * list of values (`"squash" | "merge" | "rebase"`), an enumerated definition by its name
 * (`Effort`), and an array of any of those (`string[]`). An object is not spelled, because the
 * code view writes most objects differently from the document — `permissions` camel-cases its
 * keys, `next` is a string — and a type that described the document would mislead.
 *
 * @param schema - The published document.
 * @param node - A subschema.
 * @param spell - How an inline enum's members are written.
 * @returns The spelling, or `undefined` when the location has none.
 */
export function spellType(
  schema: JsonSchema,
  node: JsonSchema,
  spell: ValueSpelling = asListed,
): string | undefined {
  const target = referenced(schema, node);
  if (target !== undefined) {
    return Array.isArray(target.node.enum)
      ? typeName(target.name)
      : spellType(schema, target.node, spell);
  }

  if (Array.isArray(node.enum)) {
    const values = spelledValues(schema, node, spell).map((value) => JSON.stringify(value));
    return values.length > 0 ? values.join(" | ") : undefined;
  }

  if (typeof node.type === "string" && SCALAR_TYPES.has(node.type)) return node.type;

  if (node.type === "array" && isObject(node.items)) {
    const items = spellType(schema, node.items, spell);
    if (items === undefined) return undefined;
    return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
  }

  return undefined;
}
