import { describe, expect, it } from "vitest";

import type { Role } from "@/app/api/membership";
import {
  READ_ONLY_ACCESS,
  READ_ONLY_BODY,
  readOnlyNote,
  settingsAccess,
} from "@/app/settings/access";

/**
 * Who may do what on the settings hub (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): the page's three variants —
 * owner, admin, read-only — from the roles the service reported.
 */

describe("the page's variant", () => {
  it.each<[Role[], string, boolean, boolean]>([
    [["owner"], "owner", true, true],
    [["admin"], "admin", true, false],
    [["member"], "read-only", false, false],
    [["viewer"], "read-only", false, false],
  ])("for %j is %s", (roles, tier, mayEdit, mayOwn) => {
    const access = settingsAccess(roles);

    expect(access.tier).toBe(tier);
    expect(access.mayEdit).toBe(mayEdit);
    expect(access.mayOwn).toBe(mayOwn);
  });

  it("takes the strongest of several roles", () => {
    expect(settingsAccess(["member", "owner"]).tier).toBe("owner");
    expect(settingsAccess(["viewer", "admin"]).tier).toBe("admin");
    expect(settingsAccess(["member", "owner"]).role).toBe("owner");
  });

  it("keeps the owner-only operations from an admin", () => {
    const admin = settingsAccess(["admin"]);

    expect(admin.mayEdit).toBe(true);
    expect(admin.mayOwn).toBe(false);
  });

  it("errs low: a membership with no role this installation recognises is read-only", () => {
    // A page that guessed high would draw a control the service then refuses.
    expect(settingsAccess([])).toEqual({
      tier: "read-only",
      role: "viewer",
      mayEdit: false,
      mayOwn: false,
    });
    expect(READ_ONLY_ACCESS).toEqual(settingsAccess([]));
  });

  it("names the role beside the variant, for the note — never decides from it", () => {
    expect(settingsAccess(["member"]).role).toBe("member");
    expect(settingsAccess(["viewer"]).role).toBe("viewer");
  });
});

describe("the read-only note", () => {
  it("names the reader's role and says what is true: everything can be read", () => {
    expect(readOnlyNote("viewer")).toEqual({
      head: "Viewing workspace settings as a viewer.",
      body: READ_ONLY_BODY,
    });
    expect(readOnlyNote("member").head).toBe("Viewing workspace settings as a member.");
    expect(READ_ONLY_BODY).toMatch(/can be read/);
    expect(READ_ONLY_BODY).toMatch(/an owner or an admin/);
  });
});
