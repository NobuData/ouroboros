/**
 * The merge executor's re-check — the one rule every merge passes through, and the designed
 * reasons a failed one records.
 *
 * AX.4 ([#360](https://github.com/NobuData/ouroboros/issues/360)), decision **V3**. Someone arms a
 * PR at 14:35 while five of seven gates are green; twenty minutes later the last gate turns green
 * and the executor wakes. In that gap a commit may have landed, a green gate may have gone red, the
 * host may have developed a conflict. So before it merges, the executor asks all of it again —
 * inside the transaction that holds the PR row (see `merge.repository.ts`) — and this function is
 * the question:
 *
 * ```
 * armed against the latest revision?          no  → head_moved        (disarm)
 * any required gate red on it?                yes → gate_red          (disarm)
 * every required gate satisfied?              no  → gates_pending     (wait — nothing changes)
 * host still reports it open?                 no  → host_not_open     (disarm)
 * host's head the latest revision's head?     no  → host_head_moved   (disarm)
 * host reports a conflict?                    yes → host_conflict     (disarm)
 *                                             otherwise → merge
 * ```
 *
 * **Pending is not a failure.** An armed plan whose gates are still running is exactly the promise
 * the person made — *merge when all gates go green* — so `gates_pending` leaves the arm in place.
 * Every other failure is a promise that no longer applies to the situation, and disarms with a
 * reason the card can show; arming again is a fresh look.
 *
 * **`mergeable: null` passes.** GitHub computes mergeability in the background and answers null
 * until it has; the merge request itself is refused if there is a conflict, and that refusal
 * disarms as `host_refused`. Refusing on null would disarm a clean PR for asking too soon.
 *
 * A merge is never attempted on anything but a passing re-check — the executor's only path to the
 * SPI's `mergePR` runs through {@link recheck} returning `ok`.
 *
 * Pure.
 */

import type { HostPrState } from "../../ticket-sources/ticket-source.pr";
import { sameCommit } from "../gates/gate.providers";

/** Why a re-check refused a merge — the machine-readable half of `disarm_reason`. */
export type MergeRefusalCode =
  | "head_moved"
  | "gate_red"
  | "gates_pending"
  | "host_not_open"
  | "host_head_moved"
  | "host_conflict"
  | "host_refused";

/** Every code, in the order the re-check asks. */
export const MERGE_REFUSAL_CODES = [
  "head_moved",
  "gate_red",
  "gates_pending",
  "host_not_open",
  "host_head_moved",
  "host_conflict",
  "host_refused",
] as const satisfies readonly MergeRefusalCode[];

/** The refusals that leave an armed plan armed — the promise still applies. */
const WAITS: ReadonlySet<MergeRefusalCode> = new Set(["gates_pending"]);

/** The latest revision, as the re-check reads it. */
export interface RecheckRevision {
  /** `pr_revisions.id`. */
  readonly id: string;
  /** Revision 1, 2. */
  readonly seq: number;
  /** Its head. */
  readonly headSha: string;
}

/** The revision's gates, as the re-check reads them. */
export interface RecheckGates {
  /** `pr_gate_aggregate(revision).merge_ready`. */
  readonly mergeReady: boolean;
  /** The labels of the required gates that are red, in card order. */
  readonly red: readonly string[];
  /** How many required gates are satisfied. */
  readonly satisfied: number;
  /** How many are required. */
  readonly required: number;
}

/** The PR as its host reports it now. */
export interface RecheckHost {
  /** Open, closed or merged. */
  readonly state: HostPrState;
  /** Its head. */
  readonly headSha: string;
  /** Whether it merges cleanly — null while the host does not know. */
  readonly mergeable: boolean | null;
}

/** What the verification half of the re-check reads — the database's side. */
export interface VerificationInput {
  /** The revision the plan was armed against, or null for a direct merge of a plan never armed. */
  readonly armedRevisionId: string | null;
  /** The PR's latest revision, or null when it has none. */
  readonly latest: RecheckRevision | null;
  /** The latest revision's gates. */
  readonly gates: RecheckGates;
}

/** Everything the re-check reads. */
export interface RecheckInput extends VerificationInput {
  /** What the host says now. */
  readonly host: RecheckHost;
}

/** A refusal: the code, a sentence for the card, and whether it disarms. */
export interface MergeRefusal {
  readonly ok: false;
  readonly code: MergeRefusalCode;
  /** One sentence, fit for the merge card. */
  readonly message: string;
  /** Whether an armed plan is disarmed — false only for {@link WAITS}. */
  readonly disarms: boolean;
}

/** What the re-check decided. */
export type RecheckVerdict = { readonly ok: true } | MergeRefusal;

/**
 * A refusal.
 *
 * @param code - Why.
 * @param message - The card's sentence.
 * @returns The verdict.
 */
export function refusal(code: MergeRefusalCode, message: string): MergeRefusal {
  return { ok: false, code, message, disarms: !WAITS.has(code) };
}

/**
 * Re-check a merge — see this file's header for the order and why. The two halves composed:
 * {@link recheckVerification}, then {@link recheckHost}.
 *
 * @param input - The arm, the latest revision, its gates and the host's answer.
 * @returns `ok`, or the first refusal.
 */
export function recheck(input: RecheckInput): RecheckVerdict {
  const verified = recheckVerification(input);

  return verified.ok && input.latest !== null ? recheckHost(input.latest, input.host) : verified;
}

/**
 * The database's half of the re-check — the arm's revision and the gates. The executor asks it
 * before calling the host, so an armed plan whose gates are only pending costs no host request.
 *
 * @param input - The arm, the latest revision and its gates.
 * @returns `ok`, or the first refusal.
 */
export function recheckVerification(input: VerificationInput): RecheckVerdict {
  const { latest, gates } = input;

  if (latest === null) {
    return refusal("head_moved", "The PR has no recorded revision to merge.");
  }

  if (input.armedRevisionId !== null && input.armedRevisionId !== latest.id) {
    return refusal(
      "head_moved",
      `A new commit landed after arming — revision ${String(latest.seq)} (${short(latest.headSha)}) ` +
        "is not the revision that was armed.",
    );
  }

  if (gates.red.length > 0) {
    return refusal(
      "gate_red",
      `${gates.red.join(", ")} ${gates.red.length === 1 ? "is" : "are"} red on revision ` +
        `${String(latest.seq)}.`,
    );
  }

  if (!gates.mergeReady) {
    return refusal(
      "gates_pending",
      `${String(gates.satisfied)} of ${String(gates.required)} required gates are satisfied on ` +
        `revision ${String(latest.seq)}.`,
    );
  }

  return { ok: true };
}

/**
 * The host's half of the re-check — open, at the verified head, without a conflict.
 *
 * @param latest - The latest revision, which the verification half passed.
 * @param host - What the host says now.
 * @returns `ok`, or the first refusal.
 */
export function recheckHost(latest: RecheckRevision, host: RecheckHost): RecheckVerdict {
  if (host.state !== "open") {
    return refusal("host_not_open", `The host reports the PR ${host.state}.`);
  }

  if (!sameCommit(host.headSha, latest.headSha)) {
    return refusal(
      "host_head_moved",
      `The host's head is ${short(host.headSha)}, not revision ${String(latest.seq)}'s ` +
        `${short(latest.headSha)} — a commit landed that has not been verified.`,
    );
  }

  if (host.mergeable === false) {
    return refusal("host_conflict", "The host reports a merge conflict with the base branch.");
  }

  return { ok: true };
}

/** The longest `disarm_reason` V058 stores. */
export const MAX_DISARM_REASON = 1024;

/**
 * A refusal as `pr_merge_plans.disarm_reason` stores it — `<code>: <sentence>`.
 *
 * @param refused - The refusal.
 * @returns The column's text, bounded to {@link MAX_DISARM_REASON}.
 */
export function formatDisarmReason(refused: Pick<MergeRefusal, "code" | "message">): string {
  return `${refused.code}: ${refused.message}`.slice(0, MAX_DISARM_REASON);
}

/**
 * A stored `disarm_reason` read back.
 *
 * @param stored - The column, or null.
 * @returns The code and sentence, or null — a reason whose code this build does not know reads as
 *   `host_refused` with the whole text, rather than being hidden.
 */
export function parseDisarmReason(
  stored: string | null,
): { code: MergeRefusalCode; message: string } | null {
  if (stored === null) {
    return null;
  }

  const at = stored.indexOf(": ");
  const code = at < 0 ? "" : stored.slice(0, at);

  return (MERGE_REFUSAL_CODES as readonly string[]).includes(code)
    ? { code: code as MergeRefusalCode, message: stored.slice(at + 2) }
    : { code: "host_refused", message: stored };
}

/**
 * @param sha - A sha.
 * @returns Its first seven characters.
 */
function short(sha: string): string {
  return sha.slice(0, 7);
}
