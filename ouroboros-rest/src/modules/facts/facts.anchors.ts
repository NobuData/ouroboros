/**
 * Whether a change touches a fact's anchor — the staleness sweep's question (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411); decision **K4**).
 *
 * A change is what the source sync knows about a merged PR: its changed paths and the bounded
 * diff sample `diffExcerptOf` wrote (`--- <path>` then that file's patch). An anchor *matching*
 * means **something changed near this fact**, never *this fact is now false* — a match only flags
 * the fact `stale` for a person to decide, so every rule here leans towards firing when it cannot
 * tell.
 *
 * | kind               | fires when                                                          |
 * |--------------------|---------------------------------------------------------------------|
 * | `path_glob`        | a changed path matches the glob (`path_glob_matches`' grammar)      |
 * | `dependency`       | a changed dependency manifest's patch adds or removes a line naming |
 * |                    | the dependency — or the manifest changed and its patch is not in    |
 * |                    | the sample (no excerpt, a binary, or cut at the size limit)         |
 * | `platform_version` | a changed platform marker's patch removes the anchored version      |
 * |                    | (`zephyr-4.0` → a deleted line carrying `4.0`, `v4.0.2`, …) without |
 * |                    | adding it back, and the patch or path names the platform — or the   |
 * |                    | marker changed and its patch is not in the sample                   |
 *
 * The manifest and marker lists are by file name, anywhere in the tree. A fact with **no**
 * anchors is never matched by anything here: the sweep reports it as uncovered rather than
 * implying coverage it does not have.
 */

import type { FactAnchorKind } from "../db/schema";
import { parseExcerpt, type ExcerptFile } from "../pull-requests/gates/gate.license";

/** File names that declare dependencies — where a `dependency` anchor looks. */
export const DEPENDENCY_MANIFESTS: readonly RegExp[] = [
  /^west\.ya?ml$/,
  /^package\.json$/,
  /^go\.mod$/,
  /^Cargo\.toml$/,
  /^requirements[\w.-]*\.txt$/,
  /^pyproject\.toml$/,
  /^Pipfile$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^conanfile\.(txt|py)$/,
  /^vcpkg\.json$/,
];

/** File names that pin a platform or toolchain version — where a `platform_version` anchor looks. */
export const PLATFORM_MARKERS: readonly RegExp[] = [
  /^west\.ya?ml$/,
  /^VERSION$/,
  /^\.nvmrc$/,
  /^\.node-version$/,
  /^\.python-version$/,
  /^\.ruby-version$/,
  /^\.tool-versions$/,
  /^rust-toolchain(\.toml)?$/,
  /^go\.mod$/,
  /^global\.json$/,
];

/** An anchor as the matcher needs it. */
export interface AnchorLike {
  readonly kind: FactAnchorKind;
  readonly value: string;
}

/** One observed change: a merged PR's paths and diff sample. */
export interface ObservedChange {
  /** Repository-relative changed paths. */
  readonly paths: readonly string[];
  /** `pr_revisions.diff_excerpt`, or null when the host gave no patch text. */
  readonly diffExcerpt: string | null;
}

/** Why an anchor fired. */
export interface AnchorMatch {
  /** The changed path that fired it. */
  readonly path: string;
  /** What was seen, in a few words — `removed "revision: v4.0.0"`. */
  readonly evidence: string;
}

/** A parsed `platform_version` value — `zephyr-4.0` is `{platform: "zephyr", version: "4.0"}`. */
export interface PlatformVersion {
  readonly platform: string;
  /** The version, or null when the value carries none (then any change to a marker naming it fires). */
  readonly version: string | null;
}

/** A control character, which `fact_anchors_value_present` refuses. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Why an anchor value would be refused by V071 — `fact_anchors_value_present` and
 * `fact_anchors_path_glob_shape` — or null when it would be stored.
 *
 * The caller trims first: surrounding whitespace is normalised away rather than refused.
 *
 * @param kind - The anchor's kind.
 * @param value - The value, trimmed.
 * @returns The stated problem, or null.
 */
export function anchorValueProblem(kind: FactAnchorKind, value: string): string | null {
  if (value === "") {
    return "An anchor needs a value.";
  }
  if (value.length > 512) {
    return "An anchor value is at most 512 characters.";
  }
  if (CONTROL_CHARACTER.test(value)) {
    return "An anchor value may not contain control characters.";
  }
  if (kind === "path_glob") {
    if (value.startsWith("/") || value.includes("\\")) {
      return "A path glob is repository-relative and forward-slashed.";
    }
    if (/(^|\/)\.\.(\/|$)/.test(value)) {
      return "A path glob may not leave the repository with a .. segment.";
    }
  }
  return null;
}

/** Characters a glob escapes to be literal inside a regular expression. */
const REGEX_SPECIAL = /[.^$+(){}[\]|\\]/;

/**
 * Translate a path glob to an anchored regular expression — `path_glob_matches` (V071), in
 * TypeScript: `**∕` any number of whole directories (including none), `**` anything, `*` anything
 * within one segment, `?` one character within one segment, every other character literal.
 *
 * @param glob - The anchor's value.
 * @returns The expression.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  let i = 0;

  while (i < glob.length) {
    const c = glob[i];

    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        pattern += "(.*/)?";
        i += 3;
      } else {
        pattern += ".*";
        i += 2;
      }
      continue;
    }

    if (c === "*") {
      pattern += "[^/]*";
    } else if (c === "?") {
      pattern += "[^/]";
    } else if (REGEX_SPECIAL.test(c)) {
      pattern += `\\${c}`;
    } else {
      pattern += c;
    }
    i += 1;
  }

  return new RegExp(`^${pattern}$`, "s");
}

/**
 * Whether a repository-relative path matches a glob — the same answer V071's SQL function gives.
 *
 * @param glob - The glob.
 * @param path - The path.
 * @returns `true` on a match.
 */
export function pathGlobMatches(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/**
 * Split a `platform_version` value into its platform and version.
 *
 * @param value - `zephyr-4.0`, `node@20`, `python 3.12`, or a bare `zephyr`.
 * @returns The parts; the version is null when there is no trailing version.
 */
export function parsePlatformVersion(value: string): PlatformVersion {
  const match = /^(.+?)[-@ _]v?(\d+(?:\.\d+)*)$/.exec(value);

  return match === null
    ? { platform: value, version: null }
    : { platform: match[1], version: match[2] };
}

/**
 * The last segment of a path.
 *
 * @param path - Repository-relative.
 * @returns The file name.
 */
function baseName(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Whether a file name is one of a list's.
 *
 * @param path - The changed path.
 * @param names - The list.
 * @returns `true` when its file name matches.
 */
function isOneOf(path: string, names: readonly RegExp[]): boolean {
  const name = baseName(path);

  return names.some((pattern) => pattern.test(name));
}

/**
 * Escape a literal for a regular expression.
 *
 * @param text - The literal.
 * @returns It, escaped.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * A regular expression that finds a name as a whole token — `west` in `- name: west` but not in
 * `westmere`; `@scope/pkg` and `foo-bar` whole.
 *
 * @param name - The dependency or platform name.
 * @returns The expression, case-insensitive.
 */
function tokenPattern(name: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_.@/-])${escapeRegExp(name)}($|[^A-Za-z0-9_-])`, "i");
}

/**
 * A regular expression that finds a version as a whole version — `4.0` in `v4.0.0` and
 * `revision: 4.0`, never in `14.0` or `4.01`.
 *
 * @param version - `4.0`.
 * @returns The expression.
 */
function versionPattern(version: string): RegExp {
  return new RegExp(`(^|[^0-9.])v?${escapeRegExp(version)}(\\.\\d+)*($|[^0-9])`);
}

/**
 * Whether an anchor fires on a change, and why.
 *
 * @param anchor - The anchor.
 * @param change - The merged PR's paths and diff sample.
 * @returns The first match in path order, or null.
 */
export function matchAnchor(anchor: AnchorLike, change: ObservedChange): AnchorMatch | null {
  switch (anchor.kind) {
    case "path_glob":
      return matchPathGlob(anchor.value, change.paths);
    case "dependency":
      return matchDependency(anchor.value, change);
    case "platform_version":
      return matchPlatformVersion(anchor.value, change);
  }
}

/**
 * @param glob - The anchor's glob.
 * @param paths - The changed paths.
 * @returns The first changed path matching the glob, or null.
 */
function matchPathGlob(glob: string, paths: readonly string[]): AnchorMatch | null {
  const pattern = globToRegExp(glob);
  const path = paths.find((candidate) => pattern.test(candidate));

  return path === undefined ? null : { path, evidence: `changed ${path}` };
}

/**
 * The patch of each changed file the sample holds, by path.
 *
 * @param change - The change.
 * @returns The parsed files; empty when there is no sample.
 */
function patchesOf(change: ObservedChange): Map<string, ExcerptFile> {
  if (change.diffExcerpt === null) {
    return new Map();
  }

  return new Map(
    parseExcerpt(change.diffExcerpt, change.paths).map((file) => [file.path, file] as const),
  );
}

/**
 * @param name - The dependency.
 * @param change - The change.
 * @returns The first manifest whose patch names the dependency on a changed line, or whose patch
 *   the sample does not hold; null otherwise.
 */
function matchDependency(name: string, change: ObservedChange): AnchorMatch | null {
  const manifests = change.paths.filter((path) => isOneOf(path, DEPENDENCY_MANIFESTS));

  if (manifests.length === 0) {
    return null;
  }

  const patches = patchesOf(change);
  const token = tokenPattern(name);

  for (const path of manifests) {
    const patch = patches.get(path);

    if (patch === undefined) {
      return { path, evidence: `changed ${path} (no patch text to read)` };
    }

    const line = patch.lines.find((row) => row.kind !== "ctx" && token.test(row.text));

    if (line !== undefined) {
      const sign = line.kind === "add" ? "added" : "removed";

      return { path, evidence: `${sign} "${line.text.trim()}" in ${path}` };
    }
  }

  return null;
}

/**
 * @param value - The anchor's `platform-version` value.
 * @param change - The change.
 * @returns The first marker whose patch drops the version for that platform, or whose patch the
 *   sample does not hold; null otherwise.
 */
function matchPlatformVersion(value: string, change: ObservedChange): AnchorMatch | null {
  const markers = change.paths.filter((path) => isOneOf(path, PLATFORM_MARKERS));

  if (markers.length === 0) {
    return null;
  }

  const { platform, version } = parsePlatformVersion(value);
  const patches = patchesOf(change);
  const platformToken = tokenPattern(platform);

  for (const path of markers) {
    const patch = patches.get(path);

    if (patch === undefined) {
      return { path, evidence: `changed ${path} (no patch text to read)` };
    }

    const namesPlatform =
      platformToken.test(path) || patch.lines.some((row) => platformToken.test(row.text));

    if (!namesPlatform) {
      continue;
    }

    if (version === null) {
      const line = patch.lines.find((row) => row.kind !== "ctx");

      if (line !== undefined) {
        return { path, evidence: `changed ${path}, which names ${platform}` };
      }
      continue;
    }

    const pinned = versionPattern(version);
    const removed = patch.lines.find((row) => row.kind === "del" && pinned.test(row.text));
    const readded = patch.lines.some((row) => row.kind === "add" && pinned.test(row.text));

    if (removed !== undefined && !readded) {
      return { path, evidence: `removed "${removed.text.trim()}" in ${path}` };
    }
  }

  return null;
}
