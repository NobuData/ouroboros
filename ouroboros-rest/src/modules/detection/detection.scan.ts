/**
 * The scan orchestrator — rule packs in, card rows out, inside a bounded budget
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * ```
 * round n:  every pack's probes(seen) ─▶ dedupe by key ─▶ run in parallel (≤ concurrency)
 *                                                          ├─ cost > budget left → skipped · budget_exhausted
 *                                                          ├─ past the deadline  → skipped · deadline
 *                                                          └─ host says rate_limit → failed, and stop
 * until no pack wants a probe it has not had, or maxRounds
 *
 * conclude: a pack whose every probe finished → pack.conclude(seen)
 *           a pack with any probe unfinished   → its rows, marked undetermined (never dropped)
 * ```
 *
 * **Nothing here names a pack or a row.** The orchestrator knows probes, costs and budgets; what a
 * probe *means* is the pack's. So a pack emitting `custom:license` needs no change to this file —
 * the acceptance criterion, and `detection.scan.spec.ts` demonstrates it.
 *
 * **Honesty is structural.** A row that could not be determined is emitted with verdict `warn`, a
 * value that says why, and `evidence.undetermined: true` — never omitted, and never `missing`,
 * because *missing* is a conclusion (we looked and it is not there) the scan did not reach.
 *
 * **Rate limits are respected, not retried into** (#101). The first `rate_limit` refusal stops the
 * scan: every probe not yet sent is skipped. The provider's own guard refuses before sending when
 * the budget is at its floor, so a constrained workspace spends at most one refused call here.
 */

import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { isProbePath } from "../ticket-sources/ticket-source.probe";
import {
  PROBE_COSTS,
  ProbeResults,
  probeKey,
  type DetectionConfidence,
  type DetectionLabel,
  type DetectionRowDraft,
  type DetectionRowKey,
  type DetectionVerdict,
  type ProbeOutcome,
  type ProbeSpec,
  type ProbeStopReason,
  type ProbeValue,
  type RulePack,
} from "./detection.pack";
import { clampValue } from "./packs/pack.helpers";

/** Runs one probe against the host. Throws `TicketSourceError` on a refusal. */
export type Prober = (probe: ProbeSpec) => Promise<ProbeValue>;

/** The bounds a scan runs inside. */
export interface ScanBudget {
  /** The most probe cost one scan may spend — each probe is one host request. */
  readonly maxProbes: number;
  /** The wall-clock ceiling, in milliseconds. Probes still in flight then are abandoned. */
  readonly deadlineMs: number;
  /** How many probes run at once. */
  readonly concurrency: number;
  /** The most rounds of `probes(seen)` — a pack that keeps asking for more is cut off here. */
  readonly maxRounds: number;
}

/**
 * The default budget: 24 requests, 20 seconds, 4 at a time, 3 rounds.
 *
 * The Zephyr fixture spends 9 — languages, the tree, `west.yml`, the devcontainer and five suite
 * files — so the budget is a ceiling a real repository rarely touches, and small against GitHub's
 * 5 000 an hour and the 50 the rate guard holds back for the backlog sync.
 */
export const DEFAULT_SCAN_BUDGET: ScanBudget = Object.freeze({
  maxProbes: 24,
  deadlineMs: 20_000,
  concurrency: 4,
  maxRounds: 3,
});

/** Why a row could not be determined. */
export type UndeterminedReason = ProbeStopReason | "pack_failed" | "not_concluded";

/** The words an undetermined row prints, after *Could not determine —*. */
export const UNDETERMINED_SENTENCES: Readonly<Record<UndeterminedReason, string>> = {
  budget_exhausted: "the scan's probe budget ran out",
  deadline: "the scan ran out of time",
  rate_limited: "the host's rate limit was reached",
  error: "the host could not answer every probe",
  pack_failed: "the rule pack failed",
  not_concluded: "the rule pack reached no conclusion",
};

/** A row as the scan stores it — a pack's draft, with its provenance stamped into the evidence. */
export interface DetectionRow {
  readonly rowKey: DetectionRowKey;
  readonly verdict: DetectionVerdict;
  readonly value: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly confidence: DetectionConfidence;
  readonly label: DetectionLabel;
}

/** Progress, as the scan reports it after every probe. */
export interface ScanProgressEvent {
  /** Probes asked for so far, across rounds. */
  readonly planned: number;
  /** Probes that finished, were skipped or failed. */
  readonly settled: number;
}

/** What a scan produced. */
export interface ScanOutcome {
  /** One row per row key every pack declared, in pack order. */
  readonly rows: readonly DetectionRow[];
  /** The protected-path globs the packs suggested, deduplicated. */
  readonly protectedPaths: readonly string[];
  /** `{ pack key: version }` — the scan row's `pack_versions`. */
  readonly packVersions: Readonly<Record<string, string>>;
  /** Probe cost spent — the scan row's `probe_budget_used`. */
  readonly probesUsed: number;
  /** Wall-clock, in milliseconds — the card's `scanned in 38s`. */
  readonly durationMs: number;
  /** Why probing stopped early, or null when every wanted probe ran. */
  readonly stopped: ProbeStopReason | null;
}

/** Options beyond the packs and the prober. */
export interface ScanOptions {
  /** The bounds; {@link DEFAULT_SCAN_BUDGET} when omitted. */
  readonly budget?: ScanBudget;
  /** Told after every probe settles. */
  readonly onProgress?: (progress: ScanProgressEvent) => void;
}

/** The value a deadline race resolves to. */
const DEADLINE = Symbol("deadline");

/**
 * Run every pack against a repository through one prober.
 *
 * @param packs - The rule packs, in the order their rows are emitted.
 * @param prober - What asks the host.
 * @param options - Budget and progress.
 * @returns The rows, the suggestions and the scan's metadata. Never rejects for anything the host
 *   or a pack did: every failure becomes an undetermined row.
 */
export async function runScan(
  packs: readonly RulePack[],
  prober: Prober,
  options: ScanOptions = {},
): Promise<ScanOutcome> {
  const budget = options.budget ?? DEFAULT_SCAN_BUDGET;
  const started = Date.now();
  const outcomes = new Map<string, ProbeOutcome>();
  const requested = new Map<string, Set<string>>(packs.map((pack) => [pack.key, new Set()]));
  const broken = new Set<string>();
  let used = 0;
  let stopped: ProbeStopReason | null = null;
  let planned = 0;
  let settled = 0;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => {
      resolve(DEADLINE);
    }, budget.deadlineMs);
    timer.unref();
  });

  /** One probe, inside the budget. */
  const runOne = async (probe: ProbeSpec): Promise<ProbeOutcome> => {
    if (stopped !== null) {
      return { status: "skipped", reason: stopped };
    }

    if (Date.now() - started >= budget.deadlineMs) {
      stopped = "deadline";

      return { status: "skipped", reason: stopped };
    }

    if (used + PROBE_COSTS[probe.kind] > budget.maxProbes) {
      stopped = "budget_exhausted";

      return { status: "skipped", reason: stopped };
    }

    if (probe.kind === "file" && !isProbePath(probe.path)) {
      return { status: "failed", reason: "error" };
    }

    used += PROBE_COSTS[probe.kind];

    const call = prober(probe).then(
      (value): ProbeOutcome => ({ status: "done", value }),
      (error: unknown): ProbeOutcome => {
        if (TicketSourceError.is(error) && error.errorClass === "rate_limit") {
          stopped = "rate_limited";

          return { status: "failed", reason: "rate_limited" };
        }

        return { status: "failed", reason: "error" };
      },
    );
    const result = await Promise.race([call, deadline]);

    if (result === DEADLINE) {
      stopped = "deadline";

      return { status: "skipped", reason: "deadline" };
    }

    return result;
  };

  /** One round's probes, at most `concurrency` at a time. */
  const runRound = async (probes: readonly ProbeSpec[]): Promise<void> => {
    let next = 0;

    planned += probes.length;
    options.onProgress?.({ planned, settled });

    const worker = async (): Promise<void> => {
      while (next < probes.length) {
        const probe = probes[next];

        next += 1;
        outcomes.set(probeKey(probe), await runOne(probe));
        settled += 1;
        options.onProgress?.({ planned, settled });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(budget.concurrency, probes.length) }, () => worker()),
    );
  };

  try {
    for (let round = 0; ; round += 1) {
      const wanted = wantedProbes(packs, new ProbeResults(outcomes), requested, broken);

      if (wanted.length === 0) {
        break;
      }

      if (round >= budget.maxRounds) {
        stopped ??= "budget_exhausted";

        for (const probe of wanted) {
          outcomes.set(probeKey(probe), { status: "skipped", reason: "budget_exhausted" });
        }

        break;
      }

      await runRound(wanted);
    }
  } finally {
    clearTimeout(timer);
  }

  const seen = new ProbeResults(outcomes);
  const rows: DetectionRow[] = [];
  const protectedPaths = new Set<string>();

  for (const pack of packs) {
    const concluded = concludePack(pack, seen, requested.get(pack.key) ?? new Set(), broken);

    rows.push(...concluded.rows);
    concluded.protectedPaths.forEach((glob) => protectedPaths.add(glob));
  }

  return {
    rows,
    protectedPaths: [...protectedPaths],
    packVersions: Object.fromEntries(packs.map((pack) => [pack.key, pack.version])),
    probesUsed: used,
    durationMs: Date.now() - started,
    stopped,
  };
}

/**
 * Every probe some pack wants that has not been run — deduplicated, in pack order — recording
 * which pack asked for what.
 *
 * @param packs - The packs.
 * @param seen - The outcomes so far.
 * @param requested - Pack key → probe keys it has asked for; added to here.
 * @param broken - Packs whose `probes` threw; added to here, and never asked again.
 * @returns The probes to run next.
 */
function wantedProbes(
  packs: readonly RulePack[],
  seen: ProbeResults,
  requested: Map<string, Set<string>>,
  broken: Set<string>,
): ProbeSpec[] {
  const wanted = new Map<string, ProbeSpec>();

  for (const pack of packs) {
    if (broken.has(pack.key)) {
      continue;
    }

    let probes: readonly ProbeSpec[];

    try {
      probes = pack.probes(seen);
    } catch {
      broken.add(pack.key);
      continue;
    }

    for (const probe of probes) {
      const key = probeKey(probe);

      requested.get(pack.key)?.add(key);

      if (!seen.outcomes.has(key) && !wanted.has(key)) {
        wanted.set(key, probe);
      }
    }
  }

  return [...wanted.values()];
}

/**
 * One pack's rows: its conclusion when every probe it asked for finished, and its declared rows
 * marked undetermined otherwise.
 *
 * @param pack - The pack.
 * @param seen - Every outcome.
 * @param asked - The probe keys it asked for.
 * @param broken - Packs whose `probes` threw.
 * @returns The rows, and the protected paths it suggested.
 */
function concludePack(
  pack: RulePack,
  seen: ProbeResults,
  asked: ReadonlySet<string>,
  broken: ReadonlySet<string>,
): { rows: DetectionRow[]; protectedPaths: string[] } {
  const probes = [...asked];
  const unfinished = probes
    .map((probe) => ({ probe, outcome: seen.outcomes.get(probe) }))
    .filter(({ outcome }) => outcome?.status !== "done")
    .map(({ probe, outcome }) => ({
      probe,
      status: outcome?.status ?? "skipped",
      reason:
        outcome !== undefined && outcome.status !== "done" ? outcome.reason : "budget_exhausted",
    }));
  const undetermined = (reason: UndeterminedReason): DetectionRow[] =>
    pack.rows.map((rowKey) => undeterminedRow(rowKey, pack, probes, reason, unfinished));

  if (broken.has(pack.key)) {
    return { rows: undetermined("pack_failed"), protectedPaths: [] };
  }

  if (unfinished.length > 0) {
    return { rows: undetermined(unfinished[0].reason), protectedPaths: [] };
  }

  let conclusion;

  try {
    conclusion = pack.conclude(seen);
  } catch {
    return { rows: undetermined("pack_failed"), protectedPaths: [] };
  }

  const drafts = new Map<DetectionRowKey, DetectionRowDraft>();

  for (const draft of conclusion.rows) {
    if (pack.rows.includes(draft.rowKey) && !drafts.has(draft.rowKey) && isWellFormed(draft)) {
      drafts.set(draft.rowKey, draft);
    }
  }

  return {
    rows: pack.rows.map((rowKey) => {
      const draft = drafts.get(rowKey);

      return draft === undefined
        ? undeterminedRow(rowKey, pack, probes, "not_concluded", [])
        : {
            rowKey,
            verdict: draft.verdict,
            value: clampValue(draft.value),
            confidence: draft.confidence,
            label: "detected",
            // The pack's evidence first, provenance last — so a pack cannot restate its own.
            evidence: {
              ...draft.evidence,
              pack: pack.key,
              packVersion: pack.version,
              probes,
              confidence: draft.confidence,
            },
          };
    }),
    protectedPaths: (conclusion.protectedPaths ?? []).filter(isProtectedGlob),
  };
}

/**
 * A row the scan could not determine — present, and saying so.
 *
 * @param rowKey - The row.
 * @param pack - The pack that declared it.
 * @param probes - The probes the pack asked for.
 * @param reason - Why.
 * @param unfinished - The probes that did not finish, and how.
 * @returns The row: verdict `warn`, `evidence.undetermined: true`.
 */
function undeterminedRow(
  rowKey: DetectionRowKey,
  pack: RulePack,
  probes: readonly string[],
  reason: UndeterminedReason,
  unfinished: readonly { probe: string; status: string; reason: string }[],
): DetectionRow {
  return {
    rowKey,
    verdict: "warn",
    value: `Could not determine — ${UNDETERMINED_SENTENCES[reason]}`,
    confidence: "low",
    label: "detected",
    evidence: {
      undetermined: true,
      reason,
      unfinished,
      pack: pack.key,
      packVersion: pack.version,
      probes,
      confidence: "low",
    },
  };
}

/** V067's verdicts. */
const VERDICTS: readonly string[] = ["ok", "warn", "missing"];

/** V067's confidences, as this service spells them. */
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];

/**
 * Whether a pack's draft is one V067 would store.
 *
 * @param draft - The draft.
 * @returns True when the verdict, confidence, value and evidence are well-formed.
 */
function isWellFormed(draft: DetectionRowDraft): boolean {
  return (
    VERDICTS.includes(draft.verdict) &&
    CONFIDENCES.includes(draft.confidence) &&
    typeof draft.value === "string" &&
    draft.value.trim() !== "" &&
    typeof draft.evidence === "object" &&
    draft.evidence !== null &&
    !Array.isArray(draft.evidence)
  );
}

/**
 * Whether a suggested glob is one V067's `protected_path_policies_glob_format` accepts.
 *
 * @param glob - The glob.
 * @returns True when relative, non-blank, trimmed, ≤ 512, no backslash, no `..` segment, no
 *   control character.
 */
export function isProtectedGlob(glob: string): boolean {
  return (
    typeof glob === "string" &&
    glob !== "" &&
    glob.trim() === glob &&
    glob.length <= 512 &&
    !glob.startsWith("/") &&
    !glob.includes("\\") &&
    !/(^|\/)\.\.(\/|$)/.test(glob) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(glob)
  );
}
