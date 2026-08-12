import {
  organizationOptions,
  stripPersonalFlag,
  type OrganizationAuditSink,
} from "./organization.plugin";
import { CREATOR_ROLE, ORGANIZATION_ROLES, organizationAccessControl } from "./organization.roles";

/**
 * The organization plugin's options — tenancy, as a configuration object
 * ([#704](https://github.com/NobuData/ouroboros/issues/704)).
 *
 * What is asserted here is *policy*: which roles exist, what the creator of an organization
 * becomes, what a client may not claim about one it is creating, and where
 * [#725](https://github.com/NobuData/ouroboros/issues/725)'s audit trail attaches. That the
 * real plugin accepts these options is proven where Jest cannot reach — by
 * `@better-auth/cli generate` building a genuine instance from `auth.config.ts` with this
 * plugin registered, which is how `V005` was generated
 * ([#707](https://github.com/NobuData/ouroboros/issues/707)).
 */

/** The hooks, narrowed — they are optional on the plugin's type and always set here. */
function hooksOf(audit?: OrganizationAuditSink) {
  const hooks = organizationOptions(audit).organizationHooks;

  if (hooks === undefined) {
    throw new Error("organizationOptions registered no hooks");
  }

  return hooks;
}

describe("the plugin's options", () => {
  it("hands over the access control its roles were minted from", () => {
    // Identity rather than equivalence, and the plugin depends on it: it resolves a role out
    // of `roles` and authorizes against `ac`. Two instances built from the same statements
    // would authorize nothing, with no error anywhere to say why.
    expect(organizationOptions().ac).toBe(organizationAccessControl);
    expect(organizationOptions().roles).toBe(ORGANIZATION_ROLES);
  });

  it("makes the creator of an organization its owner", () => {
    // The plugin's default is the same value. It is stated because it is the one role that
    // cannot be granted by anybody else — an organization created by an `admin` would have
    // no owner, so nobody in it could delete it or hand it on.
    expect(organizationOptions().creatorRole).toBe(CREATOR_ROLE);
  });

  it("configures nothing else", () => {
    // The same rule `auth.options.spec.ts` holds the root options to. The plugin has some
    // thirty options — teams, dynamic access control, membership limits, organization
    // limits — and each of them is a product decision with an issue behind it. One added
    // here without one is a route surface nobody designed.
    expect(Object.keys(organizationOptions()).sort()).toEqual([
      "ac",
      "creatorRole",
      "organizationHooks",
      "roles",
    ]);
  });

  it("hands back a fresh object each time", () => {
    // Two callers could exist — `auth.factory.ts` and anything #725 wires — and a shared
    // literal would let one's mutation reach the other.
    expect(organizationOptions()).not.toBe(organizationOptions());
  });

  it("leaves teams off, so V005 needed no team tables", () => {
    // Load-bearing rather than incidental: the plugin adds `team` and `teamMember` to its
    // schema when teams are on, and #707's migration was generated from these exact options.
    // Turning them on is a migration, not a flag.
    expect(organizationOptions()).not.toHaveProperty("teams");
  });
});

describe("stripPersonalFlag", () => {
  it("takes a client-supplied personal flag off", () => {
    // Mockup 01 Step 2 renders `metadata.personal` as a pill meaning *this workspace is
    // yours alone*. Without this, anybody could create an organization wearing it, invite
    // four colleagues in, and the list would show a shared workspace labelled `personal`.
    expect(stripPersonalFlag({ personal: true })).toBeUndefined();
  });

  it("keeps everything else the caller sent", () => {
    expect(stripPersonalFlag({ personal: true, plan: "team" })).toEqual({ plan: "team" });
  });

  it("leaves metadata that never claimed it exactly as it was", () => {
    // Identity, so an ordinary create does not pay for a copy it does not need.
    const metadata = { plan: "team" };

    expect(stripPersonalFlag(metadata)).toBe(metadata);
  });

  it("passes undefined through rather than inventing an empty object", () => {
    // `organization.metadata` is nullable, and `{}` is not the same as null — it is a row
    // that says "somebody set metadata here", which nobody did.
    expect(stripPersonalFlag(undefined)).toBeUndefined();
  });

  it("strips a falsy claim too, because the key is what renders the pill", () => {
    // `personal: false` is not dangerous, but leaving it would make "has the key" and "is
    // personal" two different questions — and `active.organization.ts` writes only `true`.
    expect(stripPersonalFlag({ personal: false })).toBeUndefined();
  });
});

describe("the organization-creation hook", () => {
  it("returns the organization with any personal claim removed", async () => {
    const result = await hooksOf().beforeCreateOrganization?.({
      organization: { name: "Globex", slug: "globex", metadata: { personal: true } },
      user: { id: "user-1" } as never,
    });

    expect(result?.data).toEqual({ name: "Globex", slug: "globex", metadata: undefined });
  });

  it("leaves an ordinary creation untouched", async () => {
    const organization = { name: "Globex", slug: "globex" };

    const result = await hooksOf().beforeCreateOrganization?.({
      organization,
      user: { id: "user-1" } as never,
    });

    expect(result?.data).toEqual({ ...organization, metadata: undefined });
  });
});

describe("the audit seam (#725)", () => {
  it("calls nothing when no sink is supplied, which is every deployment today", async () => {
    // The hooks are registered unconditionally so their shape is fixed now rather than
    // negotiated later — but with nothing behind them they must not so much as look at an
    // audit trail. This asserts they run clean, which is what keeps the plugin's own code
    // path unchanged until #725 lands.
    const hooks = hooksOf();

    await expect(
      hooks.beforeCreateOrganization?.({
        organization: { name: "Globex" },
        user: { id: "user-1" } as never,
      }),
    ).resolves.toBeDefined();
    await expect(
      hooks.afterAddMember?.({
        member: { organizationId: "org-1", userId: "user-2", role: "member" } as never,
        user: { id: "user-2" } as never,
        organization: { id: "org-1" } as never,
      }),
    ).resolves.toBeUndefined();
  });

  it("reports an organization coming into existence, before the row is written", async () => {
    // `before`, so a sink that throws stops the creation — which is what makes this the hook
    // a policy attaches to rather than only a log.
    const organizationCreating = jest.fn(async () => {});

    await hooksOf({ organizationCreating }).beforeCreateOrganization?.({
      organization: { name: "Globex", slug: "globex" },
      user: { id: "user-1" } as never,
    });

    expect(organizationCreating).toHaveBeenCalledWith({
      name: "Globex",
      slug: "globex",
      userId: "user-1",
    });
  });

  it("reports somebody joining, after the membership row exists", async () => {
    // `after`, because an audit entry for a member who was not added would be worse than no
    // entry at all.
    const memberAdded = jest.fn(async () => {});

    await hooksOf({ memberAdded }).afterAddMember?.({
      member: { organizationId: "org-1", userId: "user-2", role: "viewer" } as never,
      user: { id: "user-2" } as never,
      organization: { id: "org-1" } as never,
    });

    expect(memberAdded).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-2",
      role: "viewer",
    });
  });

  it("still strips the personal flag when a sink is attached", async () => {
    // The two responsibilities share one hook because the plugin allows one
    // `beforeCreateOrganization`. This is what stops #725's arrival from quietly dropping
    // the rule that was there first.
    const result = await hooksOf({
      organizationCreating: jest.fn(async () => {}),
    }).beforeCreateOrganization?.({
      organization: { name: "Globex", metadata: { personal: true, plan: "team" } },
      user: { id: "user-1" } as never,
    });

    expect(result?.data.metadata).toEqual({ plan: "team" });
  });
});
