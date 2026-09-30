/**
 * The pure rules of playbooks (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415),
 * decision **K6**): how a past run becomes a recipe, and how V072's three jsonb documents are
 * written and read.
 *
 * ```
 * create-from-run
 *   injected skills (context_injections of the run) ─┐
 *   assembly's resolution for the run's scope now    ─┴─▶ deriveOverrides ─▶ {enable, disable}
 *   the run's steers (run_controls, kind steer)      ────▶ steerPreset     ─▶ steer_notes
 * ```
 *
 * **Overrides are a delta, so they are derived as one.** V072 stores skill overrides *relative to
 * what assembly would resolve* — `{}` means "as assembly resolves". So the run's manifest is
 * compared with what assembly resolves for the same scope today: a skill the run was injected with
 * that assembly would not inject is **enabled**; a skill assembly would inject that the run went
 * without is **disabled** — unless it is `required`, which no recipe may switch off (V072's lock).
 * A run with no injection records carries no manifest to learn from, and derives `{}`.
 *
 * **Steer notes are copied, not summarised.** What the human typed is kept verbatim (trimmed),
 * in the order it was typed, de-duplicated, and held to V072's bounds — at most 16 notes of at
 * most 2 000 characters. A note past the bound is cut rather than refused: the recipe is a draft
 * the person edits, and refusing it would lose the other fifteen.
 */

/** V072's `playbook_skill_overrides_typed` — the most ids either half may hold. */
export const MAX_OVERRIDE_IDS = 64;

/** V072's `playbook_context_preset_typed` — the most steer notes a preset holds. */
export const MAX_STEER_NOTES = 16;

/** V072's `playbook_context_preset_typed` — the longest steer note. */
export const MAX_STEER_NOTE_LENGTH = 2000;

/** V072's `playbook_context_preset_typed` — the most extra facts a preset names. */
export const MAX_PRESET_FACTS = 64;

/** V072's `playbook_issue_filter_typed` — the most labels or repositories a filter lists. */
export const MAX_FILTER_ENTRIES = 32;

/** V072's `{enable, disable}` delta of skill ids, relative to assembly. */
export interface PlaybookOverrides {
  readonly enable: readonly string[];
  readonly disable: readonly string[];
}

/** V072's context preset: the human's steer, and extra facts to inject. */
export interface PlaybookPreset {
  readonly steerNotes: readonly string[];
  readonly factIds: readonly string[];
}

/** V072's issue filter — `null` admits every issue. */
export interface PlaybookIssueFilter {
  /** An issue must carry at least one of these; `null` when the filter says nothing of labels. */
  readonly labels: readonly string[] | null;
  /** An issue must live in one of these (`owner/name`, lower-case); `null` when unrestricted. */
  readonly repos: readonly string[] | null;
}

/** One skill assembly resolves for a scope — what {@link deriveOverrides} compares against. */
export interface ResolvedSkill {
  readonly skillId: string;
  readonly required: boolean;
}

/** No delta. */
export const NO_PLAYBOOK_OVERRIDES: PlaybookOverrides = Object.freeze({ enable: [], disable: [] });

/** No preset. */
export const NO_PLAYBOOK_PRESET: PlaybookPreset = Object.freeze({ steerNotes: [], factIds: [] });

/**
 * The override delta that reproduces a run's skills against assembly's resolution today.
 *
 * @param injected - The skill ids the run was injected with, from its injection records. `null`
 *   when the run has no record at all — there is no manifest to learn from.
 * @param resolved - The skills assembly resolves for the run's scope now.
 * @returns `{enable, disable}`, each sorted and capped at {@link MAX_OVERRIDE_IDS}; empty halves
 *   when the run's manifest and today's resolution agree.
 */
export function deriveOverrides(
  injected: ReadonlySet<string> | null,
  resolved: readonly ResolvedSkill[],
): PlaybookOverrides {
  if (injected === null) {
    return NO_PLAYBOOK_OVERRIDES;
  }

  const resolvedIds = new Set(resolved.map((skill) => skill.skillId));
  const enable = [...injected].filter((id) => !resolvedIds.has(id));
  const disable = resolved
    .filter((skill) => !skill.required && !injected.has(skill.skillId))
    .map((skill) => skill.skillId);

  return {
    enable: enable.sort().slice(0, MAX_OVERRIDE_IDS),
    disable: [...new Set(disable)].sort().slice(0, MAX_OVERRIDE_IDS),
  };
}

/**
 * A run's steers, as a preset's notes.
 *
 * @param notes - The steer texts, oldest first.
 * @returns Trimmed, non-blank, de-duplicated (first wins), each cut to
 *   {@link MAX_STEER_NOTE_LENGTH}, the first {@link MAX_STEER_NOTES} kept.
 */
export function steerPreset(notes: readonly string[]): string[] {
  const kept: string[] = [];

  for (const note of notes) {
    const text = note.trim().slice(0, MAX_STEER_NOTE_LENGTH).trim();

    if (text !== "" && !kept.includes(text)) {
      kept.push(text);
    }

    if (kept.length === MAX_STEER_NOTES) break;
  }

  return kept;
}

/**
 * The ids enabled and disabled at once — V072 keeps the halves disjoint.
 *
 * @param overrides - The delta.
 * @returns The ids in both halves; empty when disjoint.
 */
export function overlapOf(overrides: PlaybookOverrides): string[] {
  const disabled = new Set(overrides.disable);

  return overrides.enable.filter((id) => disabled.has(id));
}

/**
 * The delta as V072 stores it: only non-empty halves.
 *
 * @param overrides - The delta.
 * @returns `{enable?, disable?}` — `{}` for no delta.
 */
export function storedOverrides(overrides: PlaybookOverrides): Record<string, string[]> {
  const stored: Record<string, string[]> = {};

  if (overrides.enable.length > 0) stored.enable = [...new Set(overrides.enable)];
  if (overrides.disable.length > 0) stored.disable = [...new Set(overrides.disable)];

  return stored;
}

/**
 * The preset as V072 stores it: only non-empty keys, snake-cased.
 *
 * @param preset - The preset.
 * @returns `{steer_notes?, fact_ids?}` — `{}` for no preset.
 */
export function storedPreset(preset: PlaybookPreset): Record<string, string[]> {
  const stored: Record<string, string[]> = {};
  const notes = steerPreset(preset.steerNotes);

  if (notes.length > 0) stored.steer_notes = notes;
  if (preset.factIds.length > 0) stored.fact_ids = [...new Set(preset.factIds)];

  return stored;
}

/**
 * The filter as V072 stores it — repositories lower-cased (every repository reference in the
 * service is compared lower-case), and a filter that admits everything stored as `null`, not `{}`.
 *
 * @param filter - The filter, or `null`.
 * @returns `{labels?, repos?}`, or `null`.
 */
export function storedFilter(filter: PlaybookIssueFilter | null): Record<string, string[]> | null {
  if (filter === null) return null;

  const stored: Record<string, string[]> = {};
  const labels = distinct(filter.labels ?? []);
  const repos = distinct((filter.repos ?? []).map((repo) => repo.toLowerCase()));

  if (labels.length > 0) stored.labels = labels;
  if (repos.length > 0) stored.repos = repos;

  return Object.keys(stored).length === 0 ? null : stored;
}

/**
 * The stored delta, read back.
 *
 * @param value - `playbooks.skill_overrides`, as the driver returns it.
 * @returns The delta; missing halves empty.
 */
export function readOverrides(value: unknown): PlaybookOverrides {
  const doc = asObject(value);

  return { enable: stringsOf(doc.enable), disable: stringsOf(doc.disable) };
}

/**
 * The stored preset, read back.
 *
 * @param value - `playbooks.context_preset`, as the driver returns it.
 * @returns The preset; missing keys empty.
 */
export function readPreset(value: unknown): PlaybookPreset {
  const doc = asObject(value);

  return { steerNotes: stringsOf(doc.steer_notes), factIds: stringsOf(doc.fact_ids) };
}

/**
 * The stored filter, read back.
 *
 * @param value - `playbooks.issue_filter`, as the driver returns it.
 * @returns The filter, or `null` for one that admits every issue.
 */
export function readFilter(value: unknown): PlaybookIssueFilter | null {
  if (value === null || value === undefined) return null;

  const doc = asObject(value);

  return {
    labels: Array.isArray(doc.labels) ? stringsOf(doc.labels) : null,
    repos: Array.isArray(doc.repos) ? stringsOf(doc.repos) : null,
  };
}

/**
 * @param value - Anything.
 * @returns It, when a plain object; otherwise `{}`.
 */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * @param value - Anything.
 * @returns Its string elements, when an array; otherwise `[]`.
 */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * @param values - Strings.
 * @returns Trimmed, non-blank, first occurrence kept.
 */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
}
