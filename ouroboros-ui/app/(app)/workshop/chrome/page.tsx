import type { Metadata } from "next";

import { requireWorkspace } from "@/app/api/access";
import { ChromeStory } from "@/app/workshop/chrome-story";

/**
 * The component workshop's in-pane chrome story
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)).
 *
 * The route is thin, in the shape every screen in `(app)` takes — the gate, then a
 * component that draws — and thinner than most, because a workshop story has nothing to
 * read: the fixture is the point, and it is compiled into
 * [`app/workshop/chrome-story.tsx`](../../../workshop/chrome-story.tsx).
 *
 * It lives under `(app)` rather than behind a dev-only flag because its audience is not
 * only developers of the primitives: it is the reference every subnav-owning roadmap is
 * pointed at, the long fixture the shell's e2e leg drives, and — being the product's
 * second in-shell route — the first page back/forward restoration can actually be
 * demonstrated against. It is not registered in the sidebar: the sidebar is the module
 * registry (CP.2), and a workshop is not a module.
 *
 * `requireWorkspace()` guards it like any other signed-in screen — the workshop renders
 * inside the shell, and the shell assumes a session (the reason
 * `app/(app)/dashboard/page.tsx` gives at length).
 *
 * @returns The story, inside the shell's content pane.
 */
export default async function Page() {
  await requireWorkspace();

  return <ChromeStory />;
}

export const metadata: Metadata = {
  title: "Workshop · In-pane chrome · Ouroboros",
};
