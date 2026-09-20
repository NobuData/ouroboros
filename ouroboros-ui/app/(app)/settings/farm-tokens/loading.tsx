import { FarmTokensSkeleton } from "@/app/farm/farm-tokens-skeleton";

/**
 * The farm tokens page's loading state (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * Beside the page, because `farm-tokens/` is a leaf segment: a `loading.tsx` wraps its segment's
 * page and every child segment, and this one has none.
 *
 * @returns The skeleton, which `app/farm/farm-tokens-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <FarmTokensSkeleton />;
}
