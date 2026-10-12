"use client";

import { useParams } from "next/navigation";

import { CopilotSkeleton } from "@/app/workflows/copilot/copilot-skeleton";

/**
 * The copilot's loading state (CE.1, [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * Its own file for the reason the code view's has one
 * ([`../code/loading.tsx`](../code/loading.tsx)): the section's skeleton is the visual editor's
 * geometry — a canvas and an inspector — and this surface has neither, so without this one a
 * press on **Copilot** would flash a canvas the page never draws, under a head that is not this
 * page's.
 *
 * A Client Component for the same one reason: a `loading.tsx` is handed no `params`, and the
 * skeleton's tab row links to *this* workflow's three surfaces. `useParams` is how a fallback
 * learns which workflow that is.
 *
 * @returns The skeleton, which `app/workflows/copilot/copilot-skeleton.tsx` draws and its test
 *   covers.
 */
export default function Loading() {
  const { slug } = useParams<{ slug?: string | string[] }>();

  return <CopilotSkeleton slug={typeof slug === "string" ? slug : null} />;
}
