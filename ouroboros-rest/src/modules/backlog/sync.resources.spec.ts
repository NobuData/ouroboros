import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import type { SyncTarget } from "../backlog-sync/backlog-sync.repository";
import {
  SYNC_NO_REPOSITORIES,
  SYNC_PAUSES,
  SYNC_PAUSE_MESSAGES,
  type RepoSyncOutcome,
  type SyncCycleReport,
} from "../backlog-sync/sync.report";
import { GITHUB_FAILURES } from "../github/github.errors";
import { SYNC_STATES, syncStatus, type SyncStatusInput } from "./sync.resources";

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The rendered specification, as data — the copy the service serves. */
const SPECIFICATION = JSON.parse(readFileSync(join(MODULE_ROOT, "openapi.json"), "utf8")) as {
  components: {
    schemas: Record<string, { properties: Record<string, { enum?: (string | null)[] }> }>;
  };
};

/**
 * Whether a resource is a body the published contract accepts.
 *
 * The document is registered under an identifier and the schema referenced by pointer into it,
 * so a `$ref` between schemas resolves the way a client's tooling resolves one —
 * `openapi.spec.ts` builds its validator the same way and for the same reason.
 *
 * Every schema is `additionalProperties: false`, so this catches drift in both directions: a
 * field this file starts returning and the document does not list, and a field the document
 * requires and this file stopped filling.
 *
 * @param value - What {@link syncStatus} produced.
 * @returns Ajv's complaint, or `undefined` when the body validates.
 */
function invalid(value: unknown): string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  addFormats(ajv);
  ajv.addSchema({ $id: id, components: SPECIFICATION.components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/SyncStatus` });

  return validate(value) ? undefined : ajv.errorsText(validate.errors);
}

/**
 * The composition rule — the ticket's first acceptance criterion, which is a claim about
 * *where each answer comes from*: **status reflects reality; pause reasons are derived from
 * actual state (token presence, rate-limit headers, enabled-repo count), never guessed.**
 *
 * It is asserted here rather than through the service because every rule worth checking is a
 * rule about **precedence** — which of several simultaneously true things a reader is told —
 * and that is a property of the function, not of the three reads that feed it.
 *
 * Two of the rules have a design argument behind them and each gets its own case:
 *
 *   * **Freshness is the oldest poll, not the newest.** The tag sits over the whole backlog,
 *     so one repository that synced a second ago must not speak for nine that failed.
 *   * **A paused repository has no `lastResult`.** Its outcome carries zeros, and publishing
 *     those as a result would read as *"we looked and found nothing"*, which is the one thing
 *     that did not happen.
 */

/** The workspace every case below is about. */
const ORG = "acme-robotics-id";

/** `github_repos.id`s, so an assertion can name a row. */
const FIRMWARE = "5eed000b-0000-4000-8000-000000000001";
const GROUND = "5eed000b-0000-4000-8000-000000000002";

/**
 * One enabled repository, as the columns hold it.
 *
 * @param githubRepoId - The row.
 * @param name - The repository within the organisation.
 * @param syncedAt - Its freshness stamp, or null for one never polled.
 * @param cursor - Its watermark, or null.
 * @returns The target.
 */
function target(
  githubRepoId: string,
  name: string,
  syncedAt: Date | null,
  cursor: string | null = null,
): SyncTarget {
  return {
    githubRepoId,
    organizationId: ORG,
    owner: "acme-robotics",
    name,
    syncedAt,
    cursor,
  };
}

/**
 * What a cycle's poll of one repository did.
 *
 * @param githubRepoId - The row it polled.
 * @param overrides - Whatever the case is about.
 * @returns The outcome.
 */
function outcome(githubRepoId: string, overrides: Partial<RepoSyncOutcome> = {}): RepoSyncOutcome {
  return {
    organizationId: ORG,
    githubRepoId,
    repository: "acme-robotics/helios-firmware",
    imported: 0,
    updated: 0,
    unchanged: 0,
    pullRequests: 0,
    unusable: 0,
    enqueued: 0,
    capped: false,
    ...overrides,
  };
}

/**
 * A cycle report naming this workspace.
 *
 * @param organization - What the cycle found for it.
 * @returns The report.
 */
function report(organization: {
  pause?: RepoSyncOutcome["pause"];
  repositories?: readonly RepoSyncOutcome[];
}): SyncCycleReport {
  return {
    startedAt: new Date("2026-09-10T14:07:20.000Z"),
    organizations: [
      {
        organizationId: ORG,
        pause: organization.pause,
        repositories: organization.repositories ?? [],
      },
    ],
    pending: false,
  };
}

/**
 * The inputs, with the healthy case as the default.
 *
 * @param overrides - What the case is about.
 * @returns The input.
 */
function input(overrides: Partial<SyncStatusInput> = {}): SyncStatusInput {
  return {
    organizationId: ORG,
    targets: [target(FIRMWARE, "helios-firmware", new Date("2026-09-10T14:07:20.000Z"))],
    configured: true,
    running: false,
    ...overrides,
  };
}

describe("why a workspace's sync is paused", () => {
  it("names no reason at all when nothing is stopping it", () => {
    const status = syncStatus(input());

    expect(status.state).toBe("ok");
    expect(status.pause).toBeNull();
    expect(status.message).toBeNull();
    expect(status.retryAfterSeconds).toBeNull();
  });

  it("says `not_configured` when the workspace has no token", () => {
    // Read from `github_credentials` rather than inferred from a failure, which is what makes
    // it right on a process that has polled nothing yet.
    const status = syncStatus(input({ configured: false }));

    expect(status.state).toBe("paused");
    expect(status.pause).toBe(GITHUB_FAILURES.notConfigured);
    expect(status.message).toBe(SYNC_PAUSE_MESSAGES[GITHUB_FAILURES.notConfigured]);
  });

  it("prefers `not_configured` over every other reason, because it is the first fix", () => {
    // A workspace with no token and nothing enabled is in both states; being told to add a
    // token is the only one of the two that leads anywhere.
    const status = syncStatus(input({ configured: false, targets: [], retryAfterSeconds: 90 }));

    expect(status.pause).toBe(GITHUB_FAILURES.notConfigured);
  });

  it("says `no_repositories` for a token pointed at nothing", () => {
    // Deliberately a different word from `not_configured`: the two are fixed on two different
    // screens, and one "sync is off" would send half the readers to the wrong one.
    const status = syncStatus(input({ targets: [] }));

    expect(status.pause).toBe(SYNC_NO_REPOSITORIES);
    expect(status.repositories).toEqual([]);
  });

  it("says `rate_limited` on the guard's own evidence, with the wait", () => {
    const status = syncStatus(input({ retryAfterSeconds: 1180 }));

    expect(status.pause).toBe(GITHUB_FAILURES.rateLimited);
    expect(status.retryAfterSeconds).toBe(1180);
  });

  it("prefers the guard to the last cycle's report, because a click can spend the budget too", () => {
    // The rate guard sees every call including interactive ones; the last cycle saw only its
    // own. Reporting `upstream_error` while the budget is spent would send a reader looking
    // for an outage that is not there.
    const status = syncStatus(
      input({
        retryAfterSeconds: 42,
        last: report({ pause: GITHUB_FAILURES.upstreamError }),
      }),
    );

    expect(status.pause).toBe(GITHUB_FAILURES.rateLimited);
    expect(status.retryAfterSeconds).toBe(42);
  });

  it("falls back to whatever stopped the last cycle", () => {
    const status = syncStatus(input({ last: report({ pause: GITHUB_FAILURES.unauthorized }) }));

    expect(status.pause).toBe(GITHUB_FAILURES.unauthorized);
    expect(status.message).toBe(SYNC_PAUSE_MESSAGES[GITHUB_FAILURES.unauthorized]);
  });

  it("reads nothing from another workspace's half of the report", () => {
    // One cycle covers every workspace, so a report is a list. Matching the wrong entry would
    // put somebody else's revoked token on this workspace's card.
    const foreign: SyncCycleReport = {
      startedAt: new Date("2026-09-10T14:07:20.000Z"),
      organizations: [
        { organizationId: "someone-else", pause: GITHUB_FAILURES.unauthorized, repositories: [] },
      ],
      pending: false,
    };

    expect(syncStatus(input({ last: foreign })).pause).toBeNull();
  });

  it("publishes no countdown beside a pause that is not about waiting", () => {
    // `retryAfterSeconds` beside `unauthorized` would be a number with nothing to mean.
    const status = syncStatus(
      input({ configured: false, retryAfterSeconds: undefined, last: undefined }),
    );

    expect(status.retryAfterSeconds).toBeNull();
  });

  it("omits the countdown rather than inventing one when the guard did not say", () => {
    const status = syncStatus(input({ last: report({ pause: GITHUB_FAILURES.rateLimited }) }));

    expect(status.pause).toBe(GITHUB_FAILURES.rateLimited);
    expect(status.retryAfterSeconds).toBeNull();
  });
});

describe("how fresh the backlog is", () => {
  it("is the oldest poll among the repositories, not the newest", () => {
    // The tag sits over the whole backlog: one repository that synced a second ago must not
    // speak for one that last synced an hour ago.
    const status = syncStatus(
      input({
        targets: [
          target(FIRMWARE, "helios-firmware", new Date("2026-09-10T14:07:20.000Z")),
          target(GROUND, "helios-ground", new Date("2026-09-10T13:00:00.000Z")),
        ],
      }),
    );

    expect(status.syncedAt).toBe("2026-09-10T13:00:00.000Z");
  });

  it("is null while any enabled repository has never been polled", () => {
    const status = syncStatus(
      input({
        targets: [
          target(FIRMWARE, "helios-firmware", new Date("2026-09-10T14:07:20.000Z")),
          target(GROUND, "helios-ground", null),
        ],
      }),
    );

    expect(status.syncedAt).toBeNull();
  });

  it("is null for a workspace with nothing enabled", () => {
    expect(syncStatus(input({ targets: [] })).syncedAt).toBeNull();
  });
});

describe("each repository's row", () => {
  it("carries the columns a poll wrote, and spells the repository as GitHub does", () => {
    const status = syncStatus(
      input({
        targets: [
          target(
            FIRMWARE,
            "helios-firmware",
            new Date("2026-09-10T14:07:20.000Z"),
            "2026-09-10T13:59:04.000Z",
          ),
        ],
      }),
    );

    expect(status.repositories).toEqual([
      {
        githubRepoId: FIRMWARE,
        repository: "acme-robotics/helios-firmware",
        syncedAt: "2026-09-10T14:07:20.000Z",
        cursor: "2026-09-10T13:59:04.000Z",
        state: "ok",
        pause: null,
        message: null,
        lastResult: null,
      },
    ]);
  });

  it("publishes what the last cycle's poll of it did", () => {
    const status = syncStatus(
      input({
        last: report({
          repositories: [
            outcome(FIRMWARE, {
              imported: 2,
              updated: 1,
              unchanged: 6,
              enqueued: 2,
              pullRequests: 3,
            }),
          ],
        }),
      }),
    );

    expect(status.repositories[0].lastResult).toEqual({
      imported: 2,
      updated: 1,
      unchanged: 6,
      enqueued: 2,
      pullRequests: 3,
      unusable: 0,
      capped: false,
    });
  });

  it("reports no result for a poll that never happened", () => {
    // A paused repository's outcome carries zeros to say it did nothing; publishing those as
    // a result would read as "we looked and found nothing".
    const status = syncStatus(
      input({
        last: report({ repositories: [outcome(FIRMWARE, { pause: GITHUB_FAILURES.notFound })] }),
      }),
    );

    expect(status.repositories[0].state).toBe("paused");
    expect(status.repositories[0].pause).toBe(GITHUB_FAILURES.notFound);
    expect(status.repositories[0].lastResult).toBeNull();
  });

  it("keeps one repository's failure from touching its neighbour", () => {
    // `not_found` is one repository the token cannot see and says nothing about the others —
    // the sync's own rule, seen from the surface that renders it.
    const status = syncStatus(
      input({
        targets: [
          target(FIRMWARE, "helios-firmware", new Date("2026-09-10T14:07:20.000Z")),
          target(GROUND, "helios-ground", new Date("2026-09-10T14:07:20.000Z")),
        ],
        last: report({
          repositories: [
            outcome(FIRMWARE, { pause: GITHUB_FAILURES.notFound }),
            outcome(GROUND, { unchanged: 4 }),
          ],
        }),
      }),
    );

    expect(status.repositories.map((repository) => repository.state)).toEqual(["paused", "ok"]);
  });

  it("inherits the workspace's reason where it has none of its own", () => {
    // A green row under a red card would be a page contradicting itself: these repositories
    // were not polled, and the reason is the workspace's.
    const status = syncStatus(input({ configured: false }));

    expect(status.repositories[0].state).toBe("paused");
    expect(status.repositories[0].pause).toBe(GITHUB_FAILURES.notConfigured);
  });

  it("is `ok` for a repository this process has simply not polled yet", () => {
    // After a restart there is no report and no reason — and *nothing is wrong* is the honest
    // answer. `syncedAt` is what says it has never been polled.
    const status = syncStatus(input({ targets: [target(FIRMWARE, "helios-firmware", null)] }));

    expect(status.repositories[0].state).toBe("ok");
    expect(status.repositories[0].pause).toBeNull();
    expect(status.repositories[0].syncedAt).toBeNull();
  });
});

describe("what a client is told about the loop", () => {
  it("reports a cycle in flight", () => {
    expect(syncStatus(input({ running: true })).running).toBe(true);
  });

  it("reports none when there is none", () => {
    expect(syncStatus(input()).running).toBe(false);
  });
});

describe("the words this file can produce, and the words the contract publishes", () => {
  /**
   * The one drift a hand-written specification is exposed to that a generated one is not: an
   * `enum` transcribed by a person. A reason added to `sync.report.ts` and not to
   * `openapi.yaml` is a client whose generated union cannot hold the answer it is sent.
   *
   * @param schema - Which published schema.
   * @param property - Which of its properties.
   * @returns The enum it declares.
   */
  function published(schema: string, property: string): (string | null)[] {
    return SPECIFICATION.components.schemas[schema].properties[property].enum ?? [];
  }

  it.each(["SyncStatus", "RepositorySyncStatus"])("publishes %s's two states", (schema) => {
    expect(published(schema, "state")).toEqual([...SYNC_STATES]);
  });

  it.each(["SyncStatus", "RepositorySyncStatus"])(
    "publishes %s's every pause, and null",
    (schema) => {
      // `null` is a member because the field is nullable and `ok` carries no reason; every
      // other member is one of the six words K.3 and K.4 named between them.
      expect(published(schema, "pause")).toEqual([...SYNC_PAUSES, null]);
    },
  );
});

describe("the body the contract promises", () => {
  /**
   * `openapi.spec.ts` validates what the *service* answered against the schema documented for
   * that status — and it starts no database and holds no session, so the furthest it can drive
   * these two routes is their `401`. This is the missing half: the real resource, in each of
   * the shapes it takes, against the real published schema.
   */
  it.each([
    ["healthy", input()],
    ["paused with no token", input({ configured: false, targets: [] })],
    [
      "rate-limited, with a countdown",
      input({ retryAfterSeconds: 1180, last: report({ pause: GITHUB_FAILURES.rateLimited }) }),
    ],
    [
      "polled, with a result per repository",
      input({ last: report({ repositories: [outcome(FIRMWARE, { imported: 2, capped: true })] }) }),
    ],
    ["never polled", input({ targets: [target(FIRMWARE, "helios-firmware", null)] })],
  ])("validates when it is %s", (_case, given) => {
    expect(invalid(syncStatus(given))).toBeUndefined();
  });

  it("refuses a field the document does not list", () => {
    // Spot-verified, the way `providers/boundary.spec.ts` verifies its rules: a validator whose
    // schema had quietly stopped resolving would look exactly like a resource that always
    // matches.
    expect(invalid({ ...syncStatus(input()), sizingStatus: "unsized" })).toContain(
      "NOT have additional properties",
    );
  });

  it("refuses a field the document requires and the resource stopped filling", () => {
    const { running: _running, ...missing } = syncStatus(input());

    expect(invalid(missing)).toContain("running");
  });
});
