"use server";

/**
 * The server hop for the review thread's *Reply & resolve*
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)).
 *
 * `head-actions.ts` states the rule this exists under, and it holds here unchanged:
 *
 * - **The role gate is the service's.** Resolving is `owner`, `admin` or `member`; the page draws
 *   no control a reader may not use, and one who calls this anyway gets the service's `403`.
 * - **Whether an entry can be resolved is the service's.** The page offers it on an open entry
 *   that is not the policy bot's; the service refuses one already resolved
 *   (`409 pr_thread_entry_resolved`) regardless.
 * - **Nothing here can author an entry.** Only a reply and a flag are sent — no author, no kind,
 *   no watermark — so this hop cannot put words in a reviewer's mouth.
 * - **Ids and the reply are checked before they are sent.**
 *
 * A refusal is a value, because the page is one the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { isPullRequestId, pullRequests } from "@/app/api/pull-requests";

import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  MAX_THREAD_REPLY_LENGTH,
  type ActionRefusal,
  type ThreadResolveOutcome,
  type ThreadResolveRequest,
} from "./outcomes";

/** The refusal for a request that could not have come from the page. */
const INVALID: ActionRefusal = {
  ok: false,
  status: 422,
  code: ACTION_INVALID_CODE,
  reason: ACTION_INVALID,
};

/**
 * What a request carries, rebuilt from only the fields it has.
 *
 * @param request What arrived.
 * @returns The reply and the flag, each checked — or `null` for anything the dialog could not
 *   have built: a reply that is empty, padded or too long, or a mirror with nothing to post.
 */
function resolutionOf(request: unknown): ThreadResolveRequest | null {
  if (typeof request !== "object" || request === null) return null;

  const { reply, mirror } = request as Partial<ThreadResolveRequest>;

  if (typeof mirror !== "boolean") return null;
  if (reply === undefined) return mirror ? null : { mirror };

  return typeof reply === "string" &&
    reply.length > 0 &&
    reply.length <= MAX_THREAD_REPLY_LENGTH &&
    reply.trim() === reply
    ? { reply, mirror }
    : null;
}

/**
 * Resolve an entry of a PR's review thread.
 *
 * @param prId The PR.
 * @param entryId The entry.
 * @param request The reply, and whether to mirror it to the host PR.
 * @returns The entry, resolved, and what the host did with the mirror — or the reason nothing
 *   was resolved.
 * @throws Whatever is not an `ApiError` or a dropped connection — Next.js's redirect signal for an
 *   ended session above all.
 */
export async function resolveEntry(
  prId: string,
  entryId: string,
  request: ThreadResolveRequest,
): Promise<ThreadResolveOutcome> {
  const resolution = resolutionOf(request);

  if (!isPullRequestId(prId) || !isPullRequestId(entryId) || resolution === null) {
    return INVALID;
  }

  try {
    return {
      ok: true,
      answer: await pullRequests.resolveThreadEntry(prId, entryId, resolution),
    };
  } catch (error) {
    if (isApiError(error)) {
      return { ok: false, status: error.status, code: error.code, reason: error.message };
    }

    if (error instanceof TypeError) {
      return {
        ok: false,
        status: 502,
        code: ACTION_UNREACHABLE_CODE,
        reason: ACTION_UNREACHABLE,
      };
    }

    throw error;
  }
}
