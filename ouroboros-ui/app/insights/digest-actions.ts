"use server";

/**
 * The server hop for the weekly-digest sheet (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * `app/insights/intervention-actions.ts` states the rule this exists under: the browser cannot
 * reach REST, so the sheet's Client Component calls these Server Actions, which call it.
 *
 * - **There is no person in the call.** A subscription is always the caller's own: the service
 *   resolves the person and the workspace from the cookie this request carries, so nobody can opt
 *   someone else in or out from here.
 * - **A refusal is a value, not a throw** — the sheet draws it and the page is untouched. The one
 *   throw that travels is Next.js's redirect signal, for an expired session.
 * - **The digest and its preview are read independently**, so a preview that cannot render still
 *   leaves the toggle working, and a failure here degrades the sheet rather than the page.
 */

import { isApiError } from "@/app/api/errors";
import { type InsightsDigest, type InsightsDigestPreview, insights } from "@/app/api/insights";
import { type Reading, attempt } from "@/app/api/reading";

import { MAIL_UNCONFIGURED, SUBSCRIBE_FAILED } from "./digest-view";

/** What the sheet opens on: the digest and its preview, each read or explained. */
export interface DigestSheetReadings {
  readonly digest: Reading<InsightsDigest>;
  readonly preview: Reading<InsightsDigestPreview>;
}

/** A subscription change: the digest as it now stands, or why not as a sentence. */
export type DigestOutcome =
  | { readonly ok: true; readonly value: InsightsDigest }
  | { readonly ok: false; readonly reason: string };

/** The service's codes, and the sentence each becomes. */
const SUBSCRIBE_REFUSALS: Readonly<Record<string, string>> = {
  insights_digest_mail_unconfigured: MAIL_UNCONFIGURED,
};

/**
 * Read the caller's digest and its preview, together.
 *
 * @returns Both, each read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readDigestSheet(): Promise<DigestSheetReadings> {
  const [digest, preview] = await Promise.all([
    attempt(() => insights.digest()),
    attempt(() => insights.digestPreview()),
  ]);

  return { digest, preview };
}

/**
 * Opt the caller in to, or out of, the weekly digest.
 *
 * @param subscribed True to receive it, false to stop. Anything else is refused without a call.
 * @returns The digest as it now stands, or why not.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function setDigestSubscription(subscribed: boolean): Promise<DigestOutcome> {
  if (typeof subscribed !== "boolean") return { ok: false, reason: SUBSCRIBE_FAILED };

  try {
    return { ok: true, value: await insights.subscribeDigest(subscribed) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: SUBSCRIBE_REFUSALS[error.code] ?? SUBSCRIBE_FAILED };
  }
}
