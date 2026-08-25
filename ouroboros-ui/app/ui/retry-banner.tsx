import { Button } from "./button";
import { cx } from "./class-names";

import "./ui.css";

/**
 * The one place a failed read is explained, and the one place it can be retried — the
 * banner DASH-I.7 ([#86](https://github.com/NobuData/ouroboros/issues/86)) established for
 * the dashboard, as the shape it is.
 *
 * Two screens draw it now — the dashboard's stale-data banner
 * (`app/dashboard/stale-banner.tsx`) and the routing page's failed read
 * (`app/models/routing-banner.tsx`, AA.6
 * [#205](https://github.com/NobuData/ouroboros/issues/205)) — which is the threshold this
 * directory sets for a primitive: a shape the design system names, used by more than one
 * screen, that decides nothing about the product. The *sentences* are the caller's; what is
 * decided here is the anatomy and the two rules beneath it.
 *
 * ### One headline, one reason, one control
 *
 * The rule DASH-I.7 wrote down: **a card says what could not be read, and the banner says
 * why, once, with the way out.** Before it, one refused aggregate printed the service's
 * sentence nine times over nine cards, which reads as nine problems and buries the single
 * retry that would fix them. So this takes exactly one headline (the state, in words), one
 * reason (the service's own sentence, rendered as-is) and one retry, and a page draws it
 * exactly once.
 *
 * ### The retry is never inert
 *
 * Every other control on a degraded page says why it cannot act. This one can always act:
 * the only control that can fix the page should never be the one thing on it that cannot be
 * pressed, and a reader whose retry is slow will reasonably press again. It reports its state
 * through its **label** rather than through `disabled` or a spinner beside it — a label that
 * changes is announced by the banner's own `status` role, with no second element to read
 * out. Guarding against a second press stacking a second transition is the caller's, because
 * the transition is.
 *
 * ### Announced as a status, not as an alert
 *
 * `role="status"` puts it in the polite queue. It is a fact about a page the reader is
 * already looking at, not an interruption; an `alert` would cut across whatever a screen
 * reader was saying to report that a *read* failed — precisely the wrong emphasis when the
 * page around it is still there.
 *
 * ### It takes a callback, so it is drawn by a Client Component
 *
 * `onRetry` is a function, and a function cannot cross the server–client boundary as a prop.
 * The two callers are Client Components that own the router and the transition; this owns
 * neither, which is what keeps `next/navigation` out of `app/ui` — a primitive that routed
 * would be a primitive that decided something.
 */

/** What the banner takes. */
export interface RetryBannerProps {
  /** The state, in words — *The dashboard could not be read.* Never a hue alone (§ 3.4). */
  readonly headline: string;
  /**
   * What the service said. Rendered as-is: every message in the contract's envelope is
   * written for a person and names nothing about the service's internals.
   */
  readonly reason: string;
  /** What the control does. The caller guards a second press while one is in flight. */
  readonly onRetry: () => void;
  /** Whether a retry is in flight — the label reports it, the control stays pressable. */
  readonly retrying?: boolean;
  /** The control's label. Defaults to {@link RETRY_LABEL}. */
  readonly retryLabel?: string;
  /** The label while a retry is in flight. Defaults to {@link RETRYING_LABEL}. */
  readonly retryingLabel?: string;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** What the control says. */
export const RETRY_LABEL = "Retry";

/**
 * What it says while a retry is in flight.
 *
 * The label changes rather than a spinner appearing beside it, so the control reports its own
 * state to a screen reader without a second element to announce — and the banner's `status`
 * role reads the change out politely, which is exactly the level of interruption a retry
 * deserves.
 */
export const RETRYING_LABEL = "Retrying…";

/**
 * The banner.
 *
 * @param props See {@link RetryBannerProps}.
 * @returns The status region: the headline, the reason, and the retry.
 */
export function RetryBanner({
  headline,
  reason,
  onRetry,
  retrying = false,
  retryLabel = RETRY_LABEL,
  retryingLabel = RETRYING_LABEL,
  className,
}: RetryBannerProps) {
  return (
    <div className={cx("ou-retry", className)} role="status">
      {/*
        The headline and the reason share a paragraph, so they wrap as one block beside the
        control rather than as two lines that can separate.
      */}
      <p className="ou-retry__text">
        <span className="ou-retry__headline">{headline}</span>{" "}
        <span className="ou-retry__reason">{reason}</span>
      </p>

      {/*
        Neither `disabled` nor `aria-disabled`, in flight or not — see the module note. The
        label is the state.
      */}
      <Button onClick={onRetry} size="sm" tone="ghost">
        {retrying ? retryingLabel : retryLabel}
      </Button>
    </div>
  );
}
