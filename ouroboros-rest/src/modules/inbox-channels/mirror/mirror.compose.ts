/**
 * A decision's PR comment, composed (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463))
 * — pure.
 *
 * ```
 * open      **⚠ Needs you** · err
 *           **Allow loop #1851 to touch boot/rollback_flag.c once?**
 *           It is protected; the change is three lines.
 *           [loop #1851](…/runs/…) · [PR #509](…/prs/…) · `boot/rollback_flag.c`
 *           [Answer →](…/inbox?item=…)
 *
 * resolved  **✓ Answered** — allowed once by Ken · by email · 2026-10-04 09:12 UTC
 *           (question, why and refs kept, the Answer link dropped)
 * ```
 *
 * One body per state of the item, recomposed from the database every time — so an edit after a
 * refresh or a resolution shows exactly what the item says now, and a retry composes the same text.
 * Every fact is Markdown-escaped (`render(…, "markdown")` for the prose, {@link escapeMarkdown}
 * here for labels and names), so nothing in a payload can inject links or HTML into a PR.
 */

import type { DecisionChannel, DecisionSeverity } from "../../db/schema";
import { escapeMarkdown } from "../../decisions/decision.templates";
import type { DecisionRef, RenderedDecision } from "../../decisions/decision.types";
import { outcomeWords } from "../../decisions/inbox.compose";
import { inboxItemUrl, refUrl } from "../channel.links";

/** How each channel reads in a receipt line. */
export const CHANNEL_WORDS: Readonly<Record<DecisionChannel, string>> = {
  web: "in Ouroboros",
  email: "by email",
  github: "on GitHub",
  slack: "in Slack",
  push: "by push",
  api: "through the API",
};

/** How an item was resolved, as the edited comment says it. */
export interface MirrorResolution {
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actionId: string;
  /** The person, or null for a policy or a forgotten person. */
  readonly actorName: string | null;
  readonly channel: DecisionChannel;
  readonly resolvedAt: Date;
}

/** Everything a comment shows. */
export interface MirrorCommentInput {
  readonly itemId: string;
  readonly severity: DecisionSeverity;
  /** The card's prose, rendered for Markdown. */
  readonly prose: RenderedDecision;
  readonly refs: readonly DecisionRef[];
  /** Present once the item is resolved. */
  readonly resolution?: MirrorResolution;
  /** True for an item that expired unanswered. */
  readonly expired?: boolean;
  /** `OURO_UI_URL`. */
  readonly uiUrl: string;
}

/**
 * An instant as the receipt line shows it — UTC, to the minute.
 *
 * @param at - The instant.
 * @returns `2026-10-04 09:12 UTC`.
 */
export function utcMinute(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The tag row: each ref linked to its page where it has one, a path as code.
 *
 * @param refs - The item's refs.
 * @param uiUrl - `OURO_UI_URL`.
 * @returns The row, or an empty string for an item with no refs.
 */
export function refRow(refs: readonly DecisionRef[], uiUrl: string): string {
  return refs
    .map((ref) => {
      if (ref.type === "path") {
        return `\`${ref.label.replaceAll("`", "'")}\``;
      }

      const url = refUrl(uiUrl, ref);
      const label = escapeMarkdown(ref.label);

      return url === undefined ? label : `[${label}](${url})`;
    })
    .join(" · ");
}

/**
 * The receipt line of a resolved item.
 *
 * @param resolution - How it was resolved.
 * @returns `**✓ Answered** — approved by Ken · in Ouroboros · 2026-10-04 09:12 UTC`.
 */
export function receiptLine(resolution: MirrorResolution): string {
  const words = escapeMarkdown(outcomeWords(resolution));
  const actor =
    resolution.resolver === "human" && resolution.actorName !== null
      ? ` by ${escapeMarkdown(resolution.actorName)}`
      : "";

  return `**✓ Answered** — ${words}${actor} · ${CHANNEL_WORDS[resolution.channel]} · ${utcMinute(resolution.resolvedAt)}`;
}

/**
 * The comment's Markdown body (the SPI appends its marker).
 *
 * @param input - The item as it stands.
 * @returns The body.
 */
export function composeMirrorComment(input: MirrorCommentInput): string {
  const head =
    input.resolution !== undefined
      ? receiptLine(input.resolution)
      : input.expired === true
        ? "**⌛ Expired** — nobody answered in time; it no longer asks."
        : `**⚠ Needs you** · ${input.severity}`;
  const lines = [head, "", `**${input.prose.question}**`, "", input.prose.why];
  const refs = refRow(input.refs, input.uiUrl);

  if (refs !== "") {
    lines.push("", refs);
  }

  if (input.resolution === undefined && input.expired !== true) {
    lines.push("", `[Answer →](${inboxItemUrl(input.uiUrl, input.itemId)})`);
  }

  return lines.join("\n");
}

/**
 * The SPI comment key of an item's mirror — one comment per item.
 *
 * @param itemId - The item.
 * @returns `decision-<id>`, within the SPI's key grammar.
 */
export function mirrorCommentKey(itemId: string): string {
  return `decision-${itemId}`;
}
