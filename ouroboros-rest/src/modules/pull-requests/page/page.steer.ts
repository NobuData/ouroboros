/**
 * *Return to loop*'s steer text — the selected red gates' evidence lines (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361), decision **V5**).
 *
 * ```
 * physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02
 * test_suite: 61/63 after attempt 3
 *
 * note: keep the PID loop on its own timer
 * ```
 *
 * The agent that wrote the code receives what the gates measured, not "please fix the PR". One
 * line per gate, `<gate_key>: <evidence>`, in the gates card's order — so the same selection is
 * always the same text, whatever order it was clicked in — and the person's optional note after a
 * blank line, prefixed so the agent can tell measurement from instruction.
 *
 * **Bounded to AP.4's steer limit.** A gate's evidence is at most 512 characters (V056) and a PR
 * has at most a handful of gates, but a custom gate set and a long note could still pass
 * `MAX_STEER_LENGTH`; the note is shortened first (with `…`), because the evidence is the point.
 */

import { MAX_STEER_LENGTH } from "../../controls/controls.dto";

/** One selected gate, as the snapshot holds it. */
export interface SteerGate {
  /** `pr_gate_definitions.gate_key`. */
  readonly key: string;
  /** Its evidence line on the revision — a red gate always has one. */
  readonly evidence: string | null;
}

/** What marks the person's note in the steer. */
export const NOTE_PREFIX = "note: ";

/**
 * Compose the steer.
 *
 * @param gates - The selected gates, already in the card's order.
 * @param note - The person's note, or undefined.
 * @param limit - The steer's maximum length; AP.4's by default.
 * @returns The text, at most `limit` characters.
 */
export function composeSteer(
  gates: readonly SteerGate[],
  note?: string,
  limit: number = MAX_STEER_LENGTH,
): string {
  const lines = gates.map((gate) => `${gate.key}: ${gate.evidence ?? "red (no evidence line)"}`);
  const evidence = lines.join("\n").slice(0, limit);
  const trimmed = note?.trim() ?? "";

  if (trimmed === "") {
    return evidence;
  }

  const room = limit - evidence.length - "\n\n".length - NOTE_PREFIX.length;

  if (room <= 1) {
    return evidence;
  }

  const body = trimmed.length <= room ? trimmed : `${trimmed.slice(0, room - 1)}…`;

  return `${evidence}\n\n${NOTE_PREFIX}${body}`;
}
