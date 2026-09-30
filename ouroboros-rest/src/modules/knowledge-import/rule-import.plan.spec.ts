/**
 * The import plan ([#413](https://github.com/NobuData/ouroboros/issues/413)) — what dedupes,
 * what a re-import surfaces, which slugs are chosen, and what the fingerprint pins.
 */

import { normalizeFactText } from "./rule-import.parse";
import { CLAUDE_MD, CURSORRULES, IMPORT_REPO, emptyBaseline } from "./rule-import.fixture";
import {
  RULE_FILES,
  planImport,
  type ImportBaseline,
  type ImportPlan,
  type ProbedRuleFile,
  type RuleFile,
} from "./rule-import.plan";

/**
 * The four probes, answering the files given and nothing for the rest.
 *
 * @param files - Contents by path.
 * @returns The probed files, in {@link RULE_FILES} order.
 */
function probed(files: Partial<Record<RuleFile, string>>): ProbedRuleFile[] {
  return RULE_FILES.map((path) => ({
    path,
    content: files[path] ?? null,
    size: files[path] === undefined ? 0 : Buffer.byteLength(files[path]),
    truncated: false,
  }));
}

/** The fixture repository: `CLAUDE.md` and `.cursorrules`. */
const FIXTURE = probed({ "CLAUDE.md": CLAUDE_MD, ".cursorrules": CURSORRULES });

/**
 * The baseline a workspace has once a plan was applied to it — what an apply writes, read back.
 *
 * @param plan - The plan applied.
 * @param before - The baseline it was applied over.
 * @returns The baseline after.
 */
function applied(plan: ImportPlan, before: ImportBaseline = emptyBaseline()): ImportBaseline {
  const skills = plan.files.flatMap((file) => file.skills);
  const importedSkills = before.importedSkills.map((prior) => {
    const update = skills.find((skill) => skill.skillId === prior.skillId);

    return update === undefined ? prior : { ...prior, bodies: [...prior.bodies, update.body] };
  });

  skills
    .filter((skill) => skill.action === "create")
    .forEach((skill, index) =>
      importedSkills.push({
        skillId: `skill-${String(before.importedSkills.length + index)}`,
        slug: skill.slug,
        repoRef: plan.repo,
        provenances: [{ source: skill.file, section: skill.section }],
        bodies: [skill.body],
      }),
    );

  return {
    slugs: new Set([...before.slugs, ...skills.map((skill) => skill.slug)]),
    importedSkills,
    factTexts: new Set([
      ...before.factTexts,
      ...plan.files.flatMap((file) => file.facts.map((fact) => normalizeFactText(fact.text))),
    ]),
  };
}

/**
 * A plan as `path → [skill slugs, fact count, deduped skills, deduped facts]`.
 *
 * @param plan - The plan.
 * @returns The summary.
 */
function summary(plan: ImportPlan): Record<string, [string[], number, number, number]> {
  return Object.fromEntries(
    plan.files.map((file) => [
      file.path,
      [
        file.skills.map((skill) => `${skill.action}:${skill.slug}`),
        file.facts.length,
        file.dedupedSkills,
        file.dedupedFacts,
      ],
    ]),
  );
}

describe("the fixture, into an empty workspace", () => {
  const plan = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());

  it("plans four skill drafts and thirteen facts, the two repeated bullets deduped", () => {
    expect(summary(plan)).toEqual({
      "CLAUDE.md": [["create:kconfig", "create:devicetree", "create:isr-safety"], 7, 0, 0],
      "AGENTS.md": [[], 0, 0, 0],
      ".cursorrules": [["create:cursorrules"], 6, 0, 2],
      ".github/copilot-instructions.md": [[], 0, 0, 0],
    });
  });

  it("reports which files were found", () => {
    expect(plan.files.map((file) => [file.path, file.found, file.size > 0])).toEqual([
      ["CLAUDE.md", true, true],
      ["AGENTS.md", false, false],
      [".cursorrules", true, true],
      [".github/copilot-instructions.md", false, false],
    ]);
  });
});

describe("dedupe", () => {
  it("drops a candidate an existing fact already states, whatever its status", () => {
    const baseline = emptyBaseline({
      factTexts: new Set([normalizeFactText("Prefer `k_msgq` over `k_fifo` in ISR paths")]),
    });
    const plan = planImport(IMPORT_REPO, FIXTURE, baseline);

    expect(summary(plan)["CLAUDE.md"]).toEqual([
      ["create:kconfig", "create:devicetree", "create:isr-safety"],
      6,
      0,
      1,
    ]);
    expect(plan.files[0].facts.map((fact) => fact.text)).not.toContain(
      "Prefer `k_msgq` over `k_fifo` in ISR paths.",
    );
  });

  it("makes re-importing unchanged files a no-op", () => {
    const first = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());
    const again = planImport(IMPORT_REPO, FIXTURE, applied(first));

    expect(again.files.flatMap((file) => [...file.skills, ...file.facts])).toEqual([]);
    expect(summary(again)).toEqual({
      "CLAUDE.md": [[], 0, 3, 7],
      "AGENTS.md": [[], 0, 0, 0],
      ".cursorrules": [[], 0, 1, 8],
      ".github/copilot-instructions.md": [[], 0, 0, 0],
    });
  });

  it("surfaces only the delta of a changed file: the changed section and the new bullet", () => {
    const first = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());
    const edited = CLAUDE_MD.replace(
      "- Never enable `CONFIG_ASSERT` in release builds.",
      "- Never enable `CONFIG_ASSERT` in release builds.\n- Mark every symbol `depends on`.",
    );
    const again = planImport(
      IMPORT_REPO,
      probed({ "CLAUDE.md": edited, ".cursorrules": CURSORRULES }),
      applied(first),
    );

    expect(summary(again)["CLAUDE.md"]).toEqual([["update:kconfig"], 1, 2, 7]);
    expect(again.files[0].skills[0]).toMatchObject({ skillId: "skill-0", section: "Kconfig" });
    expect(again.files[0].facts).toEqual([
      { file: "CLAUDE.md", section: "Kconfig", text: "Mark every symbol `depends on`." },
    ]);
  });

  it("proposes nothing for a removed bullet or section", () => {
    const first = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());
    const trimmed = CLAUDE_MD.slice(0, CLAUDE_MD.indexOf("## ISR safety"));
    const again = planImport(
      IMPORT_REPO,
      probed({ "CLAUDE.md": trimmed, ".cursorrules": CURSORRULES }),
      applied(first),
    );

    expect(again.files.flatMap((file) => [...file.skills, ...file.facts])).toEqual([]);
  });

  it("counts an update made again, unchanged, as deduped", () => {
    const first = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());
    const edited = probed({ "CLAUDE.md": CLAUDE_MD.replace("never block", "not block") });
    const second = planImport(IMPORT_REPO, edited, applied(first));
    const third = planImport(IMPORT_REPO, edited, applied(second, applied(first)));

    expect(summary(second)["CLAUDE.md"][0]).toEqual(["update:isr-safety"]);
    expect(summary(third)["CLAUDE.md"]).toEqual([[], 0, 3, 7]);
  });

  it("dedupes a section whose imported skill moved out of the repository's scope, unchanged", () => {
    const first = planImport(IMPORT_REPO, FIXTURE, emptyBaseline());
    const after = applied(first);
    const moved = {
      ...after,
      importedSkills: after.importedSkills.map((skill) => ({ ...skill, repoRef: null })),
    };

    expect(summary(planImport(IMPORT_REPO, FIXTURE, moved))["CLAUDE.md"]).toEqual([[], 0, 3, 7]);
  });

  it("treats another repository's import of the same file as its own, changed or not", () => {
    const first = planImport("acme-robotics/other", FIXTURE, emptyBaseline());
    const after = applied(first);
    const edited = probed({ "CLAUDE.md": CLAUDE_MD.replace("never block", "not block") });
    const plan = planImport(IMPORT_REPO, edited, { ...after, factTexts: new Set() });

    // Unchanged sections are the same text already imported; the changed one is new here.
    expect(summary(plan)["CLAUDE.md"][0]).toEqual(["create:isr-safety-2"]);
  });
});

describe("slugs", () => {
  it("take the first free suffix when the name's slug is taken", () => {
    const plan = planImport(
      IMPORT_REPO,
      FIXTURE,
      emptyBaseline({ slugs: new Set(["kconfig", "kconfig-2", "cursorrules"]) }),
    );

    expect(plan.files.flatMap((file) => file.skills.map((skill) => skill.slug))).toEqual([
      "kconfig-3",
      "devicetree",
      "isr-safety",
      "cursorrules-2",
    ]);
  });

  it("stay unique across one plan's own sections", () => {
    const text = "## Style\n\na\n\n## style\n\nb\n";
    const plan = planImport(IMPORT_REPO, probed({ "AGENTS.md": text }), emptyBaseline());

    expect(plan.files[1].skills.map((skill) => skill.slug)).toEqual(["style", "style-2"]);
  });

  it("fall back to the file for a heading with no ASCII letter or digit", () => {
    const text = "## 規約\n\na\n\n## 命名\n\nb\n";
    const plan = planImport(IMPORT_REPO, probed({ "CLAUDE.md": text }), emptyBaseline());

    expect(plan.files[0].skills.map((skill) => skill.slug)).toEqual([
      "imported-claude-md",
      "imported-claude-md-2",
    ]);
  });

  it("leave a section out rather than count past a hundred", () => {
    const slugs = new Set(["style", ...Array.from({ length: 99 }, (_, i) => `style-${i + 2}`)]);
    const plan = planImport(
      IMPORT_REPO,
      probed({ "AGENTS.md": "## Style\n\na\n\n## Other\n\nb\n" }),
      emptyBaseline({ slugs }),
    );

    expect(plan.files[1].skills.map((skill) => skill.slug)).toEqual(["other"]);
    expect(plan.files[1].dedupedSkills).toBe(1);
  });
});

describe("the fingerprint", () => {
  it("is the same for the same files and workspace", () => {
    expect(planImport(IMPORT_REPO, FIXTURE, emptyBaseline()).fingerprint).toBe(
      planImport(IMPORT_REPO, FIXTURE, emptyBaseline()).fingerprint,
    );
  });

  it("is lower-case hex sha256", () => {
    expect(planImport(IMPORT_REPO, FIXTURE, emptyBaseline()).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["a file's text", probed({ "CLAUDE.md": `${CLAUDE_MD}\n- Use tabs.` }), emptyBaseline()],
    [
      "an existing fact",
      FIXTURE,
      emptyBaseline({ factTexts: new Set(["keep functions under 60 lines"]) }),
    ],
    ["a slug taken", FIXTURE, emptyBaseline({ slugs: new Set(["kconfig"]) })],
  ])("changes with %s", (_what, files, baseline) => {
    expect(planImport(IMPORT_REPO, files, baseline).fingerprint).not.toBe(
      planImport(IMPORT_REPO, FIXTURE, emptyBaseline()).fingerprint,
    );
  });

  it("changes with the repository", () => {
    expect(planImport("acme-robotics/other", FIXTURE, emptyBaseline()).fingerprint).not.toBe(
      planImport(IMPORT_REPO, FIXTURE, emptyBaseline()).fingerprint,
    );
  });
});

describe("a repository with no rules files", () => {
  it("is an honest empty plan", () => {
    const plan = planImport(IMPORT_REPO, probed({}), emptyBaseline());

    expect(plan.files.every((file) => !file.found)).toBe(true);
    expect(plan.files.flatMap((file) => [...file.skills, ...file.facts])).toEqual([]);
  });
});
