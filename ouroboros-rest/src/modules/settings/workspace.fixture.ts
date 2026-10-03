import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { DatabaseService } from "../db/db.service";
import type { Organization, TenantDomain } from "../db/schema";
import type { DomainsRepository } from "../tenancy/domains.repository";
import type { WorkspaceNameStore } from "./workspace.auth";
import type { WorkspaceRepository } from "./workspace.repository";
import { WorkspaceService, type WorkspaceCaller } from "./workspace.service";
import { SsoEnforcement } from "./workspace.sso";

/**
 * The workspace card's service over an in-memory `organization` row and `tenant_domains` table
 * (#483) — shared by the service and contract specs so both drive the real rules.
 */

export const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
export const OTHER_WORKSPACE = "0b7e4c1d-2a3f-4e5d-8c9b-1a2b3c4d5e6f";

export const OWNER: WorkspaceCaller = { userId: "user-owner", roles: ["owner"] };
export const VIEWER: WorkspaceCaller = { userId: "user-viewer", roles: ["viewer"] };

/** A unique violation as `pg` reports one. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error("duplicate key"), { code: "23505", constraint });
}

/**
 * The in-memory tables and the fakes over them.
 *
 * @param options - The configured region and whether SSO reports enforced.
 * @returns The service, its fakes, and helpers to seed and read the domain table.
 */
export function world(options: { region?: string; ssoEnforced?: boolean } = {}) {
  const organization: Organization = {
    id: WORKSPACE,
    name: "acme-robotics",
    slug: "acme-robotics",
    logo: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    metadata: null,
  };
  let domains: TenantDomain[] = [];
  let nextId = 1;

  const row = (organizationId: string, domain: string, isPrimary: boolean): TenantDomain =>
    ({
      id: `domain-${nextId++}`,
      organization_id: organizationId,
      domain,
      is_primary: isPrimary,
    }) as TenantDomain;

  const repository = {
    organization: jest.fn((id: string) =>
      Promise.resolve(id === organization.id ? { ...organization } : undefined),
    ),
    primaryDomain: jest.fn((id: string) =>
      Promise.resolve(domains.find((d) => d.organization_id === id && d.is_primary)),
    ),
    domainNamed: jest.fn((id: string, domain: string) =>
      Promise.resolve(domains.find((d) => d.organization_id === id && d.domain === domain)),
    ),
  };

  const domainStatements = {
    clearPrimary: jest.fn((id: string) => {
      domains = domains.map((d) => (d.organization_id === id ? { ...d, is_primary: false } : d));
      return Promise.resolve();
    }),
    create: jest.fn((id: string, domain: string, isPrimary: boolean) => {
      if (domains.some((d) => d.domain === domain)) {
        return Promise.reject(uniqueViolation("tenant_domains_domain_key"));
      }
      const created = row(id, domain, isPrimary);
      domains.push(created);
      return Promise.resolve(created);
    }),
    setPrimary: jest.fn((domainId: string, isPrimary: boolean) => {
      domains = domains.map((d) => (d.id === domainId ? { ...d, is_primary: isPrimary } : d));
      return Promise.resolve(domains.find((d) => d.id === domainId));
    }),
    remove: jest.fn((id: string, domainId: string) => {
      const before = domains.length;
      domains = domains.filter((d) => !(d.organization_id === id && d.id === domainId));
      return Promise.resolve(domains.length < before);
    }),
  };

  // A transaction that rolls the table back when its body throws — what PostgreSQL does.
  const database = {
    transaction: jest.fn(async (body: (trx: unknown) => Promise<unknown>) => {
      const snapshot = domains.map((d) => ({ ...d }));
      try {
        return await body({});
      } catch (error) {
        domains = snapshot;
        throw error;
      }
    }),
  };

  const names: jest.Mocked<WorkspaceNameStore> = {
    rename: jest.fn((_id: string, name: string) => {
      organization.name = name;
      return Promise.resolve();
    }),
  };
  const audit = { record: jest.fn((_event: AuditRecord) => Promise.resolve("event-1")) };
  const sso = new SsoEnforcement();
  jest.spyOn(sso, "isEnforced").mockResolvedValue(options.ssoEnforced ?? false);

  const service = new WorkspaceService(
    repository as unknown as WorkspaceRepository,
    domainStatements as unknown as DomainsRepository,
    database as unknown as DatabaseService,
    { dataRegion: options.region } as AppConfigService,
    sso,
    audit as unknown as AuditService,
    names,
  );

  return {
    service,
    names,
    audit,
    domainStatements,
    seedDomain: (organizationId: string, domain: string, isPrimary: boolean) =>
      domains.push(row(organizationId, domain, isPrimary)),
    domainsOf: (organizationId: string) =>
      domains
        .filter((d) => d.organization_id === organizationId)
        .map((d) => (d.is_primary ? `*${d.domain}` : d.domain))
        .sort(),
  };
}
