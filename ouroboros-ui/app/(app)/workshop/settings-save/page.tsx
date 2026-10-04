import type { Metadata } from "next";

import { requireWorkspace } from "@/app/api/access";
import { SettingsSaveStory } from "@/app/workshop/settings-save-story";

/**
 * The component workshop's settings save model story (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * Thin, in the shape `app/(app)/workshop/chrome/page.tsx` takes and for its reasons: a workshop
 * story has nothing to read — the fixture is the point, compiled into
 * [`app/workshop/settings-save-story.tsx`](../../../workshop/settings-save-story.tsx) — and it
 * lives under `(app)` rather than behind a dev-only flag because its audience is the five
 * issues that mount cards on the save model (BS.2–BS.6) and the e2e leg that will drive it.
 * It is not registered in the sidebar: a workshop is not a module.
 *
 * `requireWorkspace()` guards it like any other signed-in screen.
 *
 * @returns The story, inside the shell's content pane.
 */
export default async function Page() {
  await requireWorkspace();

  return <SettingsSaveStory />;
}

export const metadata: Metadata = {
  title: "Workshop · Settings save model · Ouroboros",
};
