"use client";

import { useParams } from "next/navigation";

import { CodeSkeleton } from "@/app/workflows/code/code-skeleton";

/**
 * The code view's loading state (V.1, [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * Its own file, as `app/(app)/workflows/loading.tsx` anticipated: that skeleton is the visual
 * editor's geometry — a rail beside a canvas — and the code view has neither, so without this
 * one a press on **Code** would flash a rail the page never draws.
 *
 * A Client Component for one reason: a `loading.tsx` is handed no `params`, and the skeleton's
 * tab row links to *this* workflow's two surfaces — **Code** marked current on the file being
 * opened, **Visual** leading back to its canvas. `useParams` is how a fallback learns which
 * workflow that is.
 *
 * @returns The skeleton, which `app/workflows/code/code-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  const { slug } = useParams<{ slug?: string | string[] }>();

  return <CodeSkeleton slug={typeof slug === "string" ? slug : null} />;
}
