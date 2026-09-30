/**
 * The import plan — what an apply would write, decided once, from the probed files and what the
 * workspace already holds (BF.4, [#413](https://github.com/NobuData/ouroboros/issues/413)). Pure.
 *
 * ```
 * probed files ─▶ parseRuleFile ─▶ per candidate:
 *   skill  (file, section) matches this repo's imported skill?
 *            ├─ body equals one of its versions        → deduped (unchanged)
 *            └─ body differs                           → update: the text becomes its draft
 *          same (file, section) and body elsewhere?    → deduped (moved or copied)
 *          otherwise                                   → create, slug = first free of the name
 *   fact   normalized text an existing fact's, or already planned? → deduped
 *          otherwise                                   → create, proposed
 * ─▶ fingerprint = sha256(repo + every planned write)
 * ```
 *
 * **Preview and apply run this same function** — the apply re-probes, re-reads and re-plans
 * inside its transaction and refuses when the fingerprint differs from the one the preview
 * showed. That is what makes "apply creates exactly what the preview showed" a check rather
 * than a hope: a file edited, a fact added or a slug taken in between is a `409`, never a write
 * the person did not see.
 *
 * **Re-import is a no-op by construction**: everything the last apply wrote is now in the
 * workspace, so every candidate dedupes. A changed file surfaces only its changed sections (as
 * draft updates) and its new bullets (as new candidates). A removed bullet or section removes
 * nothing — an import only ever proposes.
 */

import { createHash } from "node:crypto";

import { nextFreeSlug, slugify } from "../workflows/slug";
import {
  normalizeFactText,
  normalizeSkillBody,
  parseRuleFile,
  type ParsedFact,
  type ParsedSkill,
} from "./rule-import.parse";

/** The rules files probed, in the order a preview lists them. */
export const RULE_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

/** One of {@link RULE_FILES}. */
export type RuleFile = (typeof RULE_FILES)[number];

/** A rules file as the probe answered. */
export interface ProbedRuleFile {
  readonly path: RuleFile;
  /** The text, or `null` when the repository has no such file. */
  readonly content: string | null;
  /** The size on the host, in bytes; 0 when absent. */
  readonly size: number;
  /** Whether the probe cut the text short (256 KiB). */
  readonly truncated: boolean;
}

/** An imported skill already in the workspace, as the plan compares against it. */
export interface PriorImportedSkill {
  readonly skillId: string;
  readonly slug: string;
  /** The skill's repository, or null once it was moved to another scope. */
  readonly repoRef: string | null;
  /** The `(source, section)` pairs any of its versions carries in `frontmatter.provenance`. */
  readonly provenances: readonly { readonly source: string; readonly section: string | null }[];
  /** Every version's body, the draft included. */
  readonly bodies: readonly string[];
}

/** What the workspace already holds that a plan dedupes against. */
export interface ImportBaseline {
  /** Every slug the workspace uses. */
  readonly slugs: ReadonlySet<string>;
  /** Every imported skill of the workspace. */
  readonly importedSkills: readonly PriorImportedSkill[];
  /** The normalized text of every fact of the repository or the whole workspace, any status. */
  readonly factTexts: ReadonlySet<string>;
}

/** A skill the apply writes. */
export interface PlannedSkill {
  /** `create` a new draft skill, or `update` an imported skill's draft version. */
  readonly action: "create" | "update";
  readonly slug: string;
  /** The skill updated, for `update`. */
  readonly skillId: string | null;
  readonly file: RuleFile;
  readonly section: string | null;
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/** A fact candidate the apply writes. */
export interface PlannedFact {
  readonly file: RuleFile;
  readonly section: string | null;
  readonly text: string;
}

/** One file's share of the plan. */
export interface FilePlan {
  readonly path: RuleFile;
  readonly found: boolean;
  readonly size: number;
  readonly truncated: boolean;
  readonly skills: readonly PlannedSkill[];
  readonly facts: readonly PlannedFact[];
  /**
   * Skill drafts that dedupe away — unchanged since a prior import — or, rarely, are left out
   * because a hundred skills already take their name's slug.
   */
  readonly dedupedSkills: number;
  /** Fact candidates that dedupe away — already a fact, or already planned from another line. */
  readonly dedupedFacts: number;
}

/** The whole plan. */
export interface ImportPlan {
  /** `owner/name`, lower-case. */
  readonly repo: string;
  /** Every probed file, in {@link RULE_FILES} order. */
  readonly files: readonly FilePlan[];
  /** sha256 of the repository and every planned write — what an apply must match. */
  readonly fingerprint: string;
}

/**
 * Plan an import.
 *
 * @param repo - `owner/name`, lower-case.
 * @param probed - The probed files, in {@link RULE_FILES} order.
 * @param baseline - What the workspace already holds.
 * @returns The plan.
 */
export function planImport(
  repo: string,
  probed: readonly ProbedRuleFile[],
  baseline: ImportBaseline,
): ImportPlan {
  const taken = new Set(baseline.slugs);
  const planned = new Set<string>();
  const files = probed.map((file): FilePlan => {
    if (file.content === null) {
      return { ...describe(file), skills: [], facts: [], dedupedSkills: 0, dedupedFacts: 0 };
    }

    const parsed = parseRuleFile(file.path, file.content);
    const skills: PlannedSkill[] = [];
    let dedupedSkills = 0;

    for (const skill of parsed.skills) {
      const decided = decideSkill(repo, file.path, skill, baseline, taken);

      if (decided === undefined) dedupedSkills += 1;
      else skills.push(decided);
    }

    const facts: PlannedFact[] = [];
    let dedupedFacts = 0;

    for (const fact of parsed.facts) {
      const key = normalizeFactText(fact.text);

      if (baseline.factTexts.has(key) || planned.has(key)) {
        dedupedFacts += 1;
      } else {
        planned.add(key);
        facts.push(plannedFact(file.path, fact));
      }
    }

    return { ...describe(file), skills, facts, dedupedSkills, dedupedFacts };
  });

  return { repo, files, fingerprint: fingerprintOf(repo, files) };
}

/**
 * What one skill draft becomes.
 *
 * @param repo - The repository.
 * @param file - The rules file.
 * @param skill - The parsed draft.
 * @param baseline - The workspace.
 * @param taken - Slugs in use, planned ones included; a create adds its slug.
 * @returns The write, or `undefined` when it dedupes away (or no slug is free).
 */
function decideSkill(
  repo: string,
  file: RuleFile,
  skill: ParsedSkill,
  baseline: ImportBaseline,
  taken: Set<string>,
): PlannedSkill | undefined {
  const body = normalizeSkillBody(skill.body);
  const sameSource = baseline.importedSkills.filter((prior) =>
    prior.provenances.some(
      (provenance) => provenance.source === file && provenance.section === skill.section,
    ),
  );
  const own = sameSource.find((prior) => prior.repoRef === repo);
  const unchanged = (prior: PriorImportedSkill): boolean =>
    prior.bodies.some((stored) => normalizeSkillBody(stored) === body);

  if (own !== undefined) {
    return unchanged(own)
      ? undefined
      : { action: "update", slug: own.slug, skillId: own.skillId, ...content(file, skill) };
  }

  if (sameSource.some(unchanged)) return undefined;

  const base = slugify(skill.name) ?? slugify(`imported-${file}`) ?? "imported";
  const free = nextFreeSlug(base, taken);

  // A hundred skills already named alike: leave this one out rather than invent a name.
  if (free === undefined) return undefined;

  taken.add(free.slug);

  return { action: "create", slug: free.slug, skillId: null, ...content(file, skill) };
}

/**
 * The parsed draft's content fields.
 *
 * @param file - The rules file.
 * @param skill - The draft.
 * @returns The fields a planned skill carries from it.
 */
function content(file: RuleFile, skill: ParsedSkill) {
  return {
    file,
    section: skill.section,
    name: skill.name,
    description: skill.description,
    body: skill.body,
  };
}

/**
 * A planned fact.
 *
 * @param file - The rules file.
 * @param fact - The parsed candidate.
 * @returns The write.
 */
function plannedFact(file: RuleFile, fact: ParsedFact): PlannedFact {
  return { file, section: fact.section, text: fact.text };
}

/**
 * A probed file's own fields.
 *
 * @param file - The probe's answer.
 * @returns Path, presence, size and truncation.
 */
function describe(file: ProbedRuleFile) {
  return {
    path: file.path,
    found: file.content !== null,
    size: file.size,
    truncated: file.truncated,
  };
}

/**
 * The plan's fingerprint: every field an apply writes, in plan order.
 *
 * @param repo - The repository.
 * @param files - The file plans.
 * @returns Lower-case hex sha256.
 */
function fingerprintOf(repo: string, files: readonly FilePlan[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repo,
        files: files.map((file) => ({
          path: file.path,
          skills: file.skills,
          facts: file.facts,
          dedupedSkills: file.dedupedSkills,
          dedupedFacts: file.dedupedFacts,
        })),
      }),
    )
    .digest("hex");
}
