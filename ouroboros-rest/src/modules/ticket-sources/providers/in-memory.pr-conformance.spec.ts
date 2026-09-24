import {
  describeTicketSourcePrConformance,
  type TicketSourcePrConformance,
} from "../conformance.pr.fixture";
import { TICKET_SOURCE_ERROR_CLASSES } from "../ticket-source.errors";
import type { TicketSourcePrCapabilities } from "../ticket-source.pr";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
} from "./in-memory.pr.fixture";
import { IN_MEMORY_PROJECT, IN_MEMORY_TOKEN, InMemoryTracker } from "./in-memory.provider.fixture";

/**
 * AX.1's criterion *"the conformance kit is green for … the fake provider"*
 * ([#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * Two declarations run, because two of the SPI's rules are about a configuration rather than a
 * provider:
 *
 *   * **Every feature** — creation, reviews, all three strategies: the shape GitHub declares.
 *   * **A narrower host** — no creation, no reviews, squash only: the proof that `null` is an
 *     answer rather than a crash, and that the strategy gate refuses `merge` and `rebase` before
 *     sending anything.
 */

/** The source every PR operation runs against. */
const CONTEXT = {
  sourceId: "b0570000-0000-4000-8000-000000000357",
  organizationId: "org-pr-conformance",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
} as const;

/**
 * A PR harness over a fresh host.
 *
 * @param pr - The declaration the provider is built with.
 * @returns The harness.
 */
function prHarness(
  pr: Partial<Pick<TicketSourcePrCapabilities, "create" | "mergeStrategies" | "reviews">>,
): TicketSourcePrConformance {
  const host = new InMemoryPrHost({ strategies: pr.mergeStrategies });
  const provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), host, { pr });

  return {
    provider,
    context: CONTEXT,
    base: IN_MEMORY_DEFAULT_BRANCH,
    push: (branch, files) => host.push(branch, files),
    open: (branch, title) =>
      host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
        branch,
        base: IN_MEMORY_DEFAULT_BRANCH,
        title,
        body: null,
      }).number,
    openIssue: () => host.openIssue(),
    foreignReference: "acme-robotics/helios-bootloader#7",
    reviewer: "mara-okafor",
    ledger: () => host.ledger(),
    refuse: Object.fromEntries(
      TICKET_SOURCE_ERROR_CLASSES.map((errorClass) => [
        errorClass,
        () => host.refuse(errorClass, new Date("2026-09-24T14:20:00.000Z")),
      ]),
    ) as TicketSourcePrConformance["refuse"],
    recover: () => host.recover(),
  };
}

describeTicketSourcePrConformance("InMemoryPrTicketSourceProvider (every feature)", () =>
  prHarness({}),
);

describeTicketSourcePrConformance(
  "InMemoryPrTicketSourceProvider (no creation, no reviews, squash only)",
  () => prHarness({ create: false, reviews: false, mergeStrategies: ["squash"] }),
);
