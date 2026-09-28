import { TestsMissing } from "@/app/test-results/tests-missing";

/**
 * What `/runs/:id/tests` renders when the page's `notFound()` fires — a run this workspace cannot
 * see ([#342](https://github.com/NobuData/ouroboros/issues/342)).
 *
 * @returns The page.
 */
export default function NotFound() {
  return <TestsMissing />;
}
