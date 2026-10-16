/**
 * The live slice's seeded workspace and its three fixtures, as this suite names them
 * ([#1314](https://github.com/NobuData/ouroboros/issues/1314), DI.5).
 *
 * `R__dev_seed_live_slice.sql` seeds a fifth workspace, `acme-live-slice`, holding the published
 * `live-slice` workflow, routes for its task kinds, the fixture repository and its one issue, a
 * dry-run policy, and a provider connection — `Anthropic · recorded fixture` — whose address is
 * the `provider-fixture` container and which carries **no credential**: a seed cannot write an
 * envelope this deployment's vault can open. The leg that runs the slice stores one through the
 * rotate route ({@link setFixtureProviderKey}) before it queues anything, the way the providers
 * leg connects its own cards to `provider-stub`.
 *
 * The values are copied from the seed on purpose, for `support/seed.ts`'s reason: a suite that
 * read them out of the migration would agree with a renamed workspace just as happily.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BrowserContext } from "@playwright/test";

import { requestAs } from "./rest";

/** The workspace the slice runs in — `R__dev_seed_live_slice.sql`'s own. */
export const LIVE_SLICE_TENANT = {
  /** `ouroboros.organization.id` — literal in the migration. */
  id: "5eed009e-0000-4000-8000-000000000001",
  /** The handle the tenant chip draws. */
  slug: "acme-live-slice",
  /** The workspace's name, as the login screen's row prints it. */
  displayName: "Acme Live Slice",
} as const;

/** The repository the slice edits: the git host's third, private one, mirrored in the workspace. */
export const LIVE_SLICE_REPOSITORY = { owner: "acme-robotics", name: "helios-greeter" } as const;

/** The one seeded issue — *greet: the exclamation mark is missing*. */
export const LIVE_SLICE_ISSUE_NUMBER = 1;

/** The published workflow's slug. */
export const LIVE_SLICE_WORKFLOW = "live-slice";

/** `provider_connections.id` of *Anthropic · recorded fixture* — literal in the migration. */
export const FIXTURE_CONNECTION_ID = "5eed00a6-0000-4000-8000-000000000001";

/** Where `provider-fixture` answers, from the host — the loopback port the compose override publishes. */
export const PROVIDER_FIXTURE_URL = "http://127.0.0.1:4600";

/** The same host as the compose network names it — the seeded connection's `base_url`. */
export const PROVIDER_FIXTURE_INTERNAL_URL = "http://provider-fixture:8080";

/**
 * A key the fixture accepts, and the one the leg stores on the seeded connection. Its rule is
 * the prefix `ouro-e2e-`, as `provider-stub`'s is.
 */
export const FIXTURE_KEY = "ouro-e2e-live-slice";

/**
 * The recording the fixture replays, resolved from this file rather than the working
 * directory — `__dirname` rather than `import.meta.url`, for `support/compose.ts`'s reason.
 */
export const RECORDING_PATH = resolve(
  __dirname,
  "../fixtures/provider-fixture/recordings/live-slice.json",
);

/** One recorded turn: what the harness must have sent to reach it, and what the model answers. */
export interface RecordedTurn {
  readonly expect: { readonly tool_results: readonly { tool_use_id: string; is_error: boolean }[] };
  readonly content: readonly Record<string, unknown>[];
}

/** One recorded session — a stage's whole exchange. */
export interface RecordedSession {
  readonly alias?: string;
  readonly model: string;
  readonly prompt_prefix?: string;
  readonly turns: readonly RecordedTurn[];
  readonly files_after?: Readonly<Record<string, string>>;
}

/** The recording's shape, as far as the suite reads it. */
export interface Recording {
  readonly recording: string;
  readonly format: number;
  readonly recorded_at: string;
  readonly harness: {
    readonly sdk: string;
    readonly cli: string;
    readonly anthropic_version: string;
    readonly anthropic_beta: readonly string[];
    readonly tools: readonly string[];
  };
  readonly sessions: Readonly<Record<string, RecordedSession>>;
}

/**
 * The committed recording.
 *
 * @returns The parsed file.
 * @throws {Error} When it is missing — naming the path and the test that makes one.
 */
export function readRecording(): Recording {
  try {
    return JSON.parse(readFileSync(RECORDING_PATH, "utf8")) as Recording;
  } catch (error) {
    throw new Error(
      `the provider fixture's recording could not be read at ${RECORDING_PATH}: ${String(error)} — ` +
        "record one with ouroboros-engine/tests/test_live_slice_recording.py (OURO_RECORD_LIVE_SLICE=1)",
    );
  }
}

/**
 * Store {@link FIXTURE_KEY} on the seeded fixture connection, through the same rotate route the
 * providers page's **Rotate** uses — it validates the key against the fixture's `/v1/models`
 * first, so a connection this returns from is one the fixture really accepted.
 *
 * @param context - The context to act for; its person must be an owner or admin of the slice's
 *   workspace, with that workspace selected.
 * @returns When the key is stored.
 * @throws {Error} If the context carries no session or the service refused.
 */
export async function setFixtureProviderKey(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "POST",
    `/api/v1/providers/${FIXTURE_CONNECTION_ID}/rotate`,
    { secret: FIXTURE_KEY },
    "storing the recorded fixture's key on the seeded connection",
  );
}

/** One line of the fixture's request log. */
export interface FixtureRequest {
  readonly at: string;
  readonly path: string;
  readonly main: boolean;
  readonly session: string | null;
  readonly turn: number | null;
  readonly model: string | null;
  readonly status: number;
  readonly mismatch?: "harness" | "turn" | "session";
}

/**
 * What the fixture has answered since its last reset.
 *
 * @returns The log, oldest first.
 * @throws {Error} If the fixture is not answering, naming it.
 */
export async function fixtureRequests(): Promise<FixtureRequest[]> {
  const response = await fetch(`${PROVIDER_FIXTURE_URL}/__fixture/requests`).catch(
    (error: unknown) => {
      throw new Error(
        `the provider fixture is not answering at ${PROVIDER_FIXTURE_URL}: ${String(error)}`,
      );
    },
  );

  if (!response.ok) {
    throw new Error(`the provider fixture answered ${String(response.status)} to a log read`);
  }

  return (await response.json()) as FixtureRequest[];
}

/**
 * Forget the fixture's request log, so a leg starts from nothing it did not send.
 *
 * @returns When the fixture has forgotten.
 * @throws {Error} If the fixture is not answering, naming it.
 */
export async function resetProviderFixture(): Promise<void> {
  const response = await fetch(`${PROVIDER_FIXTURE_URL}/__fixture/reset`, { method: "POST" }).catch(
    (error: unknown) => {
      throw new Error(
        `the provider fixture is not answering at ${PROVIDER_FIXTURE_URL}: ${String(error)}`,
      );
    },
  );

  if (!response.ok) {
    throw new Error(`the provider fixture answered ${String(response.status)} to a reset`);
  }
}
