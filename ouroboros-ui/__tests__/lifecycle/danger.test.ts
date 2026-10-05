import { describe, expect, it } from "vitest";

import {
  DELETE_TITLE,
  DISCONNECT_TITLE,
  DISCONNECT_WHY,
  PAUSE_SEMANTICS,
  PAUSE_TITLE,
  PAUSE_WHY,
  RUNNING_STATE,
  deleteButton,
  deleteConsequences,
  deleteDialogTitle,
  deleteWhy,
  disconnectSummary,
  inFlightSentence,
  inFlightUnavailable,
  lifecycleUnread,
  nameMatches,
  pauseState,
  pauseSwitchLabel,
  previewUnavailable,
  typeNameLabel,
  typeNameReason,
  utcStamp,
} from "@/app/lifecycle/danger";

import { disconnectPreview, lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";

/**
 * The Danger zone's copy and rules (BS.6, #496): mockup 17's words verbatim, the exact-match
 * rule both destructive confirmations share, and the sentences that make each confirmation
 * informative rather than only a second click.
 */

describe("the three rows", () => {
  it("are mockup 17's, verbatim", () => {
    expect(PAUSE_TITLE).toBe("Pause all loops");
    expect(PAUSE_WHY).toBe("queued issues stay queued; running loops finish their stage");
    expect(DISCONNECT_TITLE).toBe("Disconnect GitHub App");
    expect(DISCONNECT_WHY).toBe("open PRs remain, loops stop");
    expect(DELETE_TITLE).toBe("Delete workspace");
    expect(deleteWhy(30)).toBe("type the workspace name to confirm · 30-day recovery window");
    expect(deleteButton("acme-robotics")).toBe("Delete acme-robotics…");
  });

  it("take the recovery window from the service, not from the mockup", () => {
    expect(deleteWhy(14)).toContain("14-day recovery window");
  });
});

describe("the pause row", () => {
  it("states the semantics verbatim in the confirmation", () => {
    expect(PAUSE_SEMANTICS).toContain(PAUSE_WHY);
  });

  it("says where the switch stands, in words", () => {
    expect(pauseState(lifecycle())).toBe(RUNNING_STATE);
    expect(pauseState(pausedLifecycle({ changedAt: "2026-10-05T14:02:00.000Z" }))).toBe(
      "Paused since 2026-10-05 14:02 UTC",
    );
    expect(pauseState(lifecycle({ state: "paused" }))).toBe("Paused");
    expect(pauseState(pendingDeleteLifecycle())).toMatch(/pending deletion/);
  });

  it("names the switch by what a press would do", () => {
    expect(pauseSwitchLabel(false)).toBe("Pause all loops");
    expect(pauseSwitchLabel(true)).toBe("Resume all loops");
  });

  it("words the in-flight count for none, one and several", () => {
    expect(inFlightSentence(0)).toMatch(/^No runs are in flight/);
    expect(inFlightSentence(1)).toBe("1 run is in flight — it finishes its current stage, then holds.");
    expect(inFlightSentence(3)).toBe(
      "3 runs are in flight — each finishes its current stage, then holds.",
    );
    // A count the service could never send still reads as none rather than as "-1 runs".
    expect(inFlightSentence(-1)).toMatch(/^No runs/);
  });

  it("says the count is unavailable and why, without claiming there are none", () => {
    const sentence = inFlightUnavailable("The service is restarting.");

    expect(sentence).toContain("unavailable");
    expect(sentence).toContain("The service is restarting.");
    expect(sentence).not.toMatch(/No runs/);
  });
});

describe("the typed confirmation", () => {
  it("accepts the workspace's name and nothing else", () => {
    expect(nameMatches("acme-robotics", "acme-robotics")).toBe(true);
  });

  it.each([
    ["a different case", "Acme-Robotics"],
    ["a trailing space", "acme-robotics "],
    ["a leading space", " acme-robotics"],
    ["a prefix", "acme-robot"],
    ["a longer name", "acme-robotics-2"],
    ["nothing", ""],
    ["a look-alike hyphen", "acme‑robotics"],
  ])("refuses %s — byte for byte, as the service compares", (_what, typed) => {
    expect(nameMatches(typed, "acme-robotics")).toBe(false);
  });

  it("never matches an empty name, so a workspace without one cannot be confirmed by typing nothing", () => {
    expect(nameMatches("", "")).toBe(false);
  });

  it("names the workspace in its label and its reason", () => {
    expect(typeNameLabel("acme-robotics")).toBe("Type acme-robotics to confirm");
    expect(typeNameReason("acme-robotics")).toContain("acme-robotics");
  });
});

describe("the disconnect", () => {
  it("summarises what it did from the answer's counts, in the past tense", () => {
    expect(disconnectSummary(disconnectPreview())).toEqual([
      "4 open pull requests were left on GitHub, untouched.",
      "2 runs in flight finish their current stage, then stop.",
      "1 GitHub source was paused; 3 enabled repositories no longer sync.",
      "The stored GitHub token was deleted.",
      "All loops are paused. Reconnect GitHub in Sources, then resume here.",
    ]);
  });

  it("words one of each, and none of each", () => {
    expect(
      disconnectSummary(
        disconnectPreview({ openPullRequests: 1, activeRuns: 1, syncingSources: 2, enabledRepositories: 1 }),
      ).slice(0, 3),
    ).toEqual([
      "1 open pull request was left on GitHub, untouched.",
      "1 run in flight finishes its current stage, then stops.",
      "2 GitHub sources were paused; 1 enabled repository no longer syncs.",
    ]);

    const none = disconnectSummary(
      disconnectPreview({ openPullRequests: 0, activeRuns: 0, tokenStored: false }),
    );

    expect(none[0]).toBe("No pull requests were open.");
    expect(none[1]).toBe("No runs were in flight.");
    expect(none[3]).toBe("No GitHub token was stored.");
  });

  it("says why the preview could not be read", () => {
    expect(previewUnavailable("Not yours.")).toBe("What disconnecting would do could not be read: Not yours.");
  });
});

describe("the delete", () => {
  it("names the workspace in its title", () => {
    expect(deleteDialogTitle("acme-robotics")).toBe("Delete acme-robotics?");
  });

  it("lists the freeze, the sign-outs, the stop, the window and what follows it", () => {
    const list = deleteConsequences(30);

    expect(list).toHaveLength(5);
    expect(list[0]).toMatch(/recovery screen/);
    expect(list[1]).toMatch(/not an owner/);
    expect(list[2]).toMatch(/dispatch/);
    expect(list[3]).toMatch(/owner for 30 days/);
    expect(list[4]).toMatch(/After 30 days.*encryption key.*cannot be undone/);
  });
});

describe("the small tools", () => {
  it("stamps an instant in UTC, labelled, and leaves a non-instant alone", () => {
    expect(utcStamp("2026-10-05T14:02:59.000Z")).toBe("2026-10-05 14:02 UTC");
    expect(utcStamp("soon")).toBe("soon");
  });

  it("says no control is drawn when the lifecycle could not be read", () => {
    expect(lifecycleUnread("The service is restarting.")).toMatch(
      /no control is drawn: The service is restarting\.$/,
    );
  });
});
