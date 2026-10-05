/**
 * The decision mails, composed (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463)) —
 * pure.
 *
 * ```
 * instant   one err-severity card: question, why, refs, one link per action the person may press
 * digest    open decisions, most severe then oldest first, each with its action links;
 *           then the last day's resolved summary; then a link to the inbox
 * ```
 *
 * Every mail has a plain-text part and an HTML part. Every fact is escaped for HTML here — the
 * prose arrives as plain text (`render(…, "plain")`) and is escaped once, so nothing in a payload
 * can inject markup. A link that needs a signed-in confirm (a merge-class action, X5) says so
 * beside it, so the person is not surprised by a sign-in page.
 */

import type { DecisionSeverity } from "../../db/schema";
import type { DecisionRef } from "../../decisions/decision.types";
import { escapeHtml } from "../../mail/html";

/** One action link in a mail. */
export interface MailActionLink {
  readonly label: string;
  /** The sentence that says what pressing it does. */
  readonly consequence: string;
  /** The token link. */
  readonly url: string;
  readonly primary: boolean;
  /** A merge-class action: the link asks for a sign-in before anything happens. */
  readonly requiresConfirm: boolean;
}

/** One card in a mail. */
export interface MailCard {
  readonly severity: DecisionSeverity;
  readonly question: string;
  readonly why: string;
  readonly refs: readonly DecisionRef[];
  /** How long it has waited, in words — `2 h`. */
  readonly waited: string;
  /** The person's action links; empty when they may press none (the card still shows). */
  readonly actions: readonly MailActionLink[];
  /** The item in the inbox. */
  readonly inboxUrl: string;
}

/** A composed mail, before the mailer adds the addresses. */
export interface ComposedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The severity words a mail uses. */
const SEVERITY_WORDS: Readonly<Record<DecisionSeverity, string>> = {
  err: "Blocking",
  warn: "Waiting",
  info: "FYI",
};

/** The order a digest lists severities in. */
const SEVERITY_ORDER: Readonly<Record<DecisionSeverity, number>> = { err: 0, warn: 1, info: 2 };

/** The longest subject line, in code points, before it is cut. */
const MAX_SUBJECT = 120;

/**
 * A subject line, cut on a code-point boundary.
 *
 * @param text - The subject.
 * @returns It, at most {@link MAX_SUBJECT} code points.
 */
function subjectLine(text: string): string {
  const points = [...text.replace(/\s+/g, " ").trim()];

  return points.length <= MAX_SUBJECT
    ? points.join("")
    : `${points.slice(0, MAX_SUBJECT - 1).join("")}…`;
}

/**
 * Order cards as a digest lists them: most severe first, then oldest first.
 *
 * @param cards - The cards with their creation instants.
 * @returns A new array, ordered.
 */
export function digestOrder<T extends { severity: DecisionSeverity; createdAt: Date }>(
  cards: readonly T[],
): T[] {
  return [...cards].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/**
 * A card as plain text.
 *
 * @param card - The card.
 * @returns Its lines.
 */
function cardText(card: MailCard): string[] {
  const lines = [
    `[${SEVERITY_WORDS[card.severity]}] ${card.question}`,
    card.why,
    `Waiting ${card.waited}${card.refs.length > 0 ? ` · ${card.refs.map((ref) => ref.label).join(" · ")}` : ""}`,
  ];

  for (const action of card.actions) {
    lines.push(
      `  ${action.label}${action.requiresConfirm ? " (asks you to sign in first)" : ""}: ${action.url}`,
    );
  }

  lines.push(`  Open in Ouroboros: ${card.inboxUrl}`);

  return lines;
}

/**
 * A card as HTML.
 *
 * @param card - The card.
 * @returns The fragment.
 */
function cardHtml(card: MailCard): string {
  const refs = card.refs.map((ref) => escapeHtml(ref.label)).join(" · ");
  const actions = card.actions
    .map(
      (action) =>
        `<a href="${escapeHtml(action.url)}" style="display:inline-block;margin:4px 8px 4px 0;padding:6px 12px;border-radius:6px;text-decoration:none;${
          action.primary
            ? "background:#1f2937;color:#ffffff;"
            : "border:1px solid #d1d5db;color:#1f2937;"
        }" title="${escapeHtml(action.consequence)}">${escapeHtml(action.label)}${
          action.requiresConfirm ? " · sign in to confirm" : ""
        }</a>`,
    )
    .join("");

  return [
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:12px 0;">`,
    `<div style="font-size:12px;color:#6b7280;">${escapeHtml(SEVERITY_WORDS[card.severity])} · waiting ${escapeHtml(card.waited)}${refs === "" ? "" : ` · ${refs}`}</div>`,
    `<div style="font-weight:600;margin:4px 0;">${escapeHtml(card.question)}</div>`,
    `<div style="color:#374151;">${escapeHtml(card.why)}</div>`,
    `<div style="margin-top:8px;">${actions}<a href="${escapeHtml(card.inboxUrl)}" style="color:#2563eb;">Open in Ouroboros →</a></div>`,
    `</div>`,
  ].join("");
}

/**
 * Wrap a body in the mail's frame.
 *
 * @param title - The heading.
 * @param body - The HTML body.
 * @param footer - The footer line, plain text.
 * @returns The document.
 */
function frame(title: string, body: string, footer: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="margin:0;padding:16px;background:#ffffff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;">',
    `<h1 style="font-size:18px;margin:0 0 8px;">${escapeHtml(title)}</h1>`,
    body,
    `<p style="font-size:12px;color:#6b7280;margin-top:24px;">${escapeHtml(footer)}</p>`,
    "</body></html>",
  ].join("");
}

/** The footer every decision mail carries. */
const FOOTER =
  "Each link works once, only for you, and stops working as soon as the decision is answered anywhere. Change what you receive in Ouroboros → Inbox → notifications.";

/**
 * The instant mail for one err-severity card.
 *
 * @param workspace - The workspace's name.
 * @param card - The card.
 * @returns The mail.
 */
export function composeInstantMail(workspace: string, card: MailCard): ComposedMail {
  const title = `Needs you · ${workspace}`;

  return {
    subject: subjectLine(`[Ouroboros] Needs you: ${card.question}`),
    text: [title, "", ...cardText(card), "", FOOTER, ""].join("\n"),
    html: frame(title, cardHtml(card), FOOTER),
  };
}

/** What a digest shows. */
export interface DigestMailInput {
  readonly workspace: string;
  /** The UTC day it is for, `YYYY-MM-DD`. */
  readonly day: string;
  /** The open cards, already in {@link digestOrder}. */
  readonly open: readonly MailCard[];
  /** The last day's resolved lines — `Split #490 into 6 tickets — approved`. */
  readonly resolved: readonly string[];
  readonly inboxUrl: string;
  /**
   * The footer, when not the per-person one. An org notification route's digest (#488) carries no
   * action links and goes to addresses rather than people, so the per-person footer — *each link
   * works once, only for you* — would be untrue there.
   */
  readonly footer?: string;
}

/** The footer of an org notification route's digest (#488): read-only, sent to an address. */
export const ORG_DIGEST_FOOTER =
  "This digest was sent to this address by your workspace's notification routes. It carries no action links — answer in the inbox. Administrators change where it goes in Ouroboros → Settings → Notifications.";

/**
 * The daily digest.
 *
 * @param input - The cards and the resolved summary.
 * @returns The mail.
 */
export function composeDigestMail(input: DigestMailInput): ComposedMail {
  const footer = input.footer ?? FOOTER;
  const count = input.open.length;
  const waiting =
    count === 0
      ? "Nothing is waiting on you"
      : `${String(count)} decision${count === 1 ? "" : "s"} waiting`;
  const title = `${waiting} · ${input.workspace}`;
  const resolvedHeading = `Resolved in the last day (${String(input.resolved.length)})`;
  const text = [`${title} — ${input.day}`, ""];

  for (const card of input.open) {
    text.push(...cardText(card), "");
  }

  text.push(resolvedHeading);
  text.push(
    ...(input.resolved.length === 0 ? ["  (none)"] : input.resolved.map((l) => `  ✓ ${l}`)),
  );
  text.push("", `Inbox: ${input.inboxUrl}`, "", footer, "");

  const resolvedHtml =
    input.resolved.length === 0
      ? '<p style="color:#6b7280;">None.</p>'
      : `<ul style="padding-left:18px;">${input.resolved.map((line) => `<li>✓ ${escapeHtml(line)}</li>`).join("")}</ul>`;
  const body = [
    `<p style="color:#6b7280;margin:0 0 8px;">${escapeHtml(input.day)}</p>`,
    input.open.map(cardHtml).join(""),
    `<h2 style="font-size:15px;margin:20px 0 4px;">${escapeHtml(resolvedHeading)}</h2>`,
    resolvedHtml,
    `<p><a href="${escapeHtml(input.inboxUrl)}" style="color:#2563eb;">Open the inbox →</a></p>`,
  ].join("");

  return {
    subject: subjectLine(`[Ouroboros] ${title}`),
    text: text.join("\n"),
    html: frame(title, body, footer),
  };
}
