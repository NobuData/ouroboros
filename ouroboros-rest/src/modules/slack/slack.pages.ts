/**
 * The linking flow's pages (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — rendered here and reached through
 * the UI origin, as the inbox's answer pages are (`inbox-channels/answer/answer.pages.ts`, whose
 * document shell and classes these reuse).
 *
 * A Slack user id is not a member. The confirmation screen is where a signed-in person sees
 * **which Slack identity is about to be bound to which account**, and binds it by pressing the
 * button — never by opening the link, and never because a profile email happened to match. An
 * email match is shown as a suggestion; it changes one sentence and nothing else.
 *
 * No script, no external resource, every value escaped.
 */

import { documentOf } from "../inbox-channels/answer/answer.pages";
import { escapeHtml } from "../mail/html";

/** A page and the status it is served with. */
export interface SlackLinkPage {
  readonly status: number;
  readonly html: string;
}

/** Why a link cannot be confirmed. */
export type SlackLinkProblem =
  /** No pending handshake holds this token: never issued, replaced by a newer link, or used. */
  | "unknown"
  /** The handshake's fifteen minutes are over. */
  | "expired"
  /** The signed-in person is not a member of the workspace the Slack app is installed in. */
  | "not_member"
  /** Their account already has a Slack identity on this connection. */
  | "member_already_linked"
  /** The connection stopped being active while the link was open. */
  | "not_connected";

/** What the confirmation screen shows. */
export interface SlackLinkSubject {
  /** The Slack workspace's name. */
  readonly slackWorkspace: string;
  /** The Slack user's display name, when Slack gave one. */
  readonly slackName: string | null;
  /** The Slack user's id (`U024AB`) — always shown, because a display name is a label. */
  readonly slackUserId: string;
  /** The workspace in this product the link is for. */
  readonly workspace: string;
  /** The signed-in person's name and email. */
  readonly accountName: string;
  readonly accountEmail: string;
  /** Whether the Slack profile's email equals the account's. An assist only. */
  readonly emailMatches: boolean;
}

/**
 * The Slack identity, as a line.
 *
 * @param subject - What is being linked.
 * @returns `Maya Chen (U024AB) in acme-robotics`, escaped.
 */
function slackIdentity(
  subject: Pick<SlackLinkSubject, "slackName" | "slackUserId" | "slackWorkspace">,
): string {
  const who =
    subject.slackName === null
      ? escapeHtml(subject.slackUserId)
      : `${escapeHtml(subject.slackName)} (${escapeHtml(subject.slackUserId)})`;

  return `<strong>${who}</strong> in the Slack workspace <strong>${escapeHtml(subject.slackWorkspace)}</strong>`;
}

/**
 * The confirmation screen. Opening it changes nothing.
 *
 * @param subject - The Slack identity and the account about to be bound.
 * @returns The page, `200`, with one button that posts back to the same URL.
 */
export function linkConfirmPage(subject: SlackLinkSubject): SlackLinkPage {
  return {
    status: 200,
    html: documentOf(
      "Link your Slack identity — Ouroboros",
      [
        `<div class="answer__eyebrow">${escapeHtml(subject.workspace)} · Slack</div>`,
        '<h1 class="answer__title">Link this Slack identity to your account?</h1>',
        `<p class="answer__why">${slackIdentity(subject)} will act as <strong>${escapeHtml(subject.accountName)}</strong> (${escapeHtml(subject.accountEmail)}).</p>`,
        '<p class="answer__consequence">Buttons pressed and commands typed in Slack by that identity will carry your permissions and appear in the audit log under your name.</p>',
        subject.emailMatches
          ? '<p class="answer__status--ok">The email on this Slack profile matches your account. That is a suggestion, not proof — confirm only if this is you.</p>'
          : '<p class="answer__fine">The email on this Slack profile does not match your account, or Slack did not share one. Confirm only if this Slack identity is yours.</p>',
        '<form method="post"><div class="answer__actions"><button class="answer__button" type="submit">Link this Slack identity</button></div></form>',
        '<p class="answer__fine">This link works once and expires fifteen minutes after it was sent. Nothing is linked until you press the button.</p>',
      ].join(""),
    ),
  };
}

/**
 * The page a link shows to somebody who is not signed in.
 *
 * @param input - The Slack identity, the sign-in link, and whether a POST was refused.
 * @returns The page — `401` for a refused POST, `200` for the GET.
 */
export function linkSignInPage(input: {
  readonly subject: Pick<SlackLinkSubject, "slackName" | "slackUserId" | "slackWorkspace">;
  readonly signInUrl: string;
  readonly refused: boolean;
}): SlackLinkPage {
  return {
    status: input.refused ? 401 : 200,
    html: documentOf(
      "Sign in to link your Slack identity — Ouroboros",
      [
        '<div class="answer__eyebrow">Slack</div>',
        '<h1 class="answer__title">Sign in to link your Slack identity</h1>',
        `<p class="answer__why">This link is for ${slackIdentity(input.subject)}. Linking it needs you signed in — a link in a Slack message is not enough.</p>`,
        input.refused
          ? '<p class="answer__status--problem">Nothing was linked: you are not signed in.</p>'
          : "",
        `<div class="answer__actions"><a class="answer__button" href="${escapeHtml(input.signInUrl)}">Sign in to continue</a></div>`,
        '<p class="answer__fine">After signing in you return here and confirm. Nothing happens until you do.</p>',
      ].join(""),
    ),
  };
}

/**
 * The receipt after a link.
 *
 * @param subject - What was linked.
 * @returns The page, `200`.
 */
export function linkedPage(subject: SlackLinkSubject): SlackLinkPage {
  return {
    status: 200,
    html: documentOf(
      "Slack identity linked — Ouroboros",
      [
        `<div class="answer__eyebrow">${escapeHtml(subject.workspace)} · Slack</div>`,
        '<h1 class="answer__title answer__status--ok">Your Slack identity is linked</h1>',
        `<p class="answer__why">${slackIdentity(subject)} now acts as <strong>${escapeHtml(subject.accountName)}</strong>.</p>`,
        '<p class="answer__fine">You can go back to Slack. To undo this, type <code>/ouro unlink</code> there.</p>',
      ].join(""),
    ),
  };
}

/** Each problem's status, heading and explanation. */
const PROBLEMS: Readonly<
  Record<SlackLinkProblem, { status: number; title: string; body: string }>
> = {
  unknown: {
    status: 404,
    title: "This link is not valid",
    body: "It was already used, was replaced by a newer link, or never existed. Type /ouro link in Slack for a new one.",
  },
  expired: {
    status: 410,
    title: "This link has expired",
    body: "Links work for fifteen minutes. Type /ouro link in Slack for a new one.",
  },
  not_member: {
    status: 403,
    title: "You are not a member of that workspace",
    body: "The Slack app is installed for a workspace your account does not belong to, so there is nothing to link. Sign in with the account that is a member, or ask an owner to invite you.",
  },
  member_already_linked: {
    status: 409,
    title: "Your account already has a Slack identity",
    body: "One account links to one Slack identity per Slack workspace. Type /ouro unlink from the identity that is linked now, then /ouro link from this one.",
  },
  not_connected: {
    status: 409,
    title: "Slack is no longer connected",
    body: "The Slack app was removed from that Slack workspace, or its access was revoked, so nothing can be linked. An owner or admin can connect Slack again in Settings.",
  },
};

/**
 * A designed refusal. Nothing was linked.
 *
 * @param problem - Why.
 * @returns The page, with the problem's status.
 */
export function linkProblemPage(problem: SlackLinkProblem): SlackLinkPage {
  const { status, title, body } = PROBLEMS[problem];

  return {
    status,
    html: documentOf(
      `${title} — Ouroboros`,
      [
        '<div class="answer__eyebrow">Slack</div>',
        `<h1 class="answer__title answer__status--problem">${escapeHtml(title)}</h1>`,
        `<p class="answer__why">${escapeHtml(body)}</p>`,
        '<p class="answer__fine">Nothing was linked.</p>',
      ].join(""),
    ),
  };
}
