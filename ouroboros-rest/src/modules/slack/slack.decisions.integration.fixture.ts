/**
 * A run, and the blocking question it raises in a Slack channel, for the Chat Ops integration
 * suites (BZ.6, [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * **Nothing here is planted.** The question is the one a real run raises: a driver reports a
 * change-set over the internal channel, AP.3 judges it against the workspace's protected paths,
 * the guardrail plane files a `protected_path_allow_once` decision, the publisher hears it filed
 * and intends its card, and a dispatch pass posts it to the bound loops channel of the Slack
 * harness. A suite then presses the buttons Slack was actually sent.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { ACME, BENCH_SIMULATOR_SECRET, type ChatBench } from "../../testing/chatops.bench.fixture";
import type { SeededWorkspace } from "../../testing/dashboard.fixture";
import type { Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type {
  Emitted,
  HarnessTeam,
  PostedMessage,
  RecordedReply,
} from "../../testing/slack.harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { type IngestBench, seedIngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { ANSWER_ACTION_PREFIX } from "./slack.blockkit";
import type { SlackChannelResource } from "./slack.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";

/** Slack's id of the loops channel every scene binds — {@link ACME}'s first. */
export const LOOPS = "C0LOOPS";

/** The decision kind a protected-path touch raises. */
export const ALLOW_ONCE_KIND = "protected_path_allow_once";

/** A workspace whose repository protects `boot/**`, with Slack installed and loops bound. */
export interface DecisionScene {
  /** The owner — linked to Slack as `U0KEN`. */
  readonly owner: Person;
  /** The workspace, its repository and what opens a run in it. */
  readonly ingest: IngestBench;
  /** The bound loops channel. */
  readonly loops: SlackChannelResource;
}

/** A question a run raised. */
export interface Question {
  /** `runs.id` — the run that touched the path. */
  readonly run: string;
  /** The protected path it touched. */
  readonly path: string;
  /** `decision_items.id`. */
  readonly item: string;
}

/**
 * Stand up the scene: an owner, a workspace protecting `boot/**`, Slack installed, the loops
 * channel bound (which switches on *Blocking questions*, with its *+ DM on-call* affix), and the
 * owner's Slack identity linked.
 *
 * @param bench - The bench.
 * @returns The scene.
 */
export async function decisionScene(bench: ChatBench): Promise<DecisionScene> {
  const owner = await bench.api.signUp();
  const ingest = await seedIngestBench(bench.api, owner);

  await protectBoot(bench, ingest.workspace);
  await bench.install(owner, ingest.workspace, ACME);

  const loops = await bench.bind(owner, ingest.workspace, LOOPS, "loops");

  await bench.link(ACME, "U0KEN", owner);

  return { owner, ingest, loops };
}

/** A workspace with Slack installed and a channel bound for each purpose. */
export interface BoundScene {
  readonly owner: Person;
  /** The workspace, its repository and what opens a run in it. */
  readonly ingest: IngestBench;
  readonly loops: SlackChannelResource;
  readonly alerts: SlackChannelResource;
  readonly leads: SlackChannelResource;
}

/**
 * Maya's workspace, with {@link ACME} installed and a channel bound for each purpose — so every
 * default route has somewhere to go.
 *
 * @param bench - The bench.
 * @returns The scene.
 */
export async function boundScene(bench: ChatBench): Promise<BoundScene> {
  const owner = await bench.api.signIn({ displayName: "Maya Chen" });
  const ingest = await seedIngestBench(bench.api, owner);

  await bench.install(owner, ingest.workspace, ACME);

  return {
    owner,
    ingest,
    loops: await bench.bind(owner, ingest.workspace, LOOPS, "loops"),
    alerts: await bench.bind(owner, ingest.workspace, "C0ALERTS", "alerts"),
    leads: await bench.bind(owner, ingest.workspace, "C0LEADS", "leads"),
  };
}

/**
 * Protect `boot/**` in a workspace's repository, so a run that touches it is refused by AP.3.
 * Asking twice protects it once.
 *
 * @param bench - The bench.
 * @param workspace - The workspace and its repository.
 */
export async function protectBoot(bench: ChatBench, workspace: SeededWorkspace): Promise<void> {
  await bench.api.sql.query(
    `insert into ${SCHEMA_NAME}.protected_path_policies (organization_id, repo_ref, path_glob)
     select $1, o.login || '/' || r.name, 'boot/**'
       from ${SCHEMA_NAME}.github_repos r
       join ${SCHEMA_NAME}.github_orgs o on o.id = r.org_id
      where r.id = $2
     on conflict do nothing`,
    [workspace.id, workspace.repoId],
  );
}

/**
 * Call the internal channel as the simulated driver.
 *
 * @param bench - The bench.
 * @param method - The verb.
 * @param path - The internal route.
 * @param body - Its body.
 * @returns The request.
 */
export function simulator(bench: ChatBench, method: "post" | "put", path: string, body: unknown) {
  return bench.api
    .anonymous(method, path)
    .set(INTERNAL_KEY_HEADER, BENCH_SIMULATOR_SECRET)
    .send(body as object);
}

/**
 * Open a run of a workspace.
 *
 * @param bench - The bench.
 * @param ingest - The workspace and what opens a run in it.
 * @param key - The idempotency key.
 * @returns `runs.id`.
 */
export async function openRun(bench: ChatBench, ingest: IngestBench, key: string): Promise<string> {
  return bodyOf<RunOpenedResource>(
    await simulator(bench, "post", "/internal/runs", {
      idempotencyKey: key,
      ...ingest.open,
    }).expect(201),
  ).id;
}

/**
 * Have a real run touch a path: open it, move it into `implement`, and report the change-set.
 * In a workspace that protects the path, AP.3 refuses it and files the allow-once question.
 *
 * @param bench - The bench.
 * @param ingest - The workspace and what opens a run in it.
 * @param name - What tells this run's requests from another's — their idempotency keys.
 * @param path - The path touched.
 * @returns The run, and AP.3's verdict on the touch — `pass` or `fail`.
 */
export async function touchingRun(
  bench: ChatBench,
  ingest: IngestBench,
  name: string,
  path: string,
): Promise<{ run: string; verdict: string | undefined }> {
  const run = await openRun(bench, ingest, `open-${name}`);

  await simulator(bench, "post", `/internal/runs/${run}/stage-transitions`, {
    idempotencyKey: `implement-${name}`,
    stageKey: "implement",
    status: "active",
  }).expect(200);

  return { run, verdict: await touch(bench, run, path, `files-${name}-0`) };
}

/**
 * Report a change-set of a run touching a path, and read AP.3's verdict on it.
 *
 * @param bench - The bench.
 * @param run - The run.
 * @param path - The path touched.
 * @param key - The report's idempotency key.
 * @returns The run's latest `allowed_paths` verdict — `pass` or `fail`.
 */
export async function touch(
  bench: ChatBench,
  run: string,
  path: string,
  key: string,
): Promise<string | undefined> {
  await simulator(bench, "put", `/internal/runs/${run}/files`, {
    idempotencyKey: key,
    files: [{ path, status: "modified", additions: 2, deletions: 1 }],
  }).expect(200);

  return verdictOf(bench, run);
}

/**
 * AP.3's standing verdict on a run's protected paths.
 *
 * @param bench - The bench.
 * @param run - The run.
 * @returns The run's latest `allowed_paths` verdict — `pass` or `fail`.
 */
export async function verdictOf(bench: ChatBench, run: string): Promise<string | undefined> {
  const { rows } = await bench.api.sql.query<{ verdict: string }>(
    `select verdict from ${SCHEMA_NAME}.v_run_guardrails_latest
      where run_id = $1 and "check" = 'allowed_paths'`,
    [run],
  );

  return rows[0]?.verdict;
}

/**
 * Have a real run raise the question: open it, move it into `implement`, and report a touch of
 * a protected path. Returns once the publisher has intended the question's card.
 *
 * @param bench - The bench.
 * @param scene - The scene.
 * @param name - What tells this run from the scene's others — its idempotency key and its file.
 * @returns The run, the path and the decision it raised.
 */
export async function ask(bench: ChatBench, scene: DecisionScene, name = "a"): Promise<Question> {
  const path = `boot/rollback_${name}.c`;
  const { run, verdict } = await touchingRun(bench, scene.ingest, name, path);

  if (verdict !== "fail") {
    throw new Error(`The touch of ${path} was not refused, so no question was raised.`);
  }

  const item = await bench.slack.waitFor(async () => {
    const { rows } = await bench.api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.decision_items
        where organization_id = $1 and kind_id = $2 and source_ref = $3`,
      [scene.ingest.workspace.id, ALLOW_ONCE_KIND, `run:${run}:path:${path}`],
    );

    return rows[0]?.id;
  }, `the decision run ${run} raised`);

  await intended(bench, item, "post");

  return { run, path, item };
}

/**
 * Wait until the publisher — which hears the lifecycle after the caller has moved on — has
 * written an intent for a decision.
 *
 * @param bench - The bench.
 * @param item - The decision.
 * @param operation - `post` for its card, `update` for an edit of it.
 * @returns How many such intents there are.
 */
export async function intended(
  bench: ChatBench,
  item: string,
  operation: "post" | "update",
): Promise<number> {
  return bench.slack.waitFor(async () => {
    const { rows } = await bench.api.sql.query<{ n: string }>(
      `select count(*) as n from ${SCHEMA_NAME}.chat_outbox
        where decision_item_id = $1 and operation = $2`,
      [item, operation],
    );

    return Number(rows[0]?.n) > 0 ? Number(rows[0]?.n) : undefined;
  }, `a ${operation} intent for decision ${item}`);
}

/**
 * The card of a decision as it now stands in a Slack conversation.
 *
 * @param bench - The bench.
 * @param item - The decision.
 * @param channel - Slack's id of the channel or DM. The loops channel by default.
 * @returns The message, or undefined when no card of that decision was posted there.
 */
export async function cardOf(
  bench: ChatBench,
  item: string,
  channel: string = LOOPS,
): Promise<PostedMessage | undefined> {
  const { rows } = await bench.api.sql.query<{ platform_ts: string }>(
    `select m.platform_ts
       from ${SCHEMA_NAME}.chat_messages m
       join ${SCHEMA_NAME}.chat_channels ch on ch.id = m.channel_id
      where m.decision_item_id = $1 and m.kind = 'decision_card'
        and ch.channel_id = $2 and m.platform_ts is not null`,
    [item, channel],
  );

  return bench.slack.messagesIn(channel).find((message) => message.ts === rows[0]?.platform_ts);
}

/**
 * The card of a decision in the loops channel, which must be there.
 *
 * @param bench - The bench.
 * @param item - The decision.
 * @param channel - Slack's id of the conversation.
 * @returns The message.
 * @throws {Error} When it was never posted.
 */
export async function postedCard(
  bench: ChatBench,
  item: string,
  channel: string = LOOPS,
): Promise<PostedMessage> {
  const card = await cardOf(bench, item, channel);

  if (card === undefined) {
    throw new Error(`Decision ${item} has no card in ${channel}.`);
  }

  return card;
}

/**
 * An answering button of a card, as Slack was sent it.
 *
 * @param bench - The bench.
 * @param card - The card.
 * @param label - The button's label — `Allow once`.
 * @returns Its `action_id` and signed `value`.
 * @throws {Error} When the card carries no such answering button.
 */
export function answerButton(
  bench: ChatBench,
  card: PostedMessage,
  label: string,
): { actionId: string; value: string } {
  const button = bench.slack
    .buttonsOf(card)
    .find((one) => one.label === label && one.actionId?.startsWith(ANSWER_ACTION_PREFIX));

  if (button?.actionId === undefined || button.value === undefined) {
    throw new Error(`The card carries no answering button labelled ${label}.`);
  }

  return { actionId: button.actionId, value: button.value };
}

/**
 * Press a button as a Slack user and wait for what they are told.
 *
 * @param bench - The bench.
 * @param user - Slack's id of who presses.
 * @param action - The button.
 * @param message - The message it is on, or null for a press that names none.
 * @param team - The Slack workspace the press arrives from. {@link ACME} by default.
 * @returns The acknowledgement and the ephemeral reply.
 */
export function press(
  bench: ChatBench,
  user: string,
  action: { actionId: string; value: string },
  message: { channel: string; ts: string } | null,
  team: HarnessTeam = ACME,
): Promise<{ emitted: Emitted; reply: RecordedReply; text: string }> {
  return bench.press({ team: team.id, user, action, message });
}

/**
 * A member of the scene's workspace with a linked Slack identity.
 *
 * @param bench - The bench.
 * @param scene - The scene.
 * @param role - Their role.
 * @param slackUser - Their Slack id — one of {@link ACME}'s users.
 * @param name - Their display name.
 * @returns The person.
 */
export async function linkedMember(
  bench: ChatBench,
  scene: DecisionScene,
  role: "admin" | "member" | "viewer",
  slackUser: string,
  name: string,
): Promise<Person> {
  const person = await bench.member(scene.ingest.workspace, role, name);

  await bench.link(ACME, slackUser, person);

  return person;
}

/**
 * Designate the workspace's on-call person, through its route.
 *
 * @param bench - The bench.
 * @param scene - The scene.
 * @param person - Who — a member with a linked Slack identity.
 */
export async function designateOnCall(
  bench: ChatBench,
  scene: DecisionScene,
  person: Person,
): Promise<void> {
  const { rows } = await bench.api.sql.query<{ id: string }>(
    `select "id" from ${SCHEMA_NAME}.member where "organizationId" = $1 and "userId" = $2`,
    [scene.ingest.workspace.id, person.id],
  );

  await bench.api
    .as(scene.owner)("put", "/api/v1/chat/on-call")
    .set(TENANT_HEADER, scene.ingest.workspace.slug)
    .send({ memberId: rows[0]?.id })
    .expect(200);
}

/**
 * How a decision stands.
 *
 * @param bench - The bench.
 * @param item - The decision.
 * @returns Its status, when it escalated, and how many resolutions and exceptions it has.
 */
export async function standing(
  bench: ChatBench,
  item: string,
): Promise<{ status: string; escalatedAt: Date | null; resolutions: number; grants: number }> {
  const { rows } = await bench.api.sql.query<{
    status: string;
    escalated_at: Date | null;
    resolutions: string;
    grants: string;
  }>(
    `select i.status, i.escalated_at,
            (select count(*) from ${SCHEMA_NAME}.decision_resolutions r where r.item_id = i.id)
              as resolutions,
            (select count(*) from ${SCHEMA_NAME}.guardrail_exceptions g
              where g.granted_via = i.id) as grants
       from ${SCHEMA_NAME}.decision_items i where i.id = $1`,
    [item],
  );
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`There is no decision ${item}.`);
  }

  return {
    status: row.status,
    escalatedAt: row.escalated_at,
    resolutions: Number(row.resolutions),
    grants: Number(row.grants),
  };
}
