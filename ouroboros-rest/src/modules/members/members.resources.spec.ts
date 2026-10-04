import { invitationRow, M_AT, memberRow } from "./members.fixture";
import { invitationResource, memberResource, serviceMemberResource } from "./members.resources";

/**
 * The card's rows (#485): every column is data the API enforces, and nothing is guessed.
 */

describe("a member row", () => {
  it("carries the plugin's roles, the S3 label and the capability the guard will check", () => {
    expect(memberResource(memberRow(), "user-ken")).toEqual({
      id: "member-maya",
      userId: "user-maya",
      name: "Maya Chen",
      email: "maya@acme.dev",
      image: null,
      roles: ["admin"],
      displayRole: "Maintainer",
      you: false,
      canApproveLoops: true,
      canApproveLoopsSource: "role",
      lastActiveAt: null,
      joinedAt: M_AT.toISOString(),
    });
  });

  it("tags the caller's own row", () => {
    expect(memberResource(memberRow(), "user-maya").you).toBe(true);
  });

  it("reports an explicit capability as explicit, even when it matches the default", () => {
    expect(memberResource(memberRow({ can_approve_loops: true }), "x")).toMatchObject({
      canApproveLoops: true,
      canApproveLoopsSource: "explicit",
    });
    expect(memberResource(memberRow({ can_approve_loops: false }), "x").canApproveLoops).toBe(
      false,
    );
  });

  it("renders real last activity, and null rather than a guess when there is none", () => {
    expect(memberResource(memberRow({ last_active_at: M_AT }), "x").lastActiveAt).toBe(
      M_AT.toISOString(),
    );
    expect(memberResource(memberRow(), "x").lastActiveAt).toBeNull();
  });

  it("parses a comma-separated role list", () => {
    expect(memberResource(memberRow({ role: "viewer,owner" }), "x")).toMatchObject({
      roles: ["viewer", "owner"],
      displayRole: "Owner",
    });
  });
});

describe("an invitation row", () => {
  it("carries the real invitedAt and whether it has expired", () => {
    expect(invitationResource(invitationRow(), M_AT)).toEqual({
      id: "invite-priya",
      email: "priya@acme.dev",
      roles: ["member"],
      displayRole: "Viewer",
      invitedAt: "2026-10-03T10:00:00.000Z",
      expiresAt: "2026-10-05T10:00:00.000Z",
      expired: false,
    });
    expect(invitationResource(invitationRow(), new Date("2026-10-06T00:00:00.000Z")).expired).toBe(
      true,
    );
  });

  it("treats an invitation with no role as the plugin does — a member", () => {
    expect(invitationResource(invitationRow({ role: null }), M_AT).roles).toEqual(["member"]);
  });
});

describe("a service account row", () => {
  it("is a Service with no approval power, named as the audit trail names it", () => {
    expect(
      serviceMemberResource({
        id: "sa-1",
        name: "devops-bot",
        scopes: ["api.read"],
        last_used_at: null,
      }),
    ).toEqual({
      id: "sa-1",
      name: "devops-bot",
      actor: "service:devops-bot",
      displayRole: "Service",
      scopes: ["api.read"],
      canApproveLoops: false,
      lastActiveAt: null,
    });
  });
});
