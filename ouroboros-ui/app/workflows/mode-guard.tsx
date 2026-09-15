"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type MouseEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import {
  type BufferSurface,
  SWITCH_PROMPT_TITLE,
  type SwitchPrompt,
  type UnsavedBuffer,
  isPlainClick,
  switchPrompt,
} from "./mode-switch";
import type { StudioSurface } from "./view";

import "./workflows.css";

/**
 * The guard on the studio's segmented control (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)): what stops a switch between
 * **Visual** and **Code** from silently discarding code that has not parsed.
 *
 * Decision **C3** makes a switch loss-free by construction — both editors read the one draft,
 * so each page simply reads it again — and decision **C4** names the one exception: a buffer
 * that has not parsed never reached the draft. `mode-switch.ts` decides when that exception
 * applies and what to ask; this module is the three pieces that act on it.
 *
 * - {@link StudioModeGuard} is mounted by the workflow's layout
 *   (`app/(app)/workflows/[slug]/layout.tsx`), which both editors' routes share, and owns the
 *   prompt. Confirming it calls the held buffer's `discard`, so *discards it* is what happens.
 * - {@link useUnsavedBuffer} is how an editor says it holds a buffer. The code editor's save
 *   loop calls it (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172)); the hold is
 *   released when the editor says so or unmounts, so a buffer cannot outlive its page.
 * - {@link ModeLink} is a segment of the control: an ordinary client-side link unless pressing
 *   it would discard a held buffer, in which case it asks first.
 *
 * **Outside a guard, nothing is guarded.** The section's landing (`/workflows`) is not under
 * the workflow's layout, and nothing on it can hold a buffer, so a `ModeLink` there is a plain
 * link. The same is true in a suite that renders a screen on its own.
 */

/** Where the one held buffer is kept. A holder rather than React state, because nothing renders from it. */
export interface BufferHolder {
  /** The buffer held now, or `null`. */
  get(): UnsavedBuffer | null;
  /** Hold a buffer, or release it with `null`. */
  set(buffer: UnsavedBuffer | null): void;
}

/**
 * Make an empty holder.
 *
 * Nothing re-renders when it changes, deliberately: the only reader is a click handler, which
 * reads it at the moment of the press, and a page that re-rendered its tab row on every
 * refused parse would be re-rendering for nothing it draws.
 *
 * @returns A holder with nothing in it.
 */
export function createBufferHolder(): BufferHolder {
  let held: UnsavedBuffer | null = null;

  return {
    get: () => held,
    set: (buffer) => {
      held = buffer;
    },
  };
}

/** A switch waiting for an answer: where it goes, and what was asked. */
interface PendingSwitch {
  readonly href: string;
  readonly prompt: SwitchPrompt;
}

/** What the guard offers the pieces beneath it. */
interface Guard {
  /** The held buffer. */
  readonly holder: BufferHolder;
  /** Put a switch in front of the reader. */
  readonly ask: (pending: PendingSwitch) => void;
}

/** The guard in force, or `null` outside one. */
const GuardContext = createContext<Guard | null>(null);

/**
 * The guard, and the prompt it draws.
 *
 * @param props.children The workflow's page — the visual editor or the code view.
 * @returns The page, with the prompt beside it while a switch is waiting for an answer.
 */
export function StudioModeGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [holder] = useState(createBufferHolder);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const guard = useMemo<Guard>(() => ({ holder, ask: setPending }), [holder]);

  /** Stay: the buffer is kept exactly as it was, and so is the page. */
  function stay(): void {
    setPending(null);
  }

  /** Discard the buffer — the editor drops it, when it keeps one — then take the switch the reader asked for. */
  function discard(): void {
    if (pending === null) return;

    holder.get()?.discard?.();
    holder.set(null);
    setPending(null);
    router.push(pending.href);
  }

  return (
    <GuardContext.Provider value={guard}>
      {children}

      <ShellOverlay label={pending?.prompt.title ?? SWITCH_PROMPT_TITLE} onClose={stay} open={pending !== null}>
        {pending !== null && (
          <>
            <h2 className="shell-overlay__title">{pending.prompt.title}</h2>
            <p className="shell-overlay__note">{pending.prompt.body}</p>

            <div className="studio-switch__actions">
              <Button onClick={discard} tone="danger" type="button">
                {pending.prompt.confirm}
              </Button>
              <Button onClick={stay} tone="ghost" type="button">
                {pending.prompt.cancel}
              </Button>
            </div>
          </>
        )}
      </ShellOverlay>
    </GuardContext.Provider>
  );
}

/**
 * Tell the guard whether this editor holds a buffer that has not reached the draft.
 *
 * Call it on every render with what is true now; the hold follows. It is released when the
 * argument becomes `null` and when the calling component unmounts — so a buffer abandoned by a
 * browser Back, which no link sees, is released by the unmount rather than left to prompt on a
 * later switch that has nothing to lose.
 *
 * Outside a {@link StudioModeGuard} it does nothing.
 *
 * @param buffer The buffer held, or `null` when everything the editor shows has saved. Its
 *   `discard` may be a new function on every render; the guard calls the latest.
 */
export function useUnsavedBuffer(buffer: UnsavedBuffer | null): void {
  const guard = useContext(GuardContext);
  // The surface, not the object: a caller that builds `{surface: "code"}` on every render must
  // not re-run the hold on every render.
  const surface: BufferSurface | null = buffer === null ? null : buffer.surface;
  const discard = useRef(buffer?.discard);

  useLayoutEffect(() => {
    discard.current = buffer?.discard;
  });

  useEffect(() => {
    if (guard === null || surface === null) return;

    guard.holder.set({ surface, discard: () => discard.current?.() });
    return () => {
      guard.holder.set(null);
    };
  }, [guard, surface]);
}

/** What a segment takes. */
export interface ModeLinkProps {
  /** Where the segment goes. */
  readonly href: string;
  /** The surface it leads to. */
  readonly surface: StudioSurface;
  /** The surface the page is — the segment that carries `aria-current`. */
  readonly current: StudioSurface;
  /** The label. */
  readonly children: ReactNode;
}

/**
 * One live segment of the control.
 *
 * `aria-current="page"` marks the open tab, in the spelling the sidebar uses and the subnav's
 * sheet reads. A press that would discard a held buffer is stopped before `next/link` navigates
 * — `Link` does not navigate a click whose default was prevented — and handed to the guard to
 * ask; a modified click is never stopped, because it opens the link elsewhere and discards
 * nothing.
 *
 * @param props See {@link ModeLinkProps}.
 * @returns The link.
 */
export function ModeLink({ href, surface, current, children }: ModeLinkProps) {
  const guard = useContext(GuardContext);

  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (guard === null || !isPlainClick(event)) return;

    const prompt = switchPrompt(guard.holder.get(), current, surface);
    if (prompt === null) return;

    event.preventDefault();
    guard.ask({ href, prompt });
  }

  return (
    <Link aria-current={surface === current ? "page" : undefined} href={href} onClick={onClick}>
      {children}
    </Link>
  );
}
