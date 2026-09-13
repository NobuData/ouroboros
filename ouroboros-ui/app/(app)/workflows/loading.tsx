import { StudioSkeleton } from "@/app/workflows/studio-skeleton";

/**
 * The studio's loading state (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * Placed at the section's root rather than in a route group, unlike the routing page's:
 * a `loading.tsx` wraps its segment's page **and every child segment**, and here that is the
 * property wanted — `/workflows` and `/workflows/[slug]` are one screen opened two ways, with
 * one geometry, so one skeleton stands in for both at the right shape. The day the code view
 * (V.1, #169) arrives under `/workflows/[slug]/code` with a shape of its own, it brings its own
 * `loading.tsx`, which is what a nested one is for.
 *
 * @returns The skeleton, which `app/workflows/studio-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <StudioSkeleton />;
}
