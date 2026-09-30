import type { EnabledRepo } from "@/app/api/enablement";
import type {
  RuleImportFile,
  RuleImportPreview,
  RuleImportResult,
  RuleImportTotals,
} from "@/app/api/knowledge-import";
import type { RepoMapReport } from "@/app/api/repo-map";
import type { SkillList, SkillStats, SkillSummary } from "@/app/api/skills";
import type { KnowledgeReadings } from "@/app/knowledge/view";

/**
 * Knowledge fixtures (#417, #418): the development seed's skills (mockup 14's six, with the ages,
 * versions and Used-by figures the seed gives them) and an import preview of the fixture
 * `CLAUDE.md`, trimmed to what the frame reads and the table and the sheet draw.
 */

/** The `owner/name` of the first seeded repository. */
export const SEEDED_REPO = "acme-robotics/helios-firmware";

/**
 * One skill, seed-shaped.
 *
 * @param over Fields to replace.
 * @returns The skill.
 */
export function skillSummary(over: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: "5eed0410-0000-4000-8000-000000000001",
    slug: "zephyr-conventions",
    name: "Zephyr conventions",
    description: "Kconfig, devicetree & ISR-safety house rules",
    scope: "repo",
    repoRef: "acme-robotics/helios-firmware",
    workflow: null,
    enabled: true,
    required: false,
    draft: false,
    origin: "authored",
    currentVersion: 12,
    publishedAt: "2026-09-28T10:00:00.000Z",
    active: true,
    path: "skills/zephyr-conventions.skill.md",
    updatedAt: "2026-09-28T10:00:00.000Z",
    ...over,
  };
}

/** The instant the suite reads the page at — every seeded age below is measured from it. */
export const READ_AT = "2026-09-30T14:00:00.000Z";

/**
 * An instant some minutes before {@link READ_AT}.
 *
 * @param minutes How long before.
 * @returns ISO 8601.
 */
function minutesAgo(minutes: number): string {
  return new Date(new Date(READ_AT).getTime() - minutes * 60_000).toISOString();
}

/** One seeded row: what `R__dev_seed_workspace_knowledge.sql` writes, trimmed to the table's columns. */
type SeedRow = readonly [
  slug: string,
  name: string,
  description: string,
  scope: SkillSummary["scope"],
  flags: { enabled: boolean; required: boolean; draft: boolean; origin: SkillSummary["origin"] },
  version: number,
  publishedMinutesAgo: number,
];

/** Mockup 14's six rows, as the development seed writes them. */
const SEED: readonly SeedRow[] = [
  ["zephyr-conventions", "Zephyr conventions", "Kconfig, devicetree & ISR-safety house rules", "repo",
    { enabled: true, required: false, draft: false, origin: "authored" }, 12, 2 * 1440],
  ["repo-map", "Repo map", "Module & ownership map of the source tree", "repo",
    { enabled: true, required: false, draft: false, origin: "generated" }, 60, 420],
  ["pr-etiquette", "PR etiquette", "PR title format, changelog entry, reviewer ping rules", "org",
    { enabled: true, required: false, draft: false, origin: "authored" }, 4, 21 * 1440],
  ["hil-safety", "HIL safety", "Hardware-in-loop interlocks before any motor spins", "repo",
    { enabled: true, required: true, draft: false, origin: "authored" }, 3, 40 * 1440],
  ["commit-style", "Commit style", "Conventional commits, 72-char body wrap, sign-off", "org",
    { enabled: true, required: false, draft: false, origin: "authored" }, 2, 61 * 1440],
  ["power-budget-checks", "Power budget checks", "Flag changes that raise idle current above 120 µA", "repo",
    { enabled: false, required: false, draft: true, origin: "authored" }, 1, 20],
];

/**
 * The seeded list: mockup 14's six skills — the locked `hil-safety`, the generated `repo-map`,
 * the draft `power-budget-checks` — with the versions and ages the seed gives them.
 *
 * @returns The list, in the service's order (by slug).
 */
export function seededSkills(): SkillList {
  const skills = SEED.map(([slug, name, description, scope, flags, version, publishedMinutesAgo], index) =>
    skillSummary({
      id: `5eed0410-0000-4000-8000-00000000000${String(index + 1)}`,
      slug,
      name,
      description,
      scope,
      repoRef: scope === "repo" ? SEEDED_REPO : null,
      ...flags,
      active: flags.enabled && !flags.draft,
      currentVersion: version,
      publishedAt: minutesAgo(publishedMinutesAgo),
      updatedAt: minutesAgo(publishedMinutesAgo),
      path: `skills/${slug}.skill.md`,
    }),
  ).sort((a, b) => a.slug.localeCompare(b.slug));

  return { skills, active: skills.filter((skill) => skill.active).length };
}

/** One seeded skill, by slug — `seededSkill("hil-safety")`. */
export function seededSkill(slug: string): SkillSummary {
  const skill = seededSkills().skills.find((one) => one.slug === slug);
  if (skill === undefined) throw new Error(`no seeded skill ${slug}`);

  return skill;
}

/** The Used-by figures the seed's injection records count to — the mockup's six cells. */
const SEED_STATS: readonly [slug: string, label: string, carried: number, inScope: number, injections: number][] = [
  ["zephyr-conventions", "61% of runs", 11, 18, 11],
  ["repo-map", "every run", 18, 18, 21],
  ["pr-etiquette", "every PR", 7, 21, 7],
  ["hil-safety", "physical tests", 5, 18, 5],
  ["commit-style", "every run", 21, 21, 21],
  ["power-budget-checks", "—", 0, 0, 0],
];

/**
 * The stats over the thirty days before {@link READ_AT}.
 *
 * @returns The window and the six lines.
 */
export function seededStats(): SkillStats {
  return {
    window: { days: 30, from: minutesAgo(30 * 1440), to: READ_AT },
    skills: SEED_STATS.map(([slug, label, carried, inScope, injections]) => ({
      slug,
      active: slug !== "power-budget-checks",
      usedBy: { label, carried, inScope },
      injections,
    })),
  };
}

/**
 * One generation's report — a manual regenerate that published.
 *
 * @param over Fields to replace.
 * @returns The report.
 */
export function repoMapReport(over: Partial<RepoMapReport> = {}): RepoMapReport {
  return {
    repo: SEEDED_REPO,
    outcome: "published",
    skill: "repo-map",
    version: 61,
    generatedAt: READ_AT,
    trigger: "manual",
    reason: null,
    modules: 4,
    truncated: false,
    ...over,
  };
}

/**
 * One enabled repository.
 *
 * @param over Fields to replace.
 * @returns The repository.
 */
export function enabledRepo(over: Partial<EnabledRepo> = {}): EnabledRepo {
  return {
    id: "5eed0044-0000-4000-8000-000000000101",
    name: "helios-firmware",
    login: "acme-robotics",
    ...over,
  };
}

/** The seed's two enabled repositories. */
export function seededRepos(): EnabledRepo[] {
  return [
    enabledRepo(),
    enabledRepo({ id: "5eed0044-0000-4000-8000-000000000102", name: "helios-tools" }),
  ];
}

/** A preview's fingerprint — 64 lower-case hex characters, as the contract requires. */
export const FINGERPRINT = "9c1f4e2a7b3d6c5e8f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6";

/**
 * One probed file with nothing in it — the shape of an absent file.
 *
 * @param path The file.
 * @returns The file, absent.
 */
export function absentFile(path: RuleImportFile["path"]): RuleImportFile {
  return {
    path,
    found: false,
    sizeBytes: 0,
    truncated: false,
    skills: { planned: 0, deduped: 0, samples: [] },
    facts: { planned: 0, deduped: 0, samples: [] },
  };
}

/**
 * The fixture `CLAUDE.md`, as probed: three skill drafts and nine fact candidates, three of the
 * latter already known.
 *
 * @param over Fields to replace.
 * @returns The file.
 */
export function claudeFile(over: Partial<RuleImportFile> = {}): RuleImportFile {
  return {
    path: "CLAUDE.md",
    found: true,
    sizeBytes: 4812,
    truncated: false,
    skills: {
      planned: 3,
      deduped: 0,
      samples: [
        { action: "create", slug: "kconfig", name: "Kconfig", description: "Kconfig house rules.", section: "Kconfig" },
        { action: "create", slug: "devicetree", name: "Devicetree", description: "Overlay conventions.", section: "Devicetree" },
        { action: "update", slug: "isr-safety", name: "ISR safety", description: "What may run in an ISR.", section: "ISR safety" },
      ],
    },
    facts: {
      planned: 9,
      deduped: 3,
      samples: [
        {
          text: "Prefer `k_msgq` over `k_fifo` in ISR paths.",
          section: "ISR safety",
          provenance: { line: "CLAUDE.md § ISR safety", refs: [{ kind: "import", file: "CLAUDE.md", section: "ISR safety" }] },
        },
        {
          text: "Never block in an ISR.",
          section: "ISR safety",
          provenance: { line: "CLAUDE.md § ISR safety", refs: [{ kind: "import", file: "CLAUDE.md", section: "ISR safety" }] },
        },
      ],
    },
    ...over,
  };
}

/**
 * Totals summed from a set of files.
 *
 * @param files The files.
 * @returns The totals.
 */
export function totalsOf(files: readonly RuleImportFile[]): RuleImportTotals {
  const found = files.filter((file) => file.found);

  return {
    filesFound: found.length,
    skillDrafts: found.reduce((sum, file) => sum + file.skills.samples.filter((s) => s.action === "create").length, 0),
    skillUpdates: found.reduce((sum, file) => sum + file.skills.samples.filter((s) => s.action === "update").length, 0),
    factCandidates: found.reduce((sum, file) => sum + file.facts.planned, 0),
    dedupedSkills: found.reduce((sum, file) => sum + file.skills.deduped, 0),
    dedupedFacts: found.reduce((sum, file) => sum + file.facts.deduped, 0),
  };
}

/**
 * The fixture repository's preview: `CLAUDE.md` found, the other three absent.
 *
 * @param over Fields to replace.
 * @returns The preview.
 */
export function importPreview(over: Partial<RuleImportPreview> = {}): RuleImportPreview {
  const files = [claudeFile(), absentFile("AGENTS.md"), absentFile(".cursorrules"), absentFile(".github/copilot-instructions.md")];

  return {
    repo: SEEDED_REPO,
    fingerprint: FINGERPRINT,
    files,
    totals: { ...totalsOf(files), skillDrafts: 2, skillUpdates: 1 },
    ...over,
  };
}

/** A repository with none of the four files — the honest empty result. */
export function noneFoundPreview(): RuleImportPreview {
  const files = [absentFile("CLAUDE.md"), absentFile("AGENTS.md"), absentFile(".cursorrules"), absentFile(".github/copilot-instructions.md")];

  return { repo: SEEDED_REPO, fingerprint: FINGERPRINT, files, totals: totalsOf(files) };
}

/** A re-import with nothing changed: everything found dedupes away. */
export function unchangedPreview(): RuleImportPreview {
  const files = [
    claudeFile({
      skills: { planned: 0, deduped: 3, samples: [] },
      facts: { planned: 0, deduped: 9, samples: [] },
    }),
    absentFile("AGENTS.md"),
    absentFile(".cursorrules"),
    absentFile(".github/copilot-instructions.md"),
  ];

  return { repo: SEEDED_REPO, fingerprint: FINGERPRINT, files, totals: totalsOf(files) };
}

/** Files found that parse to nothing at all. */
export function nothingUsablePreview(): RuleImportPreview {
  const files = [
    claudeFile({
      skills: { planned: 0, deduped: 0, samples: [] },
      facts: { planned: 0, deduped: 0, samples: [] },
    }),
    absentFile("AGENTS.md"),
    absentFile(".cursorrules"),
    absentFile(".github/copilot-instructions.md"),
  ];

  return { repo: SEEDED_REPO, fingerprint: FINGERPRINT, files, totals: totalsOf(files) };
}

/**
 * What applying {@link importPreview} wrote.
 *
 * @returns The result.
 */
export function importResult(): RuleImportResult {
  return {
    ...importPreview(),
    created: {
      skills: [
        { slug: "kconfig", action: "create" },
        { slug: "devicetree", action: "create" },
        { slug: "isr-safety", action: "update" },
      ],
      facts: Array.from({ length: 9 }, (_, index) => ({
        id: `5eed0413-0000-4000-8000-00000000000${String(index)}`,
        text: `Rule ${String(index + 1)}.`,
      })),
    },
  };
}

/**
 * Every reading `ok`, with the seed's values.
 *
 * @param over Readings to replace.
 * @returns The readings.
 */
export function knowledgeReadings(over: Partial<KnowledgeReadings> = {}): KnowledgeReadings {
  return {
    skills: { ok: true, value: seededSkills() },
    stats: { ok: true, value: seededStats() },
    repos: { ok: true, value: seededRepos() },
    readAt: READ_AT,
    ...over,
  };
}
