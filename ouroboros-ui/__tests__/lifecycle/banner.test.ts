import { describe, expect, it } from "vitest";

import {
  DANGER_ZONE_PATH,
  PAUSED_HEADLINE,
  PAUSED_MESSAGE,
  isLifecycle,
  mayResume,
  pausedBanner,
} from "@/app/lifecycle/banner";

import { lifecycle, pausedLifecycle, pendingDeleteLifecycle, PAUSED_SENTENCE } from "../helpers/lifecycle";

/**
 * The paused banner's decisions (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)):
 * when it is drawn, what it says, and who is offered the button.
 */

describe("the banner's line", () => {
  it("is the issue's own", () => {
    expect(PAUSED_HEADLINE).toBe("all loops paused — stages finishing");
  });
});

describe("pausedBanner", () => {
  it("draws nothing before the first answer, while active, or while pending deletion", () => {
    expect(pausedBanner(null)).toBeNull();
    expect(pausedBanner(lifecycle())).toBeNull();
    // A frozen workspace is the recovery screen's, not a bar over pages that cannot be read.
    expect(pausedBanner(pendingDeleteLifecycle())).toBeNull();
  });

  it("carries the service's sentence and its path while paused", () => {
    expect(pausedBanner(pausedLifecycle())).toEqual({
      message: PAUSED_SENTENCE,
      actionPath: "/settings#danger",
    });
  });

  it("still says something true when a paused lifecycle arrives without a banner", () => {
    expect(pausedBanner(pausedLifecycle({ banner: null }))).toEqual({
      message: PAUSED_MESSAGE,
      actionPath: DANGER_ZONE_PATH,
    });
  });
});

describe("mayResume", () => {
  it("is the service's rule: owner or admin", () => {
    expect(mayResume("owner")).toBe(true);
    expect(mayResume("admin")).toBe(true);
    expect(mayResume("member")).toBe(false);
    expect(mayResume("viewer")).toBe(false);
  });

  it("reads the organization plugin's comma-separated roles", () => {
    expect(mayResume("member,admin")).toBe(true);
    expect(mayResume("member, viewer")).toBe(false);
  });

  it("errs low for a role not yet known or not recognised", () => {
    expect(mayResume(null)).toBe(false);
    expect(mayResume("")).toBe(false);
    expect(mayResume("administrator")).toBe(false);
  });
});

describe("isLifecycle", () => {
  it("accepts each of the three states, with or without a banner", () => {
    expect(isLifecycle(lifecycle())).toBe(true);
    expect(isLifecycle(pausedLifecycle())).toBe(true);
    expect(isLifecycle(pendingDeleteLifecycle())).toBe(true);
  });

  it("refuses what is not one", () => {
    expect(isLifecycle(null)).toBe(false);
    expect(isLifecycle("paused")).toBe(false);
    expect(isLifecycle({})).toBe(false);
    expect(isLifecycle({ state: "archived" })).toBe(false);
    expect(isLifecycle({ state: "paused", banner: "paused" })).toBe(false);
    expect(isLifecycle({ state: "paused", banner: { message: 1, actionPath: "/x" } })).toBe(false);
    expect(isLifecycle({ code: "lifecycle_unavailable", message: "down" })).toBe(false);
  });
});
