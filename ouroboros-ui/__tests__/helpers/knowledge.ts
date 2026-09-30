import type { EnabledRepo } from "@/app/api/enablement";
import type {
  RuleImportFile,
  RuleImportPreview,
  RuleImportResult,
  RuleImportTotals,
} from "@/app/api/knowledge-import";
import type { SkillList, SkillSummary } from "@/app/api/skills";
import type { KnowledgeReadings } from "@/app/knowledge/view";

/**
 * Knowledge fixtures (#417): the development seed's skills (mockup 14's six) and an import preview
 * of the fixture `CLAUDE.md`, trimmed to what the frame reads and the sheet draws.
 */

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

/**
 * The seeded list: mockup 14's six skills, one of them a draft.
 *
 * @returns The list.
 */
export function seededSkills(): SkillList {
  const rows: readonly [string, string, SkillSummary["scope"], boolean][] = [
    ["zephyr-conventions", "Zephyr conventions", "repo", false],
    ["repo-map", "Repo map", "repo", false],
    ["pr-etiquette", "PR etiquette", "org", false],
    ["hil-safety", "HIL safety", "repo", false],
    ["commit-style", "Commit style", "org", false],
    ["power-budget-checks", "Power budget checks", "repo", true],
  ];

  return {
    skills: rows.map(([slug, name, scope, draft], index) =>
      skillSummary({
        id: `5eed0410-0000-4000-8000-00000000000${String(index + 1)}`,
        slug,
        name,
        scope,
        repoRef: scope === "repo" ? "acme-robotics/helios-firmware" : null,
        draft,
        active: !draft,
        currentVersion: draft ? null : 1,
        path: `skills/${slug}.skill.md`,
      }),
    ),
    active: 5,
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

/** The `owner/name` of the first seeded repository. */
export const SEEDED_REPO = "acme-robotics/helios-firmware";

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
    repos: { ok: true, value: seededRepos() },
    ...over,
  };
}
