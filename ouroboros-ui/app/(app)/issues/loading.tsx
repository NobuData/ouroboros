import { IssuesSkeleton } from "@/app/issues/issues-skeleton";

/**
 * What the reader sees while `/issues` reads its four inputs
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * Next.js wraps the segment in a Suspense boundary with this as the fallback, so the shell,
 * the sidebar and the page's own head paint at once and only the backlog waits. The route
 * has no child segments, so the boundary wraps this page alone (the models section's
 * `(routing)` group exists for the opposite case).
 *
 * The skeleton itself is `app/issues/issues-skeleton.tsx`, beside the screen it stands in
 * for and the stylesheet that gives it the page's geometry, so it can be rendered and
 * asserted on without Next.js's routing around it.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return <IssuesSkeleton />;
}
