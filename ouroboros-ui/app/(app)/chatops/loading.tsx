import { ChatOpsSkeleton } from "@/app/chatops/chatops-skeleton";

/**
 * What the reader sees while `/chatops` makes its reads (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)).
 *
 * Next.js wraps the segment in a Suspense boundary with this as the fallback, so the shell and
 * the page's own head paint at once and only the connection's regions wait. The skeleton is
 * `app/chatops/chatops-skeleton.tsx`, beside the screen it stands in for and the stylesheet that
 * gives it the page's geometry.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return <ChatOpsSkeleton />;
}
