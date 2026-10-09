/**
 * One check of one watch: read the source, scope it, compare it with the last snapshot, archive
 * a change (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * ```
 * filings          ─▶ unsupported   "filings are read by the filings tier, arriving in v2"
 * github_releases  ─▶ GitHub API (workspace token)       ─┐
 * rss              ─▶ page reader ─▶ RSS/Atom items       ├▶ normalise ─▶ sha256
 * page kinds       ─▶ page reader ─▶ selector | main text ┘        │
 *                     empty + script-rendered ─▶ render_required (honest note, never an empty snapshot)
 *                                                                  ▼
 *           no previous ─▶ first snapshot · same hash ─▶ unchanged, nothing written
 *           changed      ─▶ snapshot + diff + archive  ─▶ citable by `changes()`/`latest()`
 * ```
 *
 * Pages and feeds go through #615's page reader — robots.txt, per-host pacing, redirects, size
 * caps and the address policy are its, not reimplemented here. A robots denial is recorded on the
 * watch as `robots_denied` with the rule; the tracker does not read around it.
 *
 * **An unchanged check writes no snapshot.** The chain holds the first read and every change;
 * the watch's `last_success_at` says the source was read. So two checks of the same content
 * produce no diff and nothing to cite.
 */

import { createHash, randomUUID } from "node:crypto";

import { GithubApiError, GITHUB_FAILURES } from "../../../../github/github.errors";
import type { CompetitorCheckOutcome } from "../../../../db/schema";
import { jittered } from "../../../../scheduling/cadence";
import {
  CADENCE_MS,
  FILINGS_NOTE,
  RENDER_REQUIRED_NOTE,
  githubRepoOf,
  type GithubRepoRef,
} from "../../../competitors/competitor.kinds";
import { SelectorError } from "../../../competitors/competitor.selector";
import { lineDiff, normaliseContent } from "../../../competitors/competitor.diff";
import type {
  CheckRecord,
  ClaimedWatch,
  CompetitorsRepository,
  LatestSnapshot,
  NewSnapshot,
} from "../../../competitors/competitors.repository";
import { ResearchToolError } from "../../research-tool.errors";
import type { FetchedPage } from "../web/web.fetcher";
import { feedText, parseFeed } from "./competitor.feeds";
import { releasesText, type GithubRelease } from "./competitor.github";
import { looksScriptRendered, scopeHtml } from "./competitor.scope";

/** How soon a failed check is tried again, at most — the cadence when that is shorter. */
export const FAILURE_RETRY_MS = 60 * 60 * 1000;

/** Where a snapshot's archive lives — its row in `competitor_snapshot_contents`. */
export const CONTENT_REF_PREFIX = "archive://competitor-snapshot/";

/** The longest note a watch keeps — V117's `competitor_watches_last_note_present`. */
const MAX_NOTE = 500;

/** Reads one page through the page reader. */
export interface PageReader {
  fetch(locator: string): Promise<FetchedPage>;
}

/** Reads a repository's releases with the workspace's GitHub token, newest first. */
export type ReleasesReader = (
  organizationId: string,
  repository: GithubRepoRef,
) => Promise<readonly GithubRelease[]>;

/** What the snapshotter writes through. */
export type SnapshotStore = Pick<
  CompetitorsRepository,
  "latestSnapshot" | "insertSnapshot" | "recordCheck"
>;

/** What one check found. */
export interface CheckResult {
  readonly outcome: CompetitorCheckOutcome;
  readonly note: string | null;
  /** The snapshot written — on `first` and `changed` only. */
  readonly snapshotId: string | null;
  /** The diff written — on `changed` only. */
  readonly diff: string | null;
  readonly nextCheckAt: Date;
}

/** Everything a check depends on. */
export interface SnapshotterDependencies {
  readonly store: SnapshotStore;
  readonly pages: PageReader;
  readonly releases: ReleasesReader;
  /** `[0, 1)` — the jitter's source. */
  readonly random?: () => number;
  /** A new snapshot id. */
  readonly newId?: () => string;
}

/** A source that could not be read into text, with how the watch records it. */
class Unread extends Error {
  constructor(
    readonly outcome: Exclude<CompetitorCheckOutcome, "first" | "changed" | "unchanged">,
    readonly note: string,
  ) {
    super(note);
  }
}

export class CompetitorSnapshotter {
  private readonly random: () => number;
  private readonly newId: () => string;

  /** @param deps - The store, the readers, and the sources of randomness. */
  constructor(private readonly deps: SnapshotterDependencies) {
    this.random = deps.random ?? Math.random;
    this.newId = deps.newId ?? randomUUID;
  }

  /**
   * Check one watch and record what was found.
   *
   * @param watch - A claimed watch.
   * @param now - The check's instant.
   * @returns What was found. Never rejects for a source's failure — that is an outcome; only the
   *   database failing rejects.
   */
  async check(watch: ClaimedWatch, now: Date): Promise<CheckResult> {
    let text: string;

    try {
      text = await this.read(watch);
    } catch (error) {
      const unread = classify(error);
      return this.record(watch, now, {
        outcome: unread.outcome,
        note: unread.note,
        snapshotId: null,
        diff: null,
      });
    }

    const content = normaliseContent(text);
    const contentHash = `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
    const previous = await this.deps.store.latestSnapshot(watch.id);

    if (previous !== undefined && previous.contentHash === contentHash) {
      return this.record(watch, now, {
        outcome: "unchanged",
        note: null,
        snapshotId: null,
        diff: null,
      });
    }

    const id = this.newId();
    const diff = previous === undefined ? null : diffAgainst(previous, content);
    const snapshot: NewSnapshot = {
      id,
      watchId: watch.id,
      previousId: previous?.id ?? null,
      contentHash,
      contentRef: `${CONTENT_REF_PREFIX}${id}`,
      diff,
      takenAt:
        previous !== undefined && previous.takenAt >= now
          ? new Date(previous.takenAt.getTime() + 1)
          : now,
      content,
    };

    await this.deps.store.insertSnapshot(snapshot);

    return this.record(watch, now, {
      outcome: previous === undefined ? "first" : "changed",
      note: null,
      snapshotId: id,
      diff,
    });
  }

  /**
   * The source's text, scoped.
   *
   * @param watch - The watch.
   * @returns Its text — never empty.
   * @throws {Unread} When it cannot be read into text.
   * @throws {ResearchToolError} | {GithubApiError} From the readers, classified by {@link classify}.
   */
  private async read(watch: ClaimedWatch): Promise<string> {
    switch (watch.sourceKind) {
      case "filings":
        throw new Unread("unsupported", FILINGS_NOTE);

      case "github_releases": {
        const repository = githubRepoOf(watch.url);
        if (repository === null) {
          throw new Unread("failed", "the URL does not name a GitHub repository");
        }
        const text = releasesText(await this.deps.releases(watch.organizationId, repository));
        if (text === "") throw new Unread("failed", "the repository has no published releases yet");
        return text;
      }

      case "rss": {
        const page = await this.deps.pages.fetch(watch.url);
        const items = parseFeed(page.document);
        if (items === null)
          throw new Unread("failed", "the URL did not answer an RSS or Atom feed");
        if (items.length === 0) throw new Unread("failed", "the feed has no items yet");
        return feedText(items);
      }

      default:
        return this.readPage(watch);
    }
  }

  private async readPage(watch: ClaimedWatch): Promise<string> {
    const page = await this.deps.pages.fetch(watch.url);
    const html = page.extractor !== "plain-text";

    if (!html) {
      if (watch.selector !== null) {
        throw new Unread(
          "failed",
          `the page is ${page.contentType}, so the selector cannot scope it`,
        );
      }
      if (page.text === "") throw new Unread("failed", "the page is empty");
      return page.text;
    }

    const text =
      watch.selector === null ? page.text : scopeHtml(page.document, watch.selector).text;

    if (normaliseContent(text) !== "") return text;
    if (looksScriptRendered(page.document))
      throw new Unread("render_required", RENDER_REQUIRED_NOTE);
    throw new Unread(
      "failed",
      watch.selector === null
        ? "the page has no readable text"
        : `the selector ${watch.selector} matched nothing on the page`,
    );
  }

  private async record(
    watch: ClaimedWatch,
    now: Date,
    found: Omit<CheckResult, "nextCheckAt">,
  ): Promise<CheckResult> {
    const cadence = CADENCE_MS[watch.cadence];
    const delay = jittered(
      found.outcome === "failed" ? Math.min(cadence, FAILURE_RETRY_MS) : cadence,
      this.random,
    );
    const nextCheckAt = new Date(now.getTime() + delay);
    const note = found.note === null ? null : clipNote(found.note);
    const check: CheckRecord = {
      checkedAt: now,
      outcome: found.outcome,
      note,
      succeeded:
        found.outcome === "first" || found.outcome === "changed" || found.outcome === "unchanged",
      nextCheckAt,
      renderRequired: found.outcome === "render_required",
    };

    await this.deps.store.recordCheck(watch.id, check);
    return { ...found, note, nextCheckAt };
  }
}

/**
 * The diff a changed snapshot carries.
 *
 * @param previous - The last snapshot.
 * @param content - This snapshot's text.
 * @returns The diff — never empty, as V112 requires of a changed snapshot.
 */
function diffAgainst(previous: LatestSnapshot, content: string): string {
  if (previous.content === null) {
    // A snapshot archived before its text was kept (a seed's): say so, and show the region whole.
    return lineDiff(
      "",
      `(the previous snapshot's text was not archived; the whole region follows)\n${content}`,
    ).text;
  }
  const { text } = lineDiff(previous.content, content);
  return text === ""
    ? "~ the region was reordered or re-spaced; no line was added or removed"
    : text;
}

/**
 * A reader's failure, as the watch records it.
 *
 * @param error - What the reader threw.
 * @returns The outcome and its note.
 */
function classify(error: unknown): Unread {
  if (error instanceof Unread) return error;

  if (error instanceof SelectorError) {
    return new Unread("failed", `the selector cannot be used: ${error.message}`);
  }

  if (error instanceof ResearchToolError) {
    switch (error.errorClass) {
      case "robots_denied":
        return new Unread("robots_denied", error.detail);
      case "unsupported":
        return new Unread("unsupported", error.detail);
      default:
        return new Unread("failed", error.detail);
    }
  }

  if (error instanceof GithubApiError) {
    return new Unread("failed", GITHUB_NOTES[error.failure]);
  }

  return new Unread("failed", "the source could not be read");
}

/** What a watch says when GitHub did not answer. */
const GITHUB_NOTES: Readonly<Record<string, string>> = {
  [GITHUB_FAILURES.notConfigured]:
    "GitHub releases need this workspace's GitHub token — an owner or admin sets it in settings",
  [GITHUB_FAILURES.unauthorized]:
    "GitHub rejected this workspace's token — set a new one in settings",
  [GITHUB_FAILURES.notFound]:
    "GitHub has no such repository, or this workspace's token cannot see it",
  [GITHUB_FAILURES.rateLimited]:
    "this workspace's GitHub rate limit is spent — the watch is tried again later",
  [GITHUB_FAILURES.upstreamError]:
    "GitHub is not available right now — the watch is tried again later",
};

function clipNote(note: string): string {
  const flat = note.replace(/\s+/g, " ").trim();
  if (flat === "") return "no detail";
  return flat.length > MAX_NOTE ? `${flat.slice(0, MAX_NOTE - 1)}…` : flat;
}
