/**
 * The channel truth payload (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463),
 * decision **X5**) — pure.
 *
 * Mockup 16's *Answer From Anywhere* card shows four rows. BO.4 renders this payload **verbatim**,
 * so no UI code hand-maintains what is connected — and a channel that does not exist never shows
 * a ✓:
 *
 * ```
 * github  connected    while the workspace has a git host the SPI can comment through
 *         available    otherwise — "connect a git host"
 * email   connected    while this deployment has a mail server (OURO_SMTP_URL)
 *         available    otherwise — "set OURO_SMTP_URL"
 * slack   unavailable-until  Chat Ops (mockup 19, #536/#538)
 * push    unavailable-until  BP.2 (#472)
 * ```
 */

import type { MailTransport } from "../mail/mailer";

/** A channel's state. */
export type ChannelState = "connected" | "available" | "unavailable-until";

/** One row of the card. */
export interface ChannelTruth {
  /** `github`, `email`, `slack`, `push` — the `DecisionChannel` it answers through. */
  readonly id: "github" | "email" | "slack" | "push";
  readonly label: string;
  /** What the channel does, in the card's words. */
  readonly summary: string;
  readonly state: ChannelState;
  /** For `unavailable-until`: what it arrives with. Null otherwise. */
  readonly until: string | null;
  /** Why it is not connected, in a sentence; null when it is. */
  readonly reason: string | null;
}

/** `GET /api/v1/inbox/channels`. */
export interface ChannelsResource {
  readonly channels: readonly ChannelTruth[];
}

/** What the truth is computed from. */
export interface ChannelFacts {
  /** How many of the workspace's sources can comment on a PR through the SPI. */
  readonly commentingSources: number;
  /** This deployment's mailer. */
  readonly mailTransport: MailTransport;
}

/**
 * The four rows, in the card's order.
 *
 * @param facts - What is actually configured.
 * @returns The payload.
 */
export function channelTruth(facts: ChannelFacts): ChannelsResource {
  const github = facts.commentingSources > 0;
  const email = facts.mailTransport === "smtp";

  return {
    channels: [
      {
        id: "slack",
        label: "Slack",
        summary: "Approve with a button, right in the thread.",
        state: "unavailable-until",
        until: "Chat Ops",
        reason: "Arrives with Chat Ops.",
      },
      {
        id: "email",
        label: "Email",
        summary: "A daily digest, and an instant mail for each blocking (err) decision.",
        state: email ? "connected" : "available",
        until: null,
        reason: email ? null : "This deployment has no mail server: set OURO_SMTP_URL.",
      },
      {
        id: "push",
        label: "Mobile push",
        summary: "Critical decisions only.",
        state: "unavailable-until",
        until: "BP.2",
        reason: "Arrives later.",
      },
      {
        id: "github",
        label: "GitHub",
        // The card explains the comment's whole life (BO.4, #469): one comment, never a thread.
        summary:
          "Every decision is mirrored as a PR comment — posted when it is asked, edited when it is answered.",
        state: github ? "connected" : "available",
        until: null,
        reason: github ? null : "Connect a git host to mirror decisions on its pull requests.",
      },
    ],
  };
}
