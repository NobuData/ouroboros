/**
 * The license layer — decision **V7**, option **3-A**: a lightweight, diff-scoped check that
 * catches the common regressions in milliseconds, and says exactly what it checked.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)). Pure: it reads a revision's diff
 * sample (`pr_revisions.diff_excerpt`) and the workspace's allow-list, and nothing else.
 *
 * ```
 * headers         every added `SPDX-License-Identifier:` expression → known ids, on the allow-list
 *                 a new source file (`@@ -0,0 +1,N @@`) with no identifier in its first lines → missing
 * manifest delta  added `"license"` entries in package-lock.json and composer.lock → the dependency's license
 *                 an added `"license"` in a package.json → the package's own license
 * ```
 *
 * **What it does not do**, and the gate's evidence line says so (`clean (headers + manifest
 * delta)`): full-text license detection, transitive dependency audits, and resolving a dependency
 * whose manifest does not inline its license (a `Cargo.toml` or `go.mod` line names no license).
 * Those are the deep scanning tier, AZ.4 ([#374](https://github.com/NobuData/ouroboros/issues/374)).
 * It also sees only what the host's diff sample holds — a file past the sample's 16 KiB bound is
 * not read.
 *
 * **An SPDX expression is evaluated, not string-matched**: `MIT OR GPL-3.0-only` is acceptable when
 * either side is allowed, `MIT AND GPL-3.0-only` only when both are, and `WITH` attaches an
 * exception to the license before it (the license decides).
 */

import { canonicalException, canonicalLicense } from "./gate.spdx";
import type { LicensePolicy } from "./gate.policy";

/** One added line of a changed file. */
export interface AddedLine {
  /** The new-file line number, from 1. */
  readonly line: number;
  /** The text, without its `+`. */
  readonly text: string;
}

/** One file's hunks, as the diff sample holds them. */
export interface ExcerptFile {
  /** The repository-relative path. */
  readonly path: string;
  /** Whether a hunk shows it created — `@@ -0,0 +1,N @@`. */
  readonly created: boolean;
  /** Its added lines, in order. */
  readonly added: readonly AddedLine[];
  /** Every line of its hunks, context and additions, in order — what a lockfile's keys are read from. */
  readonly lines: readonly { readonly kind: "ctx" | "add" | "del"; readonly text: string }[];
}

/** What kind of problem a finding is. */
export type LicenseFindingKind =
  "missing_header" | "unknown_id" | "disallowed_header" | "disallowed_dependency";

/** One problem the layer found. */
export interface LicenseFinding {
  readonly kind: LicenseFindingKind;
  /** The file it is in. */
  readonly path: string;
  /** The license expression or id concerned, when there is one. */
  readonly license?: string;
  /** The dependency, for a manifest finding. */
  readonly dependency?: string;
}

/** What the layer decided. */
export interface LicenseScan {
  /** Whether there was a diff sample to read — without one nothing was checked. */
  readonly checked: boolean;
  /** Every finding, ordered by path and then by position. */
  readonly findings: readonly LicenseFinding[];
}

/** The first lines of a new file its header must be in. */
export const HEADER_WINDOW = 10;

/** Extensions of files that carry a license header. Data, config and docs do not. */
const SOURCE_EXTENSIONS = new Set([
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "s",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "rb",
  "sh",
  "cs",
  "m",
  "mm",
  "zig",
]);

/** `SPDX-License-Identifier: <expression>`, up to a comment closer or the line's end. */
const SPDX_HEADER = /SPDX-License-Identifier:\s*(.+?)\s*(?:\*\/|-->|$)/;

/** A hunk header — `@@ -12,4 +12,6 @@`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Split a revision's diff sample into its files.
 *
 * The sample is `diffExcerptOf`'s shape — `--- <path>` then that file's patch, per file. A boundary
 * is only a `--- ` line naming one of the revision's own paths, so a deleted line that happens to
 * start with `-- ` (an SQL comment) is not mistaken for one.
 *
 * @param excerpt - `pr_revisions.diff_excerpt`.
 * @param paths - The revision's changed paths.
 * @returns The files, in sample order. Text before the first boundary is ignored.
 */
export function parseExcerpt(excerpt: string, paths: readonly string[]): ExcerptFile[] {
  const known = new Set(paths);
  const files: {
    path: string;
    created: boolean;
    added: AddedLine[];
    lines: ExcerptFile["lines"][number][];
  }[] = [];
  let current: (typeof files)[number] | undefined;
  let newLine = 0;

  for (const raw of excerpt.split("\n")) {
    if (raw.startsWith("--- ") && known.has(raw.slice(4))) {
      current = { path: raw.slice(4), created: false, added: [], lines: [] };
      files.push(current);
      continue;
    }

    if (current === undefined) {
      continue;
    }

    const hunk = HUNK_HEADER.exec(raw);

    if (hunk !== null) {
      newLine = Number(hunk[3]);
      if (hunk[1] === "0" && hunk[2] === "0") {
        current.created = true;
      }
      continue;
    }

    if (raw.startsWith("+")) {
      current.added.push({ line: newLine, text: raw.slice(1) });
      current.lines.push({ kind: "add", text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", text: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "ctx", text: raw.slice(1) });
      newLine += 1;
    }
  }

  return files;
}

/** A parsed SPDX expression. */
type Expression =
  | { readonly op: "id"; readonly id: string }
  | { readonly op: "and"; readonly left: Expression; readonly right: Expression }
  | { readonly op: "or"; readonly left: Expression; readonly right: Expression };

/**
 * Parse an SPDX license expression — `MIT`, `(MIT OR Apache-2.0)`, `GPL-2.0-only WITH
 * Classpath-exception-2.0`. `AND` binds tighter than `OR`, as the specification says.
 *
 * @param text - The expression.
 * @returns The tree, or undefined when it does not parse.
 */
export function parseExpression(text: string): Expression | undefined {
  const tokens = text
    .replace(/[()]/g, " $& ")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
  let at = 0;

  const primary = (): Expression | undefined => {
    const token = tokens[at];

    if (token === "(") {
      at += 1;
      const inner = or();

      if (tokens[at] !== ")") {
        return undefined;
      }
      at += 1;
      return inner;
    }

    if (token === undefined || token === ")" || /^(and|or|with)$/i.test(token)) {
      return undefined;
    }

    at += 1;

    // An exception rides on the license before it; the license decides the verdict, so it is kept
    // only to be checked as a real exception.
    if (tokens[at]?.toUpperCase() === "WITH") {
      const exception = tokens[at + 1];

      if (exception === undefined || canonicalException(exception) === undefined) {
        return { op: "id", id: `${token} WITH ${exception ?? ""}`.trim() };
      }
      at += 2;
    }

    return { op: "id", id: token };
  };

  const and = (): Expression | undefined => {
    let left = primary();

    while (left !== undefined && tokens[at]?.toUpperCase() === "AND") {
      at += 1;
      const right = primary();
      left = right === undefined ? undefined : { op: "and", left, right };
    }
    return left;
  };

  const or = (): Expression | undefined => {
    let left = and();

    while (left !== undefined && tokens[at]?.toUpperCase() === "OR") {
      at += 1;
      const right = and();
      left = right === undefined ? undefined : { op: "or", left, right };
    }
    return left;
  };

  const tree = or();

  return tree !== undefined && at === tokens.length ? tree : undefined;
}

/** Every id an expression names. */
function idsOf(expression: Expression): string[] {
  return expression.op === "id"
    ? [expression.id]
    : [...idsOf(expression.left), ...idsOf(expression.right)];
}

/**
 * Whether a workspace accepts an expression.
 *
 * @param expression - The parsed expression.
 * @param policy - The allow- and deny-lists.
 * @returns `true` when the expression can be satisfied by allowed, non-denied licenses.
 */
function accepts(expression: Expression, policy: LicensePolicy): boolean {
  if (expression.op === "and") {
    return accepts(expression.left, policy) && accepts(expression.right, policy);
  }

  if (expression.op === "or") {
    return accepts(expression.left, policy) || accepts(expression.right, policy);
  }

  const id = canonicalLicense(expression.id)?.toLowerCase();
  const listed = (list: readonly string[]): boolean =>
    id !== undefined && list.some((entry) => entry.toLowerCase() === id);

  return listed(policy.allow) && !listed(policy.deny);
}

/** Judge one expression: unknown ids first, then acceptance. */
function judge(
  text: string,
  policy: LicensePolicy,
): { kind: "unknown_id"; license: string } | { kind: "disallowed"; license: string } | undefined {
  const expression = parseExpression(text);

  if (expression === undefined) {
    return { kind: "unknown_id", license: text };
  }

  const unknown = idsOf(expression).find((id) => canonicalLicense(id) === undefined);

  if (unknown !== undefined) {
    return { kind: "unknown_id", license: unknown };
  }

  return accepts(expression, policy) ? undefined : { kind: "disallowed", license: text };
}

/**
 * The header findings of one file.
 *
 * @param file - The file.
 * @param policy - The allow-list.
 * @returns Its findings, in line order.
 */
function headerFindings(file: ExcerptFile, policy: LicensePolicy): LicenseFinding[] {
  const findings: LicenseFinding[] = [];
  let headed = false;

  for (const { line, text } of file.added) {
    const header = SPDX_HEADER.exec(text);

    if (header === null) {
      continue;
    }

    if (line <= HEADER_WINDOW) {
      headed = true;
    }

    const verdict = judge(header[1], policy);

    if (verdict !== undefined) {
      findings.push({
        kind: verdict.kind === "unknown_id" ? "unknown_id" : "disallowed_header",
        path: file.path,
        license: verdict.license,
      });
    }
  }

  const extension = file.path.slice(file.path.lastIndexOf(".") + 1).toLowerCase();

  if (file.created && !headed && file.path.includes(".") && SOURCE_EXTENSIONS.has(extension)) {
    findings.unshift({ kind: "missing_header", path: file.path });
  }

  return findings;
}

/** A lockfile or manifest the delta check reads, and how. */
type ManifestKind = "npm_lock" | "composer_lock" | "package_json";

/**
 * @param path - A changed path.
 * @returns Which manifest it is, or undefined.
 */
function manifestKind(path: string): ManifestKind | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);

  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
    return "npm_lock";
  }

  if (name === "composer.lock") {
    return "composer_lock";
  }

  return name === "package.json" ? "package_json" : undefined;
}

/** `"node_modules/left-pad": {` — an npm lockfile's package key. */
const NPM_PACKAGE_KEY = /^\s*"(?:[^"]*\/)?node_modules\/((?:@[^/"]+\/)?[^/"]+)"\s*:\s*\{/;
/** `"name": "vendor/pkg"` — a composer lockfile's package name. */
const COMPOSER_NAME = /^\s*"name"\s*:\s*"([^"]+)"/;
/** `"license": "MIT"`. */
const LICENSE_STRING = /^\s*"license"\s*:\s*"([^"]+)"/;
/** `"license": [` or `"license": ["MIT"]`. */
const LICENSE_ARRAY = /^\s*"license"\s*:\s*\[(.*)$/;
/** A quoted string on its own. */
const QUOTED = /"([^"]+)"/g;

/**
 * The dependency licenses a manifest's added lines introduce.
 *
 * @param file - The manifest.
 * @param kind - Which manifest.
 * @returns `{dependency, license}` per added license entry, in order. A composer array of several
 *   licenses is one entry joined with `OR`, which is what composer means by listing more than one.
 */
function manifestLicenses(
  file: ExcerptFile,
  kind: ManifestKind,
): { dependency: string; license: string }[] {
  const found: { dependency: string; license: string }[] = [];
  let owner = kind === "package_json" ? "the package" : "(unnamed)";
  let array: string[] | undefined;

  for (const { kind: lineKind, text } of file.lines) {
    if (lineKind === "del") {
      continue;
    }

    if (array !== undefined) {
      array.push(...[...text.matchAll(QUOTED)].map((match) => match[1]));
      if (text.includes("]")) {
        if (lineKind === "add" && array.length > 0) {
          found.push({ dependency: owner, license: array.join(" OR ") });
        }
        array = undefined;
      }
      continue;
    }

    const key =
      kind === "npm_lock"
        ? NPM_PACKAGE_KEY.exec(text)
        : kind === "composer_lock"
          ? COMPOSER_NAME.exec(text)
          : null;

    if (key !== null) {
      owner = key[1];
      continue;
    }

    if (lineKind !== "add") {
      continue;
    }

    const single = LICENSE_STRING.exec(text);

    if (single !== null) {
      found.push({ dependency: owner, license: single[1] });
      continue;
    }

    const opened = LICENSE_ARRAY.exec(text);

    if (opened !== null) {
      const inline = [...opened[1].matchAll(QUOTED)].map((match) => match[1]);

      if (opened[1].includes("]")) {
        if (inline.length > 0) {
          found.push({ dependency: owner, license: inline.join(" OR ") });
        }
      } else {
        array = inline;
      }
    }
  }

  return found;
}

/**
 * Run the license layer over a revision's diff sample.
 *
 * @param excerpt - `pr_revisions.diff_excerpt`, or null when the host gave no patch text.
 * @param paths - The revision's changed paths.
 * @param policy - The workspace's allow-list.
 * @returns Whether anything was checked, and the findings in path order.
 */
export function scanLicenses(
  excerpt: string | null,
  paths: readonly string[],
  policy: LicensePolicy,
): LicenseScan {
  if (excerpt === null || excerpt.trim() === "") {
    return { checked: false, findings: [] };
  }

  const findings: LicenseFinding[] = [];
  const files = parseExcerpt(excerpt, paths).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  for (const file of files) {
    findings.push(...headerFindings(file, policy));

    const kind = manifestKind(file.path);

    if (kind === undefined) {
      continue;
    }

    for (const { dependency, license } of manifestLicenses(file, kind)) {
      const verdict = judge(license, policy);

      if (verdict !== undefined) {
        findings.push({
          kind: verdict.kind === "unknown_id" ? "unknown_id" : "disallowed_dependency",
          path: file.path,
          license: verdict.license,
          dependency,
        });
      }
    }
  }

  return { checked: true, findings };
}

/**
 * A finding as the gate's evidence line reads it.
 *
 * @param finding - The finding.
 * @returns `missing SPDX header in src/new.c`, `GPL-3.0-only via left-pad (package-lock.json)`.
 */
export function describeFinding(finding: LicenseFinding): string {
  switch (finding.kind) {
    case "missing_header":
      return `missing SPDX header in ${finding.path}`;
    case "unknown_id":
      return finding.dependency === undefined
        ? `unknown SPDX id ${finding.license ?? ""} in ${finding.path}`
        : `unknown SPDX id ${finding.license ?? ""} via ${finding.dependency} (${finding.path})`;
    case "disallowed_header":
      return `${finding.license ?? ""} header in ${finding.path} is not on the allow-list`;
    case "disallowed_dependency":
      return `${finding.license ?? ""} via ${finding.dependency ?? ""} (${finding.path})`;
  }
}
