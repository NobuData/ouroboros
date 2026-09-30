/**
 * What the rule-file import answers, and the stored shapes an imported row carries (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)). Pure mappers.
 *
 * The provenance an imported item carries is V069's and V071's typed shape, so the UI renders and
 * links it with the code it already has:
 *
 * ```
 * skill frontmatter  { name, description, scope: repo, provenance: { source: "CLAUDE.md", section: "Kconfig" } }
 * fact provenance    { line: "imported from CLAUDE.md", refs: [{ kind: "import", file: "CLAUDE.md", section: "Kconfig" }] }
 * ```
 */

import type { SkillFrontmatter } from "../skills/skills.frontmatter";
import type { FactProvenance } from "../facts/facts.resources";
import type { FilePlan, ImportPlan, PlannedFact, PlannedSkill } from "./rule-import.plan";

/** How many items of each kind a preview shows per file. */
export const PREVIEW_SAMPLE_SIZE = 5;

/** A skill draft, as a preview samples it. */
export interface RuleImportSkillSample {
  /** `create` a draft skill, or `update` a previously imported skill's draft version. */
  readonly action: "create" | "update";
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The heading it was split at, or null for a file with none. */
  readonly section: string | null;
}

/** A fact candidate, as a preview samples it. */
export interface RuleImportFactSample {
  readonly text: string;
  readonly section: string | null;
  /** The provenance the fact will carry. */
  readonly provenance: FactProvenance;
}

/** One output kind's share of a file. */
export interface RuleImportKind<Sample> {
  /** How many the apply writes. */
  readonly planned: number;
  /** How many deduped away. */
  readonly deduped: number;
  /** The first {@link PREVIEW_SAMPLE_SIZE} planned. */
  readonly samples: readonly Sample[];
}

/** One probed rules file. */
export interface RuleImportFile {
  readonly path: string;
  /** Whether the repository has it. */
  readonly found: boolean;
  /** Its size on the host, in bytes; 0 when absent. */
  readonly sizeBytes: number;
  /** Whether only its first 256 KiB were read. */
  readonly truncated: boolean;
  readonly skills: RuleImportKind<RuleImportSkillSample>;
  readonly facts: RuleImportKind<RuleImportFactSample>;
}

/** The whole import, summed. */
export interface RuleImportTotals {
  /** Rules files the repository has. `0` is the honest empty result. */
  readonly filesFound: number;
  /** New draft skills. */
  readonly skillDrafts: number;
  /** Draft versions written onto previously imported skills. */
  readonly skillUpdates: number;
  /** New proposed facts. */
  readonly factCandidates: number;
  readonly dedupedSkills: number;
  readonly dedupedFacts: number;
}

/** `POST …/preview` — what an apply with this fingerprint would write. */
export interface RuleImportPreview {
  readonly repo: string;
  /** What `POST …/apply` must send back. */
  readonly fingerprint: string;
  readonly files: readonly RuleImportFile[];
  readonly totals: RuleImportTotals;
}

/** `POST …/apply` — the preview it matched, and what was written. */
export interface RuleImportResult extends RuleImportPreview {
  readonly created: {
    /** Every skill written, in plan order. */
    readonly skills: readonly { readonly slug: string; readonly action: "create" | "update" }[];
    /** Every fact written, in plan order. */
    readonly facts: readonly { readonly id: string; readonly text: string }[];
  };
}

/**
 * The preview of a plan.
 *
 * @param plan - The plan.
 * @returns The resource.
 */
export function previewOf(plan: ImportPlan): RuleImportPreview {
  return {
    repo: plan.repo,
    fingerprint: plan.fingerprint,
    files: plan.files.map(fileOf),
    totals: totalsOf(plan),
  };
}

/**
 * The frontmatter an imported skill's draft is stored with.
 *
 * @param skill - The planned skill.
 * @returns V069's typed document: name, description, `scope: repo` and the import provenance.
 */
export function importedFrontmatter(skill: PlannedSkill): SkillFrontmatter {
  return {
    name: skill.name,
    description: skill.description,
    scope: "repo",
    provenance:
      skill.section === null
        ? { source: skill.file }
        : { source: skill.file, section: skill.section },
  };
}

/**
 * The provenance an imported fact is stored with.
 *
 * @param fact - The planned fact.
 * @returns V071's typed document: the display line and one `import` reference.
 */
export function importedProvenance(fact: Pick<PlannedFact, "file" | "section">): FactProvenance {
  return {
    line: `imported from ${fact.file}`,
    refs: [
      fact.section === null
        ? { kind: "import", file: fact.file }
        : { kind: "import", file: fact.file, section: fact.section },
    ],
  };
}

/**
 * How many skills and facts a plan writes.
 *
 * @param plan - The plan.
 * @returns The two counts.
 */
export function plannedCounts(plan: ImportPlan): { skills: number; facts: number } {
  return {
    skills: plan.files.reduce((sum, file) => sum + file.skills.length, 0),
    facts: plan.files.reduce((sum, file) => sum + file.facts.length, 0),
  };
}

/**
 * One file's resource.
 *
 * @param file - Its plan.
 * @returns The resource.
 */
function fileOf(file: FilePlan): RuleImportFile {
  return {
    path: file.path,
    found: file.found,
    sizeBytes: file.size,
    truncated: file.truncated,
    skills: {
      planned: file.skills.length,
      deduped: file.dedupedSkills,
      samples: file.skills.slice(0, PREVIEW_SAMPLE_SIZE).map((skill) => ({
        action: skill.action,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        section: skill.section,
      })),
    },
    facts: {
      planned: file.facts.length,
      deduped: file.dedupedFacts,
      samples: file.facts.slice(0, PREVIEW_SAMPLE_SIZE).map((fact) => ({
        text: fact.text,
        section: fact.section,
        provenance: importedProvenance(fact),
      })),
    },
  };
}

/**
 * The plan, summed.
 *
 * @param plan - The plan.
 * @returns The totals.
 */
function totalsOf(plan: ImportPlan): RuleImportTotals {
  const skills = plan.files.flatMap((file) => file.skills);

  return {
    filesFound: plan.files.filter((file) => file.found).length,
    skillDrafts: skills.filter((skill) => skill.action === "create").length,
    skillUpdates: skills.filter((skill) => skill.action === "update").length,
    factCandidates: plannedCounts(plan).facts,
    dedupedSkills: plan.files.reduce((sum, file) => sum + file.dedupedSkills, 0),
    dedupedFacts: plan.files.reduce((sum, file) => sum + file.dedupedFacts, 0),
  };
}
