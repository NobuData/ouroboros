/**
 * Reading a published JSON Schema contract under test — the field walk a drift check pins, and
 * the fixtures `expected.json` classifies (`schemas/*`).
 *
 * The walk lists every field as `path:type` (resolving local `$ref`s), so a TypeScript pin of the
 * same list goes red the moment the published document changes shape without its readers.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** A JSON Schema node, as far as the walk reads one. */
export interface SchemaNode {
  readonly $ref?: string;
  readonly $id?: string;
  readonly type?: string | readonly string[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly oneOf?: readonly SchemaNode[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly items?: SchemaNode;
  readonly $defs?: Readonly<Record<string, SchemaNode>>;
}

/** One recorded fixture verdict. */
export interface FixtureCase {
  document: string;
  def: string;
  valid: boolean;
}

/**
 * Read a contract document.
 *
 * @param path - The JSON file.
 * @returns The parsed schema.
 */
export function readSchema(path: string): SchemaNode {
  return JSON.parse(readFileSync(path, "utf8")) as SchemaNode;
}

/**
 * Follow a local `$ref` within a document.
 *
 * @param document - The whole schema.
 * @param node - A node.
 * @returns The node it refers to, or itself.
 * @throws {Error} The `$defs` entry does not exist.
 */
export function resolveRef(document: SchemaNode, node: SchemaNode): SchemaNode {
  if (node.$ref === undefined) return node;

  const name = node.$ref.replace("#/$defs/", "");
  const target = document.$defs?.[name];

  if (target === undefined) throw new Error(`the schema has no $defs/${name}`);

  return target;
}

/**
 * A node's type as a pin writes it.
 *
 * @param node - A resolved node.
 * @returns `const(…)`, `enum(…)`, `oneOf(…)` or the type(s).
 */
export function typeOf(node: SchemaNode): string {
  if (node.const !== undefined) return `const(${JSON.stringify(node.const).replaceAll('"', "")})`;
  if (node.enum !== undefined) return `enum(${node.enum.map((value) => String(value)).join(",")})`;
  if (node.oneOf !== undefined) return `oneOf(${String(node.oneOf.length)})`;

  return Array.isArray(node.type) ? node.type.join("|") : String(node.type);
}

/**
 * Every field beneath a node as `path:type`, in document order.
 *
 * @param document - The whole schema, for `$ref`s.
 * @param node - Where to start.
 * @param prefix - Its path.
 * @returns The fields.
 */
export function schemaFields(document: SchemaNode, node: SchemaNode, prefix: string): string[] {
  const out: string[] = [];

  for (const [name, raw] of Object.entries(node.properties ?? {})) {
    const child = resolveRef(document, raw);
    const path = `${prefix}.${name}`;

    out.push(`${path}:${typeOf(child)}`);
    out.push(...schemaFields(document, child, path));

    if (child.items !== undefined) {
      const items = resolveRef(document, child.items);

      if (items.properties === undefined) out.push(`${path}[]:${typeOf(items)}`);
      out.push(...schemaFields(document, items, `${path}[]`));
    }
  }

  return out;
}

/**
 * The fixtures on disk and the verdicts `expected.json` records for them.
 *
 * @param contract - The contract's directory (holding `fixtures/`).
 * @returns The recorded cases and the documents actually present.
 */
export function fixtureCases(contract: string): { cases: FixtureCase[]; onDisk: string[] } {
  const expected = JSON.parse(
    readFileSync(join(contract, "fixtures", "expected.json"), "utf8"),
  ) as { cases: FixtureCase[] };
  const onDisk = ["valid", "invalid"].flatMap((dir) =>
    readdirSync(join(contract, "fixtures", dir)).map((name) => `${dir}/${name}`),
  );

  return { cases: expected.cases, onDisk };
}

/**
 * Read one fixture document.
 *
 * @param contract - The contract's directory.
 * @param name - The document's path under `fixtures/`.
 * @returns Its parsed body.
 */
export function readFixture(contract: string, name: string): unknown {
  return JSON.parse(readFileSync(join(contract, "fixtures", name), "utf8"));
}
