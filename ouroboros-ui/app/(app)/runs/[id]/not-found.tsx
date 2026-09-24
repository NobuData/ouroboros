import { RunMissing } from "@/app/runs/run-missing";

/**
 * What `/runs/:id` renders when the page's `notFound()` fires — a run this workspace cannot see
 * ([#314](https://github.com/NobuData/ouroboros/issues/314)).
 *
 * @returns The page.
 */
export default function NotFound() {
  return <RunMissing />;
}
