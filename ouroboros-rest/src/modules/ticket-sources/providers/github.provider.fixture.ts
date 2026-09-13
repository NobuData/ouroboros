/**
 * Recorded GitHub payloads, and the pieces the provider's suites build a source out of.
 *
 * Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)). The shapes below are what
 * `GET /repos/{owner}/{repo}/issues` actually answers — including the `pull_request` key that
 * makes half of them pull requests — so a mapping assertion is an assertion about GitHub's JSON
 * rather than about a shape written to agree with the mapper.
 *
 * **The Octokit stand-in is K.3's** (`github/github.fixture.ts`). A second scriptable client
 * would be a second thing that can drift from `OctokitLike`, and the one that drifts is the one
 * that quietly stops exercising the pagination it was written for.
 *
 * **{@link SOURCE_TOKEN} is not a credential.** It is `ghp_` and thirty-six characters of
 * keyboard walk, at the length a classic personal access token has, so the secrecy suite has
 * something the rules would accept to look for and a grep of this repository finds nothing that
 * ever worked.
 */

import type { OctokitLike, OctokitResponseLike } from "../../github/github.client";
import type { OctokitFactory } from "../../github/github.client.factory";
import { httpError, response } from "../../github/github.fixture";
import type { TicketSyncContext } from "../ticket-source.provider";

/** The workspace the provider's suites act in. */
export const SOURCE_WORKSPACE = "org-sources";

/** The source row they act on — `ticket_sources.id`. */
export const SOURCE_ID = "b0390000-0000-0000-0000-00000000000a";

/** The PAT a source was configured with, and worth nothing. */
export const SOURCE_TOKEN = "ghp_mnbvcxzlkjhgfdsapoiuytrewq9876543210";

/** The account the seeded repositories belong to. */
export const SOURCE_LOGIN = "acme-robotics";

/** The repository most cases poll. */
export const SOURCE_REPO = "helios-firmware";

/** `config`, as `R__dev_seed_sources.sql` writes it for the `github` kind. */
export const SOURCE_CONFIG = { login: SOURCE_LOGIN, repos: [SOURCE_REPO] };

/**
 * The sync context the loop would hand over.
 *
 * @param overrides - What this case needs different — usually `config` or `credentials`.
 * @returns The context.
 */
export function syncContext(overrides: Partial<TicketSyncContext> = {}): TicketSyncContext {
  return {
    sourceId: SOURCE_ID,
    organizationId: SOURCE_WORKSPACE,
    config: SOURCE_CONFIG,
    credentials: SOURCE_TOKEN,
    ...overrides,
  };
}

/** What an issue payload may override. */
export interface IssueOverrides {
  /** The issue number, which is both halves of the identity. */
  readonly number?: number;
  /** `open` or `closed`. */
  readonly state?: string;
  /** When the tracker last touched it, ISO-8601. */
  readonly updated_at?: string;
  /** When it was opened, ISO-8601. */
  readonly created_at?: string;
  /** The title. */
  readonly title?: string;
  /** The body, or null for an issue opened with no description. */
  readonly body?: string | null;
  /** The labels, as GitHub's objects. */
  readonly labels?: readonly { name: string }[];
  /** The author, or null for a deleted account. */
  readonly user?: { login: string } | null;
  /** The repository the link points into. */
  readonly repo?: string;
}

/**
 * One issue, as GitHub serves it.
 *
 * @param overrides - What this case needs different.
 * @returns The payload. Deliberately a plain object rather than a typed one: the mapper takes
 *   `unknown`, and a fixture that handed it a type would be testing the type.
 */
export function issuePayload(overrides: IssueOverrides = {}): Record<string, unknown> {
  const number = overrides.number ?? 485;
  const repo = overrides.repo ?? SOURCE_REPO;

  return {
    number,
    title: overrides.title ?? "Watchdog timer resets during I2C bus recovery",
    body:
      overrides.body === undefined
        ? "The watchdog fires while the bus is recovered."
        : overrides.body,
    state: overrides.state ?? "open",
    labels: overrides.labels ?? [{ name: "bug" }, { name: "i2c" }],
    user: overrides.user === undefined ? { login: "field-support" } : overrides.user,
    created_at: overrides.created_at ?? "2026-09-10T09:00:00Z",
    updated_at: overrides.updated_at ?? "2026-09-11T09:00:00Z",
    html_url: `https://github.com/${SOURCE_LOGIN}/${repo}/issues/${String(number)}`,
    repository_url: `https://api.github.com/repos/${SOURCE_LOGIN}/${repo}`,
  };
}

/**
 * One **pull request**, as the issues endpoint serves it.
 *
 * The endpoint returns both, and the only discriminator is the presence of `pull_request` —
 * there is no type field to read. That is the whole reason this fixture exists: *"a PR in the
 * backlog is a bug users see immediately"*.
 *
 * @param overrides - What this case needs different.
 * @returns The payload, identical to an issue's but for the extra key.
 */
export function pullRequestPayload(overrides: IssueOverrides = {}): Record<string, unknown> {
  const number = overrides.number ?? 486;
  const repo = overrides.repo ?? SOURCE_REPO;

  return {
    ...issuePayload({ ...overrides, number }),
    title: overrides.title ?? "Guard the I2C recovery path with a watchdog kick",
    html_url: `https://github.com/${SOURCE_LOGIN}/${repo}/pull/${String(number)}`,
    pull_request: {
      url: `https://api.github.com/repos/${SOURCE_LOGIN}/${repo}/pulls/${String(number)}`,
      html_url: `https://github.com/${SOURCE_LOGIN}/${repo}/pull/${String(number)}`,
    },
  };
}

/**
 * A run of issues, numbered and stamped in ascending `updated_at` order.
 *
 * Ascending because that is the order the provider asks GitHub for and the order its cursor
 * depends on — a fixture that produced them in any other order would let a watermark bug pass.
 *
 * @param count - How many.
 * @param options - Where to start numbering, which repository, and the first stamp.
 * @returns The payloads.
 */
export function issueRun(
  count: number,
  options: { from?: number; repo?: string; since?: Date } = {},
): Record<string, unknown>[] {
  const from = options.from ?? 1;
  const since = options.since ?? new Date("2026-09-01T00:00:00.000Z");

  return Array.from({ length: count }, (_unused, index) =>
    issuePayload({
      number: from + index,
      repo: options.repo,
      created_at: since.toISOString(),
      updated_at: new Date(since.getTime() + index * 60_000).toISOString(),
    }),
  );
}

/**
 * What a scripted GitHub answers, per repository.
 *
 * Keyed by repository because the provider walks several in one call and each gets its **own**
 * page iterator. K.3's `fakeOctokit` answers one flat script in order, which is right for a
 * client's suite and wrong here: the first repository's walk would drain the answers meant for
 * the second, and every multi-repository assertion would pass for the wrong reason.
 */
export interface OctokitScript {
  /**
   * What `GET /repos/{owner}/{repo}` says about each repository — `true` for *visible*, an
   * error for a refusal. A repository absent from the map answers `404`, which is what GitHub
   * does for one that does not exist and for one a token cannot see.
   */
  readonly repos?: Readonly<Record<string, true | Error>>;
  /** The issue pages each repository serves, in order. A repository absent serves one empty page. */
  readonly issues?: Readonly<Record<string, readonly (readonly unknown[])[]>>;
  /** An error a repository's walk throws instead of serving pages. */
  readonly issuesFail?: Readonly<Record<string, Error>>;
  /** Headers every response carries — `budgetHeaders` builds the rate ones. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** A scripted GitHub, and a record of every request it was asked for. */
export interface ScriptedOctokit extends OctokitLike {
  /** Every `(route, params)` pair, one entry per HTTP request — so a page is a call. */
  readonly calls: { route: string; params: Readonly<Record<string, unknown>> }[];
}

/**
 * A stand-in for GitHub that answers per repository.
 *
 * @param script - What each repository says.
 * @returns The stand-in.
 */
export function scriptedOctokit(script: OctokitScript = {}): ScriptedOctokit {
  const calls: { route: string; params: Readonly<Record<string, unknown>> }[] = [];
  const headers = script.headers ?? {};

  return {
    calls,
    request(route, params = {}) {
      calls.push({ route, params });

      const repo = repoOf(params);
      const scripted = script.repos?.[repo];

      if (scripted instanceof Error) {
        return Promise.reject(scripted);
      }

      if (scripted === undefined) {
        return Promise.reject(httpError(404));
      }

      return Promise.resolve(response({ full_name: `${String(params.owner)}/${repo}` }, headers));
    },
    paginate: {
      iterator(route, params = {}) {
        const repo = repoOf(params);

        // A generator rather than an array, so a provider that stops reading — because its
        // share of the page budget is spent — stops the walk, and the call count says so.
        const walk = async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
          const fails = script.issuesFail?.[repo];

          if (fails !== undefined) {
            calls.push({ route, params });

            throw fails;
          }

          for (const page of script.issues?.[repo] ?? [[]]) {
            calls.push({ route, params });

            yield await Promise.resolve(response(page, headers));
          }
        };

        return { [Symbol.asyncIterator]: walk };
      },
    },
  };
}

/**
 * Which repository a request's parameters name.
 *
 * The parameters are `Record<string, unknown>` — the shape `OctokitLike` declares, because a
 * route's parameters are the route's business — so the narrowing happens here rather than at
 * two call sites.
 *
 * @param params - What the provider sent.
 * @returns The repository name, or the empty string when there is none.
 */
function repoOf(params: Readonly<Record<string, unknown>>): string {
  return typeof params.repo === "string" ? params.repo : "";
}

/** An Octokit factory, and every token it was asked to build a client for. */
export interface RecordingFactory {
  /** What the provider injects. */
  readonly factory: OctokitFactory;
  /** Every token handed to it, in order — what the secrecy suite looks for elsewhere. */
  readonly tokens: string[];
}

/**
 * Bind one scripted GitHub behind K.3's injectable seam.
 *
 * @param octokit - What every call should reach.
 * @returns The factory and its record.
 */
export function recordingFactory(octokit: OctokitLike): RecordingFactory {
  const tokens: string[] = [];

  return {
    tokens,
    factory: (token: string): OctokitLike => {
      tokens.push(token);

      return octokit;
    },
  };
}
