/**
 * Formula-version enforcement (BJ.5, [#441](https://github.com/NobuData/ouroboros/issues/441)) —
 * the half of "extractors are versioned with their registry entries" no database can check.
 *
 * `rollup.registry.ts` refuses a fill whose extractor declares a version the registry does not
 * hold, and `rollup.registry.spec.ts` holds every declaration to the migrations. Neither notices
 * a **computation** that changed while its version stayed put — a reasonable improvement to a
 * formula that silently changes the meaning of every historical comparison, under a methodology
 * popover still describing the old one. This file closes that gap with a fingerprint:
 *
 *   * a family's **formula sources** are its extractor file, every module under
 *     `src/modules/insights/` it imports at runtime (transitively), and — for a module outside
 *     insights — only the top-level declarations it imports by name (the cost family reads
 *     `LOCAL_PROVIDER_KINDS`, not the rest of the providers module);
 *   * the **fingerprint** is a SHA-256 over those sources' tokens: comments are trivia and
 *     whitespace inside a literal collapses to one space, so documentation and formatting move
 *     nothing, while any change to what the code computes does;
 *   * `rollup.formula.lock.json` records each family's fingerprint beside the versions it
 *     implements, and `rollup.formula.spec.ts` fails when a fingerprint moved and no version
 *     rose with it.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/** `src/` — the root every source path in a fingerprint is written relative to. */
export const SOURCE_ROOT = resolve(__dirname, "../../..");

/** `src/modules/insights/` — modules here are formula sources whole and transitively. */
const INSIGHTS_ROOT = resolve(__dirname, "..");

/** The committed lock, beside this file. */
export const FORMULA_LOCK_PATH = join(__dirname, "rollup.formula.lock.json");

/** One family's lock entry: the versions it implements and the fingerprint they were set at. */
export interface FormulaLockEntry {
  /** Metric id → the `metric_definitions.version` the extractor implemented when locked. */
  readonly metrics: Readonly<Record<string, number>>;
  /** `sha256:<hex>` over the family's formula sources. */
  readonly fingerprint: string;
}

/** The lock file: family → entry. */
export type FormulaLock = Readonly<Record<string, FormulaLockEntry>>;

/** A family as it stands in the working tree. */
export interface FormulaState {
  readonly family: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly fingerprint: string;
}

/** A formula source: the whole module, or only the named top-level declarations of it. */
interface SourcePart {
  readonly path: string;
  readonly names: ReadonlySet<string> | "all";
}

/**
 * The extractor file for a family — `extractors/<family>.extractor.ts`, the one naming
 * convention every extractor follows.
 *
 * @param family - The metric family.
 * @returns The absolute path.
 */
export function extractorPath(family: string): string {
  return join(__dirname, "extractors", `${family}.extractor.ts`);
}

/**
 * Resolve a relative import to a `.ts` file.
 *
 * @param from - The importing file.
 * @param specifier - The module specifier, `./x` or `../y`.
 * @returns The absolute path, or `undefined` when no `.ts` module answers it.
 */
function resolveImport(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);

  return [`${base}.ts`, join(base, "index.ts")].find((candidate) => existsSync(candidate));
}

/**
 * The names a runtime import binds — `import type` and `type`-only specifiers bind nothing that
 * computes, so they are left out.
 *
 * @param clause - The import clause.
 * @returns The imported (exported-side) names; `"all"` for a namespace or default import.
 */
function runtimeNames(clause: ts.ImportClause | undefined): Set<string> | "all" {
  if (clause === undefined) {
    return "all"; // `import "./x"` runs the module for its effects.
  }

  if (clause.isTypeOnly) {
    return new Set();
  }

  if (clause.name !== undefined) {
    return "all";
  }

  const bindings = clause.namedBindings;

  if (bindings === undefined || ts.isNamespaceImport(bindings)) {
    return "all";
  }

  return new Set(
    bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => (element.propertyName ?? element.name).text),
  );
}

/**
 * Parse a source file.
 *
 * @param path - Its absolute path.
 * @param text - Its text; read from disk when omitted.
 * @returns The syntax tree.
 */
function parse(path: string, text?: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    text ?? readFileSync(path, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
}

/**
 * Every formula source of an extractor: the extractor, insights modules whole and transitively,
 * and the imported declarations of anything outside insights.
 *
 * @param entry - The extractor's absolute path.
 * @returns The parts, extractor first; a module imported twice is merged.
 */
export function formulaSources(entry: string): SourcePart[] {
  const parts = new Map<string, Set<string> | "all">([[entry, "all"]]);
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const statement of parse(current).statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      const target = specifier.startsWith(".") ? resolveImport(current, specifier) : undefined;
      const names = runtimeNames(statement.importClause);

      if (target === undefined || (names !== "all" && names.size === 0)) {
        continue; // A package (kysely, pg) or a type-only import: neither computes a formula.
      }

      if (target.startsWith(INSIGHTS_ROOT + sep)) {
        if (parts.get(target) !== "all") {
          parts.set(target, "all");
          queue.push(target);
        }
        continue;
      }

      const known = parts.get(target);

      if (known === "all" || names === "all") {
        parts.set(target, "all");
      } else {
        parts.set(target, new Set([...(known ?? []), ...names]));
      }
    }
  }

  return [...parts].map(([path, names]) => ({ path, names }));
}

/**
 * The name a top-level statement declares, when it declares one.
 *
 * @param statement - A top-level statement.
 * @returns The declared names.
 */
function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }

  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [statement.name.text];
  }

  return [];
}

/**
 * A node's tokens, comments and JSDoc left out, whitespace inside a token collapsed.
 *
 * @param node - The node.
 * @param file - Its source file.
 * @param out - Where the tokens are appended.
 */
function collectTokens(node: ts.Node, file: ts.SourceFile, out: string[]): void {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
    return;
  }

  const children = node.getChildren(file);

  if (children.length === 0) {
    out.push(node.getText(file).replace(/\s+/g, " "));
    return;
  }

  for (const child of children) {
    collectTokens(child, file, out);
  }
}

/**
 * Fingerprint a family's formula sources.
 *
 * @param parts - The sources, from {@link formulaSources}.
 * @param overrides - Absolute path → text to read instead of the file on disk; how a spec proves
 *   that an edited formula moves the fingerprint without touching the working tree.
 * @returns `sha256:<hex>`.
 */
export function formulaFingerprint(
  parts: readonly SourcePart[],
  overrides: ReadonlyMap<string, string> = new Map(),
): string {
  const hash = createHash("sha256");

  for (const part of [...parts].sort((a, b) => a.path.localeCompare(b.path))) {
    const file = parse(part.path, overrides.get(part.path));
    const tokens: string[] = [];
    const statements =
      part.names === "all"
        ? file.statements
        : file.statements.filter((statement) =>
            declaredNames(statement).some((name) => (part.names as Set<string>).has(name)),
          );

    for (const statement of statements) {
      collectTokens(statement, file, tokens);
    }

    // A collapsed token holds no newline, so one separates tokens unambiguously.
    hash.update(
      `${relative(SOURCE_ROOT, part.path).split(sep).join("/")}\n${tokens.join("\n")}\n\n`,
    );
  }

  return `sha256:${hash.digest("hex")}`;
}

/**
 * Read the committed lock.
 *
 * @returns The lock.
 */
export function readFormulaLock(): FormulaLock {
  return JSON.parse(readFileSync(FORMULA_LOCK_PATH, "utf8")) as FormulaLock;
}

/**
 * Why a family's formula disagrees with its lock entry.
 *
 * The rule: **a fingerprint that moved needs a version that rose**. When it did, the lock is
 * merely out of date and says what to record; when it did not, the formula changed without a
 * version bump — the failure this check exists for. A metric new to the family counts as a
 * rise: a metric that never had a number cannot have its meaning changed.
 *
 * @param state - The family as it stands.
 * @param locked - Its lock entry, if it has one.
 * @returns One sentence per problem; empty when the two agree.
 */
export function formulaDrift(state: FormulaState, locked: FormulaLockEntry | undefined): string[] {
  const record = JSON.stringify({ metrics: state.metrics, fingerprint: state.fingerprint });

  if (locked === undefined) {
    return [`${state.family} has no entry in rollup.formula.lock.json — record ${record}`];
  }

  const sameVersions =
    JSON.stringify(Object.entries(locked.metrics).sort()) ===
    JSON.stringify(Object.entries(state.metrics).sort());

  if (locked.fingerprint === state.fingerprint && sameVersions) {
    return [];
  }

  const rose = Object.entries(state.metrics).some(
    ([metricId, version]) => version > (locked.metrics[metricId] ?? 0),
  );

  if (locked.fingerprint !== state.fingerprint && !rose) {
    return [
      `the ${state.family} formula changed without a version bump — raise ` +
        `metric_definitions.version for each metric whose computation changed (a migration, ` +
        `and the extractor's \`metrics\`), then record ${record} in rollup.formula.lock.json`,
    ];
  }

  return [
    `the ${state.family} entry in rollup.formula.lock.json is out of date — record ${record}`,
  ];
}
