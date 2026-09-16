/**
 * A planning world for the push service's suites: a workspace, a GitHub source recorded in memory,
 * a batch of drafts with dependencies, and the service wired over all of it.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)). The batch is mockup 09's —
 * six OTA drafts, five `blocks` notes, one epic and the **Helios 2.1** milestone — keyed so that
 * dependency order and key order disagree, which is the only way a suite can tell a push that
 * walks blockers first from one that happens to walk keys.
 *
 * ```
 * OTA-3 ─▶ OTA-1 ─▶ OTA-4 ─▶ OTA-6
 *   └────▶ OTA-2 ─▶ OTA-5
 * ```
 *
 * Nothing stands in but the network and the database: the provider is the real
 * `GithubTicketSourceProvider` over `github.write-recordings.fixture.ts`, and the store is
 * `push.store.fixture.ts`, which keeps V034–V036's rules.
 */

import { GithubRateLimiter } from "../github/github.rate-limit";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type {
  TicketSourceProvider,
  TicketSyncContext,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { TicketDraftInput, TicketWriteRef } from "../ticket-sources/ticket-source.write";
import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";
import {
  SOURCE_CONFIG,
  SOURCE_TOKEN,
  recordingFactory,
} from "../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
  type WriteRecordingOptions,
} from "../ticket-sources/providers/github.write-recordings.fixture";
import { InMemoryPushStore, type StoredDraft } from "./push.store.fixture";
import { PushService, type SourceOpener } from "./push.service";

/** The workspace that owns the batch. */
export const PLANNING_ORG = "org-planning";

/** A workspace that does not. */
export const OTHER_ORG = "org-elsewhere";

/** The GitHub source the batch targets. */
export const PLANNING_SOURCE = "50000000-0000-4000-8000-000000000279";

/** The batch. */
export const PLANNING_BATCH = "b0000000-0000-4000-8000-000000000279";

/** The epic the batch belongs to. */
export const PLANNING_EPIC = "e0000000-0000-4000-8000-000000000279";

/** The six drafts' local keys, in key order. */
export const OTA_KEYS = ["OTA-1", "OTA-2", "OTA-3", "OTA-4", "OTA-5", "OTA-6"] as const;

/** The five `blocks` notes, as `[blocker, blocked]` local keys. */
export const OTA_BLOCKS: readonly (readonly [string, string])[] = [
  ["OTA-3", "OTA-1"],
  ["OTA-3", "OTA-2"],
  ["OTA-1", "OTA-4"],
  ["OTA-2", "OTA-5"],
  ["OTA-4", "OTA-6"],
];

/**
 * A draft's id from its key.
 *
 * @param localKey - `OTA-3`.
 * @returns A uuid ending in the key's number.
 */
export function draftId(localKey: string): string {
  return `d0000000-0000-4000-8000-${localKey.replace("OTA-", "").padStart(12, "0")}`;
}

/**
 * The GitHub provider with failures a case can arrange per draft title — the real provider for
 * everything else.
 */
export class ScriptedGithubProvider extends GithubTicketSourceProvider {
  /** Refusals to answer `createTicket` with, by draft title, consumed once each. */
  readonly createFailures = new Map<string, Error>();

  /** Every `createTicket` call's title, in order. */
  readonly created: string[] = [];

  /** @inheritdoc */
  override createTicket(
    context: TicketSyncContext,
    draft: TicketDraftInput,
  ): Promise<TicketWriteRef> {
    this.created.push(draft.title);

    const failure = this.createFailures.get(draft.title);

    if (failure !== undefined) {
      this.createFailures.delete(draft.title);

      return Promise.reject(failure);
    }

    return super.createTicket(context, draft);
  }
}

/** How a world is built. */
export interface WorldOptions extends WriteRecordingOptions {
  /** The batch's milestone, or null. Defaults to **Helios 2.1**. */
  readonly milestone?: string | null;
  /** Whether the batch belongs to the epic. Defaults to true. */
  readonly epic?: boolean;
  /** Providers to register instead of the scripted GitHub one. */
  readonly providers?: (github: ScriptedGithubProvider) => TicketSourceProvider[];
  /** What opening the credential does instead of succeeding. */
  readonly openFails?: Error;
}

/** A planning world. */
export interface World {
  readonly service: PushService;
  readonly store: InMemoryPushStore;
  readonly github: WriteRecording;
  readonly provider: ScriptedGithubProvider;
  readonly limiter: GithubRateLimiter;
  /** The draft with this key. */
  draft(localKey: string): StoredDraft;
  /** Recorded issues carrying a push key — tickets, not epic parents. */
  ticketIssues(): number;
}

/**
 * Build a world holding mockup 09's batch.
 *
 * @param options - How.
 * @returns The world.
 */
export function planningWorld(options: WorldOptions = {}): World {
  const github = writeRecording(options);
  const limiter = new GithubRateLimiter();
  const provider = new ScriptedGithubProvider(recordingFactory(github.octokit).factory, limiter);
  const store = new InMemoryPushStore();
  const registry = new TicketSourceRegistry(options.providers?.(provider) ?? [provider]);
  const opener: SourceOpener = {
    withCredentials: (source, run) =>
      options.openFails !== undefined
        ? Promise.reject(options.openFails)
        : run({
            sourceId: source.sourceId,
            organizationId: source.organizationId,
            config: source.config,
            credentials: SOURCE_TOKEN,
          }),
  };

  store.sources.set(PLANNING_SOURCE, {
    sourceId: PLANNING_SOURCE,
    organizationId: PLANNING_ORG,
    kind: "github",
    displayName: "GitHub · acme-robotics",
    config: SOURCE_CONFIG,
    cursor: null,
    syncedAt: null,
  });
  store.epics.set(PLANNING_EPIC, { organizationId: PLANNING_ORG, name: "OTA power-loss safety" });
  store.batches.set(PLANNING_BATCH, {
    id: PLANNING_BATCH,
    organizationId: PLANNING_ORG,
    status: "sized",
    targetMilestone: options.milestone === undefined ? "Helios 2.1" : options.milestone,
    epicId: options.epic === false ? null : PLANNING_EPIC,
    sourceId: PLANNING_SOURCE,
  });

  for (const localKey of OTA_KEYS) {
    store.drafts.push({
      id: draftId(localKey),
      batchId: PLANNING_BATCH,
      localKey,
      title: `${localKey}: ${TITLES[localKey] ?? "draft"}`,
      body: `Evidence for ${localKey}: 0 of 1,284 builds set this option.`,
      selected: true,
      pushState: "pending",
      pushedTicketId: null,
      pushError: null,
    });
  }

  for (const [blocker, blocked] of OTA_BLOCKS) {
    store.edges.push({
      organizationId: PLANNING_ORG,
      blockerDraftId: draftId(blocker),
      blockerTicketId: null,
      blockedDraftId: draftId(blocked),
      blockedTicketId: null,
    });
  }

  return {
    service: new PushService(store, registry, opener),
    store,
    github,
    provider,
    limiter,
    draft: (localKey) => {
      const found = store.drafts.find((draft) => draft.localKey === localKey);

      if (found === undefined) {
        throw new Error(`no draft ${localKey}`);
      }

      return found;
    },
    ticketIssues: () => github.ledger().tickets.length,
  };
}

/** The drafts' titles, so a failure can be arranged against one. */
const TITLES: Readonly<Record<string, string>> = {
  "OTA-1": "Journal writes before the OTA image is swapped",
  "OTA-2": "Verify the image signature before swap",
  "OTA-3": "Reserve a recovery partition",
  "OTA-4": "Power-loss test rig for the OTA swap",
  "OTA-5": "Roll back on a failed signature",
  "OTA-6": "Document the recovery procedure",
};

/**
 * The title a draft is created with.
 *
 * @param localKey - `OTA-3`.
 * @returns Its title.
 */
export function titleOf(localKey: string): string {
  return `${localKey}: ${TITLES[localKey] ?? "draft"}`;
}

/**
 * A refusal of one class, as a provider would throw it.
 *
 * @param errorClass - The class.
 * @param httpStatus - The status.
 * @param retryAt - When a throttle lifts.
 * @returns The error.
 */
export function refusal(
  errorClass: TicketSourceError["errorClass"],
  httpStatus: number | null = null,
  retryAt: Date | null = null,
): TicketSourceError {
  return new TicketSourceError(errorClass, `refused as ${errorClass}`, retryAt, httpStatus);
}
