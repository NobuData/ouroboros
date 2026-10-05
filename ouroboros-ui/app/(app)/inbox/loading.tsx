import { InboxSkeleton } from "@/app/inbox/inbox-skeleton";

/**
 * The `/inbox` loading state (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470)).
 *
 * Beside the page, because `inbox/` is a leaf segment: a `loading.tsx` wraps its segment's page
 * and every child segment, and this one has none. The route reads five things before its first
 * paint; until they land, the shell is painted and only the page waits.
 *
 * @returns The skeleton, which `app/inbox/inbox-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <InboxSkeleton />;
}
