import { pushPermission, REPOSITORY_ROUTE } from "./github.permissions";

describe("pushPermission (DK.1, #1318)", () => {
  it("reads the account's push permission as GitHub said it", () => {
    expect(pushPermission({ permissions: { admin: false, push: true, pull: true } })).toBe(true);
    expect(pushPermission({ permissions: { push: false, pull: true } })).toBe(false);
  });

  it("is null when the answer does not say", () => {
    expect(pushPermission({ full_name: "acme/helios" })).toBeNull();
    expect(pushPermission({ permissions: null })).toBeNull();
    expect(pushPermission({ permissions: { push: "yes" } })).toBeNull();
    expect(pushPermission(undefined)).toBeNull();
    expect(pushPermission("acme/helios")).toBeNull();
  });

  it("asks a read route", () => {
    expect(REPOSITORY_ROUTE).toBe("GET /repos/{owner}/{repo}");
  });
});
