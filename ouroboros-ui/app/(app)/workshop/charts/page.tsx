import type { Metadata } from "next";

import { requireWorkspace } from "@/app/api/access";
import { ChartsStory } from "@/app/workshop/charts-story";

/**
 * The component workshop's chart primitives story
 * ([#442](https://github.com/NobuData/ouroboros/issues/442)).
 *
 * Thin, in the shape of `app/(app)/workshop/chrome/page.tsx` and for its reasons: the gate,
 * then a component that draws a compiled-in fixture. It is the page the chart screenshot
 * suite photographs, and it is not registered in the sidebar — a workshop is not a module.
 *
 * @returns The story, inside the shell's content pane.
 */
export default async function Page() {
  await requireWorkspace();

  return <ChartsStory />;
}

export const metadata: Metadata = {
  title: "Workshop · Chart primitives · Ouroboros",
};
