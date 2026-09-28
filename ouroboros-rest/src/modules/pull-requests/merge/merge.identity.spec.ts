import { MAX_IDENTITY, TOKEN_IDENTITY, claimsBot, identityUsed } from "./merge.identity";

/**
 * Identity honesty (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360), decision V3):
 * `merged_result.identity_used` is the login the host recorded, and never a `[bot]` claim while
 * merges are token-based — V058's `pr_merge_plans_identity_not_bot`, applied before the write.
 */
describe("identityUsed", () => {
  it("records the login the host says merged", () => {
    expect(identityUsed("ken-s")).toBe("ken-s");
    expect(identityUsed("  mara-okafor ")).toBe("mara-okafor");
  });

  it("records the configured token when the host names nobody", () => {
    expect(identityUsed(null)).toBe(TOKEN_IDENTITY);
    expect(identityUsed("   ")).toBe(TOKEN_IDENTITY);
  });

  it("makes a [bot] claim impossible, in any case", () => {
    for (const bot of ["ouroboros-app[bot]", "Ouroboros-App[BOT]", "dependabot[bot]"]) {
      expect(identityUsed(bot)).toBe(TOKEN_IDENTITY);
      expect(claimsBot(identityUsed(bot))).toBe(false);
    }
  });

  it("bounds the identity to V058's 255", () => {
    expect(identityUsed("k".repeat(300))).toHaveLength(MAX_IDENTITY);
  });
});
