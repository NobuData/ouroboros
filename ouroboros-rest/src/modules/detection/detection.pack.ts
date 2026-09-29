/**
 * The rule-pack contract — what a pack declares, what it is handed, and what it concludes
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * ```
 * pack = { key, version, rows[], probes(seen) → ProbeSpec[], conclude(seen) → rows + suggestions }
 *
 * round 1   probes({})        → languages, tree          (the static probe set)
 * round 2   probes(seen)      → file:west.yml, file:.devcontainer.json, …   (chosen from the tree)
 * conclude  (seen)            → { rowKey, verdict, value, evidence, confidence }[]
 * ```
 *
 * **A pack is declarative and pure.** It never calls the host: it names probes, and reads their
 * results. That is what lets the orchestrator bound the budget, run probes in parallel, dedupe a
 * `package.json` two packs both want, and mark a row undetermined when a probe it needed never
 * ran — none of which it could do if a pack held a client.
 *
 * **Versioned**, because a conclusion's provenance has to survive the pack changing: the scan row
 * stores `{ pack key: version }` and every row's evidence names its pack and version.
 */

import type { RepoFile, RepoTree } from "../ticket-sources/ticket-source.probe";

/** The six rows the onboarding card draws (mockup 13), in its order. */
export const CORE_ROW_KEYS = [
  "language",
  "build",
  "devcontainer",
  "tests",
  "protected_paths",
  "conventions",
] as const;

/** One of the six core rows. */
export type CoreRowKey = (typeof CORE_ROW_KEYS)[number];

/** A row key: a core row, or a pack's own `custom:<name>` (V067's `repo_detections_row_key`). */
export type DetectionRowKey = CoreRowKey | `custom:${string}`;

/** V067's grammar for a custom row key. */
export const CUSTOM_ROW_KEY = /^custom:[a-z0-9][a-z0-9_.-]{0,62}$/;

/** `ok` (✓), `warn` (the conventions row), `missing` (nothing found). V067's vocabulary. */
export type DetectionVerdict = "ok" | "warn" | "missing";

/** How sure a conclusion is. Stored in the row's evidence; V067 has no column for it. */
export type DetectionConfidence = "high" | "medium" | "low";

/** `detected` (a probe saw it) or `measured` (real data backs it). V067's vocabulary. */
export type DetectionLabel = "detected" | "measured";

/** Semantic version, as a pack declares it. */
export const PACK_VERSION = /^\d+\.\d+\.\d+$/;

/** A pack key: lower-case, the name its rows' evidence carries. */
export const PACK_KEY = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/**
 * One probe, as a pack asks for it.
 *
 * Three kinds and a cost each — see {@link PROBE_COSTS}. `tree` answers every existence check and
 * every glob in one request, which is why there is no `exists` or `glob` probe: a pack reads them
 * off the tree for free.
 */
export type ProbeSpec =
  | { readonly kind: "languages" }
  | { readonly kind: "tree" }
  | { readonly kind: "file"; readonly path: string };

/** What each probe kind costs against the scan's budget — one host request apiece. */
export const PROBE_COSTS: Readonly<Record<ProbeSpec["kind"], number>> = {
  languages: 1,
  tree: 1,
  file: 1,
};

/**
 * Where a probe ended up.
 *
 *   * `done` — the host answered (a file that does not exist is `done` with a `null` value).
 *   * `skipped` — never sent: the budget, the deadline or a rate-limit refusal stopped the scan.
 *   * `failed` — the host refused or could not be reached.
 */
export type ProbeStatus = "done" | "skipped" | "failed";

/** Why a probe did not finish. */
export type ProbeStopReason = "budget_exhausted" | "deadline" | "rate_limited" | "error";

/** One probe's outcome. */
export type ProbeOutcome =
  | { readonly status: "done"; readonly value: ProbeValue }
  | { readonly status: "skipped" | "failed"; readonly reason: ProbeStopReason };

/** What a probe answered. */
export type ProbeValue = Record<string, number> | RepoTree | RepoFile | null;

/**
 * Every probe outcome of the scan so far, keyed by {@link probeKey}, with typed readers.
 *
 * A pack reads through these rather than the raw map so it cannot mistake a skipped probe for a
 * missing file: {@link ProbeResults.file} answers `undefined` (not asked, or did not finish) and
 * `null` (asked, and there is no such file) differently.
 */
export class ProbeResults {
  /**
   * @param outcomes - The outcomes, by probe key.
   */
  constructor(readonly outcomes: ReadonlyMap<string, ProbeOutcome> = new Map()) {}

  /**
   * Whether a probe finished.
   *
   * @param probe - The probe.
   * @returns True when the host answered it.
   */
  has(probe: ProbeSpec): boolean {
    return this.outcomes.get(probeKey(probe))?.status === "done";
  }

  /**
   * The languages, when that probe finished.
   *
   * @returns Bytes per language, or `undefined`.
   */
  languages(): Record<string, number> | undefined {
    return this.value({ kind: "languages" }) as Record<string, number> | undefined;
  }

  /**
   * The tree, when that probe finished.
   *
   * @returns The tree, or `undefined`.
   */
  tree(): RepoTree | undefined {
    return this.value({ kind: "tree" }) as RepoTree | undefined;
  }

  /**
   * One file, when that probe finished.
   *
   * @param path - The path.
   * @returns The file; `null` when the host has no such file; `undefined` when it was not asked
   *   or did not finish.
   */
  file(path: string): RepoFile | null | undefined {
    return this.value({ kind: "file", path }) as RepoFile | null | undefined;
  }

  /**
   * Every file path the tree lists, as a set — the existence check a manifest probe needs.
   *
   * @returns The paths; empty when the tree has not been read.
   */
  paths(): ReadonlySet<string> {
    return new Set(
      (this.tree()?.entries ?? []).filter((entry) => entry.type === "file").map((e) => e.path),
    );
  }

  /**
   * One probe's value.
   *
   * @param probe - The probe.
   * @returns The value, or `undefined` when it did not finish.
   */
  private value(probe: ProbeSpec): ProbeValue | undefined {
    const outcome = this.outcomes.get(probeKey(probe));

    return outcome?.status === "done" ? outcome.value : undefined;
  }
}

/**
 * One row as a pack concludes it — before the orchestrator stamps its provenance.
 */
export interface DetectionRowDraft {
  /** Which card row. Must be one the pack declared. */
  readonly rowKey: DetectionRowKey;
  /** ok · warn · missing. */
  readonly verdict: DetectionVerdict;
  /** The line the card prints — `west + twister (found west.yml)`. Non-blank, ≤ 512 characters. */
  readonly value: string;
  /** Which probes hit and missed, and whatever else explains the row. A JSON object. */
  readonly evidence: Readonly<Record<string, unknown>>;
  /** How sure the conclusion is. */
  readonly confidence: DetectionConfidence;
}

/** What a pack concludes. */
export interface PackConclusion {
  /** One row per row key the pack declared. */
  readonly rows: readonly DetectionRowDraft[];
  /**
   * Protected-path globs to suggest, in AP.3's grammar — written as `suggested` policy rows the
   * person can edit. Only the protected-paths pack sets this today; any pack may.
   */
  readonly protectedPaths?: readonly string[];
}

/** A rule pack. */
export interface RulePack {
  /** Stable name — `build`. What the scan's `pack_versions` is keyed by. */
  readonly key: string;
  /** Semantic version. Bump it when a conclusion could change for the same probes. */
  readonly version: string;
  /** The rows this pack concludes. No two registered packs may declare the same row. */
  readonly rows: readonly DetectionRowKey[];
  /**
   * The probes this pack wants, given what has been read so far.
   *
   * Called once per round: with nothing in round 1, then with every earlier round's outcomes. A
   * probe already run (by this pack or another) is not run again. Return the same list every
   * time or a longer one — the orchestrator stops when a round asks for nothing new.
   *
   * @param seen - The outcomes so far.
   * @returns The probes wanted.
   */
  probes(seen: ProbeResults): readonly ProbeSpec[];
  /**
   * The rows, from the outcomes. Pure.
   *
   * Only called when every probe this pack asked for finished — a pack never has to reason about
   * a probe the budget cut, because the orchestrator marks its rows undetermined instead.
   *
   * @param seen - Every outcome of the scan.
   * @returns The rows and any suggestions.
   */
  conclude(seen: ProbeResults): PackConclusion;
}

/**
 * The key a probe is deduplicated and stored by — `languages`, `tree`, `file:west.yml`.
 *
 * @param probe - The probe.
 * @returns The key.
 */
export function probeKey(probe: ProbeSpec): string {
  return probe.kind === "file" ? `file:${probe.path}` : probe.kind;
}

/**
 * Whether a row key is one V067 stores — a core row or a well-formed `custom:<name>`.
 *
 * @param key - The key.
 * @returns True when valid.
 */
export function isRowKey(key: string): key is DetectionRowKey {
  return (CORE_ROW_KEYS as readonly string[]).includes(key) || CUSTOM_ROW_KEY.test(key);
}
