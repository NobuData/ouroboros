import { describe, expect, it } from "vitest";

import { unreadHeadline, unreadReason, unreadSections } from "@/app/settings/unread";

/**
 * The hub's error state as values (BS.6, #496): which sections hold a read that was made and
 * refused, counted once each, and what the page-level retry box says about them.
 */

const OK = { ok: true, value: {} } as const;
const DOWN = { ok: false, reason: "The service is restarting." } as const;

describe("unreadSections", () => {
  it("is empty while every read that was made succeeded", () => {
    expect(
      unreadSections({
        dryRun: OK,
        policy: OK,
        workspace: OK,
        retention: OK,
        members: OK,
        audit: OK,
        integrations: OK,
        routes: OK,
        lifecycle: OK,
      }),
    ).toEqual([]);
  });

  it("does not count a read that was never made, or never passed", () => {
    // The audit log is not requested for a reader below admin.
    expect(unreadSections({ dryRun: OK, audit: null })).toEqual([]);
    expect(unreadSections({})).toEqual([]);
  });

  it("names each read's seat", () => {
    expect(unreadSections({ dryRun: DOWN })).toEqual(["policies"]);
    expect(unreadSections({ policy: DOWN })).toEqual(["policies"]);
    expect(unreadSections({ workspace: DOWN })).toEqual(["workspace"]);
    expect(unreadSections({ retention: DOWN })).toEqual(["workspace"]);
    expect(unreadSections({ members: DOWN })).toEqual(["members"]);
    expect(unreadSections({ audit: DOWN })).toEqual(["audit"]);
    expect(unreadSections({ integrations: DOWN })).toEqual(["integrations"]);
    expect(unreadSections({ routes: DOWN })).toEqual(["notifications"]);
    expect(unreadSections({ lifecycle: DOWN })).toEqual(["danger"]);
  });

  it("counts a section once however many of its reads failed, in the page's order", () => {
    expect(
      unreadSections({
        lifecycle: DOWN,
        retention: DOWN,
        workspace: DOWN,
        dryRun: DOWN,
        policy: DOWN,
        members: OK,
      }),
    ).toEqual(["workspace", "policies", "danger"]);
  });
});

describe("the retry box's sentences", () => {
  it("counts in words that agree", () => {
    expect(unreadHeadline(1)).toBe("1 section could not be read.");
    expect(unreadHeadline(3)).toBe("3 sections could not be read.");
  });

  it("names the sections by their cards' titles, and says the rest stands", () => {
    expect(unreadReason(["workspace", "danger"])).toBe(
      "Workspace, Danger zone — each says why in its own card. The rest of the page is as the service answered.",
    );
  });
});
