/**
 * Switching between the studio's editors, as functions with inputs and outputs (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * Decision **C3** is *one draft, two editors*: **Visual** and **Code** both read the draft slot
 * P.3 stores ([#134](https://github.com/NobuData/ouroboros/issues/134)), so moving between them
 * converts nothing and carries nothing — each page reads the same row when it renders. There is
 * exactly one thing a switch can lose, and decision **C4** names it: a code buffer that has not
 * parsed yet. It never reached the draft, because the service refuses a file that does not
 * read, so it exists only in the page that holds it. Leaving that page discards it.
 *
 * The rule is therefore narrow: **a switch prompts only when it would discard a held buffer**.
 * Everything else — a switch with nothing held, a press on the tab already open, a click that
 * opens a new tab — navigates with nothing asked. `app/workflows/mode-guard.tsx` draws the
 * prompt; what it says and when it appears are decided here.
 *
 * **Framework-free and pure**, like `view.ts` beside it.
 */

import type { StudioSurface } from "./view";

/**
 * The surfaces whose buffers can be held — only the code editor's today.
 *
 * The canvas has no buffer in this sense: what it draws is the draft, and S.6's autosave
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) writes each move to the draft
 * rather than keeping it aside. A surface joins this union when it gains something that can
 * exist only in the page.
 */
export type BufferSurface = Extract<StudioSurface, "code">;

/**
 * A buffer that has not reached the draft: code that has not parsed yet (C4).
 *
 * The code editor holds one from its first refused save to its next successful one (V.4,
 * [#172](https://github.com/NobuData/ouroboros/issues/172)), through
 * `mode-guard.tsx`'s `useUnsavedBuffer`.
 */
export interface UnsavedBuffer {
  /** The surface holding it — the one a switch would leave it behind on. */
  readonly surface: BufferSurface;
}

/** What each surface is called on the segmented control, and so in the prompt. */
export const SURFACE_LABELS: Readonly<Record<StudioSurface, string>> = {
  visual: "Visual",
  code: "Code",
};

/** What a prompt says: a title, a sentence, and its two answers. */
export interface SwitchPrompt {
  /** The dialog's heading, which is also its accessible name. */
  readonly title: string;
  /** What is lost, why it was never saved, and what the other editor will show. */
  readonly body: string;
  /** The answer that discards the buffer and switches. */
  readonly confirm: string;
  /** The answer that stays, with the buffer as it was. */
  readonly cancel: string;
}

/** The prompt's heading. */
export const SWITCH_PROMPT_TITLE = "Discard code that has not parsed?";

/** The answer that stays. */
export const SWITCH_PROMPT_CANCEL = "Keep editing";

/**
 * What the prompt says about switching to a surface.
 *
 * @param to The surface the switch leads to.
 * @returns The sentence — what the buffer is, why the draft never had it, and what `to` shows.
 */
export function switchPromptBody(to: StudioSurface): string {
  return (
    "This code has not parsed yet, so none of it has reached the draft both editors share. " +
    `Switching to ${SURFACE_LABELS[to]} discards it, and ${SURFACE_LABELS[to]} opens on the ` +
    "last draft that saved."
  );
}

/**
 * Whether switching surfaces discards a held buffer, and if so what to ask.
 *
 * @param held The buffer the page holds, or `null` when it holds none.
 * @param from The surface the page is.
 * @param to The surface the pressed segment leads to.
 * @returns The prompt, or `null` when the switch loses nothing: nothing is held, the press is
 *   on the open tab, or the buffer belongs to a surface other than the one being left.
 */
export function switchPrompt(
  held: UnsavedBuffer | null,
  from: StudioSurface,
  to: StudioSurface,
): SwitchPrompt | null {
  if (held === null || from === to || held.surface !== from) return null;

  return {
    title: SWITCH_PROMPT_TITLE,
    body: switchPromptBody(to),
    confirm: `Discard and open ${SURFACE_LABELS[to]}`,
    cancel: SWITCH_PROMPT_CANCEL,
  };
}

/** The parts of a click that decide where it navigates. */
export interface ClickFacts {
  /** Which mouse button — `0` is the primary one. */
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a click navigates *this* tab.
 *
 * A modified or non-primary click opens the link somewhere else — a new tab, a new window, a
 * download — and leaves this page, and the buffer it holds, where they are. So only a plain
 * primary click can discard anything, and only a plain primary click is worth a prompt.
 *
 * @param click The click.
 * @returns `true` for a primary-button click with no modifier held.
 */
export function isPlainClick(click: ClickFacts): boolean {
  return (
    click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey
  );
}
