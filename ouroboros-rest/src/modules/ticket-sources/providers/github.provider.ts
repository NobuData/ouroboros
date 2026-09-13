/**
 * `GithubTicketSourceProvider` — the first conforming plugin behind the Q.2 SPI.
 *
 * Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)), decision **P5**.
 *
 * ```
 * validateConfig  ─▶ token + repo access probe          → settings "test connection"
 * fullSync        ─▶ paginate all open issues           → PRs filtered out
 * incrementalSync ─▶ issues?since=cursor&state=all      → { tickets[], nextCursor }
 * mapTicket       ─▶ #485 → { externalId: "485", externalKey: "#485", … }
 * errors          ─▶ rate limit → "rate limited until 14:20 UTC" (honest)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why this ticket exists at all, in the issue's own words.** *"An SPI with one hypothetical
 * implementation proves nothing."* Everything below is behaviour K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) and K.4
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)) already ship — and none of it is
 * special-cased in core: the sync loop calls four members it would call on a Jira provider, and
 * `ticket-sources.module.ts` is the only file outside this directory that knows the class
 * exists.
 *
 * **The one place the issue's filing-time note has been overtaken.** It was written on
 * 2026-08-09 expecting K.3 and K.4 to be unbuilt, and planned to implement their behaviour
 * SPI-first. Both shipped in the meantime, so this provider *reuses* them instead of
 * reimplementing them: `GithubClient` is K.3's paginating, rate-guarded, error-classifying
 * client, and `github.mapping.ts` imports K.4's payload contract. What that leaves this file is
 * the part that is genuinely new — the canonical model, the cursor, and the error taxonomy.
 * The cut-over of the *shipped* intake (`github_issues` → `tickets`, and the estimation
 * pipeline with it) is a migration in `ouroboros-db`, which this issue's **Affected systems**
 * does not name; it stays where V030's header put it, and `LoggingTicketIntake` still says so
 * out loud.
 *
 * ---------------------------------------------------------------------------
 * **No `@octokit/*` import appears here, and that is the boundary rather than an oversight.**
 *
 * `.dependency-cruiser.cjs`'s `no-octokit-outside-the-seam` permits the library in exactly one
 * file — `github/github.octokit.ts` — and that includes this directory. So the provider takes
 * {@link OCTOKIT_FACTORY}, the injectable seam K.3 cut, and is written against `OctokitLike`
 * like everything else downstream of it. `ticket-sources/boundary.spec.ts` watches the rule
 * fail on a tree that puts the import here.
 *
 * ---------------------------------------------------------------------------
 * **The credential is never held.** It arrives on {@link TicketSyncContext.credentials}, is
 * handed to the seam, and the reference dies with the call. Nothing here keeps it in a field —
 * a provider is a singleton, and a singleton with a token in it holds one across every request
 * the process serves — and nothing here puts it, or anything derived from it, in a log line or
 * in a `detail`. `github.provider.secrecy.spec.ts` is that sentence as a test.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { GithubClient, type OctokitLike } from "../../github/github.client";
import { OCTOKIT_FACTORY, type OctokitFactory } from "../../github/github.client.factory";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { GithubRateLimiter, REMAINING_HEADER } from "../../github/github.rate-limit";
import { LEGACY_TOKEN, TOKEN_PREFIXES } from "../../github/github.token";
import { chunked } from "../../scheduling/cadence";
import { TicketSourceError, classifyHttpStatus } from "../ticket-source.errors";
import type {
  CanonicalTicket,
  TicketPage,
  TicketSourceCapabilities,
  TicketSourceProvider,
  TicketSourceValidation,
  TicketSyncContext,
} from "../ticket-source.provider";
import { readGithubConfig, type GithubSourceConfig } from "./github.config";
import {
  ISSUES_ROUTE,
  cursorInstant,
  cursorOf,
  isPullRequest,
  mapGithubIssue,
} from "./github.mapping";

/**
 * The Nest token the provider's rate guard is bound under.
 *
 * A **second** `GithubRateLimiter` instance, deliberately not `GithubModule`'s. The two guards
 * watch two different tokens: `GithubModule`'s is the workspace's settings PAT, which K.4's
 * backlog poller spends and which M.4's `/api/v1/backlog/sync-status` reads to explain a pause;
 * this one is whatever credential a *source* was configured with. Sharing them would let a
 * ticket source's exhausted budget make the backlog page say `rate_limited` about a token that
 * is fine — a pause reported for the wrong reason is worse than no pause at all.
 */
export const GITHUB_SOURCE_BUDGET = "GITHUB_SOURCE_BUDGET";

/**
 * How the token above is bound, as a provider `ticket-sources.module.ts` can spread.
 *
 * Declared here rather than in the module so that `GithubRateLimiter` — a file under
 * `src/modules/github/` — is named by the provider that needs it rather than by the
 * registration point, which should only have to know a class and a token.
 */
export const GITHUB_SOURCE_BUDGET_PROVIDER = {
  provide: GITHUB_SOURCE_BUDGET,
  useFactory: (): GithubRateLimiter => new GithubRateLimiter(),
};

/** What a repository probe asks for, for `validateConfig`. */
export const REPO_ROUTE = "GET /repos/{owner}/{repo}";

/**
 * The most canonical tickets one sync may answer with.
 *
 * K.4's `MAX_ISSUES_PER_POLL`, and the same number for the same reason: the loop writes a page
 * in **one transaction**, so a page is as large as a transaction should be. What differs is how
 * it is spent — see {@link budgetPerRepo}.
 */
export const MAX_TICKETS_PER_SYNC = 500;

/** How many repositories `validateConfig` probes at once. K.4's `REPO_CONCURRENCY`. */
export const VALIDATION_CONCURRENCY = 3;

/** What one repository's walk produced, and how far it got. */
export interface RepoWalk {
  /** The usable, non-pull-request tickets, ascending by {@link CanonicalTicket.sourceUpdatedAt}. */
  readonly tickets: readonly CanonicalTicket[];
  /**
   * Whether the repository had more to give than this walk's share.
   *
   * True only when a further usable ticket actually existed — never merely because the share was
   * filled exactly — so `hasMore` books another cycle for work rather than for a check.
   */
  readonly capped: boolean;
  /**
   * The last instant this walk is known to have seen everything up to.
   *
   * The `sourceUpdatedAt` of the last ticket it collected, or null when it collected none.
   */
  readonly frontier: Date | null;
}

/**
 * The GitHub provider.
 *
 * Stateless by construction: every member takes what it needs as an argument, and the two
 * fields are an injected factory and an injected guard. See this file's header on why the
 * credential is not among them.
 */
@Injectable()
export class GithubTicketSourceProvider implements TicketSourceProvider {
  /** V030's `ticket_sources.kind` value this provider answers for. */
  readonly kind = "github" as const;

  /** Where a payload this provider had to skip is reported. Never a credential — see the header. */
  private readonly logger = new Logger(GithubTicketSourceProvider.name);

  /**
   * @param octokit - K.3's injectable seam: the one way a client is built, and the reason no
   *   file here names the library.
   * @param budget - The rate guard, per {@link GITHUB_SOURCE_BUDGET}.
   */
  constructor(
    @Inject(OCTOKIT_FACTORY) private readonly octokit: OctokitFactory,
    @Inject(GITHUB_SOURCE_BUDGET) private readonly budget: GithubRateLimiter,
  ) {}

  /**
   * What this provider can do.
   *
   * @returns Labels yes — GitHub has them, so an empty chip-set means *nothing matched* rather
   *   than *no such concept*. Webhooks no: a delivery endpoint is Q.4's
   *   ([#141](https://github.com/NobuData/ouroboros/issues/141)) and the registry refuses a flag
   *   that disagrees with the member, so claiming it here would fail at boot. Bidirectional
   *   writes are reserved across the whole SPI.
   */
  capabilities(): TicketSourceCapabilities {
    return { webhooks: false, labels: true, bidirectionalWrites: false };
  }

  /**
   * Check a configuration and a token against GitHub — Q.4's **Test connection**.
   *
   * A real round-trip rather than a shape check: one `GET /repos/{owner}/{repo}` per enabled
   * repository, which is the question somebody pressing the button is actually asking — *can
   * this token see these repositories?* A token that is valid but cannot see a repository fails
   * here rather than at the first poll.
   *
   * @param config - The settings, in this provider's grammar. See `github.config.ts`.
   * @param credentials - The personal access token, or null while a source has none.
   * @returns What the probe found. **Never rejects**: a bad config, a refusal, a timeout and a
   *   closed socket are all results, because a form's error state must not depend on whether a
   *   caller remembered a `try`. That is why `readGithubConfig`'s throw is caught here rather
   *   than being allowed out.
   */
  async validateConfig(
    config: unknown,
    credentials: string | null,
  ): Promise<TicketSourceValidation> {
    let settings: GithubSourceConfig;

    try {
      settings = readGithubConfig(config);
    } catch (error) {
      return asValidationFailure(error);
    }

    const token = credentials === null ? "" : credentials.trim();

    if (token === "") {
      return {
        status: "failed",
        errorClass: "auth",
        detail: "this source has no GitHub token; add one so Ouroboros can read its backlog",
      };
    }

    // A bare `OctokitLike` rather than a `GithubClient`: there is no source row yet, so there is
    // no budget to attribute these calls to, and a guard keyed on nothing would be a guard that
    // either refused the next caller or learned nothing. One probe per repository, unretried.
    const octokit = this.octokit(token);

    for (const batch of chunked(settings.repos, VALIDATION_CONCURRENCY)) {
      const probed = await Promise.all(
        batch.map(async (repo) => probeRepo(octokit, settings.login, repo)),
      );
      const refused = probed.find((outcome) => outcome !== null);

      if (refused !== undefined && refused !== null) {
        return { status: "failed", errorClass: refused.errorClass, detail: refused.detail };
      }
    }

    const count = settings.repos.length;

    return {
      status: "ok",
      detail: `${settings.login} · ${String(count)} ${count === 1 ? "repository" : "repositories"}`,
    };
  }

  /**
   * Every open issue in the enabled repositories, from the beginning.
   *
   * `state=open`, which is this provider exercising the entitlement the SPI grants: *"a cold
   * import that dragged in a decade of closed issues would be a first sync nobody wants"*. What
   * a backlog holds is what is open.
   *
   * @param context - The source, opened.
   * @returns One page. {@link TicketPage.hasMore} is true while any repository had more to give.
   * @throws {TicketSourceError} When GitHub could not be asked or refused.
   */
  fullSync(context: TicketSyncContext): Promise<TicketPage> {
    return this.walk(context, undefined);
  }

  /**
   * Everything that has changed since a cursor.
   *
   * `state=all` rather than `state=open`, and that is the whole of how a close reaches the
   * mirror: an issue that was closed upstream stops being listed by `state=open`, and *"a ticket
   * that simply stops being listed sits in the mirror as open forever"*. With `all`, the close
   * arrives as the `state` change it is.
   *
   * @param context - The source, opened.
   * @param cursor - Exactly what this provider last returned: an ISO-8601 instant, handed to
   *   GitHub as `since`. A value that will not parse is treated as no cursor, so a corrupted
   *   watermark costs one wide poll rather than every subsequent one.
   * @returns One page.
   * @throws {TicketSourceError} When GitHub could not be asked or refused.
   */
  incrementalSync(context: TicketSyncContext, cursor: string): Promise<TicketPage> {
    return this.walk(context, cursorInstant(cursor));
  }

  /**
   * One issue payload, as a canonical ticket.
   *
   * @param raw - Whatever the issues endpoint returned for one element.
   * @returns The canonical row.
   * @throws {TicketSourceError} `upstream`, when the payload cannot be represented — including
   *   when it is a pull request, which is not a ticket. See `github.mapping.ts`.
   */
  mapTicket(raw: unknown): CanonicalTicket {
    return mapGithubIssue(raw);
  }

  /**
   * Walk every enabled repository once and answer one page.
   *
   * @param context - The source, opened.
   * @param since - The watermark to resume from, or undefined for a full import.
   * @returns The page, ascending by `sourceUpdatedAt`, with the watermark {@link watermarkOf}
   *   computes and `hasMore` set from whether any repository was cut short.
   * @throws {TicketSourceError} When GitHub could not be asked or refused. A page is all or
   *   nothing: the loop writes one transaction, and half a page with a full watermark would be
   *   a mirror that had silently skipped the other half.
   */
  private async walk(context: TicketSyncContext, since: Date | undefined): Promise<TicketPage> {
    const settings = readGithubConfig(context.config);
    const client = new GithubClient(
      context.organizationId,
      this.octokit(tokenOf(context)),
      this.budget,
    );
    const share = budgetPerRepo(settings.repos.length);
    const walks: RepoWalk[] = [];

    for (const repo of settings.repos) {
      walks.push(await this.walkRepo(client, settings.login, repo, since, share));
    }

    const tickets = walks
      .flatMap((walk) => [...walk.tickets])
      .sort((left, right) => left.sourceUpdatedAt.getTime() - right.sourceUpdatedAt.getTime());

    return {
      tickets,
      nextCursor: watermarkOf(walks),
      hasMore: walks.some((walk) => walk.capped),
    };
  }

  /**
   * Walk one repository's issues until its share is spent or GitHub runs out of them.
   *
   * @param client - K.3's client, which owns the pagination, the rate budget and the
   *   classification of a refusal.
   * @param owner - The account from `config.login`.
   * @param repo - The repository from `config.repos`.
   * @param since - The watermark, or undefined for a full import.
   * @param share - The most tickets this repository may contribute to the page.
   * @returns What it collected, and whether it stopped early.
   * @throws {TicketSourceError} When GitHub could not be asked or refused.
   *
   * No ETag is sent, which `GithubClient` would happily carry. There is nowhere to keep one:
   * the SPI stores a single opaque cursor per *source*, and a conditional request needs one
   * per repository per route. `since` is the cheaper guard anyway — a `304` and an empty array
   * both cost one request, and only the array can also say *nothing changed here but something
   * did over there*.
   */
  private async walkRepo(
    client: GithubClient,
    owner: string,
    repo: string,
    since: Date | undefined,
    share: number,
  ): Promise<RepoWalk> {
    const tickets: CanonicalTicket[] = [];
    let capped = false;

    try {
      for await (const page of client.pages<unknown>(ISSUES_ROUTE, query(owner, repo, since))) {
        for (const raw of page.items) {
          // The endpoint answers issues *and* pull requests, and a PR in the backlog is a bug
          // users see immediately. Dropped before mapping rather than after, so it never
          // becomes a skip a person has to read a log line about.
          if (isPullRequest(raw)) {
            continue;
          }

          const ticket = this.read(raw, owner, repo);

          if (ticket === undefined) {
            continue;
          }

          if (tickets.length >= share) {
            capped = true;
            break;
          }

          tickets.push(ticket);
        }

        if (capped) {
          break;
        }
      }
    } catch (error) {
      throw asTicketSourceError(error);
    }

    return { tickets, capped, frontier: tickets.at(-1)?.sourceUpdatedAt ?? null };
  }

  /**
   * Map one payload, reporting rather than failing the page when it cannot be read.
   *
   * A single malformed issue must not cost a workspace its whole sync — the other ninety-nine
   * on the page are fine, and a mirror that refused all of them would be stuck until somebody
   * fixed a tracker they may not own. `mapTicket` still throws for the caller that asked about
   * one payload; this is the walk's policy, not the mapper's.
   *
   * @param raw - One element of a page.
   * @param owner - The account, for the log line.
   * @param repo - The repository, for the log line.
   * @returns The ticket, or undefined when it was skipped.
   */
  private read(raw: unknown, owner: string, repo: string): CanonicalTicket | undefined {
    try {
      return mapGithubIssue(raw);
    } catch (error) {
      this.logger.warn(
        `${owner}/${repo}: skipped one issue this mirror cannot store.`,
        describeForLog(error),
      );

      return undefined;
    }
  }
}

/**
 * How many tickets each repository may contribute to one page.
 *
 * The page budget is **divided** rather than being a running total, and that is what makes the
 * watermark below safe: every enabled repository is asked on every cycle, so no repository can
 * sit unvisited behind a cap that a busier one keeps filling. One repository gets the whole
 * budget; fifty get ten each.
 *
 * @param repos - How many repositories are enabled. Always at least one — `readGithubConfig`
 *   refuses an empty list.
 * @returns The per-repository share, never below one.
 */
export function budgetPerRepo(repos: number): number {
  return Math.max(1, Math.floor(MAX_TICKETS_PER_SYNC / Math.max(1, repos)));
}

/**
 * What the page's walks entitle this provider to store as the next cursor.
 *
 * **The rule is the weakest frontier, not the newest ticket**, and this is the part a
 * multi-repository source gets wrong if it is written the obvious way. Each repository is walked
 * from the same `since`, so a repository that was cut short has seen everything only up to its
 * own last ticket. Advancing to the newest instant across the page would put the watermark past
 * tickets in *that* repository that nobody has fetched — and `since` is how they would have been
 * found. So:
 *
 * * any repository cut short → the **earliest** frontier among those, which every repository is
 *   provably complete up to;
 * * none cut short → the newest instant on the page, because every repository is complete;
 * * nothing seen at all → `null`, which the loop reads as *"no watermark to record"* and which
 *   leaves the stored cursor alone. It is **not** a way to clear one.
 *
 * The cost is that a repository which finished may be re-walked from an earlier point next
 * cycle. That is re-reading, not re-writing: the loop compares field by field and issues no
 * statement when nothing differs.
 *
 * @param walks - One per enabled repository, in the order they were walked.
 * @returns The cursor to store, or null.
 */
export function watermarkOf(walks: readonly RepoWalk[]): string | null {
  const frontiers = walks
    .filter((walk) => walk.capped)
    .map((walk) => walk.frontier)
    .filter((frontier): frontier is Date => frontier !== null);

  if (frontiers.length > 0) {
    return cursorOf(new Date(Math.min(...frontiers.map((frontier) => frontier.getTime()))));
  }

  const seen = walks
    .flatMap((walk) => [...walk.tickets])
    .map((ticket) => ticket.sourceUpdatedAt.getTime());

  return seen.length === 0 ? null : cursorOf(new Date(Math.max(...seen)));
}

/**
 * The query one repository's walk sends.
 *
 * `sort=updated&direction=asc` is load-bearing rather than tidy: it is what makes a page's
 * tickets exactly the ones at or before the cursor it returns, which is what makes the next
 * page a continuation instead of a restart.
 *
 * @param owner - The account.
 * @param repo - The repository.
 * @param since - The watermark, or undefined for a full import.
 * @returns The parameters for `GET /repos/{owner}/{repo}/issues`.
 */
export function query(
  owner: string,
  repo: string,
  since: Date | undefined,
): Record<string, unknown> {
  return {
    owner,
    repo,
    // Open only on a cold import — a backlog is what is open. Everything once a cursor exists,
    // because a close is a change and `state=open` cannot express one.
    state: since === undefined ? "open" : "all",
    ...(since === undefined ? {} : { since: cursorOf(since) }),
    sort: "updated",
    direction: "asc",
  };
}

/**
 * The token for this sync, or a refusal.
 *
 * @param context - The source, opened.
 * @returns The credential, trimmed.
 * @throws {TicketSourceError} `auth`, when there is none. GitHub's issues endpoint will serve
 *   public repositories unauthenticated, and this provider still requires a token: an
 *   unauthenticated poller gets sixty requests an hour shared across the host, which is a source
 *   that fails unpredictably rather than one that says what is wrong.
 */
function tokenOf(context: TicketSyncContext): string {
  const token = context.credentials === null ? "" : context.credentials.trim();

  if (token === "") {
    throw new TicketSourceError("auth", "this source has no GitHub token");
  }

  return token;
}

/**
 * Ask GitHub whether a token can see one repository.
 *
 * @param octokit - A client built for the token being tested.
 * @param owner - The account.
 * @param repo - The repository.
 * @returns Null when the repository answered, or the class and the words for a form when it did
 *   not. Nothing GitHub said is echoed: a tracker's error body quotes request headers, and the
 *   shortest path to a leaked token is a provider that repeats one.
 */
async function probeRepo(
  octokit: OctokitLike,
  owner: string,
  repo: string,
): Promise<{ errorClass: TicketSourceError["errorClass"]; detail: string } | null> {
  try {
    await octokit.request(REPO_ROUTE, { owner, repo });

    return null;
  } catch (error) {
    const errorClass = classifyRefusal(error);

    return {
      errorClass,
      detail: `${owner}/${repo}: ${VALIDATION_DETAIL[errorClass]}`,
    };
  }
}

/** What a failed probe says about each class, in words a form renders. */
const VALIDATION_DETAIL: Readonly<Record<TicketSourceError["errorClass"], string>> = Object.freeze({
  auth: "GitHub rejected this token, or it is missing the repository scope",
  rate_limit: "this token's GitHub rate limit is spent; try again once it resets",
  not_found: "no such repository, or this token cannot see it",
  upstream: "GitHub did not answer",
});

/**
 * Which class a refusal to a *single* request belongs to.
 *
 * {@link classifyHttpStatus} does the general mapping, and there is exactly one status GitHub
 * reads differently: a `403` is `auth` for a token missing a scope and `rate_limit` when the
 * budget is spent, and the `x-ratelimit-remaining` header is the only thing that tells them
 * apart. K.3's client draws the same distinction on the sync path; this is it for the one call
 * that does not go through a client.
 *
 * @param error - Whatever the request rejected with.
 * @returns The class.
 */
function classifyRefusal(error: unknown): TicketSourceError["errorClass"] {
  const status = statusOf(error);

  if (status === undefined) {
    return "upstream";
  }

  if (status === 403 && headerOf(error, REMAINING_HEADER) === "0") {
    return "rate_limit";
  }

  return classifyHttpStatus(status);
}

/**
 * An HTTP status off an Octokit rejection, if it carried one.
 *
 * @param error - Whatever the request rejected with.
 * @returns The status, or undefined when the call failed before an answer.
 */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const { status } = error;

  return typeof status === "number" && status >= 300 ? status : undefined;
}

/**
 * One response header off an Octokit rejection.
 *
 * @param error - Whatever the request rejected with.
 * @param name - The header, lower-cased.
 * @returns Its value as a string, or undefined.
 */
function headerOf(error: unknown, name: string): string | undefined {
  const headers = (
    error as { response?: { headers?: Record<string, string | number | undefined> } }
  ).response?.headers;
  const value = headers?.[name];

  return value === undefined ? undefined : String(value);
}

/** What a redacted credential reads as in a `detail`. */
export const REDACTED = "[redacted]";

/**
 * Anything shaped like a GitHub token, in the middle of a sentence.
 *
 * K.3's `TOKEN_PREFIXES` and `LEGACY_TOKEN` rather than a second list — the grammar that
 * decides what may be *stored* is the grammar that decides what has to be *hidden*, and two
 * copies would mean a new prefix protected in one place only. Anchoring is deliberately dropped:
 * `isWellFormedToken` asks whether a whole string is a token, and this asks whether one is
 * buried in a message.
 */
const TOKEN_ANYWHERE = new RegExp(
  `(?:${TOKEN_PREFIXES.join("|")})[A-Za-z0-9_]+|\\b${LEGACY_TOKEN.source.replace(/^\^|\$$/g, "")}\\b`,
  "g",
);

/**
 * Remove anything token-shaped from a message before it becomes a `detail`.
 *
 * Q.3's last acceptance criterion is that *"credentials never appear in a response or a log
 * line"*, and this is the one place a message this module did not compose can reach one:
 * `GithubClient` describes a call that failed before an answer by quoting the underlying
 * error, and what that error says is a library's business. Nothing this provider writes
 * contains a token, so on every ordinary path this function returns its argument unchanged —
 * it is a net under the one rope it does not hold.
 *
 * @param detail - The words, as they arrived.
 * @returns The same words with any token-shaped run replaced by {@link REDACTED}.
 */
export function redactTokens(detail: string): string {
  return detail.replace(TOKEN_ANYWHERE, REDACTED);
}

/**
 * K.3's failure vocabulary, as the SPI's.
 *
 * Two taxonomies meet here and only here. `GithubApiError.failure` has five members because it
 * also names *"this workspace has no token"*, which is a state rather than a refusal;
 * `TicketSourceErrorClass` has four because §4 of `docs/TICKET_SOURCES.md` argues a tracker's
 * reader cannot act on more.
 *
 * @param error - Whatever a walk threw.
 * @param now - The clock, injectable for the suite that asserts the resume time.
 * @returns The error the loop will record. `detail` reaches a log; what reaches the column a
 *   settings page renders is composed from the class by `statusReasonFor`, so a `detail` cannot
 *   put a tracker's words on a screen.
 */
export function asTicketSourceError(error: unknown, now: Date = new Date()): TicketSourceError {
  if (TicketSourceError.is(error)) {
    return error;
  }

  if (!(error instanceof GithubApiError)) {
    return new TicketSourceError(
      "upstream",
      "the GitHub walk failed in a way it does not describe: " +
        redactTokens(error instanceof Error ? error.message : String(error)),
    );
  }

  const detail = redactTokens(error.detail);

  switch (error.failure) {
    case GITHUB_FAILURES.rateLimited:
      // The one piece of provider knowledge that reaches a person unchanged, because there is
      // no neutral way to say *when*. `statusReasonFor` turns it into `rate limited until
      // 14:20 UTC`, which is the honest source status this ticket asks for.
      return new TicketSourceError("rate_limit", detail, resumeAt(error, now));
    case GITHUB_FAILURES.unauthorized:
    case GITHUB_FAILURES.notConfigured:
      return new TicketSourceError("auth", detail);
    case GITHUB_FAILURES.notFound:
      return new TicketSourceError("not_found", detail);
    default:
      return new TicketSourceError("upstream", detail);
  }
}

/**
 * When a rate-limited source may be polled again.
 *
 * @param error - The rate-limit failure, which carries the guard's own wait.
 * @param now - The clock.
 * @returns The instant, or null when GitHub gave no wait to compute one from.
 */
function resumeAt(error: GithubApiError, now: Date): Date | null {
  return error.retryAfterSeconds === undefined
    ? null
    : new Date(now.getTime() + error.retryAfterSeconds * 1000);
}

/**
 * A thrown refusal, as the result `validateConfig` must answer with instead.
 *
 * @param error - What `readGithubConfig` threw.
 * @returns The failure, carrying the same class and the same words.
 */
function asValidationFailure(error: unknown): TicketSourceValidation {
  const failure = asTicketSourceError(error);

  return { status: "failed", errorClass: failure.errorClass, detail: failure.detail };
}
