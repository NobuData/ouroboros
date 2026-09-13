import { SourcesSkeleton } from "@/app/sources/sources-skeleton";

/**
 * The sources page's loading state ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Beside the page, because `sources/` is a leaf segment: a `loading.tsx` wraps its segment's
 * page and every child segment, and this one has none.
 *
 * @returns The skeleton, which `app/sources/sources-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <SourcesSkeleton />;
}
