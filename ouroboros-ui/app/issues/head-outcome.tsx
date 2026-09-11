import type { HeadOutcome } from "./view";

/**
 * What a head action's last press came back as, drawn under the button it is about
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)).
 *
 * Both of the head's actions report the same way, so they report through one component: a press
 * that took is a `status` — announced politely, in the muted ink — and a refusal is an `alert` in
 * the error hue, carrying the sentence `app/issues/head-actions.ts` answered with. Nothing is drawn
 * before the first press, because there is nothing yet to report. The table's freshness tag and
 * the selection bar ([#118](https://github.com/NobuData/ouroboros/issues/118)) report through it
 * too — the bar for a refusal that named no issue, since one that did opens a dialog instead.
 *
 * @param props.outcome The last press's outcome, or `null` before there has been one.
 * @returns The line, or nothing.
 */
export function HeadOutcomeLine({ outcome }: Readonly<{ outcome: HeadOutcome | null }>) {
  if (outcome === null) return null;

  return outcome.ok ? (
    <p className="issues__outcome" role="status">
      {outcome.message}
    </p>
  ) : (
    <p className="issues__outcome issues__outcome--err" role="alert">
      {outcome.reason}
    </p>
  );
}
