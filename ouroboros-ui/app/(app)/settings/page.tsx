import { redirect } from "next/navigation";

import { SOURCES_PATH } from "@/app/paths";

/**
 * `/settings` — the administration hub's address, redirecting to the section's one built tab.
 *
 * Mockup 17's workspace settings — the frame, the six sections, the save model — are BS.1's
 * ([#491](https://github.com/NobuData/ouroboros/issues/491)). Until it lands, the settings
 * section has exactly one surface, Ticket sources
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)), and this route sends a visitor
 * there rather than answering a `404` under a sidebar entry that is now live. A redirect
 * rather than a placeholder page, because a settings entry that leads to a working surface is
 * more honest than one that leads to *soon* — and because #491 replaces this file with the
 * hub, which is one file rather than a placeholder to retire *and* a redirect to remove.
 *
 * No gate here: the destination gates. `redirect` signals by throwing, so nothing after it
 * runs and there is nothing to render.
 *
 * @returns Never — the redirect throws.
 */
export default function Page(): never {
  redirect(SOURCES_PATH);
}
