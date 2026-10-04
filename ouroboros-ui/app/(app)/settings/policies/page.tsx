import { redirect } from "next/navigation";

import { POLICIES_PATH } from "@/app/paths";

/**
 * `/settings/policies` — the address the dry-run policy had before the hub, redirecting to the
 * hub's Policies section (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The policy's page was *Settings → Policies* (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)); its row is mounted in the hub's
 * section now, at `/settings#policies`. The old address is kept rather than left to `404`
 * because it is in circulation: `ouroboros-rest` names it in what it tells the onboarding
 * wizard, and so does every bookmark and pasted link made before today.
 *
 * No gate here: the destination gates. `redirect` signals by throwing, so nothing after it runs
 * and there is nothing to render.
 *
 * @returns Never — the redirect throws.
 */
export default function Page(): never {
  redirect(POLICIES_PATH);
}
