/**
 * One GitHub issue payload, as a {@link CanonicalTicket}.
 *
 * Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)). This is the half of the
 * provider a recorded fixture can exercise with no network at all, which is why
 * {@link TicketSourceProvider.mapTicket} is on the interface rather than being a private
 * helper — and why this file has no client in it.
 *
 * ```
 * #485  ─▶  { external_id: "485", external_key: "#485",
 *             state, labels[], author, meta: { github: { owner, repo } } }
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The payload contract is K.4's, and it is imported rather than copied.**
 *
 * `backlog-sync/issue.mapping.ts` already parses this exact endpoint's response — the same
 * fields, the same optionality, the same `pull_request` marker — and it is the file a GitHub
 * API change would be noticed in. A second Zod object describing the same JSON is a second
 * thing to keep in agreement, and the copy that drifts is the one that quietly stops finding
 * the field it was written for. So {@link githubIssuePayload} and the `since` cursor's two
 * helpers come from there.
 *
 * **What is *not* shared is the validation**, and the reason is that the two mappers write to
 * different tables. K.4's writes `github_issues`, whose bounds are *"what the thing being
 * copied permits"* — GitHub's 64 KiB body, GitHub's login grammar. V030's `tickets` is
 * deliberately wider on both counts: its body bound is a storage-sanity number that *"must
 * never be the reason a ticket a provider legitimately returned cannot be stored"*, and its
 * `tickets_author_present` carries no grammar at all. Reusing K.4's rules here would refuse
 * rows this table accepts, which is a mirror losing tickets to a constraint that is not its
 * own.
 *
 * ---------------------------------------------------------------------------
 * **Why the repository is read out of the issue's own URL.**
 *
 * `mapTicket(raw)` takes one argument, and that is the point of it: a fixture with a payload
 * in it must produce the whole row, including the `meta` the issue asks for. GitHub's
 * `html_url` is `https://<host>/<owner>/<repo>/issues/<number>`, so the repository is *in* the
 * payload rather than being ambient in the walk that fetched it — and a mapper that took it as
 * a parameter would be a mapper with two behaviours, one for the sync and one for the test.
 */

import { MAX_LABELS, MAX_URL_LENGTH, githubIssuePayload } from "../../backlog-sync/issue.mapping";
import { TicketSourceError } from "../ticket-source.errors";
import type { CanonicalTicket } from "../ticket-source.provider";

export { ISSUES_ROUTE, cursorInstant, cursorOf } from "../../backlog-sync/issue.mapping";

/** `tickets_title_present` — non-blank and at most this long. */
export const MAX_TITLE_LENGTH = 512;

/** `tickets_body_bounded` — V030's storage-sanity bound, not GitHub's 64 KiB. */
export const MAX_BODY_LENGTH = 262_144;

/** `tickets_author_present` — non-blank and at most this long, and no grammar. */
export const MAX_AUTHOR_LENGTH = 255;

/** `tickets_labels_shape` — each of at most {@link MAX_LABELS} names is at most this long. */
export const MAX_LABEL_LENGTH = 255;

/**
 * `tickets_external_url_https`, as this service's regular expression.
 *
 * The constraint's own pattern, character for character. A safety rule rather than a tidy one:
 * an `href` is a place a scheme like `javascript:` executes rather than navigates, and this
 * file is an HTTP client parsing somebody else's JSON.
 */
export const HTTPS_URL = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?\//;

/** Which repository an issue belongs to, read back out of its own link. */
export interface GithubRepoRef {
  /** The owning account. */
  readonly owner: string;
  /** The repository name. */
  readonly repo: string;
}

/**
 * Whether a payload from the issues endpoint is a pull request.
 *
 * `GET /repos/{owner}/{repo}/issues` answers both, and *"a PR in the backlog is a bug users see
 * immediately"* — so this is asked before {@link mapGithubIssue}, in the walk, rather than
 * being a mapping failure. GitHub's own marker is the presence of the `pull_request` key; there
 * is no type discriminator to read.
 *
 * @param raw - One element of the endpoint's array.
 * @returns True when the element is a pull request rather than an issue.
 */
export function isPullRequest(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "pull_request" in raw &&
    (raw as { pull_request?: unknown }).pull_request !== undefined
  );
}

/**
 * One issue payload, as a canonical ticket.
 *
 * @param raw - Whatever `GET /repos/{owner}/{repo}/issues` returned for one element.
 * @returns The canonical row, with every value already inside what V030 will accept.
 * @throws {TicketSourceError} `upstream`, when the payload cannot be represented — a field
 *   missing, a timestamp that will not parse, a value past a column's bound, or a pull request,
 *   which is not a ticket at all. Throwing rather than returning a half-filled row: V030
 *   refuses most of those at the column, and one that made it through would be a ticket
 *   rendered with a placeholder in it.
 */
export function mapGithubIssue(raw: unknown): CanonicalTicket {
  if (isPullRequest(raw)) {
    throw unusable("payload is a pull request, which this provider does not mirror as a ticket");
  }

  const parsed = githubIssuePayload.safeParse(raw);

  if (!parsed.success) {
    throw unusable(
      `payload does not match the issues contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  const issue = parsed.data;
  const at = `#${String(issue.number)}`;
  const title = issue.title.trim();

  if (title === "" || title.length > MAX_TITLE_LENGTH) {
    throw unusable(`${at} has a title this mirror cannot store`);
  }

  if (issue.body != null && issue.body.length > MAX_BODY_LENGTH) {
    throw unusable(`${at} has a body past ${String(MAX_BODY_LENGTH)} characters`);
  }

  const labels = labelNames(issue.labels);

  if (labels === undefined) {
    throw unusable(`${at} carries a label this mirror cannot store`);
  }

  const author = issue.user?.login.trim() ?? null;

  if (author !== null && (author === "" || author.length > MAX_AUTHOR_LENGTH)) {
    throw unusable(`${at} names an author this mirror cannot store`);
  }

  if (issue.html_url.length > MAX_URL_LENGTH || !HTTPS_URL.test(issue.html_url)) {
    throw unusable(`${at} has a URL that is not an https link`);
  }

  const repository = repoOf(issue.html_url);

  if (repository === undefined) {
    throw unusable(`${at} has a URL no repository can be read out of`);
  }

  const sourceCreatedAt = instant(issue.created_at);
  const sourceUpdatedAt = instant(issue.updated_at);

  if (sourceCreatedAt === undefined || sourceUpdatedAt === undefined) {
    throw unusable(`${at} carries a timestamp that is not a date`);
  }

  if (sourceUpdatedAt.getTime() < sourceCreatedAt.getTime()) {
    throw unusable(`${at} was updated before it was opened`);
  }

  return {
    // `485` and `#485` differ by one character, which is exactly why GitHub is the tracker
    // that hides this distinction. It is still two fields: `externalId` is what the API takes
    // and what the upsert keys on, `externalKey` is what a table cell renders.
    externalId: String(issue.number),
    externalKey: at,
    externalUrl: issue.html_url,
    title,
    // `null` means *the tracker did not say*, never `""`: an issue opened with no description
    // and one whose description is empty are different facts, and only one is possible here.
    body: issue.body ?? null,
    // GitHub's two words are V030's two words, so this collapse is an identity — the providers
    // whose workflow states are richer than two are the ones that have a decision to make.
    state: issue.state,
    labels,
    author,
    sourceCreatedAt,
    sourceUpdatedAt,
    // Namespaced by kind, per §3 of `docs/TICKET_SOURCES.md`: nothing enforces it, and it is
    // what keeps a later per-kind filter from colliding with another provider's key.
    meta: { github: repository },
  };
}

/**
 * Read the owner and repository out of an issue's `html_url`.
 *
 * Works for `github.com` and for a GitHub Enterprise Server host, because both spell the path
 * the same way. Deliberately not derived from `repository_url`, which is absent from some
 * payload shapes GitHub serves.
 *
 * @param htmlUrl - The issue's link, already known to be an https URL.
 * @returns The repository, or undefined when the path is not an issue's.
 */
export function repoOf(htmlUrl: string): GithubRepoRef | undefined {
  let path: string[];

  try {
    path = new URL(htmlUrl).pathname.split("/").filter((segment) => segment !== "");
  } catch {
    return undefined;
  }

  const [owner, repo, collection] = path;

  if (owner === undefined || repo === undefined || collection !== "issues") {
    return undefined;
  }

  return { owner, repo };
}

/**
 * The names of an issue's labels, or undefined when the set cannot be stored.
 *
 * GitHub serves labels as objects and — on a webhook payload — sometimes as bare strings;
 * {@link githubIssuePayload} accepts both, and this is where the two become one list.
 *
 * @param labels - What the payload carried.
 * @returns The names in order, or undefined when there are too many, one is unnamed, or one is
 *   longer than `tickets_labels_shape` permits.
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

    if (name === undefined || name === "" || name.length > MAX_LABEL_LENGTH) {
      return undefined;
    }

    names.push(name);
  }

  return names;
}

/**
 * One timestamp, parsed.
 *
 * Separate from `cursorInstant`, which the cursor helpers own: these two values are the
 * tracker's stamps on a ticket rather than a watermark, and a helper named for one used on the
 * other is the kind of reuse that reads as a mistake a year later.
 *
 * @param value - What the payload carried.
 * @returns The instant, or undefined when the string is not a date.
 */
function instant(value: string): Date | undefined {
  const at = new Date(value);

  return Number.isNaN(at.getTime()) ? undefined : at;
}

/**
 * The one error this file throws.
 *
 * `upstream` for every case, which is what the SPI asks of `mapTicket`: the payload came from
 * the tracker, so a payload this mapper cannot read is the tracker answering in a way this
 * build does not understand.
 *
 * @param detail - What could not be represented, in words for a log. Never a field's value —
 *   an issue body is somebody's text and a log is not where it belongs.
 * @returns The error to throw.
 */
function unusable(detail: string): TicketSourceError {
  return new TicketSourceError("upstream", detail);
}
