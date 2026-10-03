import { SsoEnforcement } from "./workspace.sso";

describe("SSO enforcement before #722", () => {
  it("is never enforced — there is no SSO provider to enforce it", async () => {
    await expect(new SsoEnforcement().isEnforced("org-1", "acme.io")).resolves.toBe(false);
  });
});
