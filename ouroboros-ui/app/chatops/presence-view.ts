import type { ReactNode } from "react";

import { ANALYZER_PATH } from "@/app/paths";

/*
 * The AI-presence card (CA.4, [#544](https://github.com/NobuData/ouroboros/issues/544)) — what it
 * says, and the contract CB.1 ([#546](https://github.com/NobuData/ouroboros/issues/546)) flips
 * it live through.
 *
 * ## The activation slot
 *
 * The card (`ai-presence-card.tsx`) draws a {@link PresenceSource}. There are two:
 *
 * - **`preview`** — what ships today: {@link PREVIEW_THREAD}, mockup 19's exchange, written here.
 *   The card wears its `preview` chip and its arrival label, **Apply** is inert with its reason,
 *   and a system line is drawn as an illustration. This is the default — the page passes nothing.
 * - **`live`** — what #546 supplies: a thread read from the service, `onConfirm` for a
 *   suggestion's confirm control, and the composer to draw under the thread.
 *
 * **Activation is a data change plus the composer.** Both sources are the same
 * {@link PresenceThread} shape, drawn by the same layout and the same message components
 * (`message.tsx`, which the channel mirror's stream is made of too) with the same
 * suggestion-with-confirm affordance. To go live, #546:
 *
 * 1. reads a thread and maps it to {@link PresenceThread} (`at` set on every message, `clock`
 *    unset);
 * 2. passes `source={{ mode: "live", thread, onConfirm, composer }}` to `AiPresenceCard` from
 *    `chatops-screen.tsx`.
 *
 * Nothing in the card, its sheet or `message.tsx` changes. What a live source must bring that the
 * preview does not have — grounding, citations, the confirmation step behind `onConfirm`, the
 * policy check and the audit entry — is #546's, on the service; the card only draws the thread
 * it is handed.
 */

/** A suggestion an answer makes: something to confirm, and where to read more. */
export interface PresenceSuggestion {
  /** What the confirm control says — `Apply`. */
  readonly confirmLabel: string;
  /** The link beside it, or null. An in-app path stays in the tab. */
  readonly link: { readonly label: string; readonly href: string } | null;
}

/** One message of the thread. */
export interface PresenceMessage {
  readonly type: "message";
  /** Its identity in the thread — what `onConfirm` is handed. */
  readonly id: string;
  /** Who it is from: a person, or the app. */
  readonly from: "person" | "app";
  /** The person's name. Ignored for the app, which is always named as the app. */
  readonly name: string | null;
  /** When it was sent, ISO 8601. A live message always has one. */
  readonly at?: string;
  /** The time as written — the illustration's, which names no real moment. */
  readonly clock?: string;
  /** What it says. */
  readonly text: string;
  /** The suggestion it ends with, or null. */
  readonly suggestion: PresenceSuggestion | null;
}

/** A system line: what happened to a suggestion. */
export interface PresenceLine {
  readonly type: "line";
  readonly id: string;
  /** The line, as written. */
  readonly text: string;
}

/** One entry of the thread. */
export type PresenceEntry = PresenceMessage | PresenceLine;

/** A thread: its entries, oldest first. */
export interface PresenceThread {
  readonly entries: readonly PresenceEntry[];
}

/** What the card draws — see the note at the top of this file. */
export type PresenceSource =
  | {
      /** The designed preview: nothing in it can be activated. */
      readonly mode: "preview";
      readonly thread: PresenceThread;
    }
  | {
      /** A live thread, supplied by #546. */
      readonly mode: "live";
      readonly thread: PresenceThread;
      /**
       * Confirm a message's suggestion.
       *
       * @param messageId The message whose suggestion was confirmed.
       */
      readonly onConfirm: (messageId: string) => void;
      /** The composer, drawn under the thread. */
      readonly composer?: ReactNode;
    };

/** The card's title, as mockup 19 prints it. */
export const PRESENCE_TITLE = "AI PRESENCE";

/** The chip on the card's head. */
export const PREVIEW_CHIP = "preview";

/** When the card becomes real — beside the chip. */
export const PRESENCE_ARRIVES = "arrives with AI presence (#546)";

/** The thread's accessible name while it is an illustration. */
export const PREVIEW_THREAD_LABEL = "Preview — an illustration of AI presence, not a live conversation";

/** The thread's accessible name once it is live. */
export const LIVE_THREAD_LABEL = "AI presence thread";

/** What a screen reader hears before an illustrated system line. */
export const ILLUSTRATED_LINE_PREFIX = "Illustration:";

/** Why **Apply** cannot be pressed — its tooltip, its description, and the line under it. */
export const APPLY_REASON = "Apply is part of the preview — it arrives with AI presence (#546).";

/** The caption while the card is a preview: the commitment, not a present-tense claim. */
export const PREVIEW_CAPTION =
  "When it lands: anything the UI can do, a sentence can do — same permissions, same audit trail.";

/** The mockup's caption, true once the card is live. */
export const LIVE_CAPTION = "Anything the UI can do, a sentence can do. Same permissions, same audit trail.";

/** The pointer to what works today, in three parts so the command is set as code. */
export const TODAY_POINTER = { before: "today, the ", code: "/ouro", after: " commands do this deterministically →" } as const;

/** The commands card's id — where the pointer goes. */
export const COMMANDS_ANCHOR = "chatops-commands";

/** Mockup 19's exchange, verbatim. An illustration: no record stands behind any of it. */
export const PREVIEW_THREAD: PresenceThread = {
  entries: [
    {
      type: "message",
      id: "preview-question",
      from: "person",
      name: "Ken",
      clock: "14:36",
      text: "why did #479 take 38 minutes?",
      suggestion: null,
    },
    {
      type: "message",
      id: "preview-answer",
      from: "app",
      name: null,
      clock: "14:36",
      text: "11 of those minutes were queue time on pool-a (14:00–16:00 peak). The Build Analyzer already has a runner-rebalance suggestion that removes it — apply?",
      suggestion: { confirmLabel: "Apply", link: { label: "Open Analyzer →", href: ANALYZER_PATH } },
    },
    { type: "line", id: "preview-applied", text: "✓ applied · policy-checked · audit-logged" },
  ],
};

/** The source the card draws when it is handed none. */
export const PREVIEW_SOURCE: PresenceSource = { mode: "preview", thread: PREVIEW_THREAD };
