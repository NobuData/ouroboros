import { PrLoading } from "@/app/prs/pr-loading";

/**
 * What the PR verification page shows while its first read is in flight
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)).
 *
 * @returns The placeholder.
 */
export default function Loading() {
  return <PrLoading />;
}
