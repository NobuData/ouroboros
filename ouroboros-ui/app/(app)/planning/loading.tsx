import { PlanningSkeleton } from "@/app/planning/planning-skeleton";

/**
 * The planning page's loading state (AM.5, [#287](https://github.com/NobuData/ouroboros/issues/287)).
 *
 * Beside the page, because `planning/` is a leaf segment: a `loading.tsx` wraps its segment's page
 * and every child segment, and this one has none.
 *
 * @returns The skeleton, which `app/planning/planning-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <PlanningSkeleton />;
}
