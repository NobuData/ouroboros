import { GetStartedSkeleton } from "@/app/get-started/get-started-skeleton";

/**
 * `/get-started`'s loading state (BC.6, [#395](https://github.com/NobuData/ouroboros/issues/395)).
 *
 * Beside the page, because `get-started/` is a leaf segment of the standalone route group: a
 * `loading.tsx` wraps its segment's page and every child segment, and this one has none.
 *
 * @returns The skeleton, which `app/get-started/get-started-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <GetStartedSkeleton />;
}
