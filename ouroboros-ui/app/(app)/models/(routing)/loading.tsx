import { ModelsSkeleton } from "@/app/models/models-skeleton";

/**
 * The routing page's loading state (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)).
 *
 * This file is in a route group rather than beside `app/(app)/models/`'s other pages for a
 * reason the framework's own docs give: a `loading.tsx` wraps its segment's page **and every
 * child segment**, so one placed at `models/` would stand in for `/models/providers` and
 * `/models/registry` too — a routing matrix's skeleton over a page of provider cards, which
 * is a skeleton that moves the page by exactly what it promised not to. The `(routing)`
 * group changes no URL and scopes the fallback to the one page whose shape this is.
 *
 * @returns The skeleton, which `app/models/models-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <ModelsSkeleton />;
}
