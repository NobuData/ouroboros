import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { AUTO_MERGE_READ_ONLY, AUTO_MERGE_WRITE_FAILURE } from "@/app/dashboard/view";

/**
 * The pulse card's one server hop ([#83](https://github.com/NobuData/ouroboros/issues/83)) —
 * the dashboard's only write.
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module
 * is written as the security case first. Here it is short, and it is the whole argument for
 * the shape of this module: **the only argument is the switch's new position.** There is no
 * workspace in the call and no person, so there is nothing to forge — the setting belongs to
 * the workspace the caller's own session is acting in, and the role gate is the service's.
 * The rest of the suite is the posture: a refusal is a value the card can draw, and the
 * gate's redirect is the one throw that must travel.
 */

/** What the API answers, per case. */
const set = vi.fn();

vi.mock("@/app/api/settings", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/settings")>(
    "@/app/api/settings",
  );

  // The code the action branches on is the contract's own, taken from the module that names
  // it — a suite that spelled `forbidden_role` out here would pass on the day the constant
  // stopped matching the service.
  return { ...actual, autoMerge: { ...actual.autoMerge, set: (on: boolean) => set(on) } };
});

// The settings facade is `server-only` and sits on the server-side client, whose own imports
// are the three every server-side suite answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

// One export, because a `"use server"` module may have no other kind: the sentences and the
// result type this action answers with are `app/dashboard/view.ts`'s, imported above.
const { setAutoMerge } = await import("@/app/dashboard/pulse-actions");

/**
 * The setting, as the service answers it.
 *
 * @param enabled Where the switch stands after the write.
 * @returns The resource.
 */
function setting(enabled: boolean) {
  return { enabled, updatedAt: "2026-08-14T18:20:00.000Z", updatedBy: "abc" };
}

beforeEach(() => {
  set.mockReset();
});

describe("setAutoMerge", () => {
  it("writes the position it was given, and nothing else", async () => {
    set.mockResolvedValue(setting(true));

    expect(await setAutoMerge(true)).toEqual({ ok: true, enabled: true });
    expect(set).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("answers with the row's own position rather than the one that was sent", async () => {
    // The service reads the setting back from the row after an upsert, which is what makes
    // two administrators pressing at once resolve to one answer instead of two.
    set.mockResolvedValue(setting(false));

    expect(await setAutoMerge(true)).toEqual({ ok: true, enabled: false });
  });

  it("turns the switch off as deliberately as it turns it on", async () => {
    set.mockResolvedValue(setting(false));

    expect(await setAutoMerge(false)).toEqual({ ok: true, enabled: false });
    expect(set).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("answers a role that may not administer the workspace in the switch's own words", async () => {
    // The service's `403` message is written for an API caller. A person who reached this
    // action anyway is told what the tooltip on the control would have told them — from the
    // one place that sentence is written.
    set.mockRejectedValue(
      new ApiError(403, "forbidden_role", "Only an owner or an admin may do that."),
    );

    expect(await setAutoMerge(true)).toEqual({ ok: false, reason: AUTO_MERGE_READ_ONLY });
  });

  it("keeps every other refusal as the value the card can draw", async () => {
    // A refusal is a state to render: one card's control failing must not replace the
    // dashboard the reader is still entitled to be on.
    set.mockRejectedValue(
      new ApiError(400, "organization_required", "Choose a workspace first."),
    );

    expect(await setAutoMerge(true)).toEqual({
      ok: false,
      reason: "Choose a workspace first.",
    });
  });

  it("has something to say even when the service's envelope did not", async () => {
    set.mockRejectedValue(new ApiError(502, "client_unreadable_error", ""));

    expect(await setAutoMerge(true)).toEqual({ ok: false, reason: AUTO_MERGE_WRITE_FAILURE });
  });

  it("lets the redirect signal travel, so an expired session still reaches login", async () => {
    // The one throw this must not swallow. A `catch` wide enough to hold Next.js's redirect
    // would draw a dashboard captioned with the framework's internal message instead of
    // navigating.
    const redirect = new Error("NEXT_REDIRECT /login");
    set.mockRejectedValue(redirect);

    await expect(setAutoMerge(true)).rejects.toBe(redirect);
  });
});
