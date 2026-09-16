import {
  describeTicketSourceWriteConformance,
  type TicketSourceWriteConformance,
} from "../conformance.write.fixture";
import { TICKET_SOURCE_ERROR_CLASSES } from "../ticket-source.errors";
import { dependencyMarkersIn, type TicketSourceWriteCapabilities } from "../ticket-source.write";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
  InMemoryWriteTicketSourceProvider,
} from "./in-memory.provider.fixture";

/**
 * AL.2's first acceptance criterion: **the conformance kit's write suites pass for the in-memory
 * fake adapter** ([#278](https://github.com/NobuData/ouroboros/issues/278)).
 *
 * Three declarations run, because three of the criteria are about a configuration rather than a
 * provider:
 *
 *   * **Every feature** — native relations, milestones, epics as parent issues: the shape AL.3's
 *     GitHub writer will declare.
 *   * **The fallback** — no native relations, no milestones, `epicMapping: 'none'`. The fixture
 *     provider *"lacking `nativeDependencies`"* that exercises the documented body-marker path, and
 *     the proof that `none` is *"a supported, tested configuration — not a crash"*.
 *   * **A native epic** — `epicMapping: 'epic'` with milestones and no native relations, so a
 *     mapping other than a parent issue is exercised and the two flags are seen to be independent.
 *
 * The ledger is read off the tracker, never through the provider — see the kit's header — and
 * counts fallback markers as dependencies with the SPI's own `dependencyMarkersIn`, so a fallback
 * link is counted exactly as a person reading the ticket would count it.
 */

/** The source every write runs against. */
const CONTEXT = {
  sourceId: "b0420000-0000-4000-8000-000000000278",
  organizationId: "org-write-conformance",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
} as const;

/**
 * A write harness over a fresh tracker.
 *
 * @param write - The declaration the provider is built with.
 * @returns The harness.
 */
function writeHarness(
  write: Partial<Omit<TicketSourceWriteCapabilities, "createTicket">>,
): TicketSourceWriteConformance {
  const tracker = new InMemoryTracker();
  const provider = new InMemoryWriteTicketSourceProvider(tracker, { write });

  return {
    provider,
    context: CONTEXT,
    drafts: [
      {
        idempotencyKey: "batch-7f3a:OTA-1",
        title: "Journal writes before the OTA image is swapped",
        body: "So a power loss mid-swap can resume rather than brick.",
        labels: ["ota"],
        milestone: null,
      },
      {
        idempotencyKey: "batch-7f3a:OTA-3",
        title: "Power-loss test rig for the OTA swap",
        body: null,
        labels: [],
        milestone: null,
      },
    ],
    milestoneName: "Helios 2.1",
    epic: {
      epicId: "e0270000-0000-4000-8000-000000000278",
      title: "OTA power-loss safety",
      description: null,
    },
    ledger: () => {
      const ledger = tracker.ledger(dependencyMarkersIn);

      return {
        tickets: ledger.records,
        dependencies: [...ledger.relations, ...ledger.markers],
        milestones: ledger.milestones,
        containers: ledger.containers,
        memberships: ledger.memberships,
      };
    },
    refuse: Object.fromEntries(
      TICKET_SOURCE_ERROR_CLASSES.map((errorClass) => [
        errorClass,
        () => tracker.refuse(errorClass, new Date("2026-09-16T14:20:00.000Z")),
      ]),
    ) as TicketSourceWriteConformance["refuse"],
    recover: () => tracker.recover(),
  };
}

describeTicketSourceWriteConformance("InMemoryWriteTicketSourceProvider (every feature)", () =>
  writeHarness({}),
);

describeTicketSourceWriteConformance(
  "InMemoryWriteTicketSourceProvider (fallback links, no milestones, epicMapping none)",
  () => writeHarness({ nativeDependencies: false, milestones: false, epicMapping: "none" }),
);

describeTicketSourceWriteConformance(
  "InMemoryWriteTicketSourceProvider (native epics, fallback links)",
  () => writeHarness({ nativeDependencies: false, milestones: true, epicMapping: "epic" }),
);
