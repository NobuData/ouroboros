/**
 * The competitor tracker's vocabulary — source kinds, cadences, and the notes it writes when a
 * source cannot be read yet (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * ```
 * release_notes · changelog · page   fetched through the page reader, scoped by a CSS selector
 * github_releases                    the GitHub API, with the workspace's GitHub token
 * rss                                an RSS or Atom feed, through the page reader
 * filings                            registered and counted; read by v2's filings tier (#637)
 * ```
 *
 * Shared by the registry (which validates a watch against it) and the tracker adapter (which
 * reads a watch by it), so the two cannot disagree about what a kind means.
 */

import type { CompetitorCadence, CompetitorSourceKind } from "../../db/schema";

/** Every source kind, in V112's vocabulary order — the sub-line lists kinds in this order. */
export const COMPETITOR_SOURCE_KINDS: readonly CompetitorSourceKind[] = [
  "release_notes",
  "changelog",
  "github_releases",
  "rss",
  "filings",
  "page",
];

/** The cadences, shortest first. */
export const COMPETITOR_CADENCES: readonly CompetitorCadence[] = ["hourly", "daily", "weekly"];

/** A cadence as milliseconds — the nominal interval the scheduler jitters. */
export const CADENCE_MS: Readonly<Record<CompetitorCadence, number>> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** How the sub-line names a kind — `competitor_source_kind_label()` in V112, in TypeScript. */
export const SOURCE_KIND_LABELS: Readonly<Record<CompetitorSourceKind, string>> = {
  release_notes: "release notes",
  changelog: "changelogs",
  github_releases: "GitHub releases",
  rss: "RSS feeds",
  filings: "filings",
  page: "pages",
};

/** The kinds read as an HTML page, where a selector scopes the diff. */
export const PAGE_KINDS: readonly CompetitorSourceKind[] = ["release_notes", "changelog", "page"];

/** The note a `filings` watch carries: registered, counted, and not read until v2. */
export const FILINGS_NOTE =
  "filings are read by the filings tier, arriving in v2 — the watch is registered and counted";

/** The note a JS-rendered page carries — never a silently empty snapshot. */
export const RENDER_REQUIRED_NOTE =
  "the page renders its content with JavaScript — it needs the render tier, arriving in v2";

/**
 * Whether a kind takes a selector.
 *
 * @param kind - The source kind.
 * @returns `true` for the page kinds; a feed, the GitHub API and filings are scoped by their shape.
 */
export function acceptsSelector(kind: CompetitorSourceKind): boolean {
  return PAGE_KINDS.includes(kind);
}

/** A GitHub repository, as a `github_releases` watch names it. */
export interface GithubRepoRef {
  readonly owner: string;
  readonly repo: string;
}

/** GitHub's owner and repository name rules, loosely: what the URL path may hold. */
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

/**
 * The repository a `github_releases` watch URL names.
 *
 * @param url - `https://github.com/<owner>/<repo>` or `…/<repo>/releases`.
 * @returns The owner and repository, or null when the URL is not a GitHub repository.
 */
export function githubRepoOf(url: string): GithubRepoRef | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;

  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  const [owner, rawRepo, rest, ...extra] = segments;
  const repo = rawRepo?.replace(/\.git$/i, "");

  if (owner === undefined || repo === undefined || extra.length > 0) return null;
  if (rest !== undefined && rest !== "releases") return null;
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return null;

  return { owner, repo };
}
