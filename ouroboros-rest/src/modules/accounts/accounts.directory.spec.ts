import { PERSONAL_ORGANIZATION_METADATA_JSON } from "../../auth/active.organization";
import { BetterAuthAccountDirectory } from "./accounts.directory";

/**
 * The writes to BetterAuth's tables, through the library's adapters: the status fields, the
 * personal organization made by the sign-in's own function, and the stamp on open sessions.
 */

/** A `$context` with recording adapters. */
function directoryWith(options: { memberships?: object[]; sessions?: object[] } = {}) {
  const updates: unknown[] = [];
  const created: { model: string; data: Record<string, unknown> }[] = [];
  const updateUser = jest.fn().mockResolvedValue({});
  const adapter = {
    findMany: jest.fn(({ model }: { model: string }) =>
      Promise.resolve(model === "member" ? (options.memberships ?? []) : (options.sessions ?? [])),
    ),
    create: jest.fn(({ model, data }: { model: string; data: Record<string, unknown> }) => {
      created.push({ model, data });
      return Promise.resolve({ id: `${model}-1`, ...data });
    }),
    update: jest.fn((query: unknown) => {
      updates.push(query);
      return Promise.resolve(null);
    }),
  };
  const betterAuth = {
    instance: { $context: Promise.resolve({ adapter, internalAdapter: { updateUser } }) },
  };

  return {
    directory: new BetterAuthAccountDirectory(betterAuth as never),
    updateUser,
    updates,
    created,
  };
}

const PRIYA = { id: "priya", name: "Priya Raman", email: "priya@contractor.dev" };

describe("the account directory", () => {
  it("writes a decision through the internal adapter, as the library's own fields", async () => {
    const { directory, updateUser } = directoryWith();
    const changedAt = new Date();

    await directory.setStatus("priya", {
      status: "approved",
      reason: "approved_by_admin",
      changedBy: "ken@acme-robotics.dev",
      changedAt,
    });

    expect(updateUser).toHaveBeenCalledWith("priya", {
      accountStatus: "approved",
      accountStatusReason: "approved_by_admin",
      accountStatusChangedBy: "ken@acme-robotics.dev",
      accountStatusChangedAt: changedAt,
    });
  });

  it("makes a personal organization for somebody who belongs nowhere and stamps their idle sessions", async () => {
    const { directory, created, updates } = directoryWith({
      sessions: [
        { id: "s1", activeOrganizationId: null },
        { id: "s2", activeOrganizationId: "org-elsewhere" },
      ],
    });

    await expect(directory.ensureWorkspace(PRIYA)).resolves.toBe("organization-1");

    expect(created.map((row) => row.model)).toEqual(["organization", "member"]);
    expect(created[0].data).toMatchObject({
      name: "Priya Raman",
      metadata: PERSONAL_ORGANIZATION_METADATA_JSON,
    });
    expect(created[1].data).toMatchObject({ userId: "priya", role: "owner" });
    expect(updates).toEqual([
      {
        model: "session",
        where: [{ field: "id", value: "s1" }],
        update: { activeOrganizationId: "organization-1" },
      },
    ]);
  });

  it("makes nothing for somebody who already belongs somewhere, and still stamps", async () => {
    const { directory, created, updates } = directoryWith({
      memberships: [{ organizationId: "org-existing" }],
      sessions: [{ id: "s1", activeOrganizationId: null }],
    });

    await expect(directory.ensureWorkspace(PRIYA)).resolves.toBe("org-existing");
    expect(created).toEqual([]);
    expect(updates).toHaveLength(1);
  });
});
