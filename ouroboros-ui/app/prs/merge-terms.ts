/**
 * What a merge waits on, and why a re-check refused one
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)) — the sentences the Merge plan card's
 * confirmation and its disarmed state are made of.
 *
 * **Arming is a promise about a moment nobody will be watching**, so its confirmation states the
 * terms: {@link armTerms} names each required gate that is not yet satisfied, counts the ones that
 * have not reported at all — they are absent from the rows, and leaving them unsaid would understate
 * the wait — and {@link RECHECK_TERMS} states that everything is checked again at merge time
 * (#360).
 *
 * **A failed re-check says why.** {@link refusalView} gives each designed code its own headline
 * and what to do next, beside the service's own sentence — never a generic error.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PrGateRow, PrMergeRefusalCode, PullRequestPage } from "@/app/api/pull-requests";

import { type GateVerdict, VERDICT_WORDS } from "./gates";

/** The re-check, stated in every confirmation. */
export const RECHECK_TERMS =
  "Gates, head commit and mergeability are re-checked at merge time. If any check fails, the " +
  "plan disarms and says why — nothing merges.";

/** What a direct merge's confirmation states. */
export const MERGE_NOW_TERMS =
  "Every required gate is green, so this merges now. Gates, head commit and mergeability are " +
  "re-checked first; if any check fails, nothing merges and the reason is shown.";

/** What an arm waits on when no gate can be named. */
export const EVERY_GATE = "Merges automatically when every required gate is green.";

/** The verdicts that satisfy a required gate — `pr_gate_aggregate`'s `satisfied_count`. */
const SATISFYING: ReadonlySet<GateVerdict> = new Set(["green", "waived", "not_required"]);

// --- the gates it waits on -----------------------------------------------------------------

/** One required gate that is not yet satisfied. */
export interface WaitingGate {
  /** `model_review`. */
  readonly key: string;
  /** `Second-model review`. */
  readonly label: string;
  /** Where it stands — `pending`, `unavailable`, `red`. */
  readonly verdict: GateVerdict;
  /** `Second-model review — unavailable`. */
  readonly line: string;
  /** What that standing means for the promise. */
  readonly note: string;
}

/** What an arm waits on. */
export interface Waiting {
  /** The required gates that have reported and are not satisfied, in the gates card's order. */
  readonly gates: readonly WaitingGate[];
  /** How many required gates have not reported at all, so cannot be named. */
  readonly unreported: number;
}

/** What each unsatisfied verdict means for an arm. */
const WAITING_NOTES: Readonly<Record<GateVerdict, string>> = {
  pending: "It is being evaluated.",
  unavailable:
    "Nothing reports it yet, so it will not turn green on its own — the merge waits until it " +
    "is green, waived or no longer required.",
  red: "It is red — the re-check would disarm rather than merge.",
  green: "",
  waived: "",
  not_required: "",
};

/**
 * What a merge of the latest revision is waiting on.
 *
 * @param page The PR page.
 * @returns The required gates not yet satisfied, each with where it stands, and how many more
 *   required gates have no result at all — those are absent from the rows, so they are counted
 *   from the aggregate rather than left unsaid.
 */
export function waitingOn(page: PullRequestPage): Waiting {
  const gates = (page.gates?.rows ?? [])
    .filter((row: PrGateRow) => row.required && !SATISFYING.has(row.verdict))
    .map((row: PrGateRow) => ({
      key: row.key,
      label: row.label,
      verdict: row.verdict,
      line: `${row.label} — ${VERDICT_WORDS[row.verdict]}`,
      note: WAITING_NOTES[row.verdict],
    }));
  const aggregate = page.gates?.aggregate ?? null;
  const unsatisfied =
    aggregate === null ? 0 : aggregate.requiredCount - aggregate.satisfiedCount;

  return { gates, unreported: Math.max(0, unsatisfied - gates.length) };
}

/**
 * A list, said — `A`, `A and B`, `A, B and C`.
 *
 * @param names What to list.
 * @returns The list.
 */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * How many required gates have not reported, said.
 *
 * @param count How many.
 * @param more Whether it follows gates that were named.
 * @returns `1 more required gate that has not reported`, or without the `more`.
 */
export function unreportedLine(count: number, more: boolean): string {
  const gates = count === 1 ? "required gate that has" : "required gates that have";

  return `${count} ${more ? "more " : ""}${gates} not reported`;
}

/**
 * The promise an arm makes, naming the gates it waits on.
 *
 * @param waiting {@link waitingOn}'s answer.
 * @returns `Merges automatically when Second-model review turns green.` — every gate named, and
 *   the ones that cannot be named counted. {@link EVERY_GATE} when there is nothing to name.
 */
export function armTerms(waiting: Waiting): string {
  const names = waiting.gates.map((gate) => gate.label);

  if (waiting.unreported > 0) {
    names.push(unreportedLine(waiting.unreported, waiting.gates.length > 0));
  }

  if (names.length === 0) return EVERY_GATE;

  // One subject — one gate, or one gate that has not reported — takes the singular.
  const verb = names.length === 1 && waiting.unreported <= 1 ? "turns" : "turn";

  return `Merges automatically when ${listed(names)} ${verb} green.`;
}

// --- the disarm reason ---------------------------------------------------------------------

/** Why a re-check refused, drawn. */
export interface RefusalView {
  /** `A gate went red`. */
  readonly headline: string;
  /** The service's sentence — `Physical HIL is red on revision 2.` */
  readonly message: string;
  /** What can be done about it. */
  readonly next: string;
}

/** Each refusal's headline, and what follows from it. */
const REFUSALS: Readonly<Record<PrMergeRefusalCode, readonly [string, string]>> = {
  dry_run_policy_active: [
    "Dry-run is on",
    "Nothing merges while the dry-run policy is active. An owner or admin can turn it off in " +
      "Settings → Policies, then arm again.",
  ],
  gate_red: ["A gate went red", "Fix it, or return the PR to the loop, then arm again."],
  head_moved: [
    "The head moved",
    "A new revision was recorded after arming. Review its gates, then arm again.",
  ],
  host_head_moved: [
    "The host has a commit that is not verified yet",
    "Arm again once the new commit has been recorded and its gates evaluated.",
  ],
  host_conflict: [
    "The host reports a conflict",
    "Resolve it on the host, or return the PR to the loop, then arm again.",
  ],
  host_not_open: [
    "The PR is no longer open on its host",
    "There is nothing to merge until it is open again.",
  ],
  host_refused: [
    "The host refused the merge",
    "Nothing was retried. Arm again once the host would accept the merge.",
  ],
  gates_pending: [
    "Not every required gate is satisfied",
    "Arm the merge instead, and it merges when they are.",
  ],
};

/**
 * A re-check's refusal, drawn.
 *
 * @param code The designed code.
 * @param message The service's sentence.
 * @returns The headline for the code, the sentence, and what to do next.
 */
export function refusalView(code: PrMergeRefusalCode, message: string): RefusalView {
  const [headline, next] = REFUSALS[code];

  return { headline, message, next };
}
