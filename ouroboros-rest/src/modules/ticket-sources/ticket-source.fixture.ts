/**
 * The stand-ins Q.2's suites share ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * Four kinds of thing, together because six suites want the same ones: sources to sync and the
 * workspaces they belong to, canonical tickets in the two shapes that matter — a GitHub-shaped
 * one and a Jira-shaped one with no repository — a {@link TicketSourceProvider} whose answers a
 * spec writes down in advance, and a {@link TicketIntake} that records what it was handed
 * instead of doing anything with it.
 *
 * ---------------------------------------------------------------------------
 * **This is not Q.5's fake, and the difference matters.**
 * [#142](https://github.com/NobuData/ouroboros/issues/142) asks for an
 * `InMemoryTicketSourceProvider` that *"passes the kit and powers core-intake tests without
 * network"* — a provider with behaviour, held to the same contract as GitHub's, and the
 * on-ramp for T.2–T.4 and for community providers. {@link scriptedProvider} below is a
 * **test double**: it returns whatever a spec queued and records what it was asked. It is
 * exactly enough to prove the loop dispatches, upserts, stamps and reports correctly, and it
 * is deliberately not enough to prove a provider *conforms* — which is the job Q.5 exists to
 * do and which this file must not pre-empt with something weaker.
 *
 * **Two shapes, always.** Every fixture here comes in a GitHub flavour and a Jira flavour,
 * because decision **P6** is the thing under test in half these suites and a fixture set where
 * every ticket has an integer identity would let a GitHub-shaped assumption back in through
 * the tests. `PROJ-142` has no repository in its `meta`, and its `externalId` is not its
 * `externalKey`.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { SyncSource } from "./ticket-sources.repository";
import type { EstimableTicket, TicketIntake } from "./ticket.intake";
import { TicketSourceError } from "./ticket-source.errors";
import type {
  CanonicalTicket,
  TicketPage,
  TicketSourceCapabilities,
  TicketSourceProvider,
  TicketSourceValidation,
  TicketSyncContext,
  WebhookCapableProvider,
  WebhookOutcome,
} from "./ticket-source.provider";

/** The workspace every unit suite here syncs for. */
export const FIXTURE_WORKSPACE = "org-sources";

/** The GitHub-kind source's row id. */
export const FIXTURE_GITHUB_SOURCE = "b0390000-0000-0000-0000-00000000000a";

/** The Jira-kind source's row id — the one with no repository anywhere in it. */
export const FIXTURE_JIRA_SOURCE = "b0390000-0000-0000-0000-00000000000b";

/** The cycle's clock, so a freshness assertion can name the instant it expects. */
export const FIXTURE_NOW = new Date("2026-09-12T10:00:00.000Z");

/**
 * One of the vault's envelopes, in the shape V030's `ticket_sources_credentials_sealed`
 * accepts.
 *
 * A real-looking envelope rather than a placeholder, so a spec that asserts the sealed value
 * never reaches a log is asserting against something the column would actually hold.
 */
export const FIXTURE_ENVELOPE = "ouro.v1.1.c2VlZC1ub25jZS00.ZGV2LXNlZWQtbm90LWEtY3JlZGVudGlhbA";

/**
 * What {@link FIXTURE_ENVELOPE} opens to.
 *
 * Deliberately shaped like a real token and deliberately distinctive, because several suites
 * search a log transcript for it — a value that looked like ordinary prose could pass that
 * search by being missed rather than by being absent.
 */
export const FIXTURE_CREDENTIAL = "ghp_fixtureQ2onlyNEVERlogTHISvalue0001";

/**
 * A GitHub-kind source to sync.
 *
 * @param overrides - What differs from a source that has never been synced — a `cursor` and a
 *   `syncedAt` are what make a sync incremental rather than a full one.
 * @returns The source.
 */
export function githubSource(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    sourceId: FIXTURE_GITHUB_SOURCE,
    organizationId: FIXTURE_WORKSPACE,
    kind: "github",
    displayName: "GitHub · acme-robotics",
    config: { login: "acme-robotics", repos: ["helios-firmware"] },
    cursor: null,
    syncedAt: null,
    ...overrides,
  };
}

/**
 * A Jira-kind source to sync — the kind this build has no provider for.
 *
 * @param overrides - What differs.
 * @returns The source.
 */
export function jiraSource(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    sourceId: FIXTURE_JIRA_SOURCE,
    organizationId: FIXTURE_WORKSPACE,
    kind: "jira",
    displayName: "Jira · PROJ",
    config: { base_url: "https://acme-robotics.atlassian.net", project_keys: ["PROJ"] },
    cursor: null,
    syncedAt: null,
    ...overrides,
  };
}

/**
 * A canonical ticket in GitHub's shape — `485` displayed as `#485`, with a repository in
 * `meta`.
 *
 * @param overrides - What differs from mockup 03's `#485`.
 * @returns The ticket.
 */
export function githubTicket(overrides: Partial<CanonicalTicket> = {}): CanonicalTicket {
  return {
    externalId: "485",
    externalKey: "#485",
    externalUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
    title: "Watchdog timer resets during I2C bus recovery",
    body: "The watchdog fires while the bus is being recovered.",
    state: "open",
    labels: ["bug", "i2c", "watchdog"],
    author: "field-support",
    sourceCreatedAt: new Date("2026-09-10T09:00:00.000Z"),
    sourceUpdatedAt: new Date("2026-09-11T09:00:00.000Z"),
    meta: { github: { repo_id: "dfff0000-0000-0000-0000-00000000000a" } },
    ...overrides,
  };
}

/**
 * A canonical ticket in Jira's shape — a key that is not the identity, and **no repository**.
 *
 * The fixture decision **P6** is actually about. A suite that only ever handled
 * {@link githubTicket} would pass with a loop that assumed an integer identity and a
 * repository in `meta`, which is the assumption V030 exists to remove.
 *
 * @param overrides - What differs.
 * @returns The ticket.
 */
export function jiraTicket(overrides: Partial<CanonicalTicket> = {}): CanonicalTicket {
  return {
    externalId: "10042",
    externalKey: "PROJ-142",
    externalUrl: "https://acme-robotics.atlassian.net/browse/PROJ-142",
    title: "Calibration drifts after firmware rollback",
    body: null,
    state: "open",
    labels: [],
    author: "5b10a2844c20165700ede21g",
    sourceCreatedAt: new Date("2026-09-09T08:00:00.000Z"),
    sourceUpdatedAt: new Date("2026-09-11T12:00:00.000Z"),
    meta: { jira: { project_key: "PROJ" } },
    ...overrides,
  };
}

/**
 * One page, with the defaults a spec that does not care about paging wants.
 *
 * @param tickets - What the page carries.
 * @param overrides - A cursor, or `hasMore`.
 * @returns The page.
 */
export function page(
  tickets: readonly CanonicalTicket[] = [],
  overrides: Partial<TicketPage> = {},
): TicketPage {
  return { tickets, nextCursor: null, hasMore: false, ...overrides };
}

/** All three capability flags off — the shape a polling-only provider declares. */
export const NO_CAPABILITIES: TicketSourceCapabilities = Object.freeze({
  webhooks: false,
  labels: false,
  bidirectionalWrites: false,
});

/** What {@link scriptedProvider} is told to do, and what it writes down. */
export interface ScriptedProvider extends TicketSourceProvider {
  /** Every context it was handed, in call order — for asserting what the loop opened. */
  readonly calls: TicketSyncContext[];
  /** Which member was called each time: the loop's full-or-incremental decision, recorded. */
  readonly members: ("fullSync" | "incrementalSync")[];
  /** Every cursor it was handed — `undefined` for a full sync, which never receives one. */
  readonly cursors: (string | undefined)[];
}

/** What a {@link scriptedProvider} answers with. */
export interface ProviderScript {
  /** The provider's kind. `github` unless a spec is about dispatch. */
  kind?: TicketSourceProvider["kind"];
  /** What the flags say. */
  capabilities?: Partial<TicketSourceCapabilities>;
  /** What each sync call answers, in order; the last is repeated once exhausted. */
  pages?: readonly TicketPage[];
  /** Thrown instead of answering, by every sync call. */
  fails?: unknown;
  /** What `validateConfig` answers. */
  validation?: TicketSourceValidation;
}

/**
 * A provider that answers what a spec queued and records what it was asked.
 *
 * See this file's header for why this is a double rather than Q.5's fake.
 *
 * @param script - What it should do.
 * @returns The provider, with its recordings.
 */
export function scriptedProvider(script: ProviderScript = {}): ScriptedProvider {
  const calls: TicketSyncContext[] = [];
  const members: ("fullSync" | "incrementalSync")[] = [];
  const cursors: (string | undefined)[] = [];
  const pages = script.pages ?? [page()];
  let served = 0;

  /**
   * Record one call and answer it.
   *
   * @param member - Which member was called.
   * @param context - What it was handed.
   * @param cursor - The cursor, for an incremental call.
   * @returns The next scripted page.
   */
  const answer = (
    member: "fullSync" | "incrementalSync",
    context: TicketSyncContext,
    cursor?: string,
  ): Promise<TicketPage> => {
    calls.push(context);
    members.push(member);
    cursors.push(cursor);

    if (script.fails !== undefined) {
      // `unknown` rather than an `Error`, and the rule is disabled rather than the type
      // narrowed: one of the loop's cases is *a provider that threw something that is not a
      // `TicketSourceError`*, and a fixture that could only reject with a well-formed error
      // could not stage it.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(script.fails);
    }

    // The last page repeats rather than running out: a spec that drives two cycles and cares
    // about only the first should not have to script the second.
    const answered = pages[Math.min(served, pages.length - 1)] ?? page();

    served += 1;

    return Promise.resolve(answered);
  };

  return {
    kind: script.kind ?? "github",
    calls,
    members,
    cursors,
    capabilities: () => ({ ...NO_CAPABILITIES, ...script.capabilities }),
    validateConfig: () =>
      Promise.resolve(script.validation ?? { status: "ok", detail: "1 repository" }),
    fullSync: async (context) => answer("fullSync", context),
    incrementalSync: async (context, cursor) => answer("incrementalSync", context, cursor),
    mapTicket: () => githubTicket(),
  };
}

/**
 * A provider that also accepts webhook deliveries.
 *
 * Separate from {@link scriptedProvider} rather than a flag on it, because the whole point of
 * {@link WebhookCapableProvider} is that the member and the flag travel together — and a
 * factory that could produce one without the other would be a factory that could produce the
 * boot failure the registry exists to raise. The suites that want *that* build it by hand, so
 * the disagreement is visible in the spec that asserts it.
 *
 * @param outcome - What a delivery resolves to.
 * @returns The provider.
 */
export function webhookProvider(outcome: WebhookOutcome = { tickets: [] }): WebhookCapableProvider {
  return {
    ...scriptedProvider({ capabilities: { webhooks: true } }),
    capabilities: () => ({ ...NO_CAPABILITIES, webhooks: true }),
    webhookHandler: (_payload, signature) =>
      signature === null
        ? Promise.reject(new TicketSourceError("auth", "unsigned delivery"))
        : Promise.resolve(outcome),
  };
}

/** A {@link TicketIntake} that writes down what it was handed. */
export interface RecordingIntake extends TicketIntake {
  /** Every batch, in the order they arrived. Flat, because every assertion here is about tickets. */
  readonly accepted: EstimableTicket[];
  /** How many times {@link TicketIntake.accept} was called, including with an empty batch. */
  batches(): number;
}

/**
 * An intake that records rather than queues.
 *
 * @param failWith - Thrown instead of accepting, for the suite that asserts a broken handoff
 *   costs the handoff and not the sync.
 * @returns The intake.
 */
export function recordingIntake(failWith?: unknown): RecordingIntake {
  const accepted: EstimableTicket[] = [];
  let batches = 0;

  return {
    accepted,
    batches: () => batches,
    accept: (tickets) => {
      batches += 1;

      if (failWith !== undefined) {
        // See {@link scriptedProvider} on why the rule is disabled rather than the type
        // narrowed.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(failWith);
      }

      accepted.push(...tickets);

      return Promise.resolve();
    },
  };
}
