/**
 * The Settings workspace card — name and tenant domain as edits, region and training data as
 * deployment truth (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * **Name** goes through the BetterAuth organization plugin's adapter (`workspace.auth.ts`).
 * **Domain** is the workspace's primary `tenant_domains` row, and saving one *replaces* the
 * primary: the new domain is inserted (or, if the workspace already lists it, promoted) and the
 * old primary row is removed, in one transaction; every other domain is left alone. **Region** and
 * **training data** come from `workspace.truth.ts` and are never written.
 *
 * **Order on a save carrying both:** the domain commits first, then the name. The domain is the
 * write that can be refused by another workspace (`409 domain_taken`), so refusing it leaves the
 * name unchanged too — the save is all or nothing for every refusal a caller can cause. The name
 * is the library's row on the library's connection, so the two cannot share a transaction; a
 * failure *after* the domain committed is an infrastructure failure, and the `500` says so.
 */

import { Inject, Injectable } from "@nestjs/common";

import { WORKSPACE_UPDATED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../db/db.service";
import type { OrganizationRole } from "../db/schema";
import { violatesConstraint } from "../tenancy/constraints";
import { DomainsRepository } from "../tenancy/domains.repository";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANCY_ERRORS, conflict, tenantNotFound } from "../tenancy/tenancy.errors";
import { WORKSPACE_NAME_STORE, type WorkspaceNameStore } from "./workspace.auth";
import type { PatchWorkspaceDto } from "./workspace.dto";
import { WorkspaceRepository } from "./workspace.repository";
import {
  DOMAIN_CONSEQUENCE,
  roleEditability,
  type DomainTag,
  type WorkspaceSettingsResource,
} from "./workspace.resources";
import { SsoEnforcement } from "./workspace.sso";
import { DEPLOYMENT_KIND, regionPayload, trainingDataPayload } from "./workspace.truth";

/** The unique index that makes a domain belong to one workspace (V001). */
const DOMAIN_KEY = "tenant_domains_domain_key";

/** The message `409 domain_taken` carries, also bound to the `domain` field. */
const DOMAIN_TAKEN_MESSAGE = "That domain belongs to another workspace.";

/** Who is asking, as far as the card is concerned. */
export interface WorkspaceCaller {
  /** The user id, recorded as the audit actor on a save. */
  readonly userId: string;
  /** The caller's roles in this workspace — what decides `editable`. */
  readonly roles: readonly OrganizationRole[];
}

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly workspace: WorkspaceRepository,
    private readonly domains: DomainsRepository,
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly sso: SsoEnforcement,
    private readonly audit: AuditService,
    @Inject(WORKSPACE_NAME_STORE) private readonly names: WorkspaceNameStore,
  ) {}

  /**
   * The card, as it stands for this caller.
   *
   * @param organizationId - The workspace, from the tenant guard.
   * @param caller - Who is asking; their roles decide which fields are editable.
   * @returns The card's payload.
   * @throws {NotFoundError} `404 tenant_not_found` when the workspace was deleted mid-request.
   */
  async read(organizationId: string, caller: WorkspaceCaller): Promise<WorkspaceSettingsResource> {
    const [organization, primary] = await Promise.all([
      this.workspace.organization(organizationId),
      this.workspace.primaryDomain(organizationId),
    ]);

    if (organization === undefined) {
      throw tenantNotFound(organizationId);
    }

    const domain = primary?.domain ?? null;
    const editability = roleEditability(isAdministrator(caller.roles));

    return {
      id: organization.id,
      slug: organization.slug,
      deployment: DEPLOYMENT_KIND,
      name: { value: organization.name, ...editability },
      domain: {
        value: domain,
        ...editability,
        tags: await this.domainTags(organizationId, domain),
        consequence: DOMAIN_CONSEQUENCE,
      },
      region: regionPayload(DEPLOYMENT_KIND, this.config.dataRegion),
      trainingData: trainingDataPayload(DEPLOYMENT_KIND),
    };
  }

  /**
   * Save the card's editable fields, then read it back.
   *
   * Only what changed is written and audited: a field equal to its current value is skipped, and
   * a body that changes nothing writes no audit row.
   *
   * @param organizationId - The workspace, from the tenant guard.
   * @param caller - The administrator saving it (the route's `@Roles` has already checked).
   * @param patch - The validated body.
   * @returns The card after the save.
   * @throws {ConflictError} `409 domain_taken` with `details.fields.domain` when another
   *   workspace holds the domain. Nothing is written.
   */
  async update(
    organizationId: string,
    caller: WorkspaceCaller,
    patch: PatchWorkspaceDto,
  ): Promise<WorkspaceSettingsResource> {
    const before = await this.read(organizationId, caller);
    const changed: string[] = [];

    if (patch.domain !== undefined && patch.domain !== before.domain.value) {
      await this.replacePrimaryDomain(organizationId, patch.domain);
      changed.push("domain");
    }

    if (patch.name !== undefined && patch.name !== before.name.value) {
      await this.names.rename(organizationId, patch.name);
      changed.push("name");
    }

    if (changed.length === 0) {
      return before;
    }

    await this.audit.record({
      organizationId,
      actorId: caller.userId,
      action: WORKSPACE_UPDATED_EVENT,
      subjectType: "workspace",
      subjectId: organizationId,
      at: new Date(),
      detail: {
        fields: changed.join(","),
        name: changed.includes("name") ? patch.name : undefined,
        previousName: changed.includes("name") ? before.name.value : undefined,
        domain: changed.includes("domain") ? patch.domain : undefined,
        previousDomain: changed.includes("domain") ? before.domain.value : undefined,
      },
    });

    return this.read(organizationId, caller);
  }

  /**
   * Make `domain` the workspace's primary and remove the old primary, in one transaction.
   *
   * @param organizationId - The workspace.
   * @param domain - The new primary, lower-case.
   * @returns When the transaction has committed.
   * @throws {ConflictError} `409 domain_taken` when another workspace holds it.
   */
  private async replacePrimaryDomain(organizationId: string, domain: string): Promise<void> {
    try {
      await this.database.transaction(async (trx) => {
        const previous = await this.workspace.primaryDomain(organizationId, trx);
        const existing = await this.workspace.domainNamed(organizationId, domain, trx);

        await this.domains.clearPrimary(organizationId, trx);

        if (existing === undefined) {
          await this.domains.create(organizationId, domain, true, trx);
        } else {
          await this.domains.setPrimary(existing.id, true, trx);
        }

        if (previous !== undefined) {
          await this.domains.remove(organizationId, previous.id, trx);
        }
      });
    } catch (error) {
      if (violatesConstraint(error, DOMAIN_KEY)) {
        throw conflict(TENANCY_ERRORS.domainTaken, DOMAIN_TAKEN_MESSAGE, {
          fields: { domain: [DOMAIN_TAKEN_MESSAGE] },
        });
      }

      throw error;
    }
  }

  /**
   * The tags beside the domain: `sso_enforced` only when SSO is enforced on it.
   *
   * @param organizationId - The workspace.
   * @param domain - Its primary domain, or `null`.
   * @returns The tags — empty when there is no domain or SSO is not enforced.
   */
  private async domainTags(organizationId: string, domain: string | null): Promise<DomainTag[]> {
    if (domain === null) {
      return [];
    }

    return (await this.sso.isEnforced(organizationId, domain)) ? ["sso_enforced"] : [];
  }
}

/**
 * Whether these roles include an administrator's.
 *
 * @param roles - The caller's roles in the workspace.
 * @returns `true` for an `owner` or `admin`.
 */
function isAdministrator(roles: readonly OrganizationRole[]): boolean {
  return roles.some((role) => ADMINISTRATORS.includes(role));
}
