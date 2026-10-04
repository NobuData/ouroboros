/**
 * The token confirm pages (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463), decision
 * **X5**) — pure HTML, in the shape of #440's unsubscribe pages.
 *
 * ```
 * confirm      the full decision card, the action and its consequence, a note field when the
 *              action takes one, and ONE button — the POST is the answer, never the link-open
 * sign in      the same card, and "sign in to confirm" (a merge-class action without a session)
 * receipt      what was done, by whom, and the plane's receipt
 * problems     expired · used · revoked (answered elsewhere / replaced by a newer mail / withdrawn)
 *              · unknown · someone else's link · no longer a member · the action failed
 * ```
 *
 * Every page is complete on its own — no script, no external resource (the controller's CSP
 * forbids both) — and every value is escaped. Styling is a `<style>` block of classes over
 * custom properties, light and dark.
 */

import type { DecisionSeverity } from "../../db/schema";
import type { DecisionRef } from "../../decisions/decision.types";
import { escapeHtml } from "../../mail/html";

/** A page and the status it is answered with. */
export interface AnswerPage {
  readonly status: number;
  readonly html: string;
}

/** The card a page shows. */
export interface AnswerCard {
  readonly workspace: string;
  readonly severity: DecisionSeverity;
  readonly question: string;
  readonly why: string;
  readonly refs: readonly DecisionRef[];
}

/** The action a token performs. */
export interface AnswerAction {
  readonly label: string;
  readonly consequence: string;
  readonly takesNote: boolean;
  readonly style: "primary" | "ghost" | "danger";
}

/** Why a token cannot answer — each its own designed page. */
export type TokenProblem =
  | "expired"
  | "used"
  | "answered"
  | "superseded"
  | "withdrawn"
  | "unknown"
  | "wrong_user"
  | "not_member";

/** The longest note a resolution stores (V095). */
export const MAX_ANSWER_NOTE = 2000;

const STYLE = `
:root{--bg:#f9fafb;--card:#ffffff;--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#1f2937;--accent-ink:#ffffff;--danger:#b91c1c;--ok:#047857;--warn:#b45309;--radius:10px;--gap:16px}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f14;--card:#121821;--ink:#e5e7eb;--muted:#9ca3af;--line:#1f2937;--accent:#e5e7eb;--accent-ink:#0b0f14;--danger:#f87171;--ok:#34d399;--warn:#fbbf24}}
*{box-sizing:border-box}
body{margin:0;padding:var(--gap);background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.answer{max-width:560px;margin:8vh auto;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:calc(var(--gap)*1.5)}
.answer__eyebrow{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.answer__title{font-size:20px;margin:6px 0 4px}
.answer__why{color:var(--muted);margin:0 0 var(--gap)}
.answer__refs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 var(--gap);padding:0;list-style:none}
.answer__ref{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:2px 8px}
.answer__severity--err{color:var(--danger)}.answer__severity--warn{color:var(--warn)}.answer__severity--info{color:var(--muted)}
.answer__consequence{border-left:3px solid var(--line);padding-left:10px;margin:0 0 var(--gap)}
.answer__label{display:block;font-size:13px;margin-bottom:4px}
.answer__note{width:100%;min-height:96px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
.answer__error{color:var(--danger);font-size:13px;margin:6px 0 0}
.answer__actions{display:flex;gap:10px;align-items:center;margin-top:var(--gap)}
.answer__button{display:inline-block;border:0;border-radius:6px;padding:9px 16px;font:inherit;cursor:pointer;text-decoration:none;background:var(--accent);color:var(--accent-ink)}
.answer__button--danger{background:var(--danger);color:var(--accent-ink)}
.answer__link{color:inherit}
.answer__status--ok{color:var(--ok)}.answer__status--problem{color:var(--danger)}
.answer__fine{font-size:12px;color:var(--muted);margin-top:var(--gap)}
`;

/**
 * A complete document.
 *
 * @param title - The tab's title.
 * @param body - The `.answer` section's inner HTML.
 * @returns The document.
 */
function documentOf(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><main class="answer">${body}</main></body></html>`,
  ].join("");
}

/**
 * The card's markup.
 *
 * @param card - The card.
 * @returns The fragment.
 */
function cardHtml(card: AnswerCard): string {
  const refs =
    card.refs.length === 0
      ? ""
      : `<ul class="answer__refs">${card.refs
          .map((ref) => `<li class="answer__ref">${escapeHtml(ref.label)}</li>`)
          .join("")}</ul>`;

  return [
    `<div class="answer__eyebrow">${escapeHtml(card.workspace)} · <span class="answer__severity--${card.severity}">${escapeHtml(card.severity)}</span></div>`,
    `<h1 class="answer__title">${escapeHtml(card.question)}</h1>`,
    `<p class="answer__why">${escapeHtml(card.why)}</p>`,
    refs,
  ].join("");
}

/**
 * The confirm page a token link opens. Nothing has happened yet.
 *
 * @param input - The card, the action, where the form posts, and a note error to show.
 * @param input.card - The decision.
 * @param input.action - What the button does.
 * @param input.formAction - The page's own path; the button POSTs here.
 * @param input.noteError - Shown when a submitted note was refused.
 * @returns The page, `200` (or `422` with a note error).
 */
export function confirmPage(input: {
  readonly card: AnswerCard;
  readonly action: AnswerAction;
  readonly formAction: string;
  readonly noteError?: string;
}): AnswerPage {
  const { action } = input;
  const note = action.takesNote
    ? [
        '<label class="answer__label" for="note">Note (required)</label>',
        `<textarea class="answer__note" id="note" name="note" maxlength="${String(MAX_ANSWER_NOTE)}" required></textarea>`,
        input.noteError === undefined
          ? ""
          : `<p class="answer__error">${escapeHtml(input.noteError)}</p>`,
      ].join("")
    : "";
  const button = `answer__button${action.style === "danger" ? " answer__button--danger" : ""}`;

  return {
    status: input.noteError === undefined ? 200 : 422,
    html: documentOf(
      `${action.label} — Ouroboros`,
      [
        cardHtml(input.card),
        `<p class="answer__consequence">${escapeHtml(action.consequence)}</p>`,
        `<form method="post" action="${escapeHtml(input.formAction)}">`,
        note,
        `<div class="answer__actions"><button class="${button}" type="submit">${escapeHtml(action.label)}</button></div>`,
        "</form>",
        '<p class="answer__fine">Opening this page changed nothing. The link works once, only for you.</p>',
      ].join(""),
    ),
  };
}

/**
 * The page a merge-class link shows without a session: the card, and a sign-in that returns here.
 *
 * @param input - The card, the action and the sign-in link.
 * @param input.card - The decision.
 * @param input.action - What the button would do.
 * @param input.signInUrl - The UI's sign-in page, returning to this link.
 * @param input.refused - True when a POST arrived without a session (`401`), false for the GET.
 * @returns The page.
 */
export function signInPage(input: {
  readonly card: AnswerCard;
  readonly action: AnswerAction;
  readonly signInUrl: string;
  readonly refused: boolean;
}): AnswerPage {
  return {
    status: input.refused ? 401 : 200,
    html: documentOf(
      `Sign in to ${input.action.label} — Ouroboros`,
      [
        cardHtml(input.card),
        `<p class="answer__consequence">${escapeHtml(input.action.consequence)}</p>`,
        `<p><strong>${escapeHtml(input.action.label)}</strong> can merge to a protected branch, so it needs you signed in — a link in a mailbox is not enough.</p>`,
        input.refused
          ? '<p class="answer__status--problem">Nothing was done: you are not signed in.</p>'
          : "",
        `<div class="answer__actions"><a class="answer__button" href="${escapeHtml(input.signInUrl)}">Sign in to confirm</a></div>`,
        '<p class="answer__fine">After signing in you return here and confirm. Nothing happens until you do.</p>',
      ].join(""),
    ),
  };
}

/**
 * The receipt after an answer.
 *
 * @param input - The card, what was pressed, the receipt line, and the inbox link.
 * @param input.card - The decision.
 * @param input.actionLabel - The action.
 * @param input.receipt - What the plane did, in a line.
 * @param input.inboxUrl - The inbox.
 * @returns The page, `200`.
 */
export function receiptPage(input: {
  readonly card: AnswerCard;
  readonly actionLabel: string;
  readonly receipt: string;
  readonly inboxUrl: string;
}): AnswerPage {
  return {
    status: 200,
    html: documentOf(
      `Done — Ouroboros`,
      [
        cardHtml(input.card),
        `<p class="answer__status--ok"><strong>✓ ${escapeHtml(input.actionLabel)}</strong> — ${escapeHtml(input.receipt)}</p>`,
        `<div class="answer__actions"><a class="answer__link" href="${escapeHtml(input.inboxUrl)}">Open the inbox →</a></div>`,
      ].join(""),
    ),
  };
}

/** Each problem's status, heading and sentence. */
const PROBLEMS: Readonly<
  Record<TokenProblem, { status: number; heading: string; sentence: string }>
> = {
  expired: {
    status: 410,
    heading: "This link has expired",
    sentence:
      "Action links only work for a short while, so an old mail cannot act. Answer the decision in Ouroboros instead.",
  },
  used: {
    status: 410,
    heading: "This link was already used",
    sentence: "Each link works once. Your answer was recorded the first time it was pressed.",
  },
  answered: {
    status: 410,
    heading: "This decision was already answered",
    sentence:
      "Someone answered it — in Ouroboros, by mail or on GitHub — so every link for it stopped working.",
  },
  superseded: {
    status: 410,
    heading: "A newer mail replaced this link",
    sentence:
      "Use the link in your most recent mail about this decision, or answer it in Ouroboros.",
  },
  withdrawn: {
    status: 410,
    heading: "This link was withdrawn",
    sentence:
      "It was switched off before anyone used it. Answer the decision in Ouroboros instead.",
  },
  unknown: {
    status: 404,
    heading: "This link is not valid",
    sentence: "It may have been copied incompletely. Nothing was done.",
  },
  wrong_user: {
    status: 403,
    heading: "This link was sent to someone else",
    sentence:
      "Action links work only for the person they were mailed to. You are signed in as somebody else, so nothing was done.",
  },
  not_member: {
    status: 403,
    heading: "You are no longer a member of this workspace",
    sentence: "Nothing was done.",
  },
};

/**
 * A designed refusal — never a generic error.
 *
 * @param problem - Which.
 * @param inboxUrl - The inbox, where the decision can still be answered.
 * @param card - The decision, when the page may show it (never for `unknown`).
 * @returns The page.
 */
export function problemPage(
  problem: TokenProblem,
  inboxUrl: string,
  card?: AnswerCard,
): AnswerPage {
  const { status, heading, sentence } = PROBLEMS[problem];

  return {
    status,
    html: documentOf(
      `${heading} — Ouroboros`,
      [
        `<div class="answer__eyebrow answer__status--problem" data-problem="${problem}">${escapeHtml(heading)}</div>`,
        card === undefined
          ? `<h1 class="answer__title">${escapeHtml(heading)}</h1>`
          : cardHtml(card),
        `<p>${escapeHtml(sentence)}</p>`,
        `<div class="answer__actions"><a class="answer__link" href="${escapeHtml(inboxUrl)}">Open the inbox →</a></div>`,
      ].join(""),
    ),
  };
}

/**
 * The page when the action itself failed — the item stays open.
 *
 * @param input - The card, the plane's sentence and status, and the inbox link.
 * @param input.card - The decision.
 * @param input.message - The plane's sentence.
 * @param input.status - The status it answered with.
 * @param input.inboxUrl - The inbox.
 * @returns The page.
 */
export function failedPage(input: {
  readonly card: AnswerCard;
  readonly message: string;
  readonly status: number;
  readonly inboxUrl: string;
}): AnswerPage {
  return {
    status: input.status,
    html: documentOf(
      "Not done — Ouroboros",
      [
        '<div class="answer__eyebrow answer__status--problem" data-problem="failed">Not done</div>',
        cardHtml(input.card),
        `<p class="answer__status--problem">${escapeHtml(input.message)}</p>`,
        "<p>The decision is still open. This link has been used, so answer it in Ouroboros.</p>",
        `<div class="answer__actions"><a class="answer__link" href="${escapeHtml(input.inboxUrl)}">Open the inbox →</a></div>`,
      ].join(""),
    ),
  };
}
