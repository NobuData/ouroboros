/**
 * The pages an unsubscribe link opens (#440).
 *
 * They are served by this API, to somebody with no session, from a link in a mail — so they are
 * self-contained documents: inline style, no script, no asset, nothing to fetch. The confirm
 * page's one control is a form that posts back to the same address.
 */

import { escapeHtml } from "../../mail/html";
import { DIGEST_PALETTE as P } from "./digest.html";

/** A page and the status it is answered with. */
export interface DigestPage {
  readonly status: 200 | 404;
  /** A complete HTML document. */
  readonly html: string;
}

/**
 * The frame every page shares.
 *
 * @param title - The document title and heading.
 * @param body - The content under the heading, already HTML.
 * @returns A complete document.
 */
function page(title: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:48px 16px;background-color:${P.ground};color:${P.ink};font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:440px;margin:0 auto;padding:28px 32px;background-color:${P.surface};border:1px solid ${P.line};border-radius:8px;">` +
    `<h1 style="margin:0 0 12px 0;font-size:20px;line-height:28px;">${escapeHtml(title)}</h1>` +
    `${body}</div></body></html>`
  );
}

/**
 * A paragraph.
 *
 * @param text - The text, unescaped.
 * @returns The block.
 */
function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;color:${P.inkDim};">${escapeHtml(text)}</p>`;
}

/**
 * The page a link opens: one button, which is the unsubscribe.
 *
 * Opening the link changes nothing. Mail scanners and link previewers open every link in a
 * message; an unsubscribe that happened on `GET` would unsubscribe people who never clicked.
 *
 * @param workspaceName - The workspace whose digest the link is for.
 * @returns The page.
 */
export function confirmPage(workspaceName: string): DigestPage {
  return {
    status: 200,
    html: page(
      "Unsubscribe from the weekly digest?",
      paragraph(`You will stop receiving the weekly Insights digest for ${workspaceName}.`) +
        `<form method="post">` +
        `<button type="submit" style="padding:10px 18px;border:0;border-radius:6px;background-color:${P.accent};color:${P.accentInk};font-size:14px;font-weight:600;cursor:pointer;">Unsubscribe</button>` +
        `</form>`,
    ),
  };
}

/**
 * The page after unsubscribing — also what a second click sees, since the result is the same.
 *
 * @param workspaceName - The workspace.
 * @returns The page.
 */
export function unsubscribedPage(workspaceName: string): DigestPage {
  return {
    status: 200,
    html: page(
      "You are unsubscribed",
      paragraph(`You will no longer receive the weekly Insights digest for ${workspaceName}.`) +
        paragraph("You can subscribe again from the Insights page at any time."),
    ),
  };
}

/**
 * The page for a link that names no send — mistyped, truncated, or from a workspace that is gone.
 *
 * @returns The page, as a `404`.
 */
export function invalidLinkPage(): DigestPage {
  return {
    status: 404,
    html: page(
      "This link is not valid",
      paragraph(
        "The unsubscribe link is incomplete or no longer exists. Open the link from the most " +
          "recent digest email, or manage the subscription from the Insights page.",
      ),
    ),
  };
}
