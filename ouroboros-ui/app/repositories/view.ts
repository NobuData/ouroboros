import type { SyncStatus } from "@/app/api/backlog";
import type { components } from "@/app/api/schema";
import type { Enablement } from "@/app/api/enablement";
import { relativeAgo } from "@/app/format";
import type { TicketSource } from "@/app/api/sources";
import { githubSources, sourceRepos } from "@/app/get-started/view";

/**
 * Settings → Repositories: the words and the pure rules.
 *
 * Three things decide whether Ouroboros works in a repository, and before this tab they were
 * set on three screens: a **GitHub source** under Sources names it, its **switch** in Get
 * started turns it on, and the **backlog token** under Sources lets the Issues backlog scan it.
 * This tab draws all three in one place. Adding or editing a GitHub source turns its
 * repositories on (`app/api/repo-enablement.ts`); the switch here is how one is turned off, or
 * back on.
 */

export const REPOSITORIES_TITLE = "Repositories";

export const REPOSITORIES_SUBLINE =
  "The repositories Ouroboros works in, the ticket source that names each one, and whether " +
  "their issues are being scanned.";

export const LIST_LABEL = "Repositories, by GitHub account";

export const EMPTY_TITLE = "No repositories yet";

export const EMPTY_NOTE =
  "Repositories come from GitHub sources. Add a GitHub source under Sources and name its " +
  "repositories — they are turned on here as soon as it is saved.";

export const LIST_FAILED_TITLE = "The repositories could not be read";

export const ADD_SOURCE_LINK = "Open Sources";

/** A repository's switch, read-only below owner or admin. */
export const SWITCH_READ_ONLY = "Switching a repository on or off is for workspace owners and admins.";

/** A switch that cannot be turned on, because nothing reads the repository's tickets. */
export const SWITCH_NOT_COVERED =
  "No GitHub source names this repository. Add it to one under Sources to turn it on.";

export const SWITCH_FAILED = "That repository could not be switched.";

/** A switch while its write is out. */
export const SWITCHING = "Switching…";

export const NO_SOURCE = "No source";

export const SCANNING_TITLE = "Issue scanning";

export const SCAN_NOW = "Scan issues now";

export const SCAN_RUNNING = "Scanning…";

export const SCAN_FAILED = "The scan could not be started.";

export const SCAN_READ_ONLY = "Starting a scan is for workspace owners, admins and members.";

export const TOKEN_MISSING =
  "No backlog token is set, so no repository's issues are being scanned. Set one under Sources.";

export const TOKEN_SET =
  "Issues are read with the backlog token set under Sources, for every repository switched on " +
  "below.";

export const STATUS_UNREAD = "The scanning status could not be read.";

/** One repository, as the tab draws it. */
export interface RepositoryRow {
  /** `owner/name`, lower-cased — the key the actions take. */
  readonly repo: string;
  /** Its name as recorded, or as the source spells it when it is not recorded yet. */
  readonly name: string;
  /** Whether the repository and its account are both on — the rule every reader applies. */
  readonly enabled: boolean;
  /** The headings of the GitHub sources that name it. Empty when none does. */
  readonly sources: readonly string[];
}

/** One GitHub account and its repositories. */
export interface RepositoryGroup {
  /** The account's login, as recorded or as a source spells it. */
  readonly login: string;
  readonly repos: readonly RepositoryRow[];
}

/**
 * Every repository the workspace has recorded or a GitHub source names, by account.
 *
 * A repository a source names but the mirror has not recorded is drawn off, so a source whose
 * repositories could not be turned on still shows what it names. A recorded repository no
 * source names is drawn too: it may still be on, and switching it off is the way out.
 *
 * @param enablement The workspace's accounts and repositories.
 * @param sources The workspace's ticket sources.
 * @returns The accounts in the order the service listed them, then accounts only a source
 *   names; repositories likewise.
 */
export function repositoryGroups(
  enablement: Enablement,
  sources: readonly TicketSource[],
): RepositoryGroup[] {
  const naming = new Map<string, string[]>();
  const named: { login: string; name: string }[] = [];

  for (const source of githubSources(sources)) {
    const read = sourceRepos(source);
    if (read === null) continue;

    for (const name of read.repos) {
      const repo = `${read.login}/${name}`;
      const headings = naming.get(repo);
      if (headings === undefined) {
        naming.set(repo, [source.displayName]);
        named.push({ login: read.login, name });
      } else if (!headings.includes(source.displayName)) {
        headings.push(source.displayName);
      }
    }
  }

  const groups = new Map<string, { login: string; repos: RepositoryRow[] }>();
  const seen = new Set<string>();

  const groupFor = (login: string) => {
    const key = login.toLowerCase();
    let group = groups.get(key);
    if (group === undefined) {
      group = { login, repos: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const { org, repos } of enablement.orgs) {
    const group = groupFor(org.login);

    for (const one of repos) {
      const repo = `${org.login}/${one.name}`.toLowerCase();
      seen.add(repo);
      group.repos.push({
        repo,
        name: one.name,
        enabled: org.enabled && one.enabled,
        sources: naming.get(repo) ?? [],
      });
    }
  }

  for (const { login, name } of named) {
    const repo = `${login}/${name}`;
    if (seen.has(repo)) continue;
    groupFor(login).repos.push({ repo, name, enabled: false, sources: naming.get(repo) ?? [] });
  }

  return [...groups.values()].filter((group) => group.repos.length > 0);
}

/**
 * Why a repository's switch cannot be pressed, or `undefined` when it can.
 *
 * @param row The repository.
 * @param mayAdminister Whether the reader is an Owner or Admin.
 * @returns The reason, in words.
 */
export function switchReason(row: RepositoryRow, mayAdminister: boolean): string | undefined {
  if (!mayAdminister) return SWITCH_READ_ONLY;
  if (!row.enabled && row.sources.length === 0) return SWITCH_NOT_COVERED;
  return undefined;
}

/**
 * The scanning card's status line.
 *
 * @param status What the backlog sync reports.
 * @param syncedAgo `status.syncedAt` in words, when there is one.
 * @returns One sentence, or `null` when the missing-token warning already says it.
 */
export function scanningLine(status: SyncStatus, syncedAgo: string | null): string | null {
  if (status.running) return "A scan is running now.";
  // No token is the card's own warning line; the service's sentence would say it twice.
  if (status.pause === "not_configured") return null;
  if (status.state === "paused") return status.message ?? "Scanning is paused.";
  if (syncedAgo === null) return "Scanning — the first pass has not finished yet.";
  return `Scanning — the least recently read repository was read ${syncedAgo}.`;
}

/** One repository's scanning state, as the backlog sync reports it. */
export type RepositoryScan = components["schemas"]["RepositorySyncStatus"];

export const NOT_SCANNED = "Not scanned while off";

export const FIRST_SCAN_PENDING = "Waiting for its first scan";

/**
 * Why one repository is not being scanned, in a phrase short enough for a row. The workspace's
 * own sentence is on the Issue scanning card above the list; repeating it on every row would
 * bury the one reason that is the repository's own.
 */
export const PAUSE_PHRASES: Readonly<Record<NonNullable<RepositoryScan["pause"]>, string>> = {
  not_configured: "Not scanned — no backlog token",
  unauthorized: "Not scanned — the backlog token was refused",
  not_found: "Not scanned — GitHub cannot find it with the backlog token",
  rate_limited: "Waiting out GitHub's rate limit",
  upstream_error: "GitHub did not answer the last scan",
  no_repositories: "Not scanned",
};

/**
 * The scanning reports, by repository — `owner/name`, lower-cased, the rows' own key.
 *
 * @param status What the backlog sync reports.
 * @returns The map.
 */
export function scansByRepo(status: SyncStatus): Map<string, RepositoryScan> {
  return new Map(status.repositories.map((one) => [one.repository.toLowerCase(), one]));
}

/**
 * What a row says about its issues being scanned.
 *
 * @param enabled Whether the repository is switched on — only those are scanned.
 * @param scan Its report, when the sync has one.
 * @param now The instant the page was read.
 * @returns One short phrase.
 */
export function repoScanLine(
  enabled: boolean,
  scan: RepositoryScan | undefined,
  now: Date,
): string {
  if (!enabled) return NOT_SCANNED;
  if (scan === undefined) return FIRST_SCAN_PENDING;
  if (scan.state === "paused") {
    return scan.pause === null ? (scan.message ?? "Scanning is paused.") : PAUSE_PHRASES[scan.pause];
  }
  if (scan.syncedAt === null) return FIRST_SCAN_PENDING;
  return `Issues read ${relativeAgo(scan.syncedAt, now)}`;
}
