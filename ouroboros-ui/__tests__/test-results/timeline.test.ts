import { describe, expect, it } from "vitest";

import type { CommitSource } from "@/app/runs/cards";
import {
  ACTIVITY,
  INTENT_STORED_NOTE,
  PR_PLANE_NOTE,
  attemptCard,
  attemptResult,
  attemptTone,
  clockOf,
  futureCard,
  gateLine,
  scrollToReveal,
  timelineView,
} from "@/app/test-results/timeline";

import { BUILD_1_ID, attempt, mockupAttempts, strip, timeline } from "../helpers/test-results";

/**
 * The build attempts timeline as data (#336): each card's hue and result line, the UTC clock, the
 * sha that links only when its source can build the URL, the *Next* card's honest and activated
 * variants (T8), and where the strip scrolls to.
 */

const GITHUB: CommitSource = { kind: "github", owner: "acme-robotics", name: "helios-firmware" };

describe("clockOf", () => {
  it("prints the time of day in UTC, with and without seconds", () => {
    expect(clockOf("2026-09-19T13:52:41.000Z")).toBe("13:52:41");
    expect(clockOf("2026-09-19T13:52:41.000Z", false)).toBe("13:52");
    expect(clockOf("2026-09-19T23:05:09-06:00")).toBe("05:05:09");
  });

  it("answers null for a value that is not a date", () => {
    expect(clockOf("soon")).toBeNull();
    expect(clockOf("")).toBeNull();
  });
});

describe("attemptTone and attemptResult", () => {
  it("colours a finished attempt by its pass ratio", () => {
    const [one, two] = mockupAttempts();

    expect(attemptTone(one!)).toBe("err");
    expect(attemptResult(one!)).toBe("49/63 · 14 failed ✗");
    expect(attemptTone(two!)).toBe("warn");
    expect(attemptResult(two!)).toBe("61/63 · 2 failed");
  });

  it("says a green attempt is green", () => {
    const green = attempt(4, { strip: strip({ passed: 63, failed: 0, failedCases: [] }) });

    expect(attemptTone(green)).toBe("ok");
    expect(attemptResult(green)).toBe("63/63 · all passed ✓");
  });

  it("says what a running build is doing, whatever it has counted so far", () => {
    for (const [selection, words] of [
      ["failed", ACTIVITY.failed],
      ["full", ACTIVITY.full],
      [null, ACTIVITY.build],
    ] as const) {
      const running = attempt(3, { status: "running", selection });

      expect(attemptTone(running)).toBe("live");
      expect(attemptResult(running)).toBe(words);
    }
    expect(ACTIVITY.failed).toBe("running re-run of failed set");
  });

  it("reads an errored build as err even when every reported case passed", () => {
    const errored = attempt(2, { status: "error", strip: strip({ passed: 63, failed: 0 }) });

    expect(attemptTone(errored)).toBe("err");
    expect(attemptResult(errored)).toBe("63/63 · 0 failed ✗");
  });

  it("invents no ratio for an attempt that reported no case", () => {
    const empty = strip({ total: 0, passed: 0, failed: 0, failedCases: [] });

    expect(attemptTone(attempt(1, { strip: empty }))).toBe("neutral");
    expect(attemptResult(attempt(1, { strip: empty }))).toBe("no cases reported");
    expect(attemptResult(attempt(1, { status: "error", strip: empty }))).toBe("errored before reporting ✗");
  });
});

describe("attemptCard", () => {
  it("draws the label, the clock and the abbreviated sha, linked on GitHub", () => {
    const sha = "a3f19c2d5e6f708192a3b4c5d6e7f8091a2b3c4d";
    const card = attemptCard(attempt(1, { commitSha: sha, startedAt: "2026-09-19T13:52:41.000Z" }), 3, GITHUB);

    expect(card).toEqual(
      expect.objectContaining({
        id: BUILD_1_ID,
        attemptSeq: 1,
        label: "Build 1",
        time: "13:52:41",
        selected: false,
        commit: {
          shortSha: "a3f19c2",
          href: `https://github.com/acme-robotics/helios-firmware/commit/${sha}`,
        },
      }),
    );
  });

  it("links a sha on a source that is not GitHub", () => {
    const gitlab: CommitSource = { kind: "gitlab", path: "acme/firmware/helios", baseUrl: "https://git.acme.dev" };
    const bitbucket: CommitSource = { kind: "bitbucket", workspace: "acme", name: "helios" };

    expect(attemptCard(attempt(1, { commitSha: "a3f19c2" }), 1, gitlab).commit?.href).toBe(
      "https://git.acme.dev/acme/firmware/helios/-/commit/a3f19c2",
    );
    expect(attemptCard(attempt(1, { commitSha: "a3f19c2" }), 1, bitbucket).commit?.href).toBe(
      "https://bitbucket.org/acme/helios/commits/a3f19c2",
    );
  });

  it("leaves the sha unlinked when the source cannot produce a commit URL", () => {
    expect(attemptCard(attempt(1, { commitSha: "a3f19c2" }), 1, null).commit).toEqual({
      shortSha: "a3f19c2",
      href: null,
    });
    expect(attemptCard(attempt(1, { commitSha: "../../x" }), 1, GITHUB).commit?.href).toBeNull();
    expect(
      attemptCard(attempt(1, { commitSha: "a3f19c2" }), 1, { kind: "gitlab", path: "a/b", baseUrl: "javascript:alert(1)" })
        .commit?.href,
    ).toBeNull();
  });

  it("draws no commit for an attempt that names none, and marks the selected one", () => {
    const card = attemptCard(attempt(2, { commitSha: null }), 2, GITHUB);

    expect(card.commit).toBeNull();
    expect(card.selected).toBe(true);
  });
});

describe("the Next card (T8)", () => {
  it("names the pull request only when one is linked and its gate is armed", () => {
    expect(futureCard(timeline().next)).toEqual({
      variant: "activated",
      result: "Publish to PR #514 when green",
      meta: "auto · gated on 63/63",
    });
  });

  it("renders the honest variant, with its activation note, while no PR gate exists", () => {
    const next = { ...timeline().next, pullRequest: null, activation: "none" as const, gate: null };

    expect(futureCard(next)).toEqual({
      variant: "honest",
      result: "auto · gated on 63/63",
      meta: PR_PLANE_NOTE,
    });
    expect(PR_PLANE_NOTE).toBe("PR publishing activates with the PR plane");
  });

  it("says a stored intent is stored, and still names no pull request", () => {
    const next = { ...timeline().next, pullRequest: null, activation: "intent_stored" as const, gate: null };
    const card = futureCard(next);

    expect(card.variant).toBe("honest");
    expect(card.meta).toBe(INTENT_STORED_NOTE);
    expect(card.meta).toContain(PR_PLANE_NOTE);
    expect(`${card.result}${card.meta}`).not.toMatch(/#\d/);
  });

  it("prints no PR number for a pull request whose gate is not armed, or a gate with no pull request", () => {
    const unarmed = futureCard({ ...timeline().next, activation: "none" });
    const unlinked = futureCard({ ...timeline().next, pullRequest: null });

    for (const card of [unarmed, unlinked]) {
      expect(card.variant).toBe("honest");
      expect(`${card.result}${card.meta}`).not.toContain("514");
    }
  });

  it("invents no count before any attempt has reported", () => {
    expect(gateLine(null)).toBe("auto · gated on a green build");
    expect(gateLine({ passed: 12, total: 12 })).toBe("auto · gated on 12/12");
  });
});

describe("timelineView", () => {
  it("draws the head, a card per attempt oldest first, and the Next card", () => {
    const view = timelineView(timeline({ attempts: mockupAttempts() }), 3, GITHUB);

    expect(view.branch).toBe("branch loop/482-canbus-flake");
    expect(view.loop).toBe("loop #1847 · started 13:50 UTC");
    expect(view.attempts.map((card) => [card.label, card.tone, card.selected])).toEqual([
      ["Build 1", "err", false],
      ["Build 2", "warn", false],
      ["Build 3", "live", true],
    ]);
    expect(view.next.variant).toBe("activated");
  });

  it("draws no branch tag for a run with no branch, and no start that is not a date", () => {
    const bare = timeline();
    const view = timelineView({ ...bare, run: { ...bare.run, branch: null, startedAt: "?" } }, 3, null);

    expect(view.branch).toBeNull();
    expect(view.loop).toBe("loop #1847");
  });
});

describe("scrollToReveal", () => {
  it("leaves the strip alone when the card is wholly in view", () => {
    expect(scrollToReveal({ start: 100, size: 200 }, 0, 600)).toBeNull();
    expect(scrollToReveal({ start: 100, size: 200 }, 100, 200)).toBeNull();
  });

  it("scrolls back to a card before the view, and forward just far enough for one after it", () => {
    expect(scrollToReveal({ start: 100, size: 200 }, 250, 600)).toBe(100);
    expect(scrollToReveal({ start: 700, size: 200 }, 0, 600)).toBe(300);
  });

  it("shows the leading edge of a card wider than the view, and never scrolls before the start", () => {
    expect(scrollToReveal({ start: 400, size: 900 }, 0, 600)).toBe(400);
    expect(scrollToReveal({ start: -4, size: 200 }, 50, 600)).toBe(0);
  });
});
