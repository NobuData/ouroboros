import type { AuditService } from "../audit/audit.service";
import type { OrganizationRole } from "../db/schema";
import type { MemberDirectory } from "./members.auth";
import { invitationRow, M_ORG, memberRow } from "./members.fixture";
import type { InvitationRow, MemberRow, MembersRepository } from "./members.repository";
import { MembersService, type MembersCaller } from "./members.service";
import { DirectorySyncStatus } from "./members.sync";

/**
 * The card's rules (#485): last-owner protection (audited), capability edits that survive role
 * changes, and invitations that go through the plugin.
 */

/** An in-memory workspace: members, invitations and capability rows. */
class MemoryMembers {
  readonly members = new Map<string, MemberRow>();
  readonly invitations = new Map<string, InvitationRow>();

  constructor(rows: MemberRow[] = []) {
    for (const row of rows) this.members.set(row.member_id, row);
  }

  member(_org: string, id: string): Promise<MemberRow | undefined> {
    return Promise.resolve(this.members.get(id));
  }

  ownerCount(): Promise<number> {
    return Promise.resolve(
      [...this.members.values()].filter((row) => row.role.split(",").includes("owner")).length,
    );
  }

  setCanApproveLoops(_org: string, id: string, value: boolean): Promise<void> {
    const row = this.members.get(id);
    if (row) this.members.set(id, { ...row, can_approve_loops: value });
    return Promise.resolve();
  }

  members_(): MemberRow[] {
    return [...this.members.values()];
  }

  invitation(_org: string, id: string): Promise<InvitationRow | undefined> {
    return Promise.resolve(this.invitations.get(id));
  }

  pendingInvitationFor(_org: string, email: string): Promise<InvitationRow | undefined> {
    return Promise.resolve(
      [...this.invitations.values()].find((row) => row.email === email && row.status === "pending"),
    );
  }

  invitations_(): Promise<InvitationRow[]> {
    return Promise.resolve(
      [...this.invitations.values()].filter((row) => row.status === "pending"),
    );
  }

  serviceAccounts(): Promise<[]> {
    return Promise.resolve([]);
  }
}

/** A directory that applies what the plugin would, to the same memory. */
function directoryOver(store: MemoryMembers): jest.Mocked<MemberDirectory> {
  return {
    invite: jest.fn(
      (
        _headers: Headers,
        input: { organizationId: string; email: string; role: OrganizationRole; resend: boolean },
      ) => {
        if (!input.resend)
          store.invitations.set(
            "invite-new",
            invitationRow({ id: "invite-new", email: input.email, role: input.role }),
          );
        return Promise.resolve();
      },
    ),
    cancelInvitation: jest.fn((_headers: Headers, id: string) => {
      const row = store.invitations.get(id);
      if (row) store.invitations.set(id, { ...row, status: "canceled" });
      return Promise.resolve();
    }),
    updateRole: jest.fn(
      (
        _headers: Headers,
        input: { organizationId: string; memberId: string; role: OrganizationRole },
      ) => {
        const row = store.members.get(input.memberId);
        if (row) store.members.set(input.memberId, { ...row, role: input.role });
        return Promise.resolve();
      },
    ),
    remove: jest.fn((_headers: Headers, input: { organizationId: string; memberId: string }) => {
      store.members.delete(input.memberId);
      return Promise.resolve();
    }),
  };
}

const KEN = memberRow({ member_id: "member-ken", user_id: "user-ken", name: "Ken", role: "owner" });
const MAYA = memberRow();
const CALLER: MembersCaller = {
  userId: "user-ken",
  roles: ["owner"],
  headers: new Headers({ cookie: "c=1" }),
};

/** The service over fresh fakes. */
function setup(rows: MemberRow[] = [KEN, MAYA]) {
  const store = new MemoryMembers(rows);
  const repository = {
    member: store.member.bind(store),
    ownerCount: store.ownerCount.bind(store),
    setCanApproveLoops: jest.fn(store.setCanApproveLoops.bind(store)),
    members: () => Promise.resolve(store.members_()),
    invitations: store.invitations_.bind(store),
    invitation: store.invitation.bind(store),
    pendingInvitationFor: store.pendingInvitationFor.bind(store),
    serviceAccounts: store.serviceAccounts.bind(store),
  } as unknown as jest.Mocked<MembersRepository>;
  const directory = directoryOver(store);
  const audit = {
    record: jest.fn().mockResolvedValue("event"),
  } as unknown as jest.Mocked<AuditService>;
  const service = new MembersService(repository, directory, audit, new DirectorySyncStatus());

  return { store, repository, directory, audit, service };
}

/** The actions audited, in order. */
function actions(audit: jest.Mocked<AuditService>): string[] {
  return audit.record.mock.calls.map(([event]) => event.action);
}

describe("the card", () => {
  it("lists members with S3 labels, flags the caller, and renders the footer without a sync line", async () => {
    const { service } = setup();
    const page = await service.page(M_ORG, { userId: "user-ken", roles: ["owner"] });

    expect(
      page.members.map((row) => [row.name, row.displayRole, row.you, row.canApproveLoops]),
    ).toEqual([
      ["Ken", "Owner", true, true],
      ["Maya Chen", "Maintainer", false, true],
    ]);
    expect(page.canManage).toBe(true);
    expect(page.footer).toEqual({
      hierarchy: "Owner > Maintainer (approve/merge) > Viewer (read-only)",
      directorySync: null,
    });
  });

  it("tells a viewer they cannot manage it", async () => {
    const { service } = setup();

    expect((await service.page(M_ORG, { userId: "user-maya", roles: ["viewer"] })).canManage).toBe(
      false,
    );
  });
});

describe("the last owner", () => {
  it("cannot be demoted — the attempt fails with a clear reason and is audited", async () => {
    const { service, directory, audit, store } = setup();

    await expect(
      service.update(M_ORG, CALLER, "member-ken", { role: "admin" }),
    ).rejects.toMatchObject({
      code: "owner_protected",
      details: { memberId: "member-ken", attempt: "demote" },
    });
    expect(directory.updateRole).not.toHaveBeenCalled();
    expect(store.members.get("member-ken")?.role).toBe("owner");
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: "member.role_changed",
      subjectId: "member-ken",
      detail: { outcome: "failure", reason: "owner_protected", before: "owner", after: "admin" },
    });
  });

  it("cannot be removed — the attempt fails and is audited", async () => {
    const { service, directory, audit } = setup();

    await expect(service.remove(M_ORG, CALLER, "member-ken")).rejects.toMatchObject({
      code: "owner_protected",
      details: { attempt: "remove" },
    });
    expect(directory.remove).not.toHaveBeenCalled();
    expect(actions(audit)).toEqual(["member.removed"]);
    expect(audit.record.mock.calls[0][0].detail).toMatchObject({ outcome: "failure" });
  });

  it("can be demoted once there is another owner", async () => {
    const { service, directory } = setup([KEN, memberRow({ role: "owner" })]);

    await service.update(M_ORG, CALLER, "member-ken", { role: "admin" });

    expect(directory.updateRole).toHaveBeenCalledWith(CALLER.headers, {
      organizationId: M_ORG,
      memberId: "member-ken",
      role: "admin",
    });
  });

  it("does not block an owner keeping the owner role", async () => {
    const { service, directory } = setup();

    await service.update(M_ORG, CALLER, "member-ken", { role: "owner" });

    expect(directory.updateRole).not.toHaveBeenCalled();
  });
});

describe("role changes", () => {
  it("go through the plugin with the caller's cookies and are audited with before and after", async () => {
    const { service, directory, audit } = setup();
    const after = await service.update(M_ORG, CALLER, "member-maya", { role: "viewer" });

    expect(directory.updateRole).toHaveBeenCalledWith(
      CALLER.headers,
      expect.objectContaining({ role: "viewer" }),
    );
    expect(after).toMatchObject({ roles: ["viewer"], displayRole: "Viewer" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.role_changed",
        detail: {
          before: "admin",
          after: "viewer",
          before_display: "Maintainer",
          after_display: "Viewer",
          outcome: "success",
        },
      }),
    );
  });

  it("move the default capability with the role when nobody set it", async () => {
    const { service } = setup();

    expect(
      (await service.update(M_ORG, CALLER, "member-maya", { role: "viewer" })).canApproveLoops,
    ).toBe(false);
  });

  it("never reset an explicitly set capability", async () => {
    const { service } = setup();

    await service.update(M_ORG, CALLER, "member-maya", { canApproveLoops: false });

    const promoted = await service.update(M_ORG, CALLER, "member-maya", { role: "owner" });

    expect(promoted).toMatchObject({
      roles: ["owner"],
      canApproveLoops: false,
      canApproveLoopsSource: "explicit",
    });
  });
});

describe("capability edits", () => {
  it("store an explicit setting and audit before and after", async () => {
    const { service, repository, audit } = setup();
    const after = await service.update(M_ORG, CALLER, "member-maya", { canApproveLoops: false });

    expect(repository.setCanApproveLoops).toHaveBeenCalledWith(
      M_ORG,
      "member-maya",
      false,
      "user-ken",
      expect.any(Date),
    );
    expect(after).toMatchObject({ canApproveLoops: false, canApproveLoopsSource: "explicit" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.capability_changed",
        detail: {
          capability: "can_approve_loops",
          before: true,
          after: false,
          before_source: "role",
        },
      }),
    );
  });

  it("refuse an update that names nothing", async () => {
    const { service } = setup();

    await expect(service.update(M_ORG, CALLER, "member-maya", {})).rejects.toMatchObject({
      code: "member_update_empty",
    });
  });

  it("refuse a member of another workspace as unknown", async () => {
    const { service } = setup();

    await expect(
      service.update(M_ORG, CALLER, "member-elsewhere", { canApproveLoops: true }),
    ).rejects.toMatchObject({
      code: "workspace_member_not_found",
    });
  });
});

describe("removing a member", () => {
  it("goes through the plugin and is audited", async () => {
    const { service, directory, audit } = setup();

    await service.remove(M_ORG, CALLER, "member-maya");

    expect(directory.remove).toHaveBeenCalledWith(CALLER.headers, {
      organizationId: M_ORG,
      memberId: "member-maya",
    });
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: "member.removed",
      detail: { outcome: "success", before: "admin", before_display: "Maintainer" },
    });
  });
});

describe("invitations", () => {
  it("invite → resend → revoke, each through the plugin and each audited — never with the address", async () => {
    const { service, directory, audit, store } = setup();
    const invited = await service.invite(M_ORG, CALLER, {
      email: "priya@acme.dev",
      role: "member",
    });

    expect(directory.invite).toHaveBeenCalledWith(CALLER.headers, {
      organizationId: M_ORG,
      email: "priya@acme.dev",
      role: "member",
      resend: false,
    });
    expect(invited).toMatchObject({ id: "invite-new", invitedAt: "2026-10-03T10:00:00.000Z" });

    const resent = await service.resend(M_ORG, CALLER, "invite-new");

    expect(directory.invite).toHaveBeenLastCalledWith(
      CALLER.headers,
      expect.objectContaining({ resend: true }),
    );
    expect(resent.invitedAt).toBe(invited.invitedAt);

    await service.revoke(M_ORG, CALLER, "invite-new");

    expect(directory.cancelInvitation).toHaveBeenCalledWith(CALLER.headers, "invite-new");
    expect(store.invitations.get("invite-new")?.status).toBe("canceled");
    expect(actions(audit)).toEqual([
      "member.invited",
      "member.invitation_resent",
      "member.invitation_revoked",
    ]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("priya@acme.dev");
  });

  it("refuses to resend or revoke what is not pending, or not there", async () => {
    const { service, store } = setup();

    store.invitations.set("old", invitationRow({ id: "old", status: "accepted" }));

    await expect(service.resend(M_ORG, CALLER, "old")).rejects.toMatchObject({
      code: "invitation_not_pending",
    });
    await expect(service.revoke(M_ORG, CALLER, "old")).rejects.toMatchObject({
      code: "invitation_not_pending",
    });
    await expect(service.revoke(M_ORG, CALLER, "nope")).rejects.toMatchObject({
      code: "invitation_not_found",
    });
  });
});
