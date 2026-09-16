import {
  describeTicketSourceConformance,
  type TicketSourceConformance,
} from "../conformance.fixture";
import type { CanonicalTicket } from "../ticket-source.provider";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  IN_MEMORY_WEBHOOK_SECRET,
  InMemoryTicketSourceProvider,
  InMemoryTracker,
  InMemoryWebhookTicketSourceProvider,
  InMemoryWriteTicketSourceProvider,
  signInMemoryDelivery,
} from "./in-memory.provider.fixture";

/**
 * Q.5's first acceptance criterion, for the fake: **the kit is green for the in-memory provider.**
 *
 * The claim is really about the kit. A contract only GitHub's provider satisfies is a contract
 * shaped like GitHub, and the cheapest way to find out the kit demands something GitHub-specific is
 * a second implementation sharing none of its code — a text identity that is not the key, a
 * four-word workflow, a cursor that is not a timestamp — passing it. That the kit also *refuses* a
 * provider that does not conform is `conformance.fixture.spec.ts`'s question.
 *
 * All three classes run, because the kit has a webhook leg that only exists for a provider declaring
 * the capability and a complementary one asserting the member is unreachable without it. Running
 * only the polling provider would leave the first never executed. The write-capable provider takes
 * the read suite too (AL.2, #278): a provider that gained writes must still sync exactly as before.
 *
 * The recording is a tracker scripted in filing order, one clock tick per change, so every stamp
 * below is stated exactly. A page size of two makes the cold import two pages long, so `hasMore`
 * and the cursor between pages are exercised, not only the cursor between cycles.
 *
 * ```
 * 09:01 PROJ-1 wont_do  (closed — never imported)
 * 09:02 PROJ-2 todo     ┐
 * 09:03 PROJ-3 in_progr ├ cold import: two pages
 * 09:04 PROJ-4 todo     ┘
 * ── change ──
 * 09:05 PROJ-2 edited · 09:06 PROJ-3 done · 09:07 PROJ-5 filed · 09:08 PROJ-6 wont_do (never seen)
 * ```
 */

/** The source the recordings sync. */
const CONTEXT = {
  sourceId: "b0420000-0000-4000-8000-000000000142",
  organizationId: "org-conformance",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
} as const;

/** `PROJ-1` — filed as a duplicate nobody will do, so closed from the start. */
const SUPERSEDED: CanonicalTicket = {
  externalId: "10001",
  externalKey: "PROJ-1",
  externalUrl: "https://tracker.example.invalid/browse/PROJ-1",
  title: "Watchdog fires twice on warm reset",
  body: "Superseded by the I2C recovery report.",
  state: "closed",
  labels: [],
  author: "field-support",
  sourceCreatedAt: new Date("2026-09-01T09:01:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-01T09:01:00.000Z"),
  meta: { custom: { project: "PROJ", status: "wont_do" } },
};

/** `PROJ-2` — open, with tags and a reporter. */
const WATCHDOG: CanonicalTicket = {
  externalId: "10002",
  externalKey: "PROJ-2",
  externalUrl: "https://tracker.example.invalid/browse/PROJ-2",
  title: "Watchdog timer resets during I2C bus recovery",
  body: "The watchdog fires while the bus is being recovered.",
  state: "open",
  labels: ["bug", "i2c"],
  author: "field-support",
  sourceCreatedAt: new Date("2026-09-01T09:02:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-01T09:02:00.000Z"),
  meta: { custom: { project: "PROJ", status: "todo" } },
};

/** `PROJ-3` — in progress, which is open; no description and no reporter. */
const CALIBRATION: CanonicalTicket = {
  externalId: "10003",
  externalKey: "PROJ-3",
  externalUrl: "https://tracker.example.invalid/browse/PROJ-3",
  title: "Calibration drifts after firmware rollback",
  body: null,
  state: "open",
  labels: [],
  author: null,
  sourceCreatedAt: new Date("2026-09-01T09:03:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-01T09:03:00.000Z"),
  meta: { custom: { project: "PROJ", status: "in_progress" } },
};

/** `PROJ-4` — open, untouched by the change. */
const THERMAL: CanonicalTicket = {
  externalId: "10004",
  externalKey: "PROJ-4",
  externalUrl: "https://tracker.example.invalid/browse/PROJ-4",
  title: "Thermal sensor reads zero after cold boot",
  body: "Seen on rev C boards only.",
  state: "open",
  labels: ["sensor"],
  author: "qa-lab",
  sourceCreatedAt: new Date("2026-09-01T09:04:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-01T09:04:00.000Z"),
  meta: { custom: { project: "PROJ", status: "todo" } },
};

/** `PROJ-5` — filed after the cold import. */
const BOOTLOADER: CanonicalTicket = {
  externalId: "10005",
  externalKey: "PROJ-5",
  externalUrl: "https://tracker.example.invalid/browse/PROJ-5",
  title: "Bootloader rejects signed images after key rotation",
  body: null,
  state: "open",
  labels: ["security"],
  author: "release-eng",
  sourceCreatedAt: new Date("2026-09-01T09:07:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-01T09:07:00.000Z"),
  meta: { custom: { project: "PROJ", status: "todo" } },
};

/**
 * A harness over a freshly scripted tracker.
 *
 * @param variant - Which provider class to build.
 * @returns The harness.
 */
function harnessFor(variant: "polling" | "webhook" | "write"): TicketSourceConformance {
  const webhooks = variant === "webhook";
  const tracker = new InMemoryTracker();

  tracker.file({
    summary: SUPERSEDED.title,
    description: SUPERSEDED.body,
    status: "wont_do",
    reporter: "field-support",
  });
  tracker.file({
    summary: WATCHDOG.title,
    description: WATCHDOG.body,
    tags: ["bug", "i2c"],
    reporter: "field-support",
  });
  tracker.file({ summary: CALIBRATION.title, status: "in_progress" });
  tracker.file({
    summary: THERMAL.title,
    description: THERMAL.body,
    tags: ["sensor"],
    reporter: "qa-lab",
  });

  const provider = webhooks
    ? new InMemoryWebhookTicketSourceProvider(tracker, IN_MEMORY_WEBHOOK_SECRET, { pageSize: 2 })
    : variant === "write"
      ? new InMemoryWriteTicketSourceProvider(tracker, { pageSize: 2 })
      : new InMemoryTicketSourceProvider(tracker, { pageSize: 2 });
  const delivery = tracker.deliver(WATCHDOG.externalId, IN_MEMORY_WEBHOOK_SECRET);

  return {
    provider,
    context: CONTEXT,
    rejectedConfigs: [
      { name: "a project key in lower case", config: { project: "proj" } },
      { name: "no project at all", config: {} },
      { name: "a project the tracker does not have", config: { project: "NOPE" } },
      { name: "not an object", config: IN_MEMORY_PROJECT },
    ],
    mappings: [
      {
        name: "an open record with tags and a reporter",
        raw: tracker.record(WATCHDOG.externalId),
        expected: WATCHDOG,
      },
      {
        name: "an in-progress record with no description and no reporter",
        raw: tracker.record(CALIBRATION.externalId),
        expected: CALIBRATION,
      },
      {
        name: "a record nobody will do, which collapses to closed",
        raw: tracker.record(SUPERSEDED.externalId),
        expected: SUPERSEDED,
      },
    ],
    unmappable: [
      {
        name: "a record whose summary is blank",
        raw: { ...tracker.record(WATCHDOG.externalId), summary: "   " },
      },
      {
        name: "a record with a status the tracker does not have",
        raw: { ...tracker.record(WATCHDOG.externalId), status: "archived" },
      },
      { name: "something that is not a record", raw: WATCHDOG.externalKey },
    ],
    backlog: [WATCHDOG, CALIBRATION, THERMAL],
    changeUpstream: () => {
      tracker.edit(WATCHDOG.externalId, { summary: `${WATCHDOG.title}, revised` });
      tracker.transition(CALIBRATION.externalId, "done");
      tracker.file({ summary: BOOTLOADER.title, tags: ["security"], reporter: "release-eng" });
      // Closed before this mirror ever saw it, so the loop must not store it.
      tracker.file({ summary: "Duplicate of PROJ-5", status: "wont_do" });
    },
    changedBacklog: [
      {
        ...WATCHDOG,
        title: `${WATCHDOG.title}, revised`,
        sourceUpdatedAt: new Date("2026-09-01T09:05:00.000Z"),
      },
      {
        ...CALIBRATION,
        state: "closed",
        sourceUpdatedAt: new Date("2026-09-01T09:06:00.000Z"),
        meta: { custom: { project: "PROJ", status: "done" } },
      },
      THERMAL,
      BOOTLOADER,
    ],
    refuse: {
      auth: () => tracker.refuse("auth"),
      rate_limit: () => tracker.refuse("rate_limit", new Date("2026-09-12T14:20:00.000Z")),
      not_found: () => tracker.refuse("not_found"),
      upstream: () => tracker.refuse("upstream"),
    },
    webhook: webhooks
      ? {
          delivery,
          expected: [WATCHDOG],
          forged: {
            payload: delivery.payload,
            signature: signInMemoryDelivery(
              delivery.payload,
              "whsec_not_the_configured_secret_0000",
            ),
          },
        }
      : null,
  };
}

describeTicketSourceConformance("InMemoryTicketSourceProvider", () => harnessFor("polling"));

describeTicketSourceConformance("InMemoryWebhookTicketSourceProvider", () => harnessFor("webhook"));

describeTicketSourceConformance("InMemoryWriteTicketSourceProvider", () => harnessFor("write"));
