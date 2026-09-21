import { FarmSkeleton } from "@/app/farm/farm-skeleton";

/**
 * The build farm's loading state (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * Beside the page, because `build-farm/` is a leaf segment: a `loading.tsx` wraps its segment's
 * page and every child segment, and this one has none. Next.js makes it the fallback of a
 * Suspense boundary around the page, so the shell, the sidebar and the page's own frame are
 * painted at once and only the cards wait for `readFarm`.
 *
 * @returns The skeleton, which `app/farm/farm-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <FarmSkeleton />;
}
