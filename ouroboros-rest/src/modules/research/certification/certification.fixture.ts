/**
 * What the research certification suites stand on (CM.7,
 * [#626](https://github.com/NobuData/ouroboros/issues/626)): the development seeds, applied to the
 * harness's database; the seeded workspace with a person in each role; its investigations found
 * by their display id; and the two things every suite needs to say — "this write is the
 * engine's" and "nothing in this payload is a dollar figure".
 *
 * **Everything is read from the seeds, nothing is a literal id.** A suite asks for `RS-127` and
 * gets whatever row the seed wrote for it; a seed that renumbers or re-ids its rows changes
 * nothing here. The seeds are applied the way `registry.seed.fixture.ts` applies its own — each
 * file as one statement batch, so each runs as one transaction and its deferred constraint
 * triggers (a brief's findings are cited, a route has hops) fire at its commit, exactly as under
 * Flyway — and in Flyway's order, which is the order of their descriptions.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import request from "supertest";

import type { ApiHarness, Method, Person, Workspace } from "../../../testing/harness.fixture";
import { memberOf, SEEDED_WORKSPACE_SLUG } from "../../../testing/registry.seed.fixture";
import { SCHEMA_NAME, type InvestigationStatus } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";

/** `ouroboros-db/migrations`, resolved from this file. */
const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "ouroboros-db", "migrations");

/** The placeholder every seed statement ends on; `true` is what `flyway.seed.toml` makes it. */
const SEED_PLACEHOLDER = "${ouro_dev_seed}";

/** A repeatable migration's file name. */
const REPEATABLE = /^R__(.+)\.sql$/;

/**
 * Every repeatable migration, in the order Flyway applies them: by description, which is the
 * file name between `R__` and `.sql` with its underscores read as spaces.
 *
 * @returns The file names.
 */
export function devSeeds(): string[] {
  const description = (name: string): string =>
    (REPEATABLE.exec(name)?.[1] ?? name).replaceAll("_", " ");

  return readdirSync(MIGRATIONS)
    .filter((name) => REPEATABLE.test(name))
    .sort((left, right) => {
      const [a, b] = [description(left), description(right)];

      return a < b ? -1 : a > b ? 1 : 0;
    });
}

/**
 * Apply the development seeds to the harness's database — the whole development workspace,
 * `acme-robotics`, as `docker compose up` has it.
 *
 * @param api - The running harness. Its database must be disposable: the next `truncate` takes
 *   the seed with everything else.
 */
export async function applyDevSeeds(api: ApiHarness): Promise<void> {
  for (const seed of devSeeds()) {
    const text = readFileSync(join(MIGRATIONS, seed), "utf8").replaceAll(SEED_PLACEHOLDER, "true");

    await api.sql.query(text);
  }
}

/** A seeded investigation, as a suite needs to address it. */
export interface SeededInvestigation {
  readonly id: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly status: InvestigationStatus;
  /** The tool slugs it may use. */
  readonly tools: readonly string[];
}

/** The seeded workspace, with one person in each role. */
export interface SeededResearch {
  readonly workspace: Workspace;
  readonly people: {
    readonly owner: Person;
    readonly admin: Person;
    readonly member: Person;
    readonly viewer: Person;
  };
  /** The `GitHub · acme-robotics` ticket source — the one with a repository. */
  readonly githubSourceId: string;
  /**
   * @param displayId - `RS-127`.
   * @returns The investigation the seed wrote under that id.
   * @throws {Error} When the seed holds no such investigation.
   */
  investigation(displayId: string): Promise<SeededInvestigation>;
  /**
   * A request as somebody, in the seeded workspace.
   *
   * @param person - Who.
   * @param method - The verb.
   * @param path - The path.
   * @returns The Supertest request.
   */
  as(person: Person, method: Method, path: string): request.Test;
}

/**
 * Apply the seeds and open the seeded workspace.
 *
 * @param api - The running harness.
 * @returns The workspace, its people and its lookups.
 */
export async function seedResearch(api: ApiHarness): Promise<SeededResearch> {
  await applyDevSeeds(api);

  const { rows } = await api.sql.query<{ id: string; slug: string; name: string }>(
    `select "id", "slug", "name" from ${SCHEMA_NAME}.organization where "slug" = $1`,
    [SEEDED_WORKSPACE_SLUG],
  );
  const workspace = rows[0];

  if (workspace === undefined) {
    throw new Error(`The development seeds did not create the ${SEEDED_WORKSPACE_SLUG} workspace.`);
  }

  const sources = await api.sql.query<{ id: string }>(
    `select id from ${SCHEMA_NAME}.ticket_sources
      where organization_id = $1 and kind = 'github' order by created_at limit 1`,
    [workspace.id],
  );
  const githubSourceId = sources.rows[0]?.id;

  if (githubSourceId === undefined) {
    throw new Error("The development seeds did not create the workspace's GitHub source.");
  }

  const people = {
    owner: await memberOf(api, workspace, "owner"),
    admin: await memberOf(api, workspace, "admin"),
    member: await memberOf(api, workspace, "member"),
    viewer: await memberOf(api, workspace, "viewer"),
  };

  return {
    workspace,
    people,
    githubSourceId,
    investigation: async (displayId) => {
      const found = await api.sql.query<{
        id: string;
        display_id: string;
        status: InvestigationStatus;
        tools_enabled: string[];
      }>(
        `select id, display_id, status, tools_enabled from ${SCHEMA_NAME}.investigations
          where organization_id = $1 and display_id = $2`,
        [workspace.id, displayId],
      );
      const row = found.rows[0];

      if (row === undefined) throw new Error(`The seeds hold no investigation ${displayId}.`);

      return {
        id: row.id,
        displayId: row.display_id,
        status: row.status,
        tools: row.tools_enabled,
      };
    },
    as: (person, method, path) => api.as(person)(method, path).set(TENANT_HEADER, workspace.slug),
  };
}

/**
 * One of the loop's writes, made the way the engine makes it — the internal research surface,
 * under the shared secret.
 *
 * @param api - The running harness.
 * @param investigationId - The investigation.
 * @param route - `start`, `checkpoint`, `brief` or `finish`.
 * @param body - The write.
 * @returns The Supertest request.
 */
export function loopWrite(
  api: ApiHarness,
  investigationId: string,
  route: "start" | "checkpoint" | "brief" | "finish",
  body: object,
): request.Test {
  const method = route === "checkpoint" ? "put" : "post";

  return request(api.baseUrl)
    [method](`/internal/research/investigations/${investigationId}/${route}`)
    .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
    .send(body);
}

/**
 * A queued investigation in a workspace, as the lifecycle would have inserted it.
 *
 * @param api - The running harness.
 * @param organizationId - The workspace.
 * @param kind - The kind's slug — `gap_analysis`.
 * @param tools - The tools it may use.
 * @returns Its id.
 */
export async function queuedInvestigation(
  api: ApiHarness,
  organizationId: string,
  kind: string,
  tools: readonly string[],
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.investigations (organization_id, kind_id, question, depth, tools_enabled)
     select $1, k.id, 'Why do rivals dock in wind and we do not?', 'quick', $3::jsonb
       from ${SCHEMA_NAME}.investigation_kinds k
      where k.organization_id = $1 and k.slug = $2
     returning id`,
    [organizationId, kind, JSON.stringify(tools)],
  );
  const id = rows[0]?.id;

  if (id === undefined) throw new Error(`The workspace has no ${kind} investigation kind.`);

  return id;
}

/** A key a money figure would sit under. */
const MONEY_KEY = /cents|cost|price|spend|usd|dollar|budget/i;

/** A rendered money figure — `~$6`, `$0.19`, `12¢`, `USD 4`. */
const MONEY_TEXT = /\$\s?\d|\d\s?¢|\bUSD\b/;

/**
 * Every place a payload mentions money — the assertion behind *an unpriced estimate carries no
 * dollar figure anywhere*. A rendered figure in any string, or a number under a key that names
 * money, counts; a `null` under such a key is what "unpriced" looks like and does not.
 *
 * @param payload - Any JSON value.
 * @param path - Where it sits, for the message.
 * @returns One line per mention, each naming its path; empty when the payload mentions none.
 */
export function moneyMentions(payload: unknown, path = "$"): string[] {
  if (typeof payload === "string") {
    return MONEY_TEXT.test(payload) ? [`${path}: "${payload}"`] : [];
  }

  if (typeof payload !== "object" || payload === null) return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => moneyMentions(item, `${path}[${String(index)}]`));
  }

  return Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) => {
    const here = `${path}.${key}`;

    if (MONEY_KEY.test(key) && typeof value === "number") return [`${here} = ${String(value)}`];

    return moneyMentions(value, here);
  });
}

/**
 * A value resolved on first use — for an adapter that is built before the application it reads
 * from exists. Every property read and every call goes to whatever `get()` answers.
 *
 * @param get - Where the real value comes from, once there is one.
 * @returns A stand-in with the value's type.
 */
export function lazily<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get: (_target, property) => {
      const real = get();
      const value: unknown = Reflect.get(real, property);

      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  });
}
