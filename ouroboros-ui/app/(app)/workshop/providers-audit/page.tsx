import type { Metadata } from "next";

import { requireWorkspace } from "@/app/api/access";
import { AuditStory } from "@/app/workshop/audit-story";

/**
 * The component workshop's credential-trail story
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * The route is thin, in the shape every screen in `(app)` takes — the gate, then a component
 * that draws — and thinner than most, because the story reads nothing itself: the sheet
 * behind the head's action fetches its own rows through a Server Action when somebody opens
 * it (`app/providers/audit-actions.ts` says why it reads then rather than on page load).
 *
 * It lives under `(app)` beside the chrome story and for the same reason: mockup 07's page is
 * AE.1's ([#227](https://github.com/NobuData/ouroboros/issues/227)), it had not landed when
 * this was written, and AD.4's *the sheet renders seeded history in both themes* is a
 * criterion that needs a running surface rather than a snapshot. That page has since arrived
 * and renders `<AuditTrail />` in its own head (`/models/providers`); this route stays as the
 * workshop's isolated mount of the element, the way the chrome story is for the primitives.
 *
 * It is not registered in the sidebar: the sidebar is the module registry (CP.2), and a
 * workshop is not a module.
 *
 * `requireWorkspace()` guards it like any other signed-in screen — and here it is more than a
 * convention, because the trail is organization-scoped and a session acting in no workspace
 * would open the sheet onto a `400`.
 *
 * @returns The story, inside the shell's content pane.
 */
export default async function Page() {
  await requireWorkspace();

  return <AuditStory />;
}

export const metadata: Metadata = {
  title: "Workshop · Credential audit log · Ouroboros",
};
