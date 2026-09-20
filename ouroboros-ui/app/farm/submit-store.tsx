"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFarm } from "./farm-store";
import type { SubmittedJob } from "./submit";

/**
 * The submit-build dialog's two doors, and the toast it leaves behind (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * The issue places **Submit build** *head-adjacent, and from a pool row* — two controls in two
 * regions, one dialog. `app/farm/pool-store.tsx` is the same arrangement for the pool sheet and
 * this follows it: the state is provided once, at the screen, and each door calls
 * {@link SubmitView.open}.
 *
 * The toast is held here as well, rather than inside the dialog, because **it outlives the
 * dialog**: the dialog unmounts the moment a submission takes, and the toast is what says so.
 *
 * ### A submission asks for a fresh page
 *
 * {@link SubmitView.recordSubmitted} calls the farm store's `refresh()`, so the next page to land
 * is one read after the write — which is the page `app/farm/queue-moves.ts` marks the moved
 * `q:N` chips on.
 */

/** A request to open the dialog. */
export interface SubmitRequest {
  /** The pool whose row asked, or `null` from the head. */
  readonly pool: string | null;
  /** Which press this is — the dialog's form is keyed by it, so each opening starts fresh. */
  readonly seq: number;
}

/** What the doors, the dialog and the toast read. */
export interface SubmitView {
  /** The open dialog's request, or `null` when it is closed. */
  readonly request: SubmitRequest | null;
  /** Open the dialog — on a pool's row, preselecting it. */
  readonly open: (pool?: string) => void;
  /** Close the dialog without submitting. */
  readonly close: () => void;
  /** The build the toast is about, or `null` when there is no toast. */
  readonly submitted: SubmittedJob | null;
  /** A submission took: close the dialog, raise the toast, and ask for a fresh page. */
  readonly recordSubmitted: (job: SubmittedJob) => void;
  /** Dismiss the toast. */
  readonly dismiss: () => void;
}

/** What is read outside a provider: nothing is open, and asking does nothing. */
const NO_SUBMIT: SubmitView = Object.freeze({
  request: null,
  open: () => {},
  close: () => {},
  submitted: null,
  recordSubmitted: () => {},
  dismiss: () => {},
});

/** Defaulted rather than left `undefined`, so a region rendered alone reads *closed*. */
const SubmitContext = createContext<SubmitView>(NO_SUBMIT);

/**
 * Put the dialog's doors and its toast within reach of everything below.
 *
 * Must sit under `FarmProvider`: a submission refreshes the farm's page.
 *
 * @param props.children The regions that read it.
 * @returns The regions, wrapped.
 */
export function SubmitProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { refresh } = useFarm();
  const [request, setRequest] = useState<SubmitRequest | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedJob | null>(null);

  const presses = useRef(0);

  const open = useCallback((pool?: string) => {
    presses.current += 1;
    setRequest({ pool: pool ?? null, seq: presses.current });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const dismiss = useCallback(() => setSubmitted(null), []);

  const recordSubmitted = useCallback(
    (job: SubmittedJob) => {
      setRequest(null);
      setSubmitted(job);
      refresh();
    },
    [refresh],
  );

  const view = useMemo<SubmitView>(
    () => ({ request, open, close, submitted, recordSubmitted, dismiss }),
    [request, open, close, submitted, recordSubmitted, dismiss],
  );

  return <SubmitContext.Provider value={view}>{children}</SubmitContext.Provider>;
}

/**
 * The submit dialog's doors, and its toast.
 *
 * @returns See {@link SubmitView}.
 */
export function useSubmit(): SubmitView {
  return useContext(SubmitContext);
}
