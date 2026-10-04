import { SERVICE_SCOPES } from "../auth/service.scopes";
import { accountRow } from "./service-accounts.fixture";
import { serviceAccountResource, serviceScopeResources } from "./service-accounts.resources";

/**
 * What the service-account routes publish (#485) — and, as much, what they never do.
 */

describe("rendering an account", () => {
  it("publishes its identity, scopes and masked token — and no field that could be the token", () => {
    const resource = serviceAccountResource(accountRow(), "orb_svc_••••ab12");

    expect(Object.keys(resource).sort()).toEqual([
      "actor",
      "createdAt",
      "createdBy",
      "disabledAt",
      "id",
      "name",
      "scopes",
      "token",
    ]);
    expect(resource.actor).toBe("service:devops-bot");
    expect(Object.keys(resource.token ?? {}).sort()).toEqual(["createdAt", "hint", "lastUsedAt"]);
  });

  it("renders a revoked account with no token", () => {
    const resource = serviceAccountResource(
      accountRow({
        disabled_at: new Date("2026-10-04T00:00:00.000Z"),
        token_id: null,
        token_hint_sealed: null,
        token_created_at: null,
      }),
      null,
    );

    expect(resource).toMatchObject({ disabledAt: "2026-10-04T00:00:00.000Z", token: null });
  });

  it("renders last use when there was one", () => {
    const resource = serviceAccountResource(
      accountRow({ token_last_used_at: new Date("2026-10-03T13:00:00.000Z") }),
      "hint",
    );

    expect(resource.token?.lastUsedAt).toBe("2026-10-03T13:00:00.000Z");
  });
});

describe("the registered scopes", () => {
  it("lists every scope with what it grants", () => {
    expect(serviceScopeResources().map((scope) => scope.scope)).toEqual([...SERVICE_SCOPES]);
    expect(serviceScopeResources().every((scope) => scope.description.length > 0)).toBe(true);
  });
});
