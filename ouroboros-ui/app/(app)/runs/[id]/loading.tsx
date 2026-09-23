import { RunSkeleton } from "@/app/runs/run-skeleton";

/**
 * What the run console shows while its first read is in flight.
 *
 * @returns The skeleton.
 */
export default function Loading() {
  return <RunSkeleton />;
}
