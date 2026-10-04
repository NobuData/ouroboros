import { BetterAuthMemberDirectory, MEMBER_DIRECTORY_REFUSED, pluginRefusal } from "./members.auth";

/**
 * The organization plugin as a port (#485): calls carry the caller's cookies, and the plugin's
 * refusals arrive in this API's envelope.
 */

describe("translating a plugin refusal", () => {
  it.each([
    [400, 422],
    [401, 401],
    [403, 403],
    [404, 404],
  ])("answers a %i from the plugin as a %i with its reason", (from, to) => {
    const translated = pluginRefusal({
      statusCode: from,
      body: { code: "YOU_ARE_NOT_ALLOWED", message: "You are not allowed to do that" },
    }) as { getStatus(): number; envelope(): object };

    expect(translated.getStatus()).toBe(to);
    expect(translated.envelope()).toEqual({
      code: MEMBER_DIRECTORY_REFUSED,
      message: "You are not allowed to do that",
      details: { reason: "YOU_ARE_NOT_ALLOWED" },
    });
  });

  it("leaves a crash a crash", () => {
    const crash = new Error("connection reset");

    expect(pluginRefusal(crash)).toBe(crash);
    expect(pluginRefusal({ statusCode: 500 })).toEqual({ statusCode: 500 });
  });
});

describe("calling the plugin", () => {
  /** A library service whose `api` records the calls. */
  function library() {
    const api = {
      createInvitation: jest.fn().mockResolvedValue({}),
      cancelInvitation: jest.fn().mockResolvedValue({}),
      updateMemberRole: jest.fn().mockResolvedValue({}),
      removeMember: jest.fn().mockResolvedValue({}),
    };

    return { api, directory: new BetterAuthMemberDirectory({ api } as never) };
  }

  const headers = new Headers({ cookie: "better-auth.session_token=abc" });

  it("invites and resends with the caller's cookies and the workspace", async () => {
    const { api, directory } = library();

    await directory.invite(headers, {
      organizationId: "org-1",
      email: "p@acme.dev",
      role: "member",
      resend: true,
    });

    expect(api.createInvitation).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "org-1", email: "p@acme.dev", role: "member", resend: true },
    });
  });

  it("revokes, changes a role and removes through the plugin's own endpoints", async () => {
    const { api, directory } = library();

    await directory.cancelInvitation(headers, "invite-1");
    await directory.updateRole(headers, {
      organizationId: "org-1",
      memberId: "m-1",
      role: "admin",
    });
    await directory.remove(headers, { organizationId: "org-1", memberId: "m-1" });

    expect(api.cancelInvitation).toHaveBeenCalledWith({
      headers,
      body: { invitationId: "invite-1" },
    });
    expect(api.updateMemberRole).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "org-1", memberId: "m-1", role: "admin" },
    });
    expect(api.removeMember).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "org-1", memberIdOrEmail: "m-1" },
    });
  });

  it("throws the plugin's refusal in this API's envelope", async () => {
    const { api, directory } = library();

    api.updateMemberRole.mockRejectedValue({ statusCode: 403, body: { message: "nope" } });

    await expect(
      directory.updateRole(headers, { organizationId: "org-1", memberId: "m-1", role: "owner" }),
    ).rejects.toMatchObject({ code: MEMBER_DIRECTORY_REFUSED });
  });
});
