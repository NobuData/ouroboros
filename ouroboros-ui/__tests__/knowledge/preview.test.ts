import { describe, expect, it } from "vitest";

import type { ContextManifest } from "@/app/api/context";
import type { FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import {
  ABSENT_STALE,
  ABSENT_UNREAD,
  CONSUMERS,
  DEFAULT_CONSUMER,
  ESTIMATOR_FACTS_ONLY,
  NO_SKILLS_RESOLVED,
  UNREAD_FACT,
  counting,
  isConsumer,
  previewAnnouncement,
  previewFailure,
  previewView,
  repoChoices,
  tokens,
  trimChip,
  workflowChoices,
} from "@/app/knowledge/preview";

import {
  type ManifestName,
  SEEDED_REPO,
  manifest,
  seededFacts,
  seededRepos,
  seededSkills,
  skillSummary,
  skillsWithOverrides,
} from "../helpers/knowledge";

/**
 * The manifest preview's judgements (#421), held against BF.5's own answers (#414,
 * `helpers/context-manifests.json`): what was kept is listed as the manifest orders it, a trim is
 * named with its tier and its reason, and every skill that is not there says why — draft, wrong
 * scope, overridden.
 */

const SKILLS: Reading<SkillList> = { ok: true, value: seededSkills() };
const WITH_OVERRIDES: Reading<SkillList> = { ok: true, value: skillsWithOverrides() };
const FACTS: Reading<FactList> = { ok: true, value: seededFacts() };

/** The two confirmed facts of the seed, as every in-repository manifest lists them. */
const RIG = "Tests under `tests/hil/` require rig reservation via `rig claim`";
const WEST = "CI needs `west update` before first build of the day";

/**
 * A fixture, arranged.
 *
 * @param name The manifest.
 * @param skills The registry behind it.
 * @returns The view.
 */
function view(name: ManifestName, skills: Reading<SkillList> = SKILLS) {
  return previewView(manifest(name), skills, FACTS);
}

/** Each absent skill as `slug: why`. */
function absences(of: ReturnType<typeof previewView>): string[] {
  return of.absent.map((entry) => `${entry.slug}: ${entry.why}`);
}

/**
 * The seeded manifest with fields replaced — for the cases assembly's fixtures do not hold.
 *
 * @param over What differs.
 * @returns The manifest.
 */
function altered(over: Partial<ContextManifest>): ContextManifest {
  return { ...manifest("seeded"), ...over };
}

describe("assembly's fixtures, exactly", () => {
  it("lists the seeded scope as the manifest orders it: required first, then by tier", () => {
    const seeded = view("seeded");

    expect(seeded.skills.map((skill) => skill.label)).toEqual([
      "hil-safety@v3",
      "repo-map@v60",
      "zephyr-conventions@v12",
      "commit-style@v2",
      "pr-etiquette@v4",
    ]);
    expect(seeded.skills.map((skill) => skill.scope)).toEqual(["repo", "repo", "repo", "org-wide", "org-wide"]);
    expect(seeded.skills.map((skill) => skill.tokens)).toEqual(["~10 tokens", "~9 tokens", "~14 tokens", "~11 tokens", "~11 tokens"]);
    expect(seeded.facts).toEqual([
      { key: "5eed0044-0000-4000-8000-000000000002", text: RIG, scope: "repo", tokens: "~16 tokens" },
      { key: "5eed0044-0000-4000-8000-000000000001", text: WEST, scope: "org-wide", tokens: "~13 tokens" },
    ]);
    expect(seeded.budget).toBe("~84 tokens of the 32.0k budget");
    expect(seeded.overBudget).toBe(false);
    expect(seeded.trimmed).toEqual([]);
    expect(seeded.nothing).toBe(false);
    expect(seeded.hash).toBe("manifest 529a6a637e3b");
  });

  it("badges only the required skill", () => {
    expect(view("seeded").skills.filter((skill) => skill.required).map((skill) => skill.label)).toEqual(["hil-safety@v3"]);
  });

  it("never lists a draft, and says why it is absent", () => {
    for (const name of ["seeded", "workflowOverride", "trimmed", "workspaceWide"] as const) {
      const drawn = view(name, WITH_OVERRIDES);

      expect(drawn.skills.map((skill) => skill.label).join(" ")).not.toContain("power-budget-checks");
      expect(absences(drawn)).toContain("power-budget-checks: a draft — drafts never inject");
    }
  });

  it("shows the workflow-override case: the closer skill kept, each overridden one with what holds its name", () => {
    const overridden = view("workflowOverride", WITH_OVERRIDES);

    expect(overridden.skills.map((skill) => skill.label)).toEqual([
      "hil-safety@v3",
      "commit-style-fix@v1",
      "repo-map@v60",
      "zephyr-conventions@v12",
    ]);
    expect(overridden.skills.map((skill) => skill.scope)).toEqual(["repo", "workflow", "repo", "repo"]);
    expect(overridden.budget).toBe("~75 tokens of the 32.0k budget");
    expect(absences(overridden)).toEqual([
      "commit-style: overridden by commit-style-fix — the closest scope wins",
      "hil-safety-off: overridden by hil-safety, which is required — a required skill cannot be overridden",
      "pr-etiquette: overridden by pr-etiquette-off — the closest scope wins",
      "pr-etiquette-off: switched off — and as the closest skill of its name, it keeps farther ones out too",
      "power-budget-checks: a draft — drafts never inject",
    ]);
    expect(overridden.absent.map((entry) => entry.scope)).toEqual(["org-wide", "workflow", "org-wide", "workflow", "repo"]);
  });

  it("names a trim: what was dropped, from which tier, why, and what it cost", () => {
    const trimmed = view("trimmed");

    expect(trimmed.trimmed).toEqual([
      {
        key: "5eed0411-0000-4000-8000-000000000005",
        name: "commit-style",
        slug: true,
        tier: "org",
        why: "over the token budget",
        tokens: "~32.5k tokens",
      },
    ]);
    expect(trimChip(trimmed)).toBe("1 trimmed");
    expect(trimmed.skills.map((skill) => skill.label)).toEqual(["hil-safety@v3", "repo-map@v60", "zephyr-conventions@v12", "pr-etiquette@v4"]);
    expect(trimmed.budget).toBe("~73 tokens of the 32.0k budget");
    // The trim is its own answer: the dropped skill is not also listed as unexplained.
    expect(absences(trimmed)).toEqual(["power-budget-checks: a draft — drafts never inject"]);
  });

  it("says the estimator carries facts only, and lists no skill as missing", () => {
    const estimator = view("estimator");

    expect(estimator.skills).toEqual([]);
    expect(estimator.skillsEmpty).toBe(ESTIMATOR_FACTS_ONLY);
    expect(estimator.facts.map((fact) => fact.text)).toEqual([RIG, WEST]);
    expect(estimator.budget).toBe("~29 tokens of the 8.0k budget");
    expect(estimator.absent).toEqual([]);
    expect(estimator.absentNote).toBeNull();
  });

  it("explains every repository skill a workspace-wide manifest leaves out as scoped elsewhere", () => {
    const wide = view("workspaceWide");

    expect(wide.skills.map((skill) => skill.label)).toEqual(["commit-style@v2", "pr-etiquette@v4"]);
    expect(wide.facts.map((fact) => fact.text)).toEqual([WEST]);
    expect(absences(wide)).toEqual([
      `hil-safety: scoped to ${SEEDED_REPO} — this preview names no repository`,
      "power-budget-checks: a draft — drafts never inject",
      `repo-map: scoped to ${SEEDED_REPO} — this preview names no repository`,
      `zephyr-conventions: scoped to ${SEEDED_REPO} — this preview names no repository`,
    ]);
  });

  it("says nothing would be injected for a workspace with nothing in it", () => {
    const empty = previewView(manifest("empty"), { ok: true, value: { skills: [], active: 0 } }, { ok: true, value: seededFacts([]) });

    expect(empty.nothing).toBe(true);
    expect(empty.skillsEmpty).toBe(NO_SKILLS_RESOLVED);
    expect(empty.facts).toEqual([]);
    expect(empty.absent).toEqual([]);
    expect(empty.budget).toBe("~0 tokens of the 32.0k budget");
    expect(trimChip(empty)).toBeNull();
  });
});

describe("the cases a manifest can hold beyond the fixtures", () => {
  it("names a trimmed fact by its text, and says so when this page never read it", () => {
    const capped = altered({
      trimmed: [{ kind: "fact", id: "5eed0044-0000-4000-8000-000000000001", slug: null, tier: "org", estTokens: 13, reason: "item_limit" }],
    });

    expect(previewView(capped, SKILLS, FACTS).trimmed).toEqual([
      { key: "5eed0044-0000-4000-8000-000000000001", name: WEST, slug: false, tier: "org", why: "over the consumer's fact cap", tokens: "~13 tokens" },
    ]);
    expect(previewView(capped, SKILLS, { ok: false, reason: "unreachable" }).trimmed[0]?.name).toBe(UNREAD_FACT);
  });

  it("flags a manifest its required skills alone push over the budget", () => {
    expect(previewView(altered({ estTokens: 40_000 }), SKILLS, FACTS)).toMatchObject({ overBudget: true, budget: "~40.0k tokens of the 32.0k budget" });
  });

  it("says when an on-trigger skill loads", () => {
    const [first, ...rest] = manifest("seeded").skillVersions;
    const triggered = altered({ skillVersions: [{ ...first!, load: "on_trigger", triggers: ["ISR", "interrupt"] }, ...rest] });

    expect(previewView(triggered, SKILLS, FACTS).skills[0]?.trigger).toBe("Loads when the task matches ISR, interrupt; the consumer decides.");
    expect(previewView(manifest("seeded"), SKILLS, FACTS).skills[0]?.trigger).toBeNull();
  });

  it("gives every exclusion its own reason", () => {
    const base = { skillId: "5eed0410-0000-4000-8000-0000000000c1", scope: "repo" as const };
    const excluded = altered({
      excluded: [
        { ...base, slug: "plain-off", reason: "disabled", by: null },
        { ...base, skillId: "5eed0410-0000-4000-8000-0000000000c2", slug: "delta-off", reason: "override_disabled", by: null },
        // `repo-map` is kept at the repo scope, so this is the same-scope tie the first slug wins.
        { ...base, skillId: "5eed0410-0000-4000-8000-0000000000c3", slug: "repo-map-two", reason: "shadowed", by: "repo-map" },
      ],
    });

    expect(absences(previewView(excluded, { ok: true, value: { skills: [], active: 0 } }, FACTS))).toEqual([
      "plain-off: switched off",
      "delta-off: disabled by an override",
      "repo-map-two: overridden by repo-map — the same name at the same scope, where the first slug holds it",
    ]);
  });

  it("explains a skill scoped to another repository, another workflow, or not yet published", () => {
    const extra = [
      skillSummary({ id: "a", slug: "tools-style", repoRef: "acme-robotics/helios-tools" }),
      skillSummary({ id: "b", slug: "docs-tone", scope: "workflow", repoRef: null, workflow: { id: "w2", slug: "docs-loop" } }),
      skillSummary({ id: "c", slug: "unpublished", currentVersion: null, publishedAt: null, active: false }),
    ];
    const skills: Reading<SkillList> = { ok: true, value: { skills: [...skillsWithOverrides().skills, ...extra], active: 0 } };
    const drawn = absences(previewView(manifest("workflowOverride"), skills, FACTS));

    expect(drawn).toContain("tools-style: scoped to acme-robotics/helios-tools — not the repository in this scope");
    expect(drawn).toContain("docs-tone: scoped to the workflow docs-loop — not the workflow in this scope");
    expect(drawn).toContain("unpublished: no published version yet");
    expect(absences(previewView(manifest("seeded"), skills, FACTS))).toContain(
      "commit-style-fix: scoped to the workflow standard-fix — this preview names no workflow",
    );
  });

  it("admits it when this page's list and the manifest disagree, rather than inventing a reason", () => {
    const newer = skillSummary({ id: "d", slug: "just-published" });
    const skills: Reading<SkillList> = { ok: true, value: { skills: [...seededSkills().skills, newer], active: 6 } };

    expect(absences(previewView(manifest("seeded"), skills, FACTS))).toContain(`just-published: ${ABSENT_STALE}`);
  });

  it("says absences cannot be explained without the skills list — and still lists what the service left out", () => {
    const unread = previewView(manifest("workflowOverride"), { ok: false, reason: "unreachable" }, FACTS);

    expect(unread.absentNote).toBe(ABSENT_UNREAD);
    expect(unread.absent.map((entry) => entry.slug)).toEqual(["commit-style", "hil-safety-off", "pr-etiquette", "pr-etiquette-off"]);
  });
});

describe("the choices", () => {
  it("offers a run stage first, then a playbook launch and the estimator", () => {
    expect(CONSUMERS.map((consumer) => consumer.value)).toEqual(["run_stage", "playbook", "estimator"]);
    expect(DEFAULT_CONSUMER).toBe("run_stage");
    expect(isConsumer("estimator")).toBe(true);
    expect(isConsumer("someone-else")).toBe(false);
  });

  it("offers every enabled repository, and none when the list could not be read", () => {
    expect(repoChoices({ ok: true, value: seededRepos() })).toEqual([SEEDED_REPO, "acme-robotics/helios-tools"]);
    expect(repoChoices({ ok: false, reason: "unreachable" })).toEqual([]);
  });

  it("offers only the workflows a skill is scoped to, each once", () => {
    expect(workflowChoices(WITH_OVERRIDES)).toEqual(["standard-fix"]);
    expect(workflowChoices(SKILLS)).toEqual([]);
    expect(workflowChoices({ ok: false, reason: "unreachable" })).toEqual([]);
  });
});

describe("the sentences", () => {
  it("writes an estimate with its tilde, compacted, and singular for one", () => {
    expect([tokens(0), tokens(1), tokens(84), tokens(6200), tokens(32_500)]).toEqual([
      "~0 tokens",
      "~1 token",
      "~84 tokens",
      "~6.2k tokens",
      "~32.5k tokens",
    ]);
  });

  it("counts a section in its heading", () => {
    expect(counting("Skills", 5)).toBe("Skills (5)");
  });

  it("announces what a manifest holds, trims included", () => {
    expect(previewAnnouncement(view("seeded"))).toBe("5 skills, 2 facts, ~84 tokens of the 32.0k budget.");
    expect(previewAnnouncement(view("trimmed"))).toBe("4 skills, 2 facts, ~73 tokens of the 32.0k budget; 1 trimmed.");
  });

  it("turns a refusal into a sentence — a vanished workflow into advice", () => {
    expect(previewFailure({ code: "context_workflow_not_found", message: "No such workflow.", details: {} })).toBe(
      "That workflow is no longer in this workspace. Choose another, or no workflow.",
    );
    expect(previewFailure({ code: "internal_error", message: "Something went wrong.", details: {} })).toBe(
      "The preview could not be assembled: Something went wrong.",
    );
  });
});
