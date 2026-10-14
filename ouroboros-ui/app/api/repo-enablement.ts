import "server-only";

import { detection } from "@/app/api/detection";
import { type Enablement, readEnablement } from "@/app/api/enablement";
import { orgs } from "@/app/api/orgs";
import { attempt } from "@/app/api/reading";
import { repos } from "@/app/api/repos";
import type { TicketSource } from "@/app/api/sources";
import { sourceRepos } from "@/app/get-started/view";

/**
 * Turning repositories on — the one write behind Get started's *Enable {repo} →*, its picker's
 * switch, and adding or editing a GitHub source under **Settings → Sources**.
 *
 * A repository is in scope when its own flag and its account's are both true, and the
 * repository picker, the Issues backlog sync and repository detection all read those flags.
 * Adding a GitHub source used to record only the source, so the repositories it named stayed
 * off — invisible to all three — until somebody found the switch in Get started. A source
 * names the repositories it reads, so storing one now turns those repositories on.
 *
 * Coverage is the caller's to check: Get started refuses a repository no source names before
 * it gets here, and the Sources actions pass the source itself.
 */

/**
 * Make both flags true for one repository, recording the account and the repository first
 * when the mirror does not hold them yet — the tenancy API's own upsert
 * (`PATCH …/repos/{name}` is *"also how one first comes to be known"*).
 *
 * @param tenantId The workspace.
 * @param listed The workspace's enablement as read before this call. A caller turning on
 *   several repositories passes the same list and the same `recorded` set to each call.
 * @param repo The repository, `owner/name`.
 * @param recorded Accounts this sequence of calls has already recorded or switched on, by
 *   lower-cased login — so a second repository under a new account is not recorded twice.
 * @returns When both flags are true.
 * @throws {ApiError} A write the service refused — `403` below admin, above all.
 */
export async function ensureRepositoryEnabled(
  tenantId: string,
  listed: Enablement,
  repo: string,
  recorded: Set<string> = new Set(),
): Promise<void> {
  const [login, name] = repo.split("/") as [string, string];
  const key = login.toLowerCase();

  const account = listed.orgs.find(({ org }) => org.login.toLowerCase() === key);
  const found = account?.repos.find((one) => one.name.toLowerCase() === name.toLowerCase());
  const owner = account?.org.login ?? key;

  if (!recorded.has(key)) {
    if (account === undefined) await orgs.record(tenantId, owner, true);
    else if (!account.org.enabled) await orgs.setEnabled(tenantId, owner, true);
    recorded.add(key);
  }

  if (found === undefined || !found.enabled) {
    await repos.setEnabled(tenantId, owner, found?.name ?? name.toLowerCase(), true);
  }
}

/**
 * Turn on every repository a GitHub source names, and ask detection to scan each.
 *
 * **The scans are best effort**, as in Get started: a debounce or a source that cannot probe
 * is the detection card's to explain, and neither undoes an enablement that succeeded.
 *
 * @param tenantId The workspace.
 * @param source The source as stored. Anything but a GitHub source with a readable config
 *   turns nothing on.
 * @returns The repositories turned on, `owner/name`, lower-cased.
 * @throws {ApiError} A write the service refused.
 */
export async function enableSourceRepositories(
  tenantId: string,
  source: TicketSource,
): Promise<string[]> {
  if (source.kind !== "github") return [];

  const read = sourceRepos(source);
  if (read === null || read.repos.length === 0) return [];

  const listed = await readEnablement(tenantId);
  const recorded = new Set<string>();
  const turnedOn: string[] = [];

  for (const name of read.repos) {
    const repo = `${read.login}/${name}`;
    await ensureRepositoryEnabled(tenantId, listed, repo, recorded);
    turnedOn.push(repo);
  }

  await Promise.all(turnedOn.map((repo) => attempt(() => detection.scan(repo))));

  return turnedOn;
}
