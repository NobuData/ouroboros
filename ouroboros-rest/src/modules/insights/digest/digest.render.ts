/**
 * An assembly as a mail: subject, HTML part, text part (#440).
 *
 * The one call both the weekly run and the preview route make, so what the subscribe sheet
 * previews is rendered by the code that will send it.
 */

import type { DigestAssembly } from "./digest.assembly";
import { digestSubject, type DigestContext } from "./digest.copy";
import { renderDigestHtml } from "./digest.html";
import { renderDigestText } from "./digest.text";

/** A rendered digest. */
export interface RenderedDigest {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Render a digest for one reader.
 *
 * @param assembly - The content.
 * @param context - The workspace, the page link, and the reader's unsubscribe link.
 * @returns The three parts of the mail.
 */
export function renderDigest(assembly: DigestAssembly, context: DigestContext): RenderedDigest {
  return {
    subject: digestSubject(assembly, context.workspaceName),
    html: renderDigestHtml(assembly, context),
    text: renderDigestText(assembly, context),
  };
}

/**
 * Where a digest's *Open Insights* leads.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @returns The Insights page, on the digest's own range.
 */
export function insightsUrl(uiUrl: string): string {
  return `${uiUrl.replace(/\/+$/, "")}/insights?range=7d`;
}

/** The path of the public unsubscribe route, under the API prefix. */
export const UNSUBSCRIBE_ROUTE = "insights/digest/unsubscribe";

/**
 * A recipient's unsubscribe link.
 *
 * @param restUrl - `OURO_REST_URL`: the origin this API is reached at.
 * @param token - The send's token.
 * @returns The link the mail carries.
 */
export function unsubscribeUrl(restUrl: string, token: string): string {
  return `${restUrl.replace(/\/+$/, "")}/api/v1/${UNSUBSCRIBE_ROUTE}/${token}`;
}
