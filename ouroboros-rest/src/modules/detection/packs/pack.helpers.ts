/**
 * Small, pure readers the core rule packs share
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)): path arithmetic over a probed tree,
 * and a tolerant JSON-with-comments parse for the two files (`devcontainer.json`, `package.json`)
 * the packs read as JSON.
 *
 * Nothing here parses YAML or TOML: the served application carries no parser for either (the
 * `yaml` package is a devDependency — `scripts/openapi.mjs`), and a probe needs one line of each
 * file, which a line-anchored expression reads honestly.
 */

import type { RepoTreeEntry } from "../../ticket-sources/ticket-source.probe";

/**
 * Directories whose contents are somebody else's code — never a suite, a manifest or a
 * protected path of this repository.
 */
export const VENDORED = /(^|\/)(node_modules|vendor|third_party|external|\.git)(\/|$)/;

/**
 * The last segment of a path.
 *
 * @param path - `a/b/c.txt`.
 * @returns `c.txt`.
 */
export function basename(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Everything before the last segment.
 *
 * @param path - `a/b/c.txt`.
 * @returns `a/b`, or `""` for a root-level path.
 */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * How many segments deep a path is — `boot` is 1, `src/boot` is 2.
 *
 * @param path - The path.
 * @returns The segment count.
 */
export function depth(path: string): number {
  return path.split("/").length;
}

/**
 * The file paths of a tree, vendored code excluded, sorted.
 *
 * @param entries - The tree's entries.
 * @returns The paths.
 */
export function ownFiles(entries: readonly RepoTreeEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "file" && !VENDORED.test(entry.path))
    .map((entry) => entry.path)
    .sort();
}

/**
 * The directory paths of a tree, vendored code excluded, sorted.
 *
 * @param entries - The tree's entries.
 * @returns The paths.
 */
export function ownDirs(entries: readonly RepoTreeEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "dir" && !VENDORED.test(entry.path))
    .map((entry) => entry.path)
    .sort();
}

/**
 * Parse JSON that may carry `//` and `/* *\/` comments and trailing commas — the dialect
 * `devcontainer.json` is written in.
 *
 * Comments are removed by a scan that respects string literals (so `"https://…"` survives), then
 * trailing commas before `}` or `]` are dropped, then `JSON.parse` decides.
 *
 * @param text - The file.
 * @returns The value, or `undefined` when it does not parse.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      out += char;

      if (char === "\\") {
        out += next ?? "";
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index);

      index = end === -1 ? text.length : end - 1;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);

      index = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }

  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A JSON object's own record, or an empty one.
 *
 * @param value - Anything.
 * @returns The value as a record when it is a plain object; `{}` otherwise.
 */
export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Every dependency name `package.json` declares, runtime and development.
 *
 * @param text - `package.json`'s contents, or undefined.
 * @returns The names; empty when the file is absent or does not parse.
 */
export function packageDependencies(text: string | undefined): Set<string> {
  const manifest = recordOf(text === undefined ? undefined : parseJsonc(text));

  return new Set([
    ...Object.keys(recordOf(manifest.dependencies)),
    ...Object.keys(recordOf(manifest.devDependencies)),
  ]);
}

/**
 * Cut a card line to V067's 512-character bound.
 *
 * @param value - The line.
 * @returns It, with an ellipsis when it was cut.
 */
export function clampValue(value: string): string {
  const trimmed = value.trim();

  return trimmed.length <= 512 ? trimmed : `${trimmed.slice(0, 511)}…`;
}

/**
 * A count and its noun — `1 suite`, `5 suites`.
 *
 * @param count - The number the noun agrees with.
 * @param noun - The singular.
 * @param shown - What to print for the number, when not the number itself (`≥ 63`).
 * @returns The phrase.
 */
export function plural(count: number, noun: string, shown: string = String(count)): string {
  return `${shown} ${noun}${count === 1 ? "" : "s"}`;
}
