import "server-only";

/**
 * The origin filter a server render reads (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)):
 * the address's `?origin=`, else the reader's remembered choice, else live — `parseOrigin`'s rule,
 * with the cookie read from the request.
 */

import { cookies } from "next/headers";

import { ORIGIN_COOKIE, type OriginFilter, parseOrigin } from "./origin";

/**
 * The origin filter for this request.
 *
 * @param param The page's `?origin=` search param, or a route handler's query value.
 * @returns The filter.
 */
export async function readOriginFilter(
  param: string | readonly string[] | null | undefined,
): Promise<OriginFilter> {
  return parseOrigin(param, (await cookies()).get(ORIGIN_COOKIE)?.value);
}
