import { KnowledgeSkeleton } from "@/app/knowledge/knowledge-skeleton";

/**
 * The knowledge route's loading state ([#417](https://github.com/NobuData/ouroboros/issues/417)):
 * Next.js wraps the segment in a Suspense boundary with this as the fallback, so the shell and the
 * page head paint at once and only the regions wait.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return <KnowledgeSkeleton />;
}
