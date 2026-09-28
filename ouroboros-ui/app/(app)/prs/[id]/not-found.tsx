import { PrMissing } from "@/app/prs/pr-missing";

/**
 * What `/prs/:id` renders when the page's `notFound()` fires — a PR this workspace cannot see
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * @returns The page.
 */
export default function NotFound() {
  return <PrMissing />;
}
