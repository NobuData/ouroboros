"use client";

import { useSecondsNow } from "@/app/shell/clock";

import { SYNCING, SYNC_TITLE, syncedLabel } from "./table";

/**
 * The card head's freshness tag — mockup 03's `synced 40s ago`, ticking, and pressable
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * ### The instant is the service's; the age is the reader's clock
 *
 * `meta.syncedAt` is M.4's stored stamp — the *oldest* successful poll among the enabled
 * repositories, and `null` while any has never been polled — so what the tag can honestly say
 * is how long ago that was. The subtraction runs against `app/shell/clock.ts`'s one interval,
 * the way the dashboard's *Elapsed* column does, so the tag moves once a second between polls
 * and a poll that brings the same stamp recomputes the same figure: there is nothing for a
 * poll to jump back to. The server's own reading of the clock is the first paint, so the
 * hydration pass matches it by construction.
 *
 * ### It is a control, drawn as a tag
 *
 * The ticket asks that the tag be *clickable to trigger M.4's re-sync*, so it is the design
 * system's tag on a `<button>` — the shape the filter bar's chips take — and it is inert with
 * a reason for a `viewer`, whose press the service would refuse, rather than dropped: the
 * freshness is every member's to read. While a press is in flight it reads *syncing…* and
 * refuses a second press, for the reason every write here does.
 *
 * @param props.syncedAt The listing's `meta.syncedAt`, or `null`.
 * @param props.readAtSeconds The server's reading of the clock when the page was read, in
 *   whole seconds — what the first paint measures the age against.
 * @param props.pending Whether a press is in flight.
 * @param props.reason Why the tag cannot be pressed, or `undefined` when it can.
 * @param props.onPress What a press does.
 * @returns The tag.
 */
export function FreshnessTag({
  syncedAt,
  readAtSeconds,
  pending,
  reason,
  onPress,
}: Readonly<{
  syncedAt: string | null;
  readAtSeconds: number;
  pending: boolean;
  reason: string | undefined;
  onPress: () => void;
}>) {
  const now = useSecondsNow(readAtSeconds);
  const inert = reason !== undefined;

  return (
    <button
      aria-busy={pending || undefined}
      aria-disabled={inert || undefined}
      className="ou-tag issues-table__sync"
      onClick={inert || pending ? undefined : onPress}
      title={reason ?? SYNC_TITLE}
      type="button"
    >
      {pending ? SYNCING : syncedLabel(syncedAt, now)}
    </button>
  );
}
