"use server";

/**
 * The Autonomy policies card's calls, as Server Actions
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * Four of them — the preview and the publish that make up a save, the history the version tag
 * opens, and the glob editor's match preview. Each answers a value rather than throwing, so the
 * card can say what happened in its own words; anything that is not the service refusing (a
 * redirect to sign in) keeps travelling.
 *
 * **The role gates are the service's.** A Server Action is a POST anybody can reach: preview,
 * publish and the path preview are `owner`/`admin` there, and a loosening is the owner's alone.
 */

import { type ApiError, isApiError } from "@/app/api/errors";
import { orgPolicy } from "@/app/api/org-policy";
import type { GlobPreview } from "@/app/globs/glob";

import {
  HISTORY_FAILED,
  type HistoryResult,
  NOTHING_TO_PUBLISH,
  PREVIEW_FAILED,
  PUBLISH_CODES,
  PUBLISH_FAILED,
  PUBLISH_NEEDS_OWNER,
  type PreviewResult,
  type PublishResult,
  versionConflict,
} from "./card-view";
import type { PolicyDocument } from "./document";

/**
 * What the service said, or a fallback when it said nothing.
 *
 * @param error The refusal.
 * @param fallback The sentence for a refusal with no message.
 * @returns The sentence.
 */
function said(error: ApiError, fallback: string): string {
  return error.message === "" ? fallback : error.message;
}

/**
 * What publishing a draft would do.
 *
 * @param document The draft document.
 * @returns The preview, or why there is none.
 */
export async function previewPolicy(document: PolicyDocument): Promise<PreviewResult> {
  try {
    return { ok: true, preview: await orgPolicy.preview(document) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: said(error, PREVIEW_FAILED) };
  }
}

/**
 * Publish the next version.
 *
 * @param document The document.
 * @param baseVersion The version the edit began from, or `null` when nothing was published.
 * @param changeNote Why, or `null`.
 * @returns The version published with its audit line, or why nothing was.
 */
export async function publishPolicy(
  document: PolicyDocument,
  baseVersion: number | null,
  changeNote: string | null,
): Promise<PublishResult> {
  try {
    const published = await orgPolicy.publish({ document, baseVersion, changeNote });

    return { ok: true, version: published.version, summary: published.summary };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === PUBLISH_CODES.conflict) {
      const current = (error.details as { currentVersion?: unknown } | undefined)?.currentVersion;

      return { ok: false, reason: versionConflict(typeof current === "number" ? current : null) };
    }
    if (error.code === PUBLISH_CODES.unchanged) return { ok: false, reason: NOTHING_TO_PUBLISH };
    if (error.code === PUBLISH_CODES.ownerRequired) return { ok: false, reason: PUBLISH_NEEDS_OWNER };

    return { ok: false, reason: said(error, PUBLISH_FAILED) };
  }
}

/**
 * A page of the policy's history.
 *
 * @param before Read versions older than this one.
 * @returns The page, or why it could not be read.
 */
export async function loadPolicyHistory(before?: number): Promise<HistoryResult> {
  try {
    return { ok: true, page: await orgPolicy.versions(before) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: said(error, HISTORY_FAILED) };
  }
}

/** What the match preview says when the service gave no reason. */
const PATH_PREVIEW_FAILED = "The match preview could not be read. The patterns themselves are unaffected.";

/**
 * What a list of globs matches in each enabled repository.
 *
 * @param globs The globs.
 * @returns The preview, or why there is none.
 */
export async function previewPolicyPaths(globs: readonly string[]): Promise<GlobPreview> {
  try {
    return { ok: true, repositories: (await orgPolicy.pathPreview(globs)).repositories };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: said(error, PATH_PREVIEW_FAILED) };
  }
}
