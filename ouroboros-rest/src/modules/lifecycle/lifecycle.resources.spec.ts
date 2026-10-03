import { ACTIVE_STANDING } from "./lifecycle.state";
import { bannerFor, disconnectPreview, lifecycleResource } from "./lifecycle.resources";

const AT = new Date("2026-10-03T09:00:00Z");

describe("the lifecycle resource (#489)", () => {
  it("carries no banner while active", () => {
    expect(lifecycleResource(ACTIVE_STANDING)).toEqual({
      state: "active",
      changedAt: null,
      changedBy: null,
      purgeAfter: null,
      recoveryWindowDays: 30,
      banner: null,
    });
  });

  it("states the pause's semantics in the banner, with the resume path", () => {
    expect(bannerFor({ state: "paused", purgeAfter: null, changedAt: AT, changedBy: "u" })).toEqual(
      {
        kind: "paused",
        message:
          "All loops are paused. Running loops finish their stage; queued issues stay queued.",
        since: AT.toISOString(),
        actionLabel: "Resume",
        actionPath: "/settings#danger",
      },
    );
  });

  it("names the deletion date in the pending-deletion banner", () => {
    const banner = bannerFor({
      state: "pending_delete",
      purgeAfter: new Date("2026-11-02T09:00:00Z"),
      changedAt: AT,
      changedBy: "u",
    });

    expect(banner?.message).toContain("2026-11-02");
    expect(banner?.actionLabel).toBe("Restore");
  });
});

describe("the disconnect preview (#489)", () => {
  it("speaks each count in the singular and the plural", () => {
    const one = disconnectPreview({
      openPullRequests: 1,
      activeRuns: 1,
      syncingSources: 1,
      enabledRepositories: 1,
      tokenStored: false,
    });

    expect(one.consequences).toEqual([
      "1 open pull request remains on GitHub, untouched.",
      "1 running loop finishes its current stage, then stops.",
      "1 GitHub source and 1 repository stop syncing.",
      "No GitHub token is stored; nothing to delete.",
      "All loops are paused until you resume them.",
    ]);
    expect(
      disconnectPreview({
        openPullRequests: 0,
        activeRuns: 2,
        syncingSources: 2,
        enabledRepositories: 5,
        tokenStored: true,
      }).consequences.slice(0, 4),
    ).toEqual([
      "0 open pull requests remain on GitHub, untouched.",
      "2 running loops finish their current stage, then stop.",
      "2 GitHub sources and 5 repositories stop syncing.",
      "The stored GitHub token is deleted.",
    ]);
  });
});
