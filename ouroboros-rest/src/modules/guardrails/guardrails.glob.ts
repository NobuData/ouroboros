/**
 * The glob grammar the path guardrails match with — small on purpose, and written here rather
 * than taken from a library.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)) matches two things against a
 * change-set's paths: the allowed-path scope (`drivers/can/**`) and the CI-file registry
 * (`.github/workflows/**`). Both are patterns *this service* writes, so the grammar only has to
 * cover what those patterns use, and a grammar small enough to read in one screen is one whose
 * behaviour on an odd path can be predicted rather than looked up:
 *
 * ```
 * **   any number of whole segments, including none   drivers/**      ⊨ drivers/can/a.c
 * *    any run of characters within one segment         *.yml           ⊨ ci.yml
 * ?    exactly one character within one segment         ci-?.yml        ⊨ ci-1.yml
 * ```
 *
 * Everything else is literal — `.`, `+`, `(` and friends are escaped, so a dot in a pattern is
 * a dot and never "any character". Matching is **case-sensitive**, because the repositories
 * this runs against are, and `Jenkinsfile` and `jenkinsfile` are two different files to git.
 *
 * Paths reaching here have already been held to V047's grammar by the ingestion contract —
 * relative, forward slashes, no `..` segment — so there is no normalisation step to get wrong.
 */

/** Characters that mean something to a `RegExp` and nothing to a glob. */
const REGEXP_SPECIALS = /[.+^${}()|[\]\\]/g;

/**
 * Compile a glob into an anchored regular expression.
 *
 * @param glob - The pattern, in the grammar above.
 * @returns A `RegExp` matching whole paths only. A `**` segment consumes its trailing slash, so
 *   `drivers/**` matches `drivers/a.c` and `drivers/can/a.c` and `a/**\/b` matches `a/b`.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];

    if (char === "*" && glob[index + 1] === "*") {
      // `**/` is "any number of whole segments"; a trailing `**` is "everything below".
      if (glob[index + 2] === "/") {
        pattern += "(?:[^/]+/)*";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(REGEXP_SPECIALS, "\\$&");
    }
  }

  return new RegExp(`^${pattern}$`);
}

/**
 * A set of globs, compiled once.
 *
 * Compiled at construction because the same set is matched against every path of a change-set,
 * and the performance criterion (≤ 50 ms) is a statement about the whole report.
 */
export class GlobSet {
  /** The patterns and their compiled form, in the order given. */
  private readonly compiled: readonly { readonly glob: string; readonly regexp: RegExp }[];

  /**
   * @param globs - The patterns. Duplicates are harmless and kept, so order is the caller's.
   */
  constructor(readonly globs: readonly string[]) {
    this.compiled = globs.map((glob) => ({ glob, regexp: globToRegExp(glob) }));
  }

  /**
   * The first pattern this path matches.
   *
   * @param path - A repository-relative path.
   * @returns The glob that admitted it, or `undefined` when none does.
   */
  match(path: string): string | undefined {
    return this.compiled.find((entry) => entry.regexp.test(path))?.glob;
  }

  /**
   * Does any pattern match this path?
   *
   * @param path - A repository-relative path.
   * @returns `true` when at least one glob admits it.
   */
  matches(path: string): boolean {
    return this.match(path) !== undefined;
  }
}

/**
 * Widen a plan's declared files into the allowed-path scope.
 *
 * The plan (`issue_estimates.breakdown.files`) names the files the work is *believed* to touch,
 * and an estimate is a belief rather than a contract: a fix to `drivers/can/telemetry_buf.c`
 * that also edits the header beside it has not left its scope. So each declared file admits its
 * **directory**, recursively — `drivers/can/telemetry_buf.c` becomes `drivers/can/**`.
 *
 * A file at the repository root admits **only itself**. Widening `README.md` to its directory
 * would be widening it to `**`, which is a scope that allows everything and therefore checks
 * nothing.
 *
 * A declared entry that already contains a glob character is kept as written, so an estimator
 * (or a person editing a plan) that means `docs/**` can say so.
 *
 * @param declared - The plan's file list, as stored.
 * @returns The scope, deduplicated, in first-seen order — and sorted nowhere, so evidence names
 *   the glob the plan's own order produced.
 */
export function widenToScope(declared: readonly string[]): string[] {
  const scope = new Set<string>();

  for (const entry of declared) {
    const path = entry.trim();

    if (path === "") {
      continue;
    }

    if (/[*?]/.test(path)) {
      scope.add(path);
      continue;
    }

    const slash = path.lastIndexOf("/");
    scope.add(slash === -1 ? path : `${path.slice(0, slash)}/**`);
  }

  return [...scope];
}

/**
 * Which glob of a scope a path came closest to — what an `allowed_paths` failure names.
 *
 * A path outside the scope fails *every* glob in it, and evidence has room for one. The useful
 * one to name is the glob the path nearly satisfied — `drivers/can/**` for
 * `drivers/spi/bus.c` rather than `docs/**` — because that is the one a person reads and
 * understands as *"you wandered out of here"*.
 *
 * @param path - The offending path.
 * @param globs - The scope. Must not be empty.
 * @returns The glob sharing the longest leading run of whole segments with the path; the first
 *   such glob on a tie, so the answer is deterministic.
 */
export function nearestGlob(path: string, globs: readonly string[]): string {
  const segments = path.split("/");
  let best = globs[0];
  let bestShared = -1;

  for (const glob of globs) {
    const globSegments = glob.split("/");
    let shared = 0;

    while (
      shared < segments.length &&
      shared < globSegments.length &&
      segments[shared] === globSegments[shared]
    ) {
      shared += 1;
    }

    if (shared > bestShared) {
      best = glob;
      bestShared = shared;
    }
  }

  return best;
}
