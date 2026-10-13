/**
 * The card model — everything Ouroboros says in a channel, before any platform has a say (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536), decision **C2**).
 *
 * **One vocabulary, many surfaces.** A decision card, an event card and a system line are
 * composed here as plain data: a headline with a severity, fact lines, one mono stats line,
 * actions and a footnote. A {@link ChatBackend} turns that into whatever its platform draws —
 * Slack's Block Kit today (`slack/slack.blockkit.ts`), Teams' Adaptive Cards later (#547) — so a
 * second platform is an adapter, never a second set of words.
 *
 * **Nothing here knows a platform.** No block, no `mrkdwn`, no button element: the model's
 * strings are plain text, and escaping is the backend's. `chat.card.spec.ts` renders every
 * archetype through a fixture backend to prove the port is enough.
 *
 * ```
 * ✓ Loop #1846 finished — PR #512 merged                 mark · headline      (severity ok)
 *   #474 Debounce e-stop interrupt handler               lines
 *   14/14 checks · 11m cycle · $0.94 · claude-fable-5    stats (mono)
 *   [View PR ↗] [Run console]                            actions
 *   paused 4m · escalates to the Needs-you inbox in 26m  footnote
 * ```
 */

/** How a card reads at a glance — the mockup's border colours. */
export type ChatSeverity = "ok" | "warn" | "accent" | "err" | "info";

/** A button that answers a decision. Its value is signed here and verified by #538. */
export interface ChatAnswerAction {
  readonly type: "answer";
  /** The decision action's id — `allow_once`. */
  readonly id: string;
  readonly label: string;
  readonly style: "primary" | "danger" | "default";
  /** The signed payload the platform sends back when the button is pressed. */
  readonly value: string;
}

/** A button that only opens a page. */
export interface ChatLinkAction {
  readonly type: "link";
  readonly id: string;
  readonly label: string;
  /** An absolute URL on the UI origin. */
  readonly url: string;
}

/** One action under a card. */
export type ChatCardAction = ChatAnswerAction | ChatLinkAction;

/** A card. */
export interface ChatCard {
  readonly kind: "card";
  readonly severity: ChatSeverity;
  /** The glyph before the headline — `✓`, `⏸`, `⟳`, `✕`, `✦`. */
  readonly mark: string;
  readonly headline: string;
  /** Fact lines under the headline, in order. Plain text. */
  readonly lines: readonly string[];
  /** The mono stats line, or null. Only figures that exist are in it. */
  readonly stats: string | null;
  readonly actions: readonly ChatCardAction[];
  /** The dim line under the actions, or null. */
  readonly footnote: string | null;
}

/** A compact one-line message — `✓ Maya Chen answered: allow once — loop #1851`. */
export interface ChatSystemLine {
  readonly kind: "line";
  readonly text: string;
}

/** Anything the publisher sends. */
export type ChatMessageModel = ChatCard | ChatSystemLine;

/** What separates the figures of a stats line and the parts of a footnote. */
export const STAT_SEPARATOR = " · ";

/**
 * Join the figures that exist into one stats line.
 *
 * @param parts - Each figure, or null when the work did not produce it.
 * @returns The line, or null when no figure exists — never a placeholder for a missing one.
 */
export function statsLine(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null && part !== "");

  return present.length === 0 ? null : present.join(STAT_SEPARATOR);
}

/**
 * A card as the plain text a notification, a screen reader or a log shows.
 *
 * @param message - The card or line.
 * @returns Its headline (with its mark), or the line's text.
 */
export function fallbackText(message: ChatMessageModel): string {
  return message.kind === "line" ? message.text : `${message.mark} ${message.headline}`;
}

/**
 * A duration in the card's short form — whole units, largest first, at most two.
 *
 * @param seconds - The duration; negatives read as zero.
 * @returns `41s`, `4m`, `1h 5m`, `2d 3h`.
 */
export function shortDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));

  if (whole < 60) {
    return `${String(whole)}s`;
  }

  const minutes = Math.floor(whole / 60);

  if (minutes < 60) {
    return `${String(minutes)}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    const rest = minutes % 60;

    return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
  }

  const days = Math.floor(hours / 24);
  const rest = hours % 24;

  return rest === 0 ? `${String(days)}d` : `${String(days)}d ${String(rest)}h`;
}

/**
 * A PostgreSQL interval, as its text reads, in seconds.
 *
 * A kind's `escalationWindow` arrives as interval text (`00:30:00`, `1 day`, `7 days`,
 * `1 day 02:00:00`); nothing else in the service parses one.
 *
 * @param interval - The interval text.
 * @returns Its length in seconds, or null for text this does not read.
 */
export function intervalSeconds(interval: string): number | null {
  const match = /^\s*(?:(\d+)\s+days?)?\s*(?:(\d+):([0-5]\d):([0-5]\d)(?:\.\d+)?)?\s*$/.exec(
    interval,
  );

  if (match === null || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;

  return Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
