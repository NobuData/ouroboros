/**
 * The side column's words and pure rules (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469),
 * mockup 16): **Answer From Anywhere** and **What Needs A Human**.
 *
 * These are the two cards where a page like this starts lying, in opposite directions, and the
 * rules here exist to stop both:
 *
 * - **The channel card lies by aspiration** — a ✓ beside a channel that cannot deliver. So the
 *   mark is never chosen here: {@link channelStanding} only puts BN.3's truth payload (#463) in a
 *   shape to draw, and a ✓ exists for exactly one state, `connected`. A channel that becomes
 *   available flips its row because the payload changed, not because this file did.
 * - **The policy card lies by staleness** — a hard-coded list that keeps claiming a rule after
 *   it was removed. So there is no list here at all: every row is BN.4's (#464), with the source
 *   that enforces it and the surface that owns it, and a rule nothing enforces is simply absent.
 */

import type { InboxChannel, NotificationPreferences } from "@/app/api/inbox";

import { DIGEST_TIME_INVALID, DIGEST_TIME_PATTERN } from "./notifications-view";

/** The column's accessible name. */
export const SIDE_LABEL = "Channels and policies";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_SIDE = "The inbox's channels and policies could not be reached.";

/** What is said when something answered and this client could not read it. */
export const UNREADABLE_SIDE = "The inbox's channels and policies could not be read.";

/** The channels card: its title, and the mark a connected channel wears. */
export const CHANNELS_TITLE = "Answer from anywhere";
export const CONNECTED_MARK = "✓ connected";

/** What a channel that could be connected, and is not, says beside its name. */
export const NOT_CONNECTED = "not connected";

/** What a channel this deployment cannot have yet says beside its name. */
export const NOT_YET = "not yet";

/**
 * The card's link to Chat Ops — honest about being unbuilt: mockup 19's page arrives with
 * [#541](https://github.com/NobuData/ouroboros/issues/541), which turns this into a real link.
 */
export const CHAT_OPS_LABEL = "Chat Ops";
export const CHAT_OPS_SOON = "The Chat Ops page arrives with #541.";
export const SOON_MARK = "soon";

/** The email row's digest controls. */
export const DIGEST_LEAD = "Daily digest";
export const DIGEST_TIME_FIELD = "Digest time (UTC)";
export const DIGEST_TIME_SAVE = "Set time";
export const DIGEST_TIME_UNCHANGED = "The digest is already sent at this time.";
export const DIGEST_SAVING = "Saving…";

/** The card's way into the preferences sheet. */
export const CHANNEL_SETTINGS_LABEL = "All notification settings";

/** The policy card: its title, its link to the settings surface, and each row's two controls. */
export const POLICY_TITLE = "What needs a human";
export const EDIT_POLICIES_LABEL = "Edit policies";
export const POLICY_SOURCE_LABEL = "Where this is enforced";
export const POLICY_EDIT_LABEL = "edit";
export const POLICY_MARK = "✓";

/** How a screen reader hears the row's arrow. */
export const POLICY_LEADS_TO = "leads to";

/** What the policy card says when nothing asks for a person at all. */
export const NO_POLICY_ROWS = "No rule asks for a person right now.";

/** How a channel stands, as the card draws it. */
export interface ChannelStanding {
  /** Whether the channel is delivering — the only state that earns a ✓. */
  readonly connected: boolean;
  /** The text at the row's edge: the ✓ for a connected channel, how far off it is for any other. */
  readonly mark: string;
  /** The sentence under the summary saying why it is not connected, or `null` when it is. */
  readonly reason: string | null;
}

/**
 * A channel's standing, from BN.3's truth payload — verbatim.
 *
 * `connected` wears the ✓. `available` could be connected and is not: *not connected*, with what
 * is missing. `unavailable-until` does not exist in this deployment yet: *not yet*, with what it
 * arrives with. A state this client has never heard of reads as not connected — an unknown state
 * must never be drawn as a ✓.
 *
 * @param channel The channel, as served.
 * @returns How to draw it.
 */
export function channelStanding(channel: Pick<InboxChannel, "state" | "reason">): ChannelStanding {
  if (channel.state === "connected") return { connected: true, mark: CONNECTED_MARK, reason: null };

  return {
    connected: false,
    mark: channel.state === "unavailable-until" ? NOT_YET : NOT_CONNECTED,
    reason: channel.reason,
  };
}

/**
 * Whether a channel's row carries the daily digest's controls.
 *
 * The digest is mail, so its switch belongs to the email channel — and only while that channel
 * is connected: a switch on a channel that cannot deliver is a control that does nothing.
 *
 * @param channel The channel, as served.
 * @returns `true` for a connected email channel.
 */
export function carriesDigest(channel: Pick<InboxChannel, "id" | "state">): boolean {
  return channel.id === "email" && channel.state === "connected";
}

/**
 * The digest's standing in a few words — the mockup's *daily · 09:00*.
 *
 * @param preferences The reader's preferences.
 * @returns `daily · 09:00 UTC`, or `off`.
 */
export function digestSummary(preferences: Pick<NotificationPreferences, "digest">): string {
  return preferences.digest.enabled ? `daily · ${preferences.digest.time} ${preferences.digest.timeZone}` : "off";
}

/**
 * Why the time typed on the email row cannot be saved, or `undefined` when it can.
 *
 * @param typed What the field holds.
 * @param saved The time the digest is sent at now.
 * @returns The reason — not a time of day, or no change to make.
 */
export function digestTimeBlock(typed: string, saved: string): string | undefined {
  if (!DIGEST_TIME_PATTERN.test(typed)) return DIGEST_TIME_INVALID;

  return typed === saved ? DIGEST_TIME_UNCHANGED : undefined;
}
