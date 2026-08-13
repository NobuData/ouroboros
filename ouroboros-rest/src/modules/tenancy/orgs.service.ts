/**
 * The workspaces a person belongs to, as mockup 01 Step 2 draws them.
 *
 * `GET /api/v1/orgs` answers one question — *where may the loop run, and where may I turn it
 * on?* — and it answers it in one request, which is the whole of why the route exists. The
 * facts it composes live in three places and no client should be asked to fetch three:
 *
 * ```
 * organization + member   →  which workspaces, and what I hold in each
 * github_orgs             →  the switches, and whether any is on
 * github_repos            →  "4 repos enabled · incl. helios-firmware"
 * ```
 *
 * Before this route, `ouroboros-ui` composed the first of those from
 * `GET /api/auth/organization/list` plus one `get-active-member-role` **per workspace**,
 * because the plugin's adapter discards the role on the way out — see that module's
 * `app/api/session.ts`, which says so and names this issue as its replacement.
 *
 * ## Two statements, not one per row
 *
 * The listing is a join, and the counts are a single grouped query over every workspace on the
 * page. That matters at a hundred rows — the contract's page ceiling — where the obvious
 * implementation is two hundred round trips. See `enablement.repository.ts`'s `countsFor`.
 *
 * ## No workspace is required to ask
 *
 * The controller is `@TenantOptional()`, and it is the only route in this module that is:
 * requiring somebody to choose a workspace before being told which workspaces they have is
 * circular, and it is exactly the state `400 organization_required` tells them to leave. The
 * listing is scoped to the caller instead, through `currentUser()`, so the exemption is not a
 * way around the tenant rule — a person sees their own memberships and no others.
 */

import { Injectable } from "@nestjs/common";

import { EnablementRepository, type GithubOrgCountsRow } from "./enablement.repository";
import { OrganizationRepository, type OrganizationMembership } from "./organization.repository";
import { pageOf, windowOf, type Page, type PageQuery } from "./pagination";
import { asCount } from "./queries";
import { orgRowResource, type GithubOrgSummary, type OrgRowResource } from "./resources";
import { currentUser } from "./tenant.context";

/**
 * The counts belonging to one workspace, pulled out of the grouped query's flat answer.
 *
 * `featuredRepo` is chosen across the workspace's organisations rather than per organisation,
 * because the mockup's line is one line: `4 repos enabled · incl. helios-firmware` describes
 * the row, not one switch inside it.
 */
interface WorkspaceEnablement {
  readonly githubOrgs: GithubOrgSummary[];
  readonly featuredRepo: string | null;
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly enablement: EnablementRepository,
  ) {}

  /**
   * The signed-in person's workspaces, as Step 2 rows.
   *
   * @param query - The window the client asked for.
   * @returns One page of rows, oldest workspace first.
   * @throws {Error} When there is no signed-in person — which cannot happen through the
   *   pipeline, because the route is authenticated and only tenant-optional. It fails loudly
   *   rather than answering with an empty page, because an empty page is what "you belong to
   *   nothing" looks like and the two must not be confused.
   */
  async list(query: PageQuery): Promise<Page<OrgRowResource>> {
    const user = currentUser();

    if (user === undefined) {
      throw new Error(
        "GET /api/v1/orgs was reached with no signed-in person. The route is @TenantOptional(), " +
          "not @AllowAnonymous() — a listing scoped to nobody would be a listing of everything.",
      );
    }

    const window = windowOf(query);
    const [memberships, total] = await Promise.all([
      this.organizations.listFor(user.id, window),
      this.organizations.countFor(user.id),
    ]);

    const enablement = await this.enablementFor(memberships);

    return pageOf(
      memberships.map((membership) => this.rowFor(membership, enablement)),
      total,
      window,
    );
  }

  /**
   * The enablement counts for a page of workspaces, keyed by workspace id.
   *
   * @param memberships - The page, in the order it will be rendered.
   * @returns A lookup from workspace id to its switches and counts. A workspace with nothing
   *   recorded is simply absent, and {@link rowFor} reads that as the zeroes the mockup's
   *   `acme-labs` row shows.
   */
  private async enablementFor(
    memberships: readonly OrganizationMembership[],
  ): Promise<Map<string, WorkspaceEnablement>> {
    const rows = await this.enablement.countsFor(
      memberships.map((membership) => membership.organization.id),
    );

    const byWorkspace = new Map<string, WorkspaceEnablement>();

    for (const row of rows) {
      const existing = byWorkspace.get(row.organization_id);
      const githubOrgs = existing?.githubOrgs ?? [];

      githubOrgs.push(summaryOf(row));
      byWorkspace.set(row.organization_id, {
        githubOrgs,
        // The query returns each workspace's organisations by login, and the first `incl.`
        // candidate found is kept — one line per row, and a stable choice for a screen that
        // renders it beside a count.
        featuredRepo: existing?.featuredRepo ?? row.featured_repo,
      });
    }

    return byWorkspace;
  }

  /**
   * One row.
   *
   * @param membership - The workspace and what the caller holds in it.
   * @param enablement - The counts for the whole page.
   * @returns The resource.
   */
  private rowFor(
    membership: OrganizationMembership,
    enablement: Map<string, WorkspaceEnablement>,
  ): OrgRowResource {
    const counts = enablement.get(membership.organization.id);

    return orgRowResource({
      organization: membership.organization,
      roles: membership.roles,
      githubOrgs: counts?.githubOrgs ?? [],
      featuredRepo: counts?.featuredRepo ?? null,
    });
  }
}

/**
 * One GitHub organisation's counted row, as a Step 2 summary.
 *
 * @param row - What the grouped query returned.
 * @returns The summary, with the aggregates read as numbers — `pg` hands a `count(*)` back as
 *   a string, and a `total` that reached the wire as `"4"` would be a contract violation the
 *   specification says is an `integer`.
 */
function summaryOf(row: GithubOrgCountsRow): GithubOrgSummary {
  return {
    login: row.login,
    enabled: row.enabled,
    repoCounts: { enabled: asCount(row.enabled_repos), total: asCount(row.total_repos) },
  };
}
