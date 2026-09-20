"use client";

import { useCallback, useRef, useState } from "react";

import { useFarm } from "./farm-store";
import { type LifecycleAction, type LifecycleOutcome, lifecycleDone } from "./lifecycle";
import { drainRunner, removeRunner, undrainRunner } from "./lifecycle-actions";

/**
 * The state behind a runner's lifecycle writes (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) — what is being asked, what is in
 * flight, and what was refused.
 *
 * ### Which writes ask first
 *
 * The issue's menu is exact about it: **Drain** is *confirm → status flips*, **Remove** is a
 * confirmation that *names the consequences*, and **Undrain** simply *returns the runner to
 * service*. So drain and remove open at {@link LifecyclePhase} `confirm`, and an undrain goes
 * straight to `working` with no dialog — it is the safe direction, and asking *are you sure you
 * want this machine working again?* is a question nobody needs. A refused undrain still has
 * somewhere to say so: `failed` opens the dialog for all three.
 *
 * ### A write is followed by a fresh page
 *
 * A success calls the farm store's `refresh()` — the next page to land is one read after the
 * write — and nothing is drawn optimistically: the pill is the agent's own heartbeat, and the
 * row's `drain requested` note (`runners.ts`) is what the fresh page says in the meantime.
 */

/** Where a lifecycle write stands. */
export type LifecyclePhase =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirm";
      readonly runnerId: string;
      readonly action: LifecycleAction;
    }
  | {
      readonly kind: "working";
      readonly runnerId: string;
      readonly action: LifecycleAction;
    }
  | {
      readonly kind: "failed";
      readonly runnerId: string;
      readonly action: LifecycleAction;
      readonly reason: string;
    };

/** Nothing is being asked. Identity-stable. */
const CLOSED: LifecyclePhase = { kind: "closed" };

/** The server action behind each write. */
const WRITES: Readonly<Record<LifecycleAction, (id: string) => Promise<LifecycleOutcome>>> = {
  drain: drainRunner,
  undrain: undrainRunner,
  remove: removeRunner,
};

/** What the card reads. */
export interface Lifecycle {
  /** Where the write stands. */
  readonly phase: LifecyclePhase;
  /** What the last successful write is announced as, or `""` before there has been one. */
  readonly said: string;
  /**
   * The runner a removal just took, until the page that no longer carries it has landed — so
   * the card can catch the focus its row takes with it.
   */
  readonly removedId: string | null;
  /** Ask for a write: a confirmation for drain and remove, the write itself for undrain. */
  readonly ask: (action: LifecycleAction, runnerId: string, name: string) => void;
  /** Confirm the write that is being asked. */
  readonly confirm: (name: string) => void;
  /** Close the dialog. Does nothing while a write is in flight. */
  readonly close: () => void;
  /** The card has dealt with {@link Lifecycle.removedId}. */
  readonly forgetRemoved: () => void;
}

/**
 * The lifecycle writes, for the runners card.
 *
 * @returns See {@link Lifecycle}.
 */
export function useLifecycle(): Lifecycle {
  const { refresh } = useFarm();
  const [phase, setPhase] = useState<LifecyclePhase>(CLOSED);
  const [said, setSaid] = useState("");
  const [removedId, setRemovedId] = useState<string | null>(null);
  // The guard against a second press, held beside the state rather than read from it: two
  // presses inside one frame both see the phase the first has not committed yet.
  const inFlight = useRef(false);

  const run = useCallback(
    (action: LifecycleAction, runnerId: string, name: string) => {
      if (inFlight.current) return;

      inFlight.current = true;
      setPhase({ kind: "working", runnerId, action });

      void WRITES[action](runnerId)
        .then((outcome) => {
          if (!outcome.ok) {
            setPhase({
              kind: "failed",
              runnerId,
              action,
              reason: outcome.reason,
            });
            return;
          }

          setPhase(CLOSED);
          setSaid(lifecycleDone(action, name, outcome.pushed));
          if (action === "remove") setRemovedId(runnerId);
          refresh();
        })
        .finally(() => {
          inFlight.current = false;
        });
    },
    [refresh],
  );

  const ask = useCallback(
    (action: LifecycleAction, runnerId: string, name: string) => {
      if (inFlight.current) return;
      if (action === "undrain") return run(action, runnerId, name);

      setPhase({ kind: "confirm", runnerId, action });
    },
    [run],
  );

  const confirm = useCallback(
    (name: string) => {
      if (phase.kind === "confirm") run(phase.action, phase.runnerId, name);
    },
    [phase, run],
  );

  const close = useCallback(() => {
    if (!inFlight.current) setPhase(CLOSED);
  }, []);

  const forgetRemoved = useCallback(() => setRemovedId(null), []);

  return { phase, said, removedId, ask, confirm, close, forgetRemoved };
}
