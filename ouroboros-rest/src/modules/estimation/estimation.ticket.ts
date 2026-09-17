/**
 * A canonical ticket, as the estimation contract's `issue` — the one translation the third kind of
 * subject needs.
 *
 * AL.5 ([#281](https://github.com/NobuData/ouroboros/issues/281)). The engine's `IssueContext` was
 * drawn around a `github_issues` row: a positive issue `number`, an `owner/name` `repo`, a title of
 * at most 256 characters and at most 100 labels of at most 50. A canonical ticket is source-neutral
 * (V030) — a `PROJ-142` key, a Jira project rather than a repository, a 512-character title — so
 * every one of those has to be *derived* rather than copied, and a derivation that could produce a
 * value the contract refuses would fail every estimate of that ticket forever.
 *
 * So each function here is total: whatever V030 lets a ticket hold, the result is a request the
 * engine accepts. Nothing here reads the database or calls the engine — `estimation.repository.ts`
 * reads the row and `estimation.orchestrator.ts` sends the request.
 */

import type { IssueContext } from "../engine/engine.contract";

/** The contract's longest title (`IssueContext.title`, `maxLength: 256`). */
export const CONTRACT_TITLE_MAX = 256;

/** The contract's longest body (`IssueContext.body`, `maxLength: 65536`). */
export const CONTRACT_BODY_MAX = 65536;

/** The contract's most labels (`IssueContext.labels`, `maxItems: 100`). */
export const CONTRACT_LABELS_MAX = 100;

/** The contract's longest label (`IssueContext.labels[]`, `maxLength: 50`). */
export const CONTRACT_LABEL_MAX = 50;

/** The contract's longest repository (`IssueContext.repo`, `maxLength: 140`). */
export const CONTRACT_REPO_MAX = 140;

/** One side of `owner/name`, as the contract's `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` allows it. */
const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** One canonical ticket, with everything an estimation request is built from. */
export interface EstimableTicketRow {
  /** `tickets.id` — what the estimate is versioned against. */
  readonly ticketId: string;
  /** The ticket's workspace — the routing resolution's scope. */
  readonly organizationId: string;
  /** `#588`, `PROJ-142` — the display key, for the log and for the request's number. */
  readonly externalKey: string;
  /** The title, as the tracker has it. Up to 512 characters (V030). */
  readonly title: string;
  /** The body, or null. */
  readonly body: string | null;
  /** The tracker's label names. */
  readonly labels: string[];
  /** Provider specifics — `{ github: { owner, repo } }` for a GitHub ticket. */
  readonly meta: unknown;
  /** The source's kind — `github`, `jira`, … */
  readonly sourceKind: string;
  /** The source's display name — the repository's stand-in for a tracker that has none. */
  readonly sourceName: string;
}

/**
 * The issue number a ticket is sized as — the trailing number of its key.
 *
 * `#588` is `588` and `PROJ-142` is `142`. Read for provenance only — no estimator branches on it —
 * so a key with no number (a hand-made row, a tracker that uses words) is sized as `1` rather than
 * refused — `draftNumber`'s fallback in `estimation.orchestrator.ts`, for the same reason.
 *
 * @param externalKey - The ticket's display key.
 * @returns A positive whole number.
 */
export function ticketNumber(externalKey: string): number {
  const match = /(\d+)\D*$/.exec(externalKey);
  const number = match === null ? 0 : Number(match[1]);

  return Number.isSafeInteger(number) && number >= 1 ? number : 1;
}

/**
 * The repository a ticket is sized as, `owner/name`.
 *
 * A GitHub ticket carries its real one in `meta.github` (`github.mapping.ts`), and that is used
 * verbatim when it fits the contract. Any other tracker has no repository, so the request names the
 * **source** instead — `jira/Acme-Jira` — which is the most specific place the ticket lives that is
 * shaped like one, and is honest about being a tracker rather than a repository.
 *
 * @param ticket - The ticket.
 * @returns A value matching the contract's `repo` pattern and length.
 */
export function ticketRepo(
  ticket: Pick<EstimableTicketRow, "meta" | "sourceKind" | "sourceName">,
): string {
  const github = githubRepository(ticket.meta);

  if (github !== undefined) {
    return github;
  }

  const owner = segment(ticket.sourceKind, "source");
  const name = segment(ticket.sourceName, "tickets");

  return `${owner}/${name}`.slice(0, CONTRACT_REPO_MAX);
}

/**
 * A canonical ticket as the contract's `issue`, within every bound the contract sets.
 *
 * @param ticket - The ticket, as the repository read it.
 * @returns The request's `issue`. A title longer than the contract allows is cut rather than
 *   refused — the estimator reads a title for its words, and the first 256 characters hold them —
 *   and so is a body; labels the contract would refuse are dropped rather than rewritten, because a
 *   label renamed by this function is a label the tracker does not have.
 */
export function ticketIssueContext(ticket: EstimableTicketRow): IssueContext {
  return {
    number: ticketNumber(ticket.externalKey),
    title: ticket.title.slice(0, CONTRACT_TITLE_MAX),
    body: ticket.body === null ? null : ticket.body.slice(0, CONTRACT_BODY_MAX),
    labels: ticket.labels
      .filter((label) => label.trim() !== "" && label.length <= CONTRACT_LABEL_MAX)
      .slice(0, CONTRACT_LABELS_MAX),
    repo: ticketRepo(ticket),
  };
}

/**
 * `meta.github.owner/repo`, when both are there and both fit the contract.
 *
 * @param meta - A ticket's `meta` — `unknown`, because it is provider-owned JSON.
 * @returns `owner/repo`, or `undefined` for anything else.
 */
function githubRepository(meta: unknown): string | undefined {
  const github = field(meta, "github");
  const owner = field(github, "owner");
  const repo = field(github, "repo");

  if (typeof owner !== "string" || typeof repo !== "string") {
    return undefined;
  }

  const full = `${owner}/${repo}`;

  return REPO_SEGMENT.test(owner) && REPO_SEGMENT.test(repo) && full.length <= CONTRACT_REPO_MAX
    ? full
    : undefined;
}

/**
 * Read one property of a value that may not be an object.
 *
 * @param value - Anything.
 * @param key - The property.
 * @returns The property's value, or `undefined` when `value` is not an object.
 */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

/**
 * Make a string one side of `owner/name`.
 *
 * @param value - A source kind or display name, which may hold spaces and `·`.
 * @param fallback - What to use when nothing of the value survives.
 * @returns Runs of disallowed characters collapsed to `-`, trimmed of leading and trailing `-`.
 */
function segment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return cleaned === "" ? fallback : cleaned;
}
