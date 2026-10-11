import { ResearchSkeleton } from "@/app/research/research-skeleton";

/**
 * What the reader sees while `/research` makes its reads (CN.7,
 * [#633](https://github.com/NobuData/ouroboros/issues/633)).
 *
 * Next.js wraps the segment in a Suspense boundary with this as the fallback, so the shell, the
 * sidebar and the page's own head paint at once and only the six regions wait. The skeleton is
 * `app/research/research-skeleton.tsx`, beside the screen it stands in for and the stylesheet
 * that gives it the page's geometry.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return <ResearchSkeleton />;
}
