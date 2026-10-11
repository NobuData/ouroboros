"use server";

/**
 * What the Research side column asks the service to do (CN.3,
 * [#629](https://github.com/NobuData/ouroboros/issues/629)): store a tool's settings, dismiss a
 * watch item, capture a release's baselines. Each answers an outcome rather than throwing — a
 * refusal is something a dialog prints, in the service's own words.
 */

import { isApiError } from "@/app/api/errors";
import {
  type RegressionBaselinesCaptured,
  type ResearchToolCatalogEntry,
  type ResearchToolConfigSubmission,
  research,
} from "@/app/api/research";

import type { SideRefusal } from "./side";

/** What an action answers: the value, or the service's refusal. */
export type SideOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: SideRefusal };

/**
 * Run a write, turning the service's refusal into an outcome.
 *
 * @param write The call.
 * @returns The outcome. Anything that was not an answer from the service is rethrown.
 */
async function outcomeOf<T>(write: () => Promise<T>): Promise<SideOutcome<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: { code: error.code, message: error.message, details: error.details } };
  }
}

/**
 * Store the workspace's settings for a tool.
 *
 * @param slug The tool.
 * @param config The enable form as submitted.
 * @returns The tool's row as it now reads, or the refusal.
 */
export async function enableTool(
  slug: string,
  config: ResearchToolConfigSubmission,
): Promise<SideOutcome<ResearchToolCatalogEntry>> {
  return outcomeOf(() => research.enableTool(slug, config));
}

/**
 * Dismiss a watch item.
 *
 * @param itemId The item.
 * @param reason Why — written to the audit log.
 * @returns The dismissed item's id, or the refusal.
 */
export async function dismissWatchItem(itemId: string, reason: string): Promise<SideOutcome<string>> {
  return outcomeOf(async () => (await research.dismissWatchItem(itemId, reason)).id);
}

/**
 * Capture a release's baselines.
 *
 * @param repository The repository, `owner/name`.
 * @param releaseTag The release tag.
 * @returns What was captured and skipped, or the refusal.
 */
export async function captureBaselines(
  repository: string,
  releaseTag: string,
): Promise<SideOutcome<RegressionBaselinesCaptured>> {
  return outcomeOf(() => research.captureBaselines({ repository, releaseTag }));
}
