import type { OrganizationRole } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors/error.envelope";
import { OTHER_WORKSPACE, OWNER, VIEWER, WORKSPACE, world } from "./workspace.fixture";
import { DOMAIN_CONSEQUENCE } from "./workspace.resources";
import { RESIDENCY_DOCS_URL } from "./workspace.truth";

/**
 * The card's rules, over an in-memory `organization` row and `tenant_domains` table: who may edit
 * what, the domain save that replaces the primary, `domain_taken` leaving everything unchanged,
 * and the deployment truth that no caller can move.
 */

describe("reading the workspace card", () => {
  it("reports the name, the primary domain and the self-hosted truth", async () => {
    const { service, seedDomain } = world({ region: "eu-central-1" });
    seedDomain(WORKSPACE, "acme.ouroboros.dev", true);
    seedDomain(WORKSPACE, "acme-labs.io", false);

    expect(await service.read(WORKSPACE, OWNER)).toEqual({
      id: WORKSPACE,
      slug: "acme-robotics",
      deployment: "self_hosted",
      name: { value: "acme-robotics", editable: true, reason: null },
      domain: {
        value: "acme.ouroboros.dev",
        editable: true,
        reason: null,
        tags: [],
        consequence: DOMAIN_CONSEQUENCE,
      },
      region: {
        label: "eu-central-1",
        selectable: false,
        source: "configured",
        reason: "deployment",
        docsUrl: RESIDENCY_DOCS_URL,
      },
      trainingData: { enabled: false, changeable: false, reason: "deployment" },
    });
  });

  it("says self-hosted, by default, when the operator named no region", async () => {
    const { service } = world();

    expect((await service.read(WORKSPACE, OWNER)).region).toMatchObject({
      label: "self-hosted",
      source: "default",
      selectable: false,
    });
  });

  it("reports a workspace with no domain as null, with no tags", async () => {
    const { service } = world({ ssoEnforced: true });

    expect((await service.read(WORKSPACE, OWNER)).domain).toMatchObject({ value: null, tags: [] });
  });

  it("omits the SSO tag when SSO is not enforced — absent, not false", async () => {
    const { service, seedDomain } = world({ ssoEnforced: false });
    seedDomain(WORKSPACE, "acme.io", true);

    expect((await service.read(WORKSPACE, OWNER)).domain.tags).toEqual([]);
  });

  it("tags the domain sso_enforced when SSO is enforced on it", async () => {
    const { service, seedDomain } = world({ ssoEnforced: true });
    seedDomain(WORKSPACE, "acme.io", true);

    expect((await service.read(WORKSPACE, OWNER)).domain.tags).toEqual(["sso_enforced"]);
  });

  it.each<[OrganizationRole, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ])("gives a %s editable=%s, with reason role when not", async (role, editable) => {
    const { service } = world();
    const card = await service.read(WORKSPACE, { userId: "u", roles: [role] });
    const expected = editable ? { editable, reason: null } : { editable, reason: "role" };

    expect(card.name).toMatchObject(expected);
    expect(card.domain).toMatchObject(expected);
  });

  it("gives every non-interactive control a reason", async () => {
    const { service } = world();
    const card = await service.read(WORKSPACE, VIEWER);

    for (const control of [card.name, card.domain]) {
      expect(control.editable || control.reason !== null).toBe(true);
    }
    expect(card.region.selectable || card.region.reason !== null).toBe(true);
    expect(card.trainingData.changeable || card.trainingData.reason !== null).toBe(true);
  });

  it("never produces the plan-locked training variant, whatever the role", async () => {
    const { service } = world({ region: "eu-central-1" });

    for (const caller of [OWNER, VIEWER]) {
      expect((await service.read(WORKSPACE, caller)).trainingData.reason).toBe("deployment");
    }
  });

  it("answers 404 for a workspace that is gone", async () => {
    const { service } = world();

    await expect(service.read(OTHER_WORKSPACE, OWNER)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("saving the workspace card", () => {
  it("renames through the name store and reads the new name back", async () => {
    const { service, names } = world();

    const card = await service.update(WORKSPACE, OWNER, { name: "Acme Robotics" });

    expect(names.rename).toHaveBeenCalledWith(WORKSPACE, "Acme Robotics");
    expect(card.name.value).toBe("Acme Robotics");
  });

  it("replaces the primary domain, leaving the other domains alone", async () => {
    const { service, seedDomain, domainsOf } = world();
    seedDomain(WORKSPACE, "acme.io", true);
    seedDomain(WORKSPACE, "acme-labs.io", false);

    const card = await service.update(WORKSPACE, OWNER, { domain: "acme.ouroboros.dev" });

    expect(card.domain.value).toBe("acme.ouroboros.dev");
    expect(domainsOf(WORKSPACE)).toEqual(["*acme.ouroboros.dev", "acme-labs.io"]);
  });

  it("promotes a domain the workspace already lists rather than inserting it twice", async () => {
    const { service, seedDomain, domainsOf } = world();
    seedDomain(WORKSPACE, "acme.io", true);
    seedDomain(WORKSPACE, "acme-labs.io", false);

    await service.update(WORKSPACE, OWNER, { domain: "acme-labs.io" });

    expect(domainsOf(WORKSPACE)).toEqual(["*acme-labs.io"]);
  });

  it("adds the first domain to a workspace that had none", async () => {
    const { service, domainsOf } = world();

    await service.update(WORKSPACE, OWNER, { domain: "acme.io" });

    expect(domainsOf(WORKSPACE)).toEqual(["*acme.io"]);
  });

  it("refuses a domain another workspace holds with 409 domain_taken, bound to the field", async () => {
    const { service, seedDomain, domainsOf, names, audit } = world();
    seedDomain(WORKSPACE, "acme.io", true);
    seedDomain(OTHER_WORKSPACE, "taken.io", true);

    const refusal = await service
      .update(WORKSPACE, OWNER, { name: "Renamed", domain: "taken.io" })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictError);
    expect(refusal).toMatchObject({
      code: "domain_taken",
      details: { fields: { domain: ["That domain belongs to another workspace."] } },
    });
    // All or nothing: the old primary survives, and the name in the same save is not written.
    expect(domainsOf(WORKSPACE)).toEqual(["*acme.io"]);
    expect(names.rename).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is not the domain's uniqueness", async () => {
    const { service, domainStatements } = world();
    domainStatements.clearPrimary.mockRejectedValueOnce(new Error("connection reset"));

    await expect(service.update(WORKSPACE, OWNER, { domain: "acme.io" })).rejects.toThrow(
      "connection reset",
    );
  });

  it("audits what changed, with the previous values", async () => {
    const { service, seedDomain, audit } = world();
    seedDomain(WORKSPACE, "acme.io", true);

    await service.update(WORKSPACE, OWNER, { name: "Acme Robotics", domain: "acme.dev" });

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      organizationId: WORKSPACE,
      actorId: "user-owner",
      action: "workspace.updated",
      subjectType: "workspace",
      subjectId: WORKSPACE,
      detail: {
        fields: "domain,name",
        name: "Acme Robotics",
        previousName: "acme-robotics",
        domain: "acme.dev",
        previousDomain: "acme.io",
      },
    });
  });

  it("writes nothing and audits nothing when nothing changed", async () => {
    const { service, seedDomain, names, audit } = world();
    seedDomain(WORKSPACE, "acme.io", true);

    const card = await service.update(WORKSPACE, OWNER, {
      name: "acme-robotics",
      domain: "acme.io",
    });
    await service.update(WORKSPACE, OWNER, {});

    expect(card.name.value).toBe("acme-robotics");
    expect(names.rename).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("leaves the region and training data as the deployment declares them", async () => {
    const { service } = world({ region: "eu-central-1" });

    const card = await service.update(WORKSPACE, OWNER, { name: "Acme" });

    expect(card.region).toMatchObject({ label: "eu-central-1", selectable: false });
    expect(card.trainingData).toEqual({ enabled: false, changeable: false, reason: "deployment" });
  });
});
