/**
 * The gap severity rule — how a capability row's `HIGH`, `MED`, `LOW`, `WIP` or `LEAD` is
 * derived from its cells (CM.2, [#621](https://github.com/NobuData/ouroboros/issues/621);
 * decision V7).
 *
 * A severity is the matrix's conclusion, so it is computed here, by one rule, and stored with
 * the inputs that produced it (`matrix_rows.severity_derivation`) — never taken as written.
 *
 * **Standing.** `none` 0 · `partial` 1 · `shipping` 2. A `beta` is a `partial`, and so is a
 * rival's `wip` — something half there. A rival whose cell is `unknown` is left out: *we did not
 * find out* is not *they have none*.
 *
 * **The rule, in order:**
 *
 *   1. our cell is `wip` (in flight)                      → `wip`
 *   2. our cell is `unknown`, or no rival's is known      → `low`   nothing can be measured
 *   3. distance = best known rival's standing − ours
 *        below 0   we are ahead of every known rival      → `lead`
 *        0         level with the best rival              → `low`
 *        1         one step behind                        → `med`, or `high` when proposed
 *        2         the best rival ships it, we have none  → `high`
 *
 * **The proposed gap is an input, not the answer.** The investigation proposes a severity per
 * row, and two rows with the same cells can deserve different ones — *docking in gusts* and
 * *abort & retry* are both one step behind Skylink, but half our gusty dockings fail. So one step
 * behind is a band, `med`–`high`, and the proposal picks within it. Everywhere else the cells
 * decide, and a proposal outside what they support is **clamped** and recorded as such: a
 * proposed `high` on a row where we lead is stored as `lead`, with the derivation saying so.
 */

import type { MatrixCellStatus, MatrixGapSeverity } from "../../db/schema";

/** A rival's cell, as the rule needs it. */
export interface RivalStanding {
  readonly name: string;
  readonly status: MatrixCellStatus;
}

/** What the rule is given for one row. */
export interface SeverityInputs {
  /** Our column's label — `Helios`. */
  readonly usLabel: string;
  /** Our cell's status. */
  readonly ours: MatrixCellStatus;
  /** Every rival column's cell. */
  readonly rivals: readonly RivalStanding[];
  /** The severity the investigation proposed for the row; null when it proposed none. */
  readonly proposed: MatrixGapSeverity | null;
}

/** What the rule concluded, and from what. */
export interface SeverityDerivation {
  readonly severity: MatrixGapSeverity;
  /** The best standing among rivals whose cell is known; null when none is. */
  readonly bestRival: MatrixCellStatus | null;
  /** Best known rival's standing minus ours; null when it cannot be measured. */
  readonly distance: number | null;
  /** Whether the proposal named a severity the cells do not support. */
  readonly clamped: boolean;
  /** The sentence stored in `matrix_rows.severity_derivation`. */
  readonly derivation: string;
}

/** The most characters a stored derivation may have — V112's check. */
export const MAX_DERIVATION_LENGTH = 1000;

/** How many characters of rival names a derivation spells out before it elides. */
const MAX_NAMES_LENGTH = 300;

const STANDING: Readonly<Record<MatrixCellStatus, number | null>> = {
  none: 0,
  partial: 1,
  wip: 1,
  shipping: 2,
  unknown: null,
};

/**
 * Derive a row's gap severity.
 *
 * @param inputs - Our cell, the rivals' cells and the proposed severity.
 * @returns The severity, the measurements behind it and the derivation to store.
 */
export function deriveSeverity(inputs: SeverityInputs): SeverityDerivation {
  const known = inputs.rivals.flatMap((rival) => {
    const standing = STANDING[rival.status];
    return standing === null ? [] : [{ ...rival, standing }];
  });
  const best = known.reduce<(typeof known)[number] | null>(
    (top, rival) => (top === null || rival.standing > top.standing ? rival : top),
    null,
  );
  const ours = STANDING[inputs.ours];
  const distance = best === null || ours === null ? null : best.standing - ours;

  const [severity, reason] = conclude(inputs, distance);
  const clamped = inputs.proposed !== null && inputs.proposed !== severity;

  return {
    severity,
    bestRival: best?.status ?? null,
    distance,
    clamped,
    derivation: describe(inputs, best?.status ?? null, severity, reason, clamped),
  };
}

/**
 * Apply the rule.
 *
 * @param inputs - The row's inputs.
 * @param distance - Best known rival's standing minus ours, or null.
 * @returns The severity and the clause of the rule that produced it.
 */
function conclude(inputs: SeverityInputs, distance: number | null): [MatrixGapSeverity, string] {
  if (inputs.ours === "wip") return ["wip", "ours is in flight"];
  if (inputs.ours === "unknown") return ["low", "our own status is unknown, so no gap is measured"];
  if (distance === null) return ["low", "no rival's status is known, so no gap is measured"];
  if (distance < 0) return ["lead", "we are ahead of every known rival"];
  if (distance === 0) return ["low", "level with the best rival"];
  if (distance >= 2) return ["high", "two steps behind the best rival"];

  return inputs.proposed === "high"
    ? ["high", "one step behind the best rival, proposed high"]
    : ["med", "one step behind the best rival"];
}

/**
 * Write the derivation that is stored beside the severity.
 *
 * @param inputs - The row's inputs.
 * @param best - The best known rival standing.
 * @param severity - What the rule concluded.
 * @param reason - The clause that produced it.
 * @param clamped - Whether the proposal was overruled.
 * @returns One line naming every input and the conclusion, at most
 *   {@link MAX_DERIVATION_LENGTH} characters.
 */
function describe(
  inputs: SeverityInputs,
  best: MatrixCellStatus | null,
  severity: MatrixGapSeverity,
  reason: string,
  clamped: boolean,
): string {
  const leaders =
    best === null
      ? ""
      : ` (${elide(
          inputs.rivals
            .filter((rival) => rival.status === best)
            .map((rival) => rival.name)
            .join(", "),
        )})`;
  const counts = (["shipping", "partial", "wip", "none", "unknown"] as const)
    .map((status) => [status, inputs.rivals.filter((rival) => rival.status === status).length])
    .filter(([, count]) => (count as number) > 0)
    .map(([status, count]) => `${String(count)} ${String(status)}`)
    .join(", ");
  const proposed =
    inputs.proposed === null
      ? "none"
      : clamped
        ? `${inputs.proposed} (clamped — the cells do not support it)`
        : inputs.proposed;

  return [
    `${elide(inputs.usLabel)}: ${inputs.ours}`,
    `best rival: ${best ?? "unknown"}${leaders}`,
    `rivals: ${counts === "" ? "none" : counts}`,
    `proposed: ${proposed}`,
    `${reason} → ${severity}`,
  ]
    .join(" · ")
    .slice(0, MAX_DERIVATION_LENGTH);
}

/**
 * @param names - Text that may be long.
 * @returns It, cut to {@link MAX_NAMES_LENGTH} characters with an ellipsis when it was longer.
 */
function elide(names: string): string {
  return names.length <= MAX_NAMES_LENGTH ? names : `${names.slice(0, MAX_NAMES_LENGTH - 1)}…`;
}
