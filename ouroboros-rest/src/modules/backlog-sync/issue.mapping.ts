/**
 * GitHub's issue JSON, read — and the one place a pull request is thrown away.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)). Three jobs, and they are
 * together because each of them is *"do not write a row this schema, or this product, does not
 * mean"*:
 *
 *   * **The wire is parsed, not asserted.** `engine.contract.ts` gives the reason and it is
 *     the same one here: this service is reading somebody else's JSON over a network, and a
 *     cast would compile and be wrong at exactly the moment it mattered — a proxy's error
 *     page, a field that changed type, a `null` where a string was promised. Unknown fields
 *     are stripped rather than refused, because GitHub adds fields to this payload routinely
 *     and a mirror that refused one would turn a GitHub release into an outage here.
 *   * **A pull request is not an issue.** GitHub's issues endpoint returns both, and the only
 *     thing that tells them apart is the presence of a `pull_request` key. Dropping them here
 *     — before a row exists — is what makes {@link "../db/schema".GithubIssuesTable}'s claim
 *     that the table holds no pull requests structural: there is no column that could record
 *     the difference, so there is no state in which a PR is stored *and marked*.
 *   * **Every rule V014 enforces is checked before the write.** The column CHECKs are the
 *     contract mockup 03 reads through — a title that says something, a `https` URL, a list of
 *     label names, timestamps that agree — and a payload that would trip one is refused *as
 *     one issue*, with a reason, rather than as a `23514` that costs a whole repository its
 *     poll. The database is still the authority; this is what keeps it from having to be the
 *     error handler.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here edits a value.** Decision **K3**: this is a cache, and a mirror that
 * trimmed a title, folded a login or dropped a blank label would be a fork of GitHub's record
 * that nothing could reconcile. So the choice for a payload the column cannot hold is refuse,
 * never repair — the one exception being that a body of `""` is stored as `""` and a missing
 * body as `null`, because that is the distinction GitHub itself draws.
 */

import { z } from "zod";

import { GITHUB_ISSUE_STATES, type GithubIssueState } from "../db/schema";

/** The paginated route a repository's issues come from, in Octokit's route syntax. */
export const ISSUES_ROUTE = "GET /repos/{owner}/{repo}/issues";

/**
 * GitHub's cap on an issue title, doubled — V014's `github_issues_title_present` bound.
 *
 * The slack is V014's and its reason is V014's: a mirror must never refuse a title GitHub
 * accepted. Checked in JavaScript's UTF-16 code units against a PostgreSQL bound counted in
 * characters, which is the strict direction — an astral character counts as two here and one
 * there, so nothing this accepts can be refused by the column.
 */
export const MAX_TITLE_LENGTH = 512;

/** GitHub's own limit on an issue body — V014's `github_issues_body_bounded` bound. */
export const MAX_BODY_LENGTH = 65536;

/** GitHub's own cap on labels per issue — V014's `github_issues_labels_shape` bound. */
export const MAX_LABELS = 100;

/** V014's `github_issues_url_https` bound. */
export const MAX_URL_LENGTH = 2048;

/**
 * A login GitHub could have issued, as V028 widened it.
 *
 * The user rule — alphanumerics separated by single hyphens — with the literal `[bot]` suffix
 * a GitHub App's login carries. `github_issues_author_login_format` is the authority; this is
 * the same rule where a bad payload can be turned into a counted reason instead of a rolled
 * back transaction.
 */
export const AUTHOR_LOGIN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*(\[bot\])?$/;

/** V028's bound — GitHub's 39-character login cap plus the five characters of `[bot]`. */
export const MAX_AUTHOR_LOGIN_LENGTH = 44;

/**
 * `https`, a host, an optional port, and a path — V014's `github_issues_url_https`.
 *
 * The same expression the CHECK uses, and it is a **safety** rule rather than a tidiness one:
 * this value becomes the `href` of *"Open on GitHub ↗"*, and an `href` is a place a scheme
 * like `javascript:` executes rather than navigates. `@` is not in the host class and cannot
 * be reached before the `/`, so a userinfo trick — `https://github.com@evil.example/…` — is
 * refused by the shape rather than by a rule about it.
 */
export const HTTPS_URL = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?\//;

/**
 * One issue, as GitHub's list route answers.
 *
 * Only the fields this mirror stores, plus the two that decide whether it stores anything:
 * `pull_request`, which marks a row that is not an issue, and `state`, which is what a close
 * flips.
 */
export const githubIssuePayload = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  /** Absent, `null` and `""` are three shapes GitHub uses for the same idea; two of them. */
  body: z.string().nullish(),
  state: z.enum(GITHUB_ISSUE_STATES),
  /**
   * GitHub sends label *objects*; this mirror stores names (V014's column comment argues
   * why). A bare string is accepted beside them because GitHub's own docs allow it on some
   * routes, and accepting both here costs one union and removes a class of surprise.
   */
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string().optional() })]))
    .optional()
    .default([]),
  /** Null when the author's account is gone, which GitHub does return. */
  user: z.object({ login: z.string() }).nullish(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string(),
  /**
   * Present — with any value at all — exactly when this row is a pull request.
   *
   * `unknown` rather than a shape: nothing reads what is inside it, and parsing an object
   * this file then ignores would be a second thing that could reject a payload for a reason
   * that does not matter.
   */
  pull_request: z.unknown().optional(),
});

/** One issue's mirrored values — everything of GitHub's that {@link GithubIssuesTable} holds. */
export interface MirroredIssue {
  /** The number GitHub assigns, unique within the repository. */
  readonly number: number;
  /** The title, exactly as GitHub has it. */
  readonly title: string;
  /** The body in full, or null when GitHub sent none. */
  readonly body: string | null;
  /** `open` or `closed`. */
  readonly state: GithubIssueState;
  /** The label names, in the order GitHub listed them. */
  readonly labels: readonly string[];
  /** The author's login, unfolded, or null when GitHub returned no user. */
  readonly authorLogin: string | null;
  /** When GitHub says it was opened. */
  readonly ghCreatedAt: Date;
  /** When GitHub last touched it — where the `since` watermark comes from. */
  readonly ghUpdatedAt: Date;
  /** The issue on GitHub. */
  readonly ghUrl: string;
}

/** What one payload turned out to be. */
export type ReadPayload =
  | { readonly kind: "issue"; readonly issue: MirroredIssue }
  /** A pull request. Dropped, counted, and never a row. */
  | { readonly kind: "pull_request" }
  /** Something this mirror cannot represent. Dropped, counted, and logged with {@link reason}. */
  | { readonly kind: "unusable"; readonly reason: string };

/**
 * Read one row of GitHub's answer.
 *
 * @param payload - One element of the issues list, straight off the wire.
 * @returns The issue, the news that it was a pull request, or the reason it cannot be stored.
 *   Never throws: a poll walks a page of these and one unusable payload must cost one issue
 *   rather than the repository's whole cycle.
 */
export function readPayload(payload: unknown): ReadPayload {
  const parsed = githubIssuePayload.safeParse(payload);

  if (!parsed.success) {
    return {
      kind: "unusable",
      reason: `payload does not match the issues contract: ${issues(parsed.error)}`,
    };
  }

  const issue = parsed.data;

  // Before anything else, and before any other rule can reject it for a reason that would be
  // misleading: a pull request is not a malformed issue.
  if (issue.pull_request !== undefined) {
    return { kind: "pull_request" };
  }

  if (issue.title.trim() === "") {
    return { kind: "unusable", reason: `#${String(issue.number)} has a blank title` };
  }

  if (issue.title.length > MAX_TITLE_LENGTH) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} has a title past ${String(MAX_TITLE_LENGTH)} characters`,
    };
  }

  if (issue.body != null && issue.body.length > MAX_BODY_LENGTH) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} has a body past ${String(MAX_BODY_LENGTH)} characters`,
    };
  }

  const labels = labelNames(issue.labels);

  if (labels === undefined) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} carries a label this mirror cannot store`,
    };
  }

  const login = issue.user?.login ?? null;

  if (login !== null && (login.length > MAX_AUTHOR_LOGIN_LENGTH || !AUTHOR_LOGIN.test(login))) {
    // Deliberately not stored as `null`: that means *"GitHub returned no user"*, and writing
    // it for an author who is right there would make the mirror say something false.
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} names an author login this mirror cannot store`,
    };
  }

  if (issue.html_url.length > MAX_URL_LENGTH || !HTTPS_URL.test(issue.html_url)) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} has a URL that is not an https link`,
    };
  }

  const createdAt = instant(issue.created_at);
  const updatedAt = instant(issue.updated_at);

  if (createdAt === undefined || updatedAt === undefined) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} carries a timestamp that is not a date`,
    };
  }

  // V014's `github_issues_updated_after_created`. GitHub never produces this pair; a mapping
  // that swapped the two fields does, and it would poison the watermark drawn from the second.
  if (updatedAt.getTime() < createdAt.getTime()) {
    return {
      kind: "unusable",
      reason: `#${String(issue.number)} was updated before it was opened`,
    };
  }

  return {
    kind: "issue",
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state,
      labels,
      authorLogin: login,
      ghCreatedAt: createdAt,
      ghUpdatedAt: updatedAt,
      ghUrl: issue.html_url,
    },
  };
}

/**
 * The value `since` is sent as.
 *
 * ISO 8601 in UTC, which is the format GitHub's `since` parameter documents and the format
 * `updated_at` comes back in — so a watermark round-trips through GitHub unchanged. Stored as
 * text in `github_repos.issues_sync_cursor`, which V014 keeps deliberately opaque: a database
 * that parsed it would be a second implementation of this format with its own opinion about
 * time zones.
 *
 * @param at - The watermark.
 * @returns The cursor, e.g. `2026-09-08T10:00:00.000Z`.
 */
export function cursorOf(at: Date): string {
  return at.toISOString();
}

/**
 * The instant a stored cursor names.
 *
 * @param cursor - A value previously written by {@link cursorOf}, or anything else that ended
 *   up in the column.
 * @returns The instant, or `undefined` when the stored value is not one — in which case the
 *   caller re-imports rather than sending GitHub a `since` it would reject.
 */
export function cursorInstant(cursor: string): Date | undefined {
  return instant(cursor);
}

/**
 * Parse a timestamp, refusing the answers `Date` gives instead of failing.
 *
 * @param value - The string.
 * @returns The instant, or `undefined` when the string is not one. `new Date("nonsense")` is
 *   an `Invalid Date` rather than a throw, and an `Invalid Date` reaching a query is a
 *   `null` in a `not null` column several layers later.
 */
function instant(value: string): Date | undefined {
  const at = new Date(value);

  return Number.isNaN(at.getTime()) ? undefined : at;
}

/**
 * The label names, or the news that one of them cannot be stored.
 *
 * @param labels - GitHub's labels: objects with a name, or bare strings.
 * @returns The names in order, or `undefined` when a label has no usable name or there are
 *   more than {@link MAX_LABELS}. Refused rather than filtered: dropping a nameless label
 *   would quietly change which chips an issue renders, and the chip-set is a filter people
 *   trust to be complete.
 */
function labelNames(
  labels: readonly (string | { name?: string })[],
): readonly string[] | undefined {
  if (labels.length > MAX_LABELS) {
    return undefined;
  }

  const names: string[] = [];

  for (const label of labels) {
    const name = typeof label === "string" ? label : label.name;

    if (name === undefined || name === "") {
      return undefined;
    }

    names.push(name);
  }

  return names;
}

/**
 * A zod failure, as one line of a log.
 *
 * @param error - What the parse rejected.
 * @returns The paths and messages, joined. Field names and zod's own words only — the payload
 *   itself is not quoted, because an issue body is somebody's text and a log is not where it
 *   belongs.
 */
function issues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
    .join("; ");
}
