import type { WorkspaceSettings, WorkspaceSettingsEffective } from "../db/schema";
import { FIXTURE_USER } from "../auth/principal.fixture";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import type { SettingsAudit } from "./audit";
import type { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

/**
 * The three rules of the surface, held where they live.
 *
 * The statements are the repository's and the role gate is the controller's; what is left
 * here is exactly what could go quietly wrong: inventing a row for a workspace that never
 * chose, a write attributed to nobody, and an audit event for a change that never
 * persisted — or none for one that did.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** The workspace's row of the effective view, as the repository would return it. */
function effective(enabled: boolean): WorkspaceSettingsEffective {
  return {
    organization_id: WORKSPACE,
    auto_merge_on_checks: enabled,
    is_explicit: true,
    updated_at: new Date("2026-08-13T09:00:00.000Z"),
    updated_by: FIXTURE_USER.id,
  };
}

/** A stored table row, as the upsert would hand it back. */
function stored(enabled: boolean): WorkspaceSettings {
  return {
    organization_id: WORKSPACE,
    auto_merge_on_checks: enabled,
    updated_by: FIXTURE_USER.id,
    created_at: new Date("2026-08-11T10:20:23.114Z"),
    updated_at: new Date("2026-08-13T09:00:00.000Z"),
  };
}

describe("the settings service", () => {
  let repository: jest.Mocked<SettingsRepository>;
  let audit: jest.Mocked<SettingsAudit>;
  let service: SettingsService;

  beforeEach(() => {
    repository = {
      effective: jest.fn().mockResolvedValue(undefined),
      upsertAutoMerge: jest.fn(),
    } as unknown as jest.Mocked<SettingsRepository>;
    audit = { autoMergeChanged: jest.fn() };

    service = new SettingsService(repository, audit);
  });

  /** Run `work` as the fixture user, the way the guard establishes a request's person. */
  function asFixtureUser<T>(work: () => T): T {
    return runWithTenantContext(() => {
      setTenantContext({ user: FIXTURE_USER });
      return work();
    });
  }

  it("reads the workspace's stored choice", async () => {
    repository.effective.mockResolvedValue(effective(true));

    await expect(service.read(WORKSPACE)).resolves.toEqual({
      enabled: true,
      updatedAt: "2026-08-13T09:00:00.000Z",
      updatedBy: FIXTURE_USER.id,
    });

    expect(repository.effective).toHaveBeenCalledWith(WORKSPACE);
  });

  it("answers the defaults for a workspace that has never chosen, without writing a row", async () => {
    // Absence is an answer: no 404, and no written-on-read row — the table holds choices,
    // so `count(*)` over it stays "how many workspaces changed a setting".
    await expect(service.read(WORKSPACE)).resolves.toEqual({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });

    expect(repository.upsertAutoMerge).not.toHaveBeenCalled();
  });

  it("stores a flip attributed to the session user, and answers with the row as stored", async () => {
    repository.upsertAutoMerge.mockResolvedValue(stored(true));

    await expect(
      asFixtureUser(() => service.update(WORKSPACE, { enabled: true })),
    ).resolves.toEqual({
      enabled: true,
      updatedAt: "2026-08-13T09:00:00.000Z",
      updatedBy: FIXTURE_USER.id,
    });

    expect(repository.upsertAutoMerge).toHaveBeenCalledWith(WORKSPACE, true, FIXTURE_USER.id);
  });

  it("tells the audit seam about every persisted write, from the row's own stamp", async () => {
    // The event is assembled from what the database returned, not from what was sent: the
    // trigger's clock is the trail's clock, and #90 inherits exactly this call.
    repository.upsertAutoMerge.mockResolvedValue(stored(false));

    await asFixtureUser(() => service.update(WORKSPACE, { enabled: false }));

    expect(audit.autoMergeChanged).toHaveBeenCalledWith({
      organizationId: WORKSPACE,
      enabled: false,
      changedBy: FIXTURE_USER.id,
      changedAt: new Date("2026-08-13T09:00:00.000Z"),
    });
  });

  it("treats an empty patch as a question, not an error — and not an event", async () => {
    // PATCH means "what is present changed". Nothing present changes nothing, writes
    // nothing, and audits nothing, because nothing happened worth attributing.
    repository.effective.mockResolvedValue(effective(true));

    await expect(asFixtureUser(() => service.update(WORKSPACE, {}))).resolves.toEqual({
      enabled: true,
      updatedAt: "2026-08-13T09:00:00.000Z",
      updatedBy: FIXTURE_USER.id,
    });

    expect(repository.upsertAutoMerge).not.toHaveBeenCalled();
    expect(audit.autoMergeChanged).not.toHaveBeenCalled();
  });

  it("fails loudly on a write with no signed-in person", async () => {
    // Unreachable through the pipeline — the route is authenticated — and precisely
    // because it is unreachable it must not be survivable: a write this surface could not
    // attribute is a write the audit trail would have to lie about.
    await expect(
      runWithTenantContext(() => service.update(WORKSPACE, { enabled: true })),
    ).rejects.toThrow(/no signed-in person/);

    expect(repository.upsertAutoMerge).not.toHaveBeenCalled();
    expect(audit.autoMergeChanged).not.toHaveBeenCalled();
  });
});
