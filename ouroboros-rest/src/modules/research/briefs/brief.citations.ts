/**
 * How a ledger record is named and linked wherever a brief shows it (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * **One function names a citation — {@link citeLabel} — and the brief body, the sources panel,
 * the matrix and the Markdown export all call it.** The label is read from the record's stored
 * `cite_no` and `cite_key` (V108 allocates them once and never updates a record), so nothing here
 * numbers anything: rendering twice, or rendering a different surface, cannot renumber.
 *
 *   cite_no 7, no key      [07]
 *   cite_no 312, no key    [312]
 *   cite_no 44, key `git`  [git]
 *
 * A locator is shown the way mockup 22's panel shows it — a web address without its scheme, a
 * `git://` locator as `repo @ sha · path` — and linked where there is somewhere to go: the page
 * itself, or the file at that commit on the repository's host.
 */

import type { SourceRecordKindColumn } from "../../db/schema";

/** The host a `git://` source's repository is linked on. */
export const REPOSITORY_HOST = "https://github.com";

/** A `git://<repo>@<sha>[/<path>][#L<n>[-L<m>]]` locator, read. */
export interface GitLocator {
  /** `owner/name`, or a bare `name`. */
  readonly repository: string;
  readonly sha: string;
  /** The path inside the repository; null for the repository itself. */
  readonly path: string | null;
  /** The first and last line cited; null when the locator names no line. */
  readonly lines: readonly [number, number] | null;
}

/** What a citation needs to be named. */
export interface Citable {
  readonly citeNo: number;
  readonly citeKey: string | null;
}

/**
 * Resolves a `git://` locator's repository to the `owner/name` it is hosted under.
 *
 * @param repository - `owner/name`, or a bare name.
 * @returns The slug, or null when the workspace has no such repository (or more than one).
 */
export type RepositoryResolver = (repository: string) => string | null;

const GIT_LOCATOR = /^git:\/\/([^@\s]+)@([0-9a-f]{7,40})(?:\/([^#\s]+))?(?:#L(\d+)(?:-L(\d+))?)?$/;

/**
 * The label a citation carries everywhere — `[07]`, or `[git]` for a symbolic key.
 *
 * @param source - The record's stored number and key.
 * @returns The label, brackets included.
 */
export function citeLabel(source: Citable): string {
  return source.citeKey === null
    ? `[${source.citeNo.toString().padStart(2, "0")}]`
    : `[${source.citeKey}]`;
}

/**
 * Read a `git://` locator.
 *
 * @param locator - The locator.
 * @returns Its parts, or null when it is not a `git://` locator.
 */
export function parseGitLocator(locator: string): GitLocator | null {
  const match = GIT_LOCATOR.exec(locator);
  if (match === null) return null;

  const [, repository, sha, path, first, last] = match as unknown as (string | undefined)[];
  const from = first === undefined ? null : Number(first);

  return {
    repository: repository ?? "",
    sha: sha ?? "",
    path: path ?? null,
    lines: from === null ? null : [from, last === undefined ? from : Number(last)],
  };
}

/**
 * A locator as the sources panel prints it.
 *
 * @param kind - The record's kind.
 * @param locator - Its locator.
 * @returns `droneanalysts.example.com/s4-teardown` for a URL, `helios-firmware @ 8c1b2e4 ·
 *   src/dock/dock_ctrl.c` for a `git://` locator, and the locator itself for any other.
 */
export function locatorLabel(kind: SourceRecordKindColumn, locator: string): string {
  if (kind === "code") {
    const git = parseGitLocator(locator);
    if (git !== null) {
      return `${git.repository} @ ${git.sha}${git.path === null ? "" : ` · ${git.path}`}`;
    }
  }

  return /^https?:\/\//i.test(locator)
    ? locator.replace(/^https?:\/\//i, "").replace(/\/$/, "")
    : locator;
}

/**
 * The address of a file at a commit on the repository's host.
 *
 * @param slug - `owner/name`.
 * @param sha - The commit.
 * @param path - The path; null for the commit's tree.
 * @param lines - The lines to land on, when known.
 * @returns The URL.
 */
export function repositoryHref(
  slug: string,
  sha: string,
  path: string | null,
  lines: readonly [number, number] | null,
): string {
  const base = `${REPOSITORY_HOST}/${slug}`;
  if (path === null) return `${base}/tree/${sha}`;

  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const anchor =
    lines === null
      ? ""
      : lines[0] === lines[1]
        ? `#L${lines[0].toString()}`
        : `#L${lines[0].toString()}-L${lines[1].toString()}`;

  return `${base}/blob/${sha}/${encoded}${anchor}`;
}

/**
 * Where a source can be opened.
 *
 * @param kind - The record's kind.
 * @param locator - Its locator.
 * @param resolve - The workspace's repositories, for a `git://` locator.
 * @returns The page for an `http(s)` locator; the file at its commit for a `git://` locator whose
 *   repository the workspace has; null for an internal locator with nowhere to go
 *   (`issue-index://`, `telemetry://`) and for a repository that does not resolve.
 */
export function sourceHref(
  kind: SourceRecordKindColumn,
  locator: string,
  resolve: RepositoryResolver,
): string | null {
  if (/^https?:\/\//i.test(locator)) return locator;
  if (kind !== "code") return null;

  const git = parseGitLocator(locator);
  if (git === null) return null;
  const slug = resolve(git.repository);

  return slug === null ? null : repositoryHref(slug, git.sha, git.path, git.lines);
}

/**
 * A resolver over the workspace's repositories.
 *
 * @param slugs - Every `owner/name` the workspace has.
 * @returns A resolver matching a full slug exactly, or a bare name only one repository has —
 *   an ambiguous bare name resolves to nothing rather than to a guess.
 */
export function repositoryResolver(slugs: readonly string[]): RepositoryResolver {
  const known = slugs.map((slug) => slug.toLowerCase());

  return (repository) => {
    const wanted = repository.trim().toLowerCase();
    if (wanted.includes("/")) return known.includes(wanted) ? wanted : null;

    const named = known.filter((slug) => slug.split("/")[1] === wanted);
    return named.length === 1 ? named[0] : null;
  };
}
