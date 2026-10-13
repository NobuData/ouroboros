"use client";

import { useRef, useState } from "react";

import type { ChatMirror, ChatMirrorEntry } from "@/app/api/chatops-mirror";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";

import { type MirrorPollOptions, createMirrorPoll, requestEarlierMirror } from "./mirror-poll";
import { EARLIER_FAILED, mergeMirror, mirrorEndpoint } from "./view";

/**
 * One channel's mirror, as the card draws it (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)): the latest page, kept current by
 * the poll, and whatever earlier pages the reader has asked for.
 *
 * ### What is read is added to, never swapped
 *
 * The poll answers with the latest page only, and that page slides forward as the channel is
 * written to. Drawing it as it arrives would take the earlier pages a reader loaded away from
 * under them every fifteen seconds, so each answer is **folded into** what is held
 * (`mergeMirror`): entries it carries replace their held selves — a question now resolved, a
 * command whose result has arrived — new ones are added, and nothing is dropped.
 *
 * The fold happens during render, guarded on the payload's identity — React's own shape for
 * state adjusted when an input changes, and the one `app/issues/use-keyed-poll.ts` uses.
 *
 * The caller mounts one of these per channel (a `key`), so nothing here outlives the channel
 * it was read for.
 */

/** What the hook hands back. */
export interface MirrorState {
  /** The latest page as last read — the channel and the app version — or null before any. */
  readonly page: ChatMirror | null;
  /** Every entry held, oldest first. */
  readonly entries: readonly ChatMirrorEntry[];
  /** Whether there is a page before the oldest entry held. */
  readonly hasEarlier: boolean;
  /** Whether an earlier page is on its way. */
  readonly loadingEarlier: boolean;
  /** Why the last earlier page could not be read, or null. */
  readonly earlierError: string | null;
  /** When the latest page was last read or confirmed, epoch milliseconds, or null. */
  readonly updatedAt: number | null;
  /** Why the last re-read failed, or null. */
  readonly error: string | null;
  /** Read the latest page now. */
  readonly refresh: () => void;
  /**
   * Read the page before the oldest entry held.
   *
   * @param beforeLanding Called once the page has arrived and just before it is drawn — the
   *   card's moment to note where its scroller stands.
   */
  readonly loadEarlier: (beforeLanding?: () => void) => void;
}

/** What is held between renders. */
interface Held {
  /** The payload last folded in, so each is folded in once. */
  readonly seen: ChatMirror | null;
  /** Every entry held. */
  readonly entries: readonly ChatMirrorEntry[];
  /** The cursor of the page before the oldest entry held; null at the start of history. */
  readonly cursor: string | null;
}

/** Nothing held. */
const NOTHING: Held = { seen: null, entries: [], cursor: null };

/**
 * A channel's mirror.
 *
 * @param channelId The channel.
 * @param options Test seams for the poll and the earlier read.
 * @returns See {@link MirrorState}.
 */
export function useMirror(channelId: string, options?: MirrorPollOptions): MirrorState {
  const { snapshot, refresh } = useKeyedPoll(mirrorEndpoint(channelId), () => createMirrorPoll(channelId, options));
  const [held, setHeld] = useState<Held>(NOTHING);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);

  /** The guard against a second press: two can arrive inside one render. */
  const loading = useRef(false);

  const latest = snapshot.data;

  if (latest !== null && latest !== held.seen) {
    setHeld({
      seen: latest,
      entries: mergeMirror(held.entries, latest.entries),
      // The first page names where history continues; after that only an earlier page moves it.
      cursor: held.seen === null ? latest.olderCursor : held.cursor,
    });
  }

  return {
    page: latest ?? held.seen,
    entries: held.entries,
    hasEarlier: held.cursor !== null,
    loadingEarlier,
    earlierError,
    updatedAt: snapshot.updatedAt,
    error: snapshot.error,
    refresh,

    loadEarlier(beforeLanding) {
      const before = held.cursor;
      if (before === null || loading.current) return;

      loading.current = true;
      setLoadingEarlier(true);
      setEarlierError(null);

      (options?.earlier ?? requestEarlierMirror)(channelId, before)
        .catch(() => null)
        .then((answer) => {
          loading.current = false;
          setLoadingEarlier(false);

          if (answer === null || answer.state !== "fresh") {
            setEarlierError(answer !== null && answer.state === "failed" ? answer.reason : EARLIER_FAILED);
            return;
          }

          beforeLanding?.();
          setHeld((now) => ({
            ...now,
            entries: mergeMirror(answer.payload.entries, now.entries),
            cursor: answer.payload.olderCursor,
          }));
        });
    },
  };
}
