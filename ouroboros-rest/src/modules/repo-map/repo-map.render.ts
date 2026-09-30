/**
 * The repo-map document — a repository's module and ownership map, rendered from real data
 * (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415), decision **K2**). Pure.
 *
 * ```
 * tree (one listing, bounded)  ─▶ modules: top-level directories and their children, file counts
 * CODEOWNERS (GitHub's rules)  ─▶ owners per module — the last matching rule wins
 * detection rows (BB.1, #384)  ─▶ what the scan concluded — build, tests, language…
 *                              ─▶ structured markdown, byte-identical for identical inputs
 * ```
 *
 * **Deterministic, because diff-awareness depends on it.** The generator publishes a version only
 * when this document differs from the one in force. So the document carries **no timestamp** (the
 * version's `published_at` is the generation time), every list is sorted, and nothing reads the
 * clock — the same tree, CODEOWNERS and detections render the same bytes, run after run.
 *
 * **Bounded.** At most {@link MAX_TREE_ENTRIES} tree entries are read; modules go two directories
 * deep, at most {@link MAX_CHILD_MODULES} children per top-level directory and
 * {@link MAX_MODULES} rows in all; at most {@link MAX_CODEOWNERS_RULES} rules are parsed. A cut is
 * said in the document rather than hidden.
 */

import type { RepoTree } from "../ticket-sources/ticket-source.probe";

/** The most tree entries one render reads. */
export const MAX_TREE_ENTRIES = 20_000;

/** The most rows the modules table holds. */
export const MAX_MODULES = 200;

/** The most second-level modules listed under one top-level directory. */
export const MAX_CHILD_MODULES = 20;

/** The most CODEOWNERS rules one render parses. */
export const MAX_CODEOWNERS_RULES = 500;

/** Where GitHub looks for CODEOWNERS, in the order it looks — the first found is used. */
export const CODEOWNERS_PATHS: readonly string[] = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

/** The frontmatter every repo-map version carries (V069's typed keys). */
export const REPO_MAP_FRONTMATTER = Object.freeze({
  name: "repo-map",
  description: "Module & ownership map of the source tree",
  scope: "repo",
  load: "always",
});

/** One CODEOWNERS line. */
export interface CodeownersRule {
  readonly pattern: string;
  readonly owners: readonly string[];
  /** The pattern compiled to GitHub's (gitignore-style) matching. */
  readonly matcher: RegExp;
}

/** One row of the modules table. */
export interface RepoModule {
  /** `drivers/` or `drivers/can/`. */
  readonly path: string;
  /** Files at or beneath it, within the bounded listing. */
  readonly files: number;
  /** Its owners, from CODEOWNERS; empty when none match. */
  readonly owners: readonly string[];
}

/** A detection row, as the render reads it. */
export interface RepoMapDetection {
  readonly rowKey: string;
  readonly verdict: string;
  readonly value: string;
}

/** Everything one render reads. */
export interface RepoMapInput {
  /** `owner/name`. */
  readonly repo: string;
  readonly tree: RepoTree;
  /** Which CODEOWNERS file was used and its text; null when the repository has none. */
  readonly codeowners: { readonly path: string; readonly content: string } | null;
  /** The newest scan's rows; empty when the repository was never scanned. */
  readonly detections: readonly RepoMapDetection[];
}

/** One render. */
export interface RepoMapDocument {
  /** The markdown body. */
  readonly body: string;
  /** How many module rows it lists. */
  readonly modules: number;
  /** Whether any bound cut the listing — the host's, or this file's. */
  readonly truncated: boolean;
}

/**
 * The CODEOWNERS file to read, given the tree — the first of GitHub's locations present.
 *
 * @param tree - The listing.
 * @returns The path, or undefined when the tree holds none.
 */
export function codeownersPath(tree: RepoTree): string | undefined {
  const files = new Set(
    tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path),
  );

  return CODEOWNERS_PATHS.find((path) => files.has(path));
}

/**
 * Parse a CODEOWNERS file: one `pattern owner…` rule per line; `#` comments and blank lines
 * skipped; a pattern with no owners kept (it clears ownership, as GitHub reads it).
 *
 * @param text - The file.
 * @returns The rules, in file order — at most {@link MAX_CODEOWNERS_RULES}.
 */
export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();

    if (line === "") continue;

    const [pattern, ...owners] = line.split(/\s+/);

    rules.push({ pattern, owners, matcher: patternMatcher(pattern) });

    if (rules.length === MAX_CODEOWNERS_RULES) break;
  }

  return rules;
}

/**
 * A CODEOWNERS pattern as a regular expression over repository paths (gitignore semantics, as
 * GitHub documents them): a leading or inner `/` anchors to the root, a trailing `/` matches a
 * directory and everything in it, `*` stays within a segment, `**` crosses them, and a pattern
 * matching a directory matches everything beneath it — except `dir/*`, which GitHub documents as
 * the files directly in `dir/` only.
 *
 * @param pattern - The pattern.
 * @returns The matcher.
 */
export function patternMatcher(pattern: string): RegExp {
  let body = pattern;
  const anchored = body.startsWith("/") || body.slice(0, -1).includes("/");

  if (body.startsWith("/")) body = body.slice(1);
  if (body.endsWith("/")) body = `${body}**`;

  let source = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (char === "*" && body[index + 1] === "*") {
      const slash = body[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  // `docs/*` owns the files directly in docs/, not those in its subdirectories (GitHub's rule);
  // every other pattern that matches a directory matches everything beneath it.
  const descend = body.endsWith("/*") ? "" : "(?:/.*)?";

  return new RegExp(`${anchored ? "^" : "(?:^|.*/)"}${source}${descend}$`);
}

/**
 * Who owns a directory: the last rule matching it (or its contents, `dir/`) wins.
 *
 * @param directory - A directory path, no trailing slash.
 * @param rules - The parsed file.
 * @returns The owners, sorted; empty when no rule matches or the winning rule lists none.
 */
export function ownersOf(directory: string, rules: readonly CodeownersRule[]): string[] {
  let owners: readonly string[] = [];

  for (const rule of rules) {
    if (rule.matcher.test(directory) || rule.matcher.test(`${directory}/`)) {
      owners = rule.owners;
    }
  }

  return [...owners].sort();
}

/**
 * The modules of a tree: every top-level directory, and the directories directly inside it.
 * Hidden directories (`.github`, `.vscode`) are tooling, not modules, and are left out.
 *
 * @param tree - The listing, already bounded.
 * @param rules - CODEOWNERS.
 * @returns The rows, sorted by path, and whether a bound cut them.
 */
export function modulesOf(
  tree: RepoTree,
  rules: readonly CodeownersRule[],
): { modules: RepoModule[]; truncated: boolean } {
  const counts = new Map<string, number>();
  const children = new Map<string, Set<string>>();

  for (const entry of tree.entries.slice(0, MAX_TREE_ENTRIES)) {
    const segments = entry.path.split("/");
    const directories = entry.type === "dir" ? segments : segments.slice(0, -1);

    if (directories.length === 0 || directories.some((segment) => segment.startsWith("."))) {
      continue;
    }

    const top = directories[0];
    const child = directories.length > 1 ? `${top}/${directories[1]}` : undefined;

    if (!counts.has(top)) counts.set(top, 0);
    if (!children.has(top)) children.set(top, new Set());
    if (child !== undefined) {
      children.get(top)?.add(child);
      if (!counts.has(child)) counts.set(child, 0);
    }

    if (entry.type === "file") {
      counts.set(top, (counts.get(top) ?? 0) + 1);
      if (child !== undefined) counts.set(child, (counts.get(child) ?? 0) + 1);
    }
  }

  let truncated = tree.truncated || tree.entries.length > MAX_TREE_ENTRIES;
  const paths: string[] = [];

  for (const top of [...children.keys()].sort()) {
    paths.push(top);

    const nested = [...(children.get(top) ?? [])].sort();

    if (nested.length > MAX_CHILD_MODULES) truncated = true;
    paths.push(...nested.slice(0, MAX_CHILD_MODULES));
  }

  if (paths.length > MAX_MODULES) truncated = true;

  return {
    modules: paths.slice(0, MAX_MODULES).map((path) => ({
      path: `${path}/`,
      files: counts.get(path) ?? 0,
      owners: ownersOf(path, rules),
    })),
    truncated,
  };
}

/**
 * Render the map.
 *
 * @param input - The tree, CODEOWNERS and detections.
 * @returns The markdown, its module count and whether it was cut.
 */
export function renderRepoMap(input: RepoMapInput): RepoMapDocument {
  const rules = input.codeowners === null ? [] : parseCodeowners(input.codeowners.content);
  const { modules, truncated } = modulesOf(input.tree, rules);
  const detections = [...input.detections].sort((a, b) => a.rowKey.localeCompare(b.rowKey));
  const lines: string[] = [`# Repository map — ${input.repo}`, "", "## Modules", ""];

  if (modules.length === 0) {
    lines.push("_No directories on the default branch._");
  } else {
    lines.push("| Path | Files | Owners |", "|---|---:|---|");
    for (const module of modules) {
      const owners = module.owners.length === 0 ? "—" : module.owners.join(" ");
      lines.push(`| \`${cell(module.path)}\` | ${String(module.files)} | ${cell(owners)} |`);
    }
  }

  lines.push("", "## Ownership", "");
  lines.push(
    input.codeowners === null
      ? "_No CODEOWNERS file — modules list no owners._"
      : `From \`${input.codeowners.path}\` (${String(rules.length)} rules); the last matching rule wins.`,
  );

  lines.push("", "## Detected", "");

  if (detections.length === 0) {
    lines.push("_The repository has not been scanned._");
  } else {
    lines.push("| Signal | Verdict | Value |", "|---|---|---|");
    for (const row of detections) {
      lines.push(`| ${cell(row.rowKey)} | ${cell(row.verdict)} | ${cell(row.value)} |`);
    }
  }

  if (truncated) {
    lines.push(
      "",
      "_The tree was larger than one listing reads; this map covers the part that was listed._",
    );
  }

  return { body: `${lines.join("\n")}\n`, modules: modules.length, truncated };
}

/**
 * @param text - A table cell's text.
 * @returns It, with pipes escaped and newlines flattened, so a row stays one row.
 */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ");
}
