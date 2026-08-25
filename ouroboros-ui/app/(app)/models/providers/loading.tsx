import { ProvidersSkeleton } from "@/app/providers/providers-skeleton";

/**
 * The providers page's loading state (AE.6,
 * [#232](https://github.com/NobuData/ouroboros/issues/232)).
 *
 * Beside the page rather than in a route group, because `providers/` is a leaf segment: a
 * `loading.tsx` wraps its segment's page and every child segment, and this one has none —
 * so, unlike the routing page's (`app/(app)/models/(routing)/loading.tsx`), there is nothing
 * for it to stand in for at the wrong geometry.
 *
 * @returns The skeleton, which `app/providers/providers-skeleton.tsx` draws and its test
 *   covers.
 */
export default function Loading() {
  return <ProvidersSkeleton />;
}
