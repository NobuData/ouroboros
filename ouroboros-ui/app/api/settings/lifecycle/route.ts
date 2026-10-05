/**
 * `GET /api/settings/lifecycle` — where the workspace stands, on this origin
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * What the shell's lifecycle poll reads to draw — and clear — the app-wide paused banner. The
 * browser cannot reach `ouroboros-rest`, so this asks over the visitor's session
 * (`app/api/settings-lifecycle-poll.ts`). A workspace pending deletion answers `pending_delete`
 * whoever asks, which is what sends the browser to the recovery screen.
 */

import { pollResponse } from "@/app/api/poll-response";
import {
  LIFECYCLE_UNAVAILABLE_CODE,
  readLifecyclePoll,
} from "@/app/api/settings-lifecycle-poll";

/**
 * Answer one poll.
 *
 * @returns The lifecycle, or the refusal.
 */
export async function GET(): Promise<Response> {
  return pollResponse(await readLifecyclePoll(), LIFECYCLE_UNAVAILABLE_CODE);
}
