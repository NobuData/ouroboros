/**
 * Path globs, as the browser checks and states them
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)) — the rules behind the shared
 * glob editor (`app/globs/glob-editor.tsx`).
 *
 * A protected-path glob is written in one language wherever it is edited: the policy card's
 * `protected_paths` rule and the Get Started detection card's protected-paths row (#391). The
 * grammar is `schemas/workflow-dsl/v1.json`'s `path_glob` — relative to the repository root, no
 * leading `/`, no `..` segment, no whitespace — and {@link GLOB_PATTERN} is that
 * definition's pattern, verbatim, so a glob this module accepts is one the service's validator
 * accepts.
 *
 * **What a glob matches is the service's to say.** This module checks the grammar and words the
 * result; the match preview comes from `POST /api/v1/policies/path-preview`, which runs the
 * guardrails' own matcher over each repository's tree — so the preview and the enforcement cannot
 * disagree, and no second matcher lives here to drift from it.
 *
 * Framework-free and pure.
 */

/** `schemas/workflow-dsl/v1.json` `$defs.path_glob.pattern`, verbatim. */
export const GLOB_PATTERN =
  /^(?:\.|\.\.[^/\s]+|\.[^/\s.][^/\s]*|[^/\s.][^/\s]*)(?:\/(?:\.|\.\.[^/\s]+|\.[^/\s.][^/\s]*|[^/\s.][^/\s]*)?)*$/;

/** The longest glob the grammar admits. */
export const GLOB_MAX_LENGTH = 256;

/** The most globs one rule may hold (`path_globs.maxItems`). */
export const GLOBS_MAX = 64;

/** Why a typed glob cannot join a list. */
export type GlobProblem = "empty" | "too_long" | "absolute" | "whitespace" | "parent" | "grammar" | "duplicate" | "full";

/** Each problem, as the sentence the editor shows under the input. */
export const GLOB_PROBLEMS: Readonly<Record<GlobProblem, string>> = {
  empty: "Type a path pattern, like drivers/can/**.",
  too_long: `A pattern is at most ${String(GLOB_MAX_LENGTH)} characters.`,
  absolute: "Patterns are relative to the repository root — leave off the leading slash.",
  whitespace: "A pattern holds no spaces.",
  parent: "A pattern cannot step out of the repository with a .. segment.",
  grammar: "That is not a path pattern. Use path segments separated by /, with * and ** as wildcards.",
  duplicate: "That pattern is already in the list.",
  full: `A rule holds at most ${String(GLOBS_MAX)} patterns.`,
};

/**
 * What is wrong with a typed glob, most specific reason first.
 *
 * @param text The glob as typed.
 * @param existing The globs already in the list, for the duplicate and capacity checks.
 * @returns The problem, or `null` when the glob may join the list.
 */
export function globProblem(text: string, existing: readonly string[] = []): GlobProblem | null {
  if (text === "") return "empty";
  if (text.length > GLOB_MAX_LENGTH) return "too_long";
  if (/\s/.test(text)) return "whitespace";
  if (text.startsWith("/")) return "absolute";
  if (text.split("/").includes("..")) return "parent";
  if (!GLOB_PATTERN.test(text)) return "grammar";
  if (existing.includes(text)) return "duplicate";
  if (existing.length >= GLOBS_MAX) return "full";

  return null;
}

/**
 * A glob as a chip states it — mockup 17's `boot/` for `boot/**`.
 *
 * "Everything under a directory" is the common case and reads as the directory; any other
 * pattern is shown as written, because abbreviating it would hide what it matches.
 *
 * @param glob The glob.
 * @returns The chip's text.
 */
export function globChip(glob: string): string {
  return glob.endsWith("/**") && !/[*?]/.test(glob.slice(0, -3)) ? glob.slice(0, -2) : glob;
}

/** One repository's answer in a match preview. */
export interface GlobPreviewRepository {
  /** The repository, `owner/name`. */
  readonly repository: string;
  /** Whether its tree could be listed. */
  readonly status: "listed" | "unavailable";
  /** Why not, when it could not. */
  readonly reason: string | null;
  /** How many files the tree holds, when listed. */
  readonly fileCount: number | null;
  /** Whether the host returned only part of the tree. */
  readonly truncated: boolean;
  /** Each glob's matches in this repository. */
  readonly globs: readonly {
    readonly glob: string;
    readonly matchCount: number;
    readonly samples: readonly string[];
  }[];
}

/** A match preview, or why there is none. */
export type GlobPreview =
  | { readonly ok: true; readonly repositories: readonly GlobPreviewRepository[] }
  | { readonly ok: false; readonly reason: string };

/** What the preview says while it is being fetched. */
export const PREVIEW_LOADING = "Checking what these patterns match…";

/** What the preview says for a workspace with no repository to check against. */
export const PREVIEW_NO_REPOSITORIES = "No repository is enabled yet, so there is nothing to preview against.";

/** What the preview says for an empty list. */
export const PREVIEW_NO_GLOBS = "No pattern yet — nothing is protected by this list.";

/**
 * One glob's matches in one repository, as a line.
 *
 * @param matchCount How many files it matches.
 * @returns `matches 12 files`, `matches 1 file`, or — for a pattern that covers nothing — a
 *   sentence that says so plainly, since that is the result a reader most needs to notice.
 */
export function matchLine(matchCount: number): string {
  if (matchCount === 0) return "matches no files";

  return matchCount === 1 ? "matches 1 file" : `matches ${matchCount.toLocaleString("en-US")} files`;
}

/**
 * A repository's heading in the preview.
 *
 * @param repository The repository's answer.
 * @returns Its name with the size of the tree checked — and that the tree was cut short, when
 *   it was, since a count over part of a tree is a floor rather than a total.
 */
export function repositoryLine(repository: GlobPreviewRepository): string {
  if (repository.status === "unavailable") {
    return `${repository.repository} — could not be listed. ${repository.reason ?? ""}`.trim();
  }

  const files = `${(repository.fileCount ?? 0).toLocaleString("en-US")} files`;

  return repository.truncated
    ? `${repository.repository} — first ${files} checked; the tree is larger, so counts are a minimum`
    : `${repository.repository} — ${files} checked`;
}
