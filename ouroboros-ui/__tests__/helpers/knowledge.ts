import type { RepoDetection, RepoDetectionRow } from "@/app/api/detection";
import type { EnabledRepo } from "@/app/api/enablement";
import type { EnvRecipe } from "@/app/api/env-recipes";
import type { Fact, FactList } from "@/app/api/facts";
import type {
  Playbook,
  PlaybookDraft,
  PlaybookIssueCandidate,
  PlaybookLaunchReceipt,
  PlaybookList,
} from "@/app/api/playbooks";
import type {
  RuleImportFile,
  RuleImportPreview,
  RuleImportResult,
  RuleImportTotals,
} from "@/app/api/knowledge-import";
import type { RepoMapReport } from "@/app/api/repo-map";
import type { SkillList, SkillStats, SkillSummary } from "@/app/api/skills";
import type { KnowledgeReadings, ProfileReadings, TicketLink } from "@/app/knowledge/view";

import { queueItem } from "./dashboard";

/**
 * Knowledge fixtures (#417, #418, #419, #420): the development seed's skills (mockup 14's six,
 * with the ages, versions and Used-by figures the seed gives them), its five facts with their
 * stamps and refs, its three playbooks with their launch-derived counts, the environment recipe
 * at v3, a detection scan of the seeded repository, and an import preview of the fixture
 * `CLAUDE.md`, trimmed to what the frame reads and the cards draw.
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

/* ------------------------------------------------------------------ facts (#419) */

/** The ids the seed gives the rows the facts cite. */
export const CITED_RUN_ID = "5eed0021-0000-4000-8000-000000000482";
export const CITED_PR_ID = "5eed0024-0000-4000-8000-000000000514";
export const CITED_TICKET_552 = "5eed0030-0000-4000-8000-000000000552";
export const CITED_TICKET_560 = "5eed0030-0000-4000-8000-000000000560";
export const CITED_CLASSIFICATION_ID = "5eed0037-0000-4000-8000-000000048201";

/** Ken and Maya, as the audit names them. */
export const KEN = { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken" };
export const MAYA = { id: "5eed0003-0000-4000-8000-000000000002", name: "Maya" };

/**
 * One fact, seed-shaped: a manual, workspace-wide proposal with one anchor.
 *
 * @param over Fields to replace.
 * @returns The fact.
 */
export function fact(over: Partial<Fact> = {}): Fact {
  return {
    id: "5eed0044-0000-4000-8000-000000000001",
    repoRef: null,
    text: "CI needs `west update` before first build of the day",
    status: "proposed",
    proposer: "manual",
    provenance: { line: "from build-farm failure pattern", refs: [{ kind: "ticket", id: CITED_TICKET_552 }] },
    confirmation: null,
    staleness: null,
    expiry: null,
    usedCount: 0,
    relearnedFromFactId: null,
    relearnedByFactIds: [],
    anchors: [{ id: "5eed0045-0000-4000-8000-000000000001", kind: "dependency", value: "west", lastCheckedAt: null }],
    sweep: { covered: true, reason: null },
    createdAt: minutesAgo(44 * 1440),
    updatedAt: minutesAgo(42 * 1440),
    ...over,
  };
}

/**
 * The seed's five facts, newest first as the service lists them: two proposals, two confirmed,
 * one expired — mockup 14's rows, with the honest MVP provenance on the correction-note one.
 *
 * @returns The facts.
 */
export function seededFactRows(): readonly Fact[] {
  return [
    fact({
      id: "5eed0044-0000-4000-8000-000000000003",
      repoRef: SEEDED_REPO,
      text: "Team prefers `k_msgq` over `k_fifo` in ISR paths",
      proposer: "correction_note",
      provenance: {
        line: "from correction note (run #1847)",
        refs: [
          { kind: "run", id: CITED_RUN_ID },
          { kind: "pull_request", id: CITED_PR_ID },
          { kind: "classification", id: CITED_CLASSIFICATION_ID },
        ],
      },
      anchors: [{ id: "5eed0045-0000-4000-8000-000000000003", kind: "path_glob", value: "subsys/telemetry/**", lastCheckedAt: null }],
      createdAt: minutesAgo(1),
      updatedAt: minutesAgo(1),
    }),
    fact({
      id: "5eed0044-0000-4000-8000-000000000004",
      repoRef: SEEDED_REPO,
      text: "PID gains live in `config/control.yaml`, not in headers",
      provenance: { line: "observed in loop #1847", refs: [{ kind: "run", id: CITED_RUN_ID }] },
      anchors: [{ id: "5eed0045-0000-4000-8000-000000000004", kind: "path_glob", value: "config/control.yaml", lastCheckedAt: null }],
      createdAt: minutesAgo(2),
      updatedAt: minutesAgo(2),
    }),
    fact({
      id: "5eed0044-0000-4000-8000-000000000002",
      repoRef: SEEDED_REPO,
      text: "Tests under `tests/hil/` require rig reservation via `rig claim`",
      status: "confirmed",
      provenance: { line: "from PR #498 review cycle", refs: [{ kind: "ticket", id: CITED_TICKET_560 }] },
      confirmation: { actor: MAYA, at: minutesAgo(21 * 1440), reason: null },
      usedCount: 12,
      anchors: [{ id: "5eed0045-0000-4000-8000-000000000002", kind: "path_glob", value: "tests/hil/**", lastCheckedAt: null }],
      createdAt: minutesAgo(23 * 1440),
      updatedAt: minutesAgo(21 * 1440),
    }),
    fact({
      status: "confirmed",
      confirmation: { actor: KEN, at: minutesAgo(42 * 1440), reason: null },
      usedCount: 48,
    }),
    fact({
      id: "5eed0044-0000-4000-8000-000000000005",
      repoRef: SEEDED_REPO,
      text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`",
      status: "expired",
      proposer: "import",
      provenance: { line: "imported from CLAUDE.md", refs: [{ kind: "import", file: "CLAUDE.md", section: "Kconfig" }] },
      confirmation: { actor: KEN, at: minutesAgo(199 * 1440), reason: null },
      staleness: { actor: null, at: minutesAgo(60), reason: "platform_version anchor zephyr-4.0 no longer holds" },
      expiry: {
        reason: "Zephyr 4.1 migration",
        previousUseCount: 31,
        stamp: { actor: KEN, at: minutesAgo(30), reason: "Zephyr 4.1 migration" },
      },
      usedCount: 31,
      anchors: [{ id: "5eed0045-0000-4000-8000-000000000005", kind: "platform_version", value: "zephyr-4.0", lastCheckedAt: minutesAgo(60) }],
      createdAt: minutesAgo(200 * 1440),
      updatedAt: minutesAgo(30),
    }),
  ];
}

/**
 * The seeded list with its counts.
 *
 * @param items The rows. Defaults to the seed's five.
 * @returns The list, its counts derived from the rows.
 */
export function seededFacts(items: readonly Fact[] = seededFactRows()): FactList {
  const counts = { proposed: 0, confirmed: 0, rejected: 0, stale: 0, expired: 0 };
  for (const one of items) counts[one.status] += 1;

  return { items: [...items], counts };
}

/** One seeded fact, by its text's first word — `seededFact("Team")`. */
export function seededFact(lead: string): Fact {
  const found = seededFactRows().find((one) => one.text.startsWith(lead));
  if (found === undefined) throw new Error(`no seeded fact starting ${lead}`);

  return found;
}

/**
 * The rig-reservation fact as the sweep would flag it: stale, with the anchor change named.
 *
 * @returns The fact.
 */
export function staleFact(): Fact {
  return {
    ...seededFact("Tests"),
    status: "stale",
    staleness: {
      actor: null,
      at: minutesAgo(3 * 1440),
      reason: "path_glob anchor tests/hil/** matched: renamed tests/hil/rig.py (PR #540)",
    },
  };
}

/** The two cited tickets, resolved to their tracker pages. */
export function seededTickets(): Readonly<Record<string, TicketLink>> {
  return {
    [CITED_TICKET_552]: { label: "#552", href: `https://github.com/${SEEDED_REPO}/issues/552` },
    [CITED_TICKET_560]: { label: "#560", href: `https://github.com/${SEEDED_REPO}/issues/560` },
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

/* ------------------------------------------------------------------ playbooks (#420) */

/** The seed's `standard-fix` workflow, pinned at v14. */
export const STANDARD_FIX = { id: "5eed0012-0000-4000-8000-000000000001", slug: "standard-fix", version: 14 };

/** The run the seed learned `Flaky test hunt` from — loop #1791. */
export const SOURCE_RUN_ID = "5eed0009-0000-4000-8000-000000001791";

/**
 * One playbook, seed-shaped: `Flaky test hunt`, run 9×.
 *
 * @param over Fields to replace.
 * @returns The playbook.
 */
export function playbook(over: Partial<Playbook> = {}): Playbook {
  return {
    id: "5eed0046-0000-4000-8000-000000000001",
    name: "Flaky test hunt",
    description: "Finds & fixes the flakiest test in the suite",
    workflow: STANDARD_FIX,
    skillOverrides: { enable: [], disable: [] },
    contextPreset: { steerNotes: ["focus the flakiest suite first"], factIds: [] },
    issueFilter: { labels: ["flaky"], repos: null },
    sourceRunId: SOURCE_RUN_ID,
    runCount: 9,
    createdAt: minutesAgo(30 * 1440),
    updatedAt: minutesAgo(30 * 1440),
    ...over,
  };
}

/**
 * The seed's three playbooks, by name as the service lists them — mockup 14's rows.
 *
 * @returns The playbooks.
 */
export function seededPlaybookRows(): readonly Playbook[] {
  return [
    playbook({
      id: "5eed0046-0000-4000-8000-000000000002",
      name: "CVE bump",
      description: "Patch a vulnerable dep + prove no API break",
      workflow: { id: "5eed0012-0000-4000-8000-000000000002", slug: "deps-refresh", version: 3 },
      contextPreset: { steerNotes: [], factIds: [] },
      issueFilter: { labels: ["security", "dependencies"], repos: null },
      sourceRunId: null,
      runCount: 14,
    }),
    playbook(),
    playbook({
      id: "5eed0046-0000-4000-8000-000000000003",
      name: "New driver bring-up",
      description: "Scaffold + HIL smoke test on the bench rig",
      skillOverrides: { enable: ["5eed0410-0000-4000-8000-000000000004"], disable: [] },
      contextPreset: { steerNotes: [], factIds: [] },
      issueFilter: null,
      sourceRunId: null,
      runCount: 3,
    }),
  ];
}

/**
 * The seeded list.
 *
 * @param items The rows. Defaults to the seed's three.
 * @returns The list.
 */
export function seededPlaybooks(items: readonly Playbook[] = seededPlaybookRows()): PlaybookList {
  return { items: [...items] };
}

/** One seeded playbook, by name — `seededPlaybook("CVE bump")`. */
export function seededPlaybook(name: string): Playbook {
  const found = seededPlaybookRows().find((one) => one.name === name);
  if (found === undefined) throw new Error(`no seeded playbook ${name}`);

  return found;
}

/**
 * One issue the picker offers — `#485`, sized, not queued.
 *
 * @param over Fields to replace.
 * @returns The candidate.
 */
export function candidate(over: Partial<PlaybookIssueCandidate> = {}): PlaybookIssueCandidate {
  return {
    id: "5eed0030-0000-4000-8000-000000000485",
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    repo: SEEDED_REPO,
    labels: ["flaky"],
    sizingStatus: "sized",
    queued: false,
    ...over,
  };
}

/**
 * Five candidates in the service's order (newest first), one of every kind: an unsized one first,
 * then sized, queued, estimating and needs-human — so the ranked order differs from the listed one.
 *
 * @returns The candidates.
 */
export function mixedCandidates(): readonly PlaybookIssueCandidate[] {
  return [
    candidate({ id: "5eed0030-0000-4000-8000-000000000490", number: 490, title: "Unsized thing", sizingStatus: "unsized" }),
    candidate(),
    candidate({ id: "5eed0030-0000-4000-8000-000000000483", number: 483, title: "Already queued thing", queued: true }),
    candidate({ id: "5eed0030-0000-4000-8000-000000000488", number: 488, title: "Being sized thing", sizingStatus: "estimating" }),
    candidate({ id: "5eed0030-0000-4000-8000-000000000481", number: 481, title: "Needs a person thing", sizingStatus: "needs_human" }),
  ];
}

/**
 * The receipt a launch of `Flaky test hunt` on `#485` leaves.
 *
 * @param over Fields to replace.
 * @returns The receipt.
 */
export function launchReceipt(over: Partial<PlaybookLaunchReceipt> = {}): PlaybookLaunchReceipt {
  return {
    playbookId: playbook().id,
    item: queueItem({ workflowVersion: 14, workflowPinReason: "explicit", position: 3 }),
    position: 3,
    context: {
      manifest: {
        consumer: "playbook",
        scope: { repo: SEEDED_REPO, workflow: null },
        budgetTokens: 6000,
        estTokens: 0,
        skillVersions: [],
        facts: [],
        trimmed: [],
        excluded: [],
        refusedOverrides: [],
        manifestHash: "0".repeat(64),
      },
      steerNotes: ["focus the flakiest suite first"],
      factIds: [],
    },
    links: {
      queue: "/api/v1/queue",
      playbook: `/api/v1/knowledge/playbooks/${playbook().id}`,
      issue: "/api/v1/backlog/5eed0030-0000-4000-8000-000000000485",
    },
    ...over,
  };
}

/**
 * What create-from-run captures from the seeded run — loop #1791.
 *
 * @param over Fields to replace.
 * @returns The draft.
 */
export function playbookDraft(over: Partial<PlaybookDraft> = {}): PlaybookDraft {
  return {
    sourceRunId: SOURCE_RUN_ID,
    sourceLoopSeq: 1791,
    workflow: STANDARD_FIX,
    skillOverrides: { enable: ["5eed0410-0000-4000-8000-000000000004"], disable: ["5eed0410-0000-4000-8000-000000000002"] },
    contextPreset: { steerNotes: ["focus the flakiest suite first", "leave the CAN driver alone"], factIds: [] },
    derivedFrom: { repo: SEEDED_REPO, injections: 3, steers: 2 },
    suggestedDescription: "Learned from loop #1791 — Fix flaky CAN-bus telemetry test",
    ...over,
  };
}

/* ------------------------------------------------------------------ the repo profile (#420) */

/**
 * One detection row.
 *
 * @param over Fields to replace.
 * @returns The row.
 */
export function detectionRow(over: Partial<RepoDetectionRow> = {}): RepoDetectionRow {
  return {
    rowKey: "language",
    verdict: "ok",
    value: "C 92% · CMake",
    label: "detected",
    confidence: "high",
    determined: true,
    evidence: { pack: "language", version: "1.0.0" },
    ...over,
  };
}

/**
 * The seeded repository's detection: mockup 13's rows as the card composes them, and the two
 * protected paths.
 *
 * @param over Fields to replace.
 * @returns The detection.
 */
export function seededDetection(over: Partial<RepoDetection> = {}): RepoDetection {
  return {
    repo: SEEDED_REPO,
    scan: {
      scanSeq: 3,
      scannedAt: minutesAgo(2 * 1440),
      durationMs: 38_000,
      packVersions: { language: "1.0.0", build: "1.0.0", devcontainer: "1.0.0", tests: "1.0.0", protected_paths: "1.0.0", conventions: "1.0.0" },
      probeBudgetUsed: 41,
    },
    rows: [
      detectionRow(),
      detectionRow({ rowKey: "build", value: "west + twister (found west.yml)", evidence: { pack: "build", version: "1.0.0" } }),
      detectionRow({ rowKey: "devcontainer", value: "✓ .devcontainer.json", evidence: { pack: "devcontainer", version: "1.0.0" } }),
      detectionRow({ rowKey: "tests", value: "412 tests (twister)", label: "measured", evidence: { pack: "tests", version: "1.0.0" } }),
      detectionRow({ rowKey: "protected_paths", value: "boot/ keys/", evidence: { pack: "protected_paths", version: "1.0.0" } }),
      detectionRow({ rowKey: "conventions", verdict: "warn", value: "no CLAUDE.md found — import one", confidence: "medium", evidence: { pack: "conventions", version: "1.0.0" } }),
    ],
    protectedPaths: [
      { glob: "boot/**", source: "suggested" },
      { glob: "keys/**", source: "edited" },
    ],
    progress: null,
    ...over,
  };
}

/** The seeded repository, never scanned. */
export function unscannedDetection(): RepoDetection {
  return seededDetection({ scan: null, rows: [], protectedPaths: [] });
}

/**
 * The seed's environment recipe at v3 — mockup 14's four ordered commands, Ken's edit nine days
 * before the read.
 *
 * @param over Fields to replace.
 * @returns The recipe.
 */
export function seededRecipe(over: Partial<EnvRecipe> = {}): EnvRecipe {
  return {
    repo: SEEDED_REPO,
    version: 3,
    commands: [
      { command: "west init -m git@github.com:acme-robotics/helios-firmware", comment: "manifest repo" },
      { command: "west update --narrow -o=--depth=1", comment: "shallow module fetch" },
      { command: "zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi", comment: "SDK + ARM toolchain" },
      { command: "ccache --set-config=max_size=8G", comment: "shared build cache" },
    ],
    source: "edited",
    updatedAt: minutesAgo(9 * 1440),
    updatedBy: KEN,
    ...over,
  };
}

/**
 * The profile readings for the seeded repository, every reading `ok`.
 *
 * @param over Readings to replace.
 * @returns The readings.
 */
export function seededProfile(over: Partial<ProfileReadings> = {}): ProfileReadings {
  return {
    repo: enabledRepo(),
    detection: { ok: true, value: seededDetection() },
    recipe: { ok: true, value: seededRecipe() },
    ...over,
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
    facts: { ok: true, value: seededFacts() },
    tickets: seededTickets(),
    repos: { ok: true, value: seededRepos() },
    playbooks: { ok: true, value: seededPlaybooks() },
    profile: seededProfile(),
    readAt: READ_AT,
    ...over,
  };
}
