import { describe, expect, it } from "vitest";

import {
  DRAFT_NEVER_INJECTS,
  GENERATED_OVERWRITE,
  GENERATED_TAG,
  MEMBER_REGENERATE_REASON,
  MEMBER_SWITCH_REASON,
  NONE_LABEL,
  NOT_COUNTED_LABEL,
  REQUIRED_NOTE,
  REQUIRED_TAG,
  UNPUBLISHED_TEXT,
  activeCount,
  editorAffordance,
  editorReason,
  generatedNote,
  nextSort,
  regenerateFailure,
  regenerateName,
  regenerateToast,
  scopeLabel,
  scopeNote,
  sortDirection,
  sortSkills,
  switchFailure,
  switchLabel,
  switchState,
  updated,
  usedBy,
  versionAge,
} from "@/app/knowledge/skills";

import {
  READ_AT,
  SEEDED_REPO,
  repoMapReport,
  seededSkill,
  seededSkills,
  seededStats,
  skillSummary,
} from "../helpers/knowledge";

/**
 * The skills table's judgements (#418): the six seeded rows come out as mockup 14 draws them,
 * every statistic carries its footnote, every refusal becomes a sentence, and the sort is stable.
 */

const NOW = new Date(READ_AT);
const STATS = { ok: true as const, value: seededStats() };
const UNREAD = { ok: false as const, reason: "The service failed." };

describe("the head", () => {
  it("counts the active skills from the service's figure, which never counts a draft", () => {
    expect(activeCount(seededSkills())).toBe("5 active");
    expect(activeCount({ skills: [], active: 1 })).toBe("1 active");
  });
});

describe("the scope tag", () => {
  it("spells the mockup's `repo` and `org-wide`", () => {
    expect(scopeLabel("repo")).toBe("repo");
    expect(scopeLabel("org")).toBe("org-wide");
    expect(scopeLabel("workflow")).toBe("workflow");
  });

  it("names the referent the tag compresses away", () => {
    expect(scopeNote(seededSkill("zephyr-conventions"))).toBe(`Applies to ${SEEDED_REPO}.`);
    expect(scopeNote(seededSkill("commit-style"))).toBe("Applies to every repository of the workspace.");
    expect(scopeNote(skillSummary({ scope: "workflow", repoRef: null, workflow: { id: "w", slug: "standard-fix" } })))
      .toBe("Applies to the workflow standard-fix.");
  });
});

describe("the Used-by cell", () => {
  it("draws the mockup's six labels from the stats", () => {
    const labels = seededSkills().skills.map((skill) => [skill.slug, usedBy(skill, STATS).label]);

    expect(labels).toEqual([
      ["commit-style", "every run"],
      ["hil-safety", "physical tests"],
      ["power-budget-checks", NONE_LABEL],
      ["pr-etiquette", "every PR"],
      ["repo-map", "every run"],
      ["zephyr-conventions", "61% of runs"],
    ]);
  });

  it("states the numerator, the denominator, the window and the injections in the footnote", () => {
    expect(usedBy(seededSkill("zephyr-conventions"), STATS).note).toBe(
      "11 of 18 runs in its scope carried it over the last 30 days (2026-08-31 to 2026-09-30); " +
        "11 injections across every consumer.",
    );
  });

  it("reads a draft's — as inert: nothing can use it, whatever the stats say", () => {
    const figure = usedBy(seededSkill("power-budget-checks"), STATS);

    expect(figure).toEqual({ label: NONE_LABEL, note: DRAFT_NEVER_INJECTS, zero: true, inert: true });
  });

  it("reads an enabled skill's zero as a real zero — enabled, and nothing has used it yet", () => {
    const stats = {
      ok: true as const,
      value: {
        ...seededStats(),
        skills: [{ slug: "commit-style", active: true, usedBy: { label: NONE_LABEL, carried: 0, inScope: 21 }, injections: 0 }],
      },
    };
    const figure = usedBy(seededSkill("commit-style"), stats);

    expect(figure.label).toBe(NONE_LABEL);
    expect(figure.zero).toBe(true);
    expect(figure.inert).toBe(false);
    expect(figure.note).toBe(
      "0 of 21 runs in its scope carried it over the last 30 days (2026-08-31 to 2026-09-30); " +
        "0 injections across every consumer. It is enabled, and nothing has used it yet.",
    );
  });

  it("says a switched-off skill's zero is because nothing can use it", () => {
    const stats = {
      ok: true as const,
      value: {
        ...seededStats(),
        skills: [{ slug: "commit-style", active: false, usedBy: { label: NONE_LABEL, carried: 0, inScope: 21 }, injections: 0 }],
      },
    };

    expect(usedBy(skillSummary({ slug: "commit-style", enabled: false }), stats).note).toMatch(
      /It is switched off, so nothing can use it\.$/,
    );
  });

  it("never draws a — for a figure nobody counted", () => {
    expect(usedBy(seededSkill("zephyr-conventions"), UNREAD)).toEqual({
      label: NOT_COUNTED_LABEL,
      note: "Use could not be counted: The service failed.",
      zero: false,
      inert: false,
    });
    expect(usedBy(skillSummary({ slug: "unlisted" }), STATS).label).toBe(NOT_COUNTED_LABEL);
  });
});

describe("the Updated cell", () => {
  it("spells the version and its age as the mockup does, through the calendar's units", () => {
    expect(versionAge(seededSkill("zephyr-conventions"), NOW)).toBe("v12 · 2d ago");
    expect(versionAge(seededSkill("pr-etiquette"), NOW)).toBe("v4 · 3w ago");
    expect(versionAge(seededSkill("commit-style"), NOW)).toBe("v2 · 2mo ago");
    expect(versionAge(seededSkill("power-budget-checks"), NOW)).toBe("v1 · 20m ago");
    expect(versionAge(skillSummary({ currentVersion: 3, publishedAt: null }), NOW)).toBe("v3");
    expect(versionAge(skillSummary({ currentVersion: null, publishedAt: null }), NOW)).toBeNull();
  });

  it("draws the six mockup cells: two tags, four versions", () => {
    const cells = seededSkills().skills.map((skill) => [skill.slug, updated(skill, NOW)]);

    expect(cells).toEqual([
      ["commit-style", { kind: "version", text: "v2 · 2mo ago" }],
      ["hil-safety", { kind: "required", tag: REQUIRED_TAG, note: `${REQUIRED_NOTE} v3 · 1mo ago.` }],
      ["power-budget-checks", { kind: "version", text: "v1 · 20m ago" }],
      ["pr-etiquette", { kind: "version", text: "v4 · 3w ago" }],
      ["repo-map", { kind: "generated", tag: GENERATED_TAG, note: generatedNote(seededSkill("repo-map"), NOW) }],
      ["zephyr-conventions", { kind: "version", text: "v12 · 2d ago" }],
    ]);
  });

  it("states when the generator last published, so the reader knows whether it ran last night", () => {
    const repoMap = seededSkill("repo-map");

    expect(generatedNote(repoMap, NOW)).toBe(
      `Last generated 7h ago (${repoMap.publishedAt}), v60. A nightly job rebuilds it.`,
    );
    expect(generatedNote(skillSummary({ origin: "generated", currentVersion: null, publishedAt: null }), NOW)).toBe(
      "Not generated yet: the nightly job has not published a version.",
    );
  });

  it("says so for a skill with no version yet", () => {
    expect(updated(skillSummary({ currentVersion: null, publishedAt: null }), NOW)).toEqual({
      kind: "unpublished",
      text: UNPUBLISHED_TEXT,
    });
  });

  it("lets the required tag win over the generated one, as the mockup draws the rows", () => {
    expect(updated(skillSummary({ required: true, origin: "generated" }), NOW).kind).toBe("required");
  });

  it("names the regenerate for its row", () => {
    expect(regenerateName("repo-map")).toBe("Regenerate repo-map now");
  });
});

describe("the switch", () => {
  it("is named by what a press would do", () => {
    expect(switchLabel(seededSkill("zephyr-conventions"))).toBe("Disable zephyr-conventions");
    expect(switchLabel(seededSkill("power-budget-checks"))).toBe("Enable power-budget-checks");
  });

  it("is an ordinary toggle for an administrator on an ordinary row", () => {
    expect(switchState(seededSkill("zephyr-conventions"), true)).toEqual({
      kind: "toggle",
      label: "Disable zephyr-conventions",
    });
  });

  it("is locked — pressable, described — on the required row", () => {
    expect(switchState(seededSkill("hil-safety"), true)).toEqual({
      kind: "locked",
      label: "Disable hil-safety",
      description: REQUIRED_NOTE,
    });
  });

  it("is read-only for a member, whatever the row", () => {
    for (const slug of ["zephyr-conventions", "hil-safety", "power-budget-checks"]) {
      expect(switchState(seededSkill(slug), false)).toMatchObject({ kind: "readonly", reason: MEMBER_SWITCH_REASON });
    }
  });

  it("turns the service's refusal into the row's sentence, led by what did not happen", () => {
    expect(
      switchFailure({
        code: "skill_required_locked",
        message: "required by policy — cannot disable",
        details: { slug: "hil-safety", reason: "required_by_policy" },
      }),
    ).toBe("Not changed: required by policy — cannot disable.");
    expect(switchFailure({ code: "forbidden", message: "Forbidden.", details: {} })).toBe(
      `Not changed: ${MEMBER_SWITCH_REASON}`,
    );
    expect(switchFailure({ code: "skill_not_found", message: "No such skill.", details: {} })).toBe(
      "Not changed: No such skill.",
    );
  });
});

describe("the editor door", () => {
  it("is closed until #181, and says which file it would open", () => {
    expect(editorReason("skills/hil-safety.skill.md")).toBe(
      "Opening skills/hil-safety.skill.md in the code-view editor arrives with #181; until then this row opens nothing.",
    );
    expect(editorAffordance(seededSkill("hil-safety"))).toEqual({
      label: "Open hil-safety in the editor",
      reason: editorReason("skills/hil-safety.skill.md"),
      warning: null,
    });
  });

  it("warns on a generated skill that the next generation overwrites manual edits", () => {
    expect(editorAffordance(seededSkill("repo-map")).warning).toBe(GENERATED_OVERWRITE);
    expect(GENERATED_OVERWRITE).toMatch(/overwritten by the next generation/);
  });
});

describe("the regenerate", () => {
  it("quotes a published report: the version, its age, the modules", () => {
    expect(regenerateToast(repoMapReport(), NOW)).toEqual({
      text: `repo-map regenerated for ${SEEDED_REPO}: v61 published 0s ago, 4 modules.`,
      links: [],
    });
    expect(regenerateToast(repoMapReport({ truncated: true }), NOW).text).toMatch(/4 modules \(tree listing truncated\)\.$/);
  });

  it("says an unchanged report wrote nothing", () => {
    expect(regenerateToast(repoMapReport({ outcome: "unchanged", version: 60 }), NOW).text).toBe(
      `repo-map regenerated for ${SEEDED_REPO}: unchanged since v60 — nothing written.`,
    );
  });

  it("says why a skipped report skipped", () => {
    expect(regenerateToast(repoMapReport({ outcome: "skipped", reason: "no_source", skill: null, version: null }), NOW).text)
      .toBe(`repo-map was not regenerated for ${SEEDED_REPO}: the repository could not be read.`);
    expect(regenerateToast(repoMapReport({ outcome: "skipped", reason: "rate_limit" }), NOW).text).toMatch(/rate-limited/);
    expect(regenerateToast(repoMapReport({ outcome: "skipped", reason: "host_error" }), NOW).text).toMatch(/the host failed/);
    expect(regenerateToast(repoMapReport({ outcome: "skipped", reason: null }), NOW).text).toMatch(/the generator skipped it/);
  });

  it("turns the service's refusals into sentences", () => {
    expect(
      regenerateFailure({ code: "repo_map_regenerate_too_soon", message: "Too soon.", details: { retryAfterSeconds: 41 } }),
    ).toBe("Regenerated under a minute ago — try again in 41s.");
    expect(regenerateFailure({ code: "repo_map_regenerate_too_soon", message: "Too soon.", details: {} })).toBe(
      "Regenerated under a minute ago.",
    );
    expect(regenerateFailure({ code: "forbidden", message: "Forbidden.", details: {} })).toBe(MEMBER_REGENERATE_REASON);
    expect(regenerateFailure({ code: "internal_error", message: "The service failed.", details: {} })).toBe(
      "The service failed.",
    );
  });
});

describe("sorting", () => {
  const rows = seededSkills().skills;
  const slugs = (sorted: readonly { slug: string }[]) => sorted.map((skill) => skill.slug);

  it("cycles a heading through ascending, descending and the service's order", () => {
    const first = nextSort(null, "skill");
    const second = nextSort(first, "skill");

    expect(first).toEqual({ key: "skill", direction: "ascending" });
    expect(second).toEqual({ key: "skill", direction: "descending" });
    expect(nextSort(second, "skill")).toBeNull();
    expect(nextSort(second, "scope")).toEqual({ key: "scope", direction: "ascending" });
  });

  it("reports a column's direction only while it is the sorted one", () => {
    const sort = { key: "scope" as const, direction: "descending" as const };

    expect(sortDirection(sort, "scope")).toBe("descending");
    expect(sortDirection(sort, "skill")).toBeNull();
    expect(sortDirection(null, "skill")).toBeNull();
  });

  it("keeps the service's order with no sort, as a new array", () => {
    const kept = sortSkills(rows, null, STATS);

    expect(slugs(kept)).toEqual(slugs(rows));
    expect(kept).not.toBe(rows);
  });

  it("sorts by slug, by scope with org first, by share with drafts last, and by age", () => {
    expect(slugs(sortSkills(rows, { key: "skill", direction: "descending" }, STATS))).toEqual([
      "zephyr-conventions", "repo-map", "pr-etiquette", "power-budget-checks", "hil-safety", "commit-style",
    ]);
    expect(slugs(sortSkills(rows, { key: "scope", direction: "ascending" }, STATS))).toEqual([
      "commit-style", "pr-etiquette", "hil-safety", "power-budget-checks", "repo-map", "zephyr-conventions",
    ]);
    expect(slugs(sortSkills(rows, { key: "usedBy", direction: "ascending" }, STATS))).toEqual([
      "power-budget-checks", "hil-safety", "pr-etiquette", "zephyr-conventions", "commit-style", "repo-map",
    ]);
    expect(slugs(sortSkills(rows, { key: "updated", direction: "descending" }, STATS))).toEqual([
      "power-budget-checks", "repo-map", "zephyr-conventions", "pr-etiquette", "hil-safety", "commit-style",
    ]);
  });

  it("sorts uncounted rows with the drafts, below a real zero", () => {
    expect(slugs(sortSkills(rows, { key: "usedBy", direction: "ascending" }, UNREAD))).toEqual(slugs(rows));
  });
});
