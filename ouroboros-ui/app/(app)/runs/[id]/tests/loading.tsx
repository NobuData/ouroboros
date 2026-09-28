import { TestsLoading } from "@/app/test-results/tests-loading";

/**
 * What the test-results page shows while its first read is in flight — its own, rather than the
 * run console's skeleton the parent segment would otherwise lend it.
 *
 * @returns The placeholder.
 */
export default function Loading() {
  return <TestsLoading />;
}
