"use server";

/**
 * Settings → Repositories' writes: a repository's switch, and *Scan issues now*.
 *
 * A Server Action is a POST endpoint anybody can reach. The workspace is always the one the
 * caller's own session names (`requireWorkspace()`), the repository is checked for shape and,
 * to be turned on, for a GitHub source that names it — the same rule Get started applies — and
 * the service refuses any role that may not make the write, in its own words.
 */

import { requireWorkspace } from "@/app/api/access";
import { backlog } from "@/app/api/backlog";
import { detection } from "@/app/api/detection";
import { readEnablement } from "@/app/api/enablement";
import { isApiError } from "@/app/api/errors";
import { attempt } from "@/app/api/reading";
import { ensureRepositoryEnabled } from "@/app/api/repo-enablement";
import { repos } from "@/app/api/repos";
import { sources } from "@/app/api/sources";
import { coveredBy, parseRepo } from "@/app/get-started/view";

import { SCAN_FAILED, SWITCH_FAILED, SWITCH_NOT_COVERED } from "./view";

/** What a write answers: done, or why not, in words. */
export type RepositoryWrite = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Turn a repository on or off.
 *
 * On: the account and the repository, recorded first when needed, then a detection scan —
 * best effort, as in Get started. Off: the repository's own flag only, so the account's other
 * repositories keep theirs.
 *
 * @param repo The repository, `owner/name`.
 * @param enabled The state to move to.
 * @returns Done, or why not.
 */
export async function setRepositoryEnabled(
  repo: string,
  enabled: boolean,
): Promise<RepositoryWrite> {
  const valid = parseRepo(repo)?.toLowerCase() ?? null;
  if (valid === null || typeof enabled !== "boolean") return { ok: false, reason: SWITCH_FAILED };

  const { membership } = await requireWorkspace();

  try {
    const [listed, listing] = await Promise.all([
      readEnablement(membership.id),
      sources.list(),
    ]);

    if (enabled) {
      if (!coveredBy(listing.items, valid)) return { ok: false, reason: SWITCH_NOT_COVERED };

      await ensureRepositoryEnabled(membership.id, listed, valid);
      await attempt(() => detection.scan(valid));
      return { ok: true };
    }

    const [login, name] = valid.split("/") as [string, string];
    const account = listed.orgs.find(({ org }) => org.login.toLowerCase() === login);
    const found = account?.repos.find((one) => one.name.toLowerCase() === name);

    if (account !== undefined && found?.enabled === true) {
      await repos.setEnabled(membership.id, account.org.login, found.name, false);
    }
    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: error.message };
  }
}

/**
 * Ask the Issues backlog to scan every repository switched on, now.
 *
 * @returns Done, or why not — the service's own sentence when it refused.
 */
export async function scanIssuesNow(): Promise<RepositoryWrite> {
  await requireWorkspace();

  try {
    await backlog.sync();
    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: error.message === "" ? SCAN_FAILED : error.message };
  }
}
