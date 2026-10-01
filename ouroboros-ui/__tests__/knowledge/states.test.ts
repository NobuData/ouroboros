import { describe, expect, it } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { RepoMapStatusList } from "@/app/api/repo-map";
import {
  MAPS_UNREAD,
  MAP_FAILED,
  MAP_PENDING,
  MAP_PENDING_ADMIN_NOTE,
  MAP_PENDING_READER_NOTE,
  NO_SKILLS_ADMIN_NOTE,
  NO_SKILLS_READER_NOTE,
  SKELETON_FACTS,
  SKELETON_PLAYBOOKS,
  SKELETON_PROFILE_ROWS,
  SKELETON_SKILLS,
  SKELETON_STEPS,
  SKILL_EXPLAINER,
  generateName,
  mapsUnreadNote,
  noSkillsNote,
  pendingMapsNote,
  repoMapNotices,
} from "@/app/knowledge/states";

import {
  CONSOLE_REPO,
  READ_AT,
  TELEMETRY_REPO,
  failedMap,
  pendingMap,
  repoMapReport,
  repoMapStatus,
  repoMapStatuses,
} from "../helpers/knowledge";

/**
 * The decisions behind the states mockup 14 cannot show (#422): what an empty skills table says to
 * whom, and how a `repo-map` that has not generated is told apart from one that failed to.
 */

const NOW = new Date(READ_AT);

/**
 * A status reading that was read.
 *
 * @param list The statuses.
 * @returns The reading.
 */
function read(list: RepoMapStatusList): Reading<RepoMapStatusList> {
  return { ok: true, value: list };
}

describe("an empty skills table", () => {
  it("says what a skill is to everyone — it teaches before it asks", () => {
    expect(noSkillsNote(true)).toContain(SKILL_EXPLAINER);
    expect(noSkillsNote(false)).toContain(SKILL_EXPLAINER);
  });

  it("names both ways in for a reader who has them, and that nothing is enabled by either", () => {
    expect(noSkillsNote(true)).toBe(NO_SKILLS_ADMIN_NOTE);
    expect(NO_SKILLS_ADMIN_NOTE).toMatch(/Write one, or import/);
    expect(NO_SKILLS_ADMIN_NOTE).toMatch(/lands here as a draft/);
    expect(NO_SKILLS_ADMIN_NOTE).toMatch(/nothing reaches a run until you publish/);
  });

  it("names who brings one for a reader who cannot, rather than two actions they would be refused", () => {
    expect(noSkillsNote(false)).toBe(NO_SKILLS_READER_NOTE);
    expect(NO_SKILLS_READER_NOTE).toMatch(/An owner or an admin/);
    expect(NO_SKILLS_READER_NOTE).not.toMatch(/Write one, or import/);
  });

  it("apologises for nothing", () => {
    for (const note of [NO_SKILLS_ADMIN_NOTE, NO_SKILLS_READER_NOTE, MAP_PENDING_ADMIN_NOTE, MAP_PENDING_READER_NOTE]) {
      expect(note).not.toMatch(/sorry|unfortunately|oops|nothing to (?:see|show)/i);
    }
  });
});

describe("a repo-map with no row in the table", () => {
  it("draws nothing for a generated map — its row is in the table", () => {
    expect(repoMapNotices(read(repoMapStatuses()), NOW)).toEqual([]);
  });

  it("calls a map nobody has generated pending, in the neutral hue with a ring — nothing is wrong", () => {
    const [notice] = repoMapNotices(read(repoMapStatuses([pendingMap()])), NOW);

    // No sentence of its own: what pending means is said once, under the list.
    expect(notice).toEqual({
      repo: CONSOLE_REPO,
      state: "pending",
      chip: MAP_PENDING,
      tone: "neutral",
      dot: "ring",
      detail: null,
    });
  });

  it("says once what pending means — not broken, and what writes the first version", () => {
    const notices = repoMapNotices(read(repoMapStatuses([pendingMap(), pendingMap(TELEMETRY_REPO)])), NOW);

    expect(pendingMapsNote(notices, true)).toBe(MAP_PENDING_ADMIN_NOTE);
    expect(MAP_PENDING_ADMIN_NOTE).toMatch(/^Pending is not broken/);
    expect(MAP_PENDING_ADMIN_NOTE).toMatch(/generate it now/);
  });

  it("does not offer a member the generate they would be refused", () => {
    const notices = repoMapNotices(read(repoMapStatuses([pendingMap()])), NOW);

    expect(pendingMapsNote(notices, false)).toBe(MAP_PENDING_READER_NOTE);
    expect(MAP_PENDING_READER_NOTE).not.toMatch(/generate it now/);
  });

  it("says nothing about pending when no map is — a failed map is not waiting on the nightly job", () => {
    const notices = repoMapNotices(read(repoMapStatuses([failedMap()])), NOW);

    expect(pendingMapsNote(notices, true)).toBeNull();
    expect(pendingMapsNote([], true)).toBeNull();
  });

  it("calls a refused generation failed, in the error hue, with why, on whose request and when", () => {
    const [notice] = repoMapNotices(read(repoMapStatuses([failedMap()])), NOW);

    expect(notice).toMatchObject({ repo: TELEMETRY_REPO, state: "failed", chip: MAP_FAILED, tone: "err", dot: "filled" });
    expect(notice?.detail).toBe(
      "The host refused the read on the nightly run, 5h ago. The nightly job retries; check the " +
        "source's credential under Settings → Sources if it keeps failing.",
    );
  });

  it("says each reason in its own words, with what to do about that one", () => {
    const detail = (reason: "no_source" | "rate_limit" | "host_error"): string =>
      repoMapNotices(read(repoMapStatuses([failedMap(TELEMETRY_REPO, reason)])), NOW)[0]?.detail ?? "";

    expect(detail("no_source")).toMatch(/^No connected source covers this repository .* Connect a source/);
    expect(detail("rate_limit")).toMatch(/^The host rate-limited the read .* retries once the limit resets/);
    expect(detail("host_error")).toMatch(/^The host refused the read/);
  });

  it("names a generation somebody asked for as one on request", () => {
    const status = failedMap();
    const asked = { ...status, lastReport: repoMapReport({ ...status.lastReport, trigger: "manual" }) };

    expect(repoMapNotices(read(repoMapStatuses([asked])), NOW)[0]?.detail).toMatch(/on a run on request, 5h ago/);
  });

  it("never draws the two states alike: the chip, the hue and the dot all differ", () => {
    const [pending, failed] = repoMapNotices(read(repoMapStatuses([pendingMap(), failedMap()])), NOW);

    expect(pending?.chip).not.toBe(failed?.chip);
    expect(pending?.tone).not.toBe(failed?.tone);
    expect(pending?.dot).not.toBe(failed?.dot);
  });

  it("keeps the service's order, and leaves the generated ones out of it", () => {
    const notices = repoMapNotices(read(repoMapStatuses([failedMap(), repoMapStatus(), pendingMap()])), NOW);

    expect(notices.map((one) => [one.repo, one.state])).toEqual([
      [TELEMETRY_REPO, "failed"],
      [CONSOLE_REPO, "pending"],
    ]);
  });

  it("still says failed for a status that carries no report, without inventing a reason", () => {
    const [notice] = repoMapNotices(read(repoMapStatuses([{ ...failedMap(), lastReport: null }])), NOW);

    expect(notice?.detail).toBe("The last generation did not publish a map.");
  });

  it("claims neither state when the status could not be read, and says why instead", () => {
    const unread: Reading<RepoMapStatusList> = { ok: false, reason: "The service failed." };

    expect(repoMapNotices(unread, NOW)).toEqual([]);
    expect(mapsUnreadNote(unread)).toBe(`${MAPS_UNREAD}: The service failed.`);
    expect(mapsUnreadNote(read(repoMapStatuses()))).toBeNull();
  });

  it("names the generate action for its repository", () => {
    expect(generateName(CONSOLE_REPO)).toBe("Generate repo-map for acme-robotics/helios-console now");
  });
});

describe("the skeleton's geometry", () => {
  it("is the mockup's: six skills, five facts, three playbooks, five profile rows, three steps", () => {
    expect([SKELETON_SKILLS, SKELETON_FACTS, SKELETON_PLAYBOOKS, SKELETON_PROFILE_ROWS, SKELETON_STEPS]).toEqual([
      6, 5, 3, 5, 3,
    ]);
  });
});
