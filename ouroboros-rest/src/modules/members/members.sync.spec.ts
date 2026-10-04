import { DirectorySyncStatus } from "./members.sync";

/**
 * The Okta footer line is absent until SCIM (BT.1) exists and syncs (#485).
 */

describe("directory sync", () => {
  it("answers null — no sync line — because nothing syncs yet", async () => {
    await expect(new DirectorySyncStatus().current("org-1")).resolves.toBeNull();
  });
});
