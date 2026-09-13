/**
 * The `github` kind's `ticket_sources.config` grammar.
 *
 * Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)). The column arrives as
 * `unknown` on purpose — decision **P6**, and V030's own note that *"the per-kind grammar
 * belongs to the provider that reads it, and a type spelled here would be GitHub's grammar
 * under a neutral name"*. This file is that grammar, in the one module entitled to hold it.
 *
 * ```
 * { "login": "acme-robotics",
 *   "repos": ["helios-firmware", "helios-console"] }
 * ```
 *
 * Two keys, and they are the two
 * [`R__dev_seed_sources.sql`](../../../../../ouroboros-db/migrations/R__dev_seed_sources.sql)
 * already writes — the seed is the contract here rather than an example of it, because a
 * development database that Q.4's settings surface cannot read would be a grammar with two
 * authors. `repos` is also the **enabled-repo scoping** the issue asks for: the list lives in
 * `config` rather than in a join table because, as that seed says, *"it is one provider's idea
 * of scope, and a `jira` row two lines down has nothing to put in such a table"*.
 *
 * ---------------------------------------------------------------------------
 * **Why the names are validated rather than passed through.**
 *
 * Both reach `GET /repos/{owner}/{repo}` as path parameters. A value containing `/` or `..`
 * would address a different resource than the one somebody configured, and the cheapest place
 * to refuse that is before a request exists. The two patterns below are GitHub's own rules for
 * a login and a repository name, which is also what makes a typo a `not_found` a person can
 * read rather than a `404` from a URL nobody meant to build.
 */

import { z } from "zod";

import { TicketSourceError } from "../ticket-source.errors";

/**
 * GitHub's rule for an account name: alphanumeric with single internal hyphens, ≤ 39
 * characters.
 *
 * Anchored, so a value that merely *contains* a legal login is refused.
 */
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;

/**
 * GitHub's rule for a repository name: letters, digits, and the three separators it allows.
 *
 * `.` is in the set — `.github` and `docs.example.com` are both real repository names — and a
 * name of exactly `.` or `..` is refused below, because those two are the ones that would
 * traverse rather than address.
 */
export const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * How many repositories one source may enable.
 *
 * A bound rather than a policy: {@link GithubTicketSourceProvider.validateConfig} probes every
 * name in the list, so an unbounded list is an unbounded **Test connection** round-trip, and a
 * sync's page budget is divided across the list so an unbounded one divides to nothing. Fifty
 * is past what a workspace plausibly enables and far below either of those cliffs.
 */
export const MAX_ENABLED_REPOS = 50;

/** The `github` kind's settings, parsed. */
export interface GithubSourceConfig {
  /** The account the repositories belong to — an organization or a user. */
  readonly login: string;
  /**
   * The enabled repositories, by name alone.
   *
   * Non-empty, de-duplicated, and in the order somebody listed them: a sync walks them in this
   * order and divides its page budget across them, so the order is observable and preserving it
   * costs nothing.
   */
  readonly repos: readonly string[];
}

/**
 * The shape, before the rules that are easier to state than to spell as a schema.
 *
 * Deliberately not `.strict()`: a key this build does not know is a source configured by a
 * later version of this provider, and refusing the whole row for it would make a rollback
 * delete a workspace's intake.
 */
const githubConfigShape = z.object({
  login: z.string(),
  repos: z.array(z.string()),
});

/**
 * Read a `github` source's configuration.
 *
 * @param config - `ticket_sources.config`, as the loop handed it over: parsed JSON of no known
 *   shape.
 * @returns The settings, with the repository list de-duplicated.
 * @throws {TicketSourceError} `not_found`, when the object is not this grammar. That class
 *   rather than a fifth one, because §4 of `docs/TICKET_SOURCES.md` gives the reason the
 *   taxonomy has no `config` member: *"a base URL pointing at a web page produces the same
 *   `404` as a mistyped project key, and the row cannot tell them apart"*. What can tell them
 *   apart is {@link GithubTicketSourceProvider.validateConfig}, which catches this and answers
 *   a form rather than a status column.
 */
export function readGithubConfig(config: unknown): GithubSourceConfig {
  const parsed = githubConfigShape.safeParse(config);

  if (!parsed.success) {
    throw refuse(`config is not a GitHub source's settings: ${reasons(parsed.error)}`);
  }

  const { login, repos } = parsed.data;

  if (!GITHUB_LOGIN.test(login)) {
    throw refuse("config.login is not a GitHub account name");
  }

  if (repos.length === 0) {
    throw refuse("config.repos enables no repository, so this source has nothing to poll");
  }

  if (repos.length > MAX_ENABLED_REPOS) {
    throw refuse(
      `config.repos enables ${String(repos.length)} repositories, ` +
        `past the ${String(MAX_ENABLED_REPOS)} one source may hold`,
    );
  }

  for (const repo of repos) {
    if (!GITHUB_REPO.test(repo) || repo === "." || repo === "..") {
      throw refuse("config.repos names a repository GitHub could not have");
    }
  }

  return { login, repos: [...new Set(repos)] };
}

/**
 * The one error this file throws, so every refusal carries the same class and prefix.
 *
 * @param detail - What is wrong, in words for a log and for a form.
 * @returns The error to throw.
 */
function refuse(detail: string): TicketSourceError {
  return new TicketSourceError("not_found", detail);
}

/**
 * Flatten a schema failure into one line.
 *
 * @param error - What Zod reported.
 * @returns Every problem it found, `path message` joined by semicolons.
 */
function reasons(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
    .join("; ");
}
