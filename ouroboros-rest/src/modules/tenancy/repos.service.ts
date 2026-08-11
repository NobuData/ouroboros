/**
 * Repository enablement — the inner half of the boundary, and the one operation in this
 * module that creates a row through a `PATCH`.
 *
 * There is no `POST /repos`, and that is the issue's own shape: repositories are listed and
 * enabled, never added. The reason is in V003 — the GitHub App installation flow that would
 * discover them is future product work, so nothing exists today to have created the row a
 * person then switches on. Making the `PATCH` an upsert is what keeps "turn this repository
 * on" a single request either way, and `on conflict … do update` is what keeps it atomic when
 * two people do it at once.
 */

import { Injectable } from "@nestjs/common";

import { OrgsRepository, type RepoChanges } from "./orgs.repository";
import { OrgsService } from "./orgs.service";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { repoResource, type RepoResource } from "./resources";
import type { UpdateRepoBody } from "./tenancy.dto";

@Injectable()
export class ReposService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly organisations: OrgsService,
  ) {}

  /**
   * List an organisation's repositories, enabled or not.
   *
   * @param tenantId - The tenant the organisation must belong to.
   * @param login - Which organisation.
   * @param query - The window the client asked for.
   * @returns One page of repositories, by name.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 org_not_found`.
   */
  async list(tenantId: string, login: string, query: PageQuery): Promise<Page<RepoResource>> {
    const org = await this.organisations.require(tenantId, login);

    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.orgs.listRepos(org.id, window),
      this.orgs.countRepos(org.id),
    ]);

    return pageOf(rows.map(repoResource), total, window);
  }

  /**
   * Enable or disable a repository, recording it if this is the first Ouroboros has heard
   * of it.
   *
   * @param tenantId - The tenant the organisation must belong to.
   * @param login - Which organisation.
   * @param name - Which repository, without the owner prefix.
   * @param body - The validated request.
   * @returns The repository after the change.
   * @throws {NotFoundError} `404 tenant_not_found` or `404 org_not_found`. There is no
   *   `404 repo_not_found`: a repository this API has never seen is one it creates, so the
   *   only thing that can be missing is the organisation it would hang from.
   */
  async setEnabled(
    tenantId: string,
    login: string,
    name: string,
    body: UpdateRepoBody,
  ): Promise<RepoResource> {
    const org = await this.organisations.require(tenantId, login);

    return repoResource(await this.orgs.upsertRepo(org.id, name, changesFrom(body)));
  }
}

/**
 * The columns an enablement request asked to set.
 *
 * @param body - The validated request.
 * @returns The flag, and the default branch only when the caller named one — an omitted
 *   `defaultBranch` leaves whatever was discovered alone rather than clearing it, which is
 *   the difference between "I am not setting this" and "I am setting this to nothing".
 */
function changesFrom(body: UpdateRepoBody): RepoChanges {
  const changes: RepoChanges = { enabled: body.enabled };

  if (body.defaultBranch !== undefined) {
    changes.default_branch = body.defaultBranch;
  }

  return changes;
}
