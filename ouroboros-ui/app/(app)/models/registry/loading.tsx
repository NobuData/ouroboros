import { RegistrySkeleton } from "@/app/registry/registry-skeleton";

/**
 * The registry page's loading state (CI.6,
 * [#596](https://github.com/NobuData/ouroboros/issues/596)).
 *
 * Beside the page rather than in a route group, because `registry/` is a leaf segment: a
 * `loading.tsx` wraps its segment's page and every child segment, and this one has none — the
 * same reasoning `app/(app)/models/providers/loading.tsx` gives.
 *
 * @returns The skeleton, which `app/registry/registry-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <RegistrySkeleton />;
}
