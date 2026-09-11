"use client";

import { useSecondsNow } from "@/app/shell/clock";
import { RetryBanner } from "@/app/ui";

import {
  CHECKING_LABEL,
  CHECK_AGAIN_LABEL,
  SYNC_UNREAD_HEADLINE,
  type SyncBannerState,
  resumesIn,
} from "./states";

/**
 * What sits over the backlog's rows when the sync is not simply running — the DASH-I.7
 * banner ([#86](https://github.com/NobuData/ouroboros/issues/86)), for the intake screen
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * ### Three things it can say, and one it never does
 *
 * - **Paused**, with the kind of pause as the headline and the service's own sentence under
 *   it — *"Sync paused — GitHub's rate limit is reached. GitHub's rate limit for this
 *   workspace's token is spent. Syncing resumes when it resets. Resumes in about 20
 *   minutes."* The reason is M.4's, read from the same guard the GitHub client enforces, so
 *   the banner and a refused press cannot disagree; the wait counts down against the
 *   reader's clock, the way the freshness tag's age does.
 * - **Unread**: the status itself could not be read, so the rows are the rows and this says
 *   why nothing can be said about their freshness.
 * - **First sync running**, over rows already mirrored — progress rather than a problem, so
 *   it is a status line and not the warn-tinted box.
 *
 * What it never says is *something went wrong*: every headline names its reason in words.
 *
 * ### The control asks the poll now
 *
 * DASH-I.7's box has one control, and here it is **Check again** — the table's poll asked
 * now rather than on its interval, which is the honest way out of every one of the pauses:
 * a rate limit ends by itself, a token is connected elsewhere, GitHub comes back. The banner
 * clears on the next answer that says so, since the status rides the same poll the rows do.
 * The control is never inert, for the primitive's reason; a second press while one is in
 * flight is guarded by the caller, which owns the poll.
 *
 * @param props.state What to say — {@link SyncBannerState}, decided by `app/issues/states.ts`.
 * @param props.readAtSeconds When the status was read, in whole seconds — what a wait counts
 *   down from.
 * @param props.checking Whether an ask is in flight — the control's label reports it.
 * @param props.onCheck What **Check again** does.
 * @returns The banner, or nothing.
 */
export function SyncBanner({
  state,
  readAtSeconds,
  checking,
  onCheck,
}: Readonly<{
  state: SyncBannerState;
  readAtSeconds: number;
  checking: boolean;
  onCheck: () => void;
}>) {
  const now = useSecondsNow(readAtSeconds);

  if (state.kind === "none") return null;

  if (state.kind === "first-sync") {
    return (
      <p className="issues-sync__progress" role="status">
        {state.message}
      </p>
    );
  }

  const reason =
    state.kind === "paused" && state.retryAfterSeconds !== null
      ? `${state.reason} ${resumesIn(state.retryAfterSeconds - (now - readAtSeconds))}`
      : state.reason;

  return (
    <RetryBanner
      className="issues-sync"
      headline={state.kind === "paused" ? state.headline : SYNC_UNREAD_HEADLINE}
      onRetry={onCheck}
      reason={reason}
      retryLabel={CHECK_AGAIN_LABEL}
      retrying={checking}
      retryingLabel={CHECKING_LABEL}
    />
  );
}
