/**
 * Leg 30's chain — Chat Ops against Slack: install → publish → answer → command → escalation
 * ([#545](https://github.com/NobuData/ouroboros/issues/545), CA.5 — the Chat Ops MVP gate).
 *
 * Each piece of the integration passes its own tests: the cards render, the buttons post, the
 * commands parse. What none of those shows is the composition — cards that render and never
 * publish, a press that is acknowledged and resumes nothing, a command that answers in Slack and
 * not in the console. This file walks the whole path against `fixtures/slack-stub`, the suite's
 * own Slack: `ouroboros-rest` posts to it over its real client, and the suite sends it the
 * events, commands and button presses Slack would, signed (`support/slack.ts`).
 *
 * ```
 * install + bind ─▶ a simulated loop stops ─▶ the card is PUBLISHED ─▶ the mirror shows it in a poll
 *   ─▶ [Allow once] pressed in Slack ─▶ the driver's run RESUMES ─▶ the card is edited and the
 *      system line posted (Slack and mirror) ─▶ /ouro status + /ouro queue: Slack ≡ console
 * a route moved ─▶ the next card lands in the other channel ─▶ nobody answers ─▶ the timer
 *   fires: the on-call DM, the card's annotation, the inbox's priority
 *   ─▶ Slack refuses a post ─▶ the publish-health banner ─▶ Retry ─▶ delivered, banner gone
 * the bot is removed from a channel ─▶ the mirror says so, and the way back
 * Slack revokes the app ─▶ the page says so, the mirror is history ─▶ Re-install ─▶ connected
 * ```
 *
 * **Why it is named for Slack and not for the page.** Playwright runs the suite's files in name
 * order, and this one answers decisions in the seeded workspace. The inbox leg counts the seed's
 * week of them, the dashboard leg its runs; both sort before `slack`, as every leg that is
 * cold-only does. `specs/chatops.spec.ts` — the seeded page, read without writing — sorts early.
 *
 * **What it borrows and gives back.** The seeded workspace's Slack connection holds a token no
 * Slack honours (SQL cannot seal one), so the leg re-installs it against the stub and binds one
 * channel of its own (`#e2e-drills`) for alerts — which takes that purpose from the seeded
 * channel, a purpose having one. Afterwards it restores the connection row, the seeded
 * channel's binding, the one route it moved and the escalation window it shortened. The cards
 * it published stay in the mirror's record, as a run of any leg's simulator stays in the run
 * list.
 *
 * **It can go red, and says where** — `scripts/verify-chatops.sh` breaks publishing, the
 * interactivity handler, the dispatcher and the timer in turn (`support/chatops.ts` § the
 * breakages) and requires the test that should notice to fail naming it.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  CHATOPS_COPY,
  DRILLS,
  LEG_TEAM,
  SEEDED_CHANNELS,
  SEEDED_CONNECTION_ID,
  approveInstallIn,
  brokenChatOps,
  channelBySlackId,
  connectionOf,
  drawnChatOps,
  drainDelivery,
  holdSeededConnection,
  installSlack,
  openChatOps,
} from "../support/chatops";
import { psql } from "../support/insights";
import { quietly, requestAs } from "../support/rest";
import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { type Simulation, startSimulation } from "../support/simulator";
import {
  type SlackMessage,
  buttonsOf,
  declareTeam,
  emitCommand,
  emitPress,
  resetSlack,
  revokeTeam,
  scriptSlack,
  setBotMembership,
  slackCalls,
  slackMessages,
  slackReplies,
  textOf,
} from "../support/slack";
import { selectWorkspace } from "../support/workspace";

/** The driver's scenario: a loop that stops on a protected path and asks (#470). */
const SCENARIO = "protected-path-allow-once";

/** Its speed: the stop is filed about fifteen real seconds in, and the rest is over in one. */
const SPEED = 20;

/** The decision kind the scenario files. */
const KIND = "protected_path_allow_once";

/** The route that publishes it, by kind and by the routing card's label. */
const QUESTIONS_ROUTE = { kind: "custom:blocking-questions", label: "Blocking questions" } as const;

/** The route an escalated question's direct message travels by, and what the banner calls it. */
const ON_CALL_DM = { kind: "needs_you_dm", label: "On-call DM" } as const;

/** The seeded owner as Slack knows him — linked, and on call for decisions. */
const KEN = { slack: "U07KEN", dm: "D07KEN" } as const;

/** How long the leg lets a question go unanswered before its timer fires. */
const ESCALATION_SECONDS = 6;

/** How long a publish may take: the stop is ~15 s in, and the dispatcher ticks every 5 s. */
const PUBLISH_TIMEOUT_MS = 50_000;

/** How long the page's own poll may take to show something — its cadence is 15 s. */
const POLL_TIMEOUT_MS = 25_000;

/** One item of the inbox queue, as far as this leg reads it. */
interface QueueItem {
  readonly id: string;
  readonly kindId: string;
  readonly escalatedAt: string | null;
  readonly refs: readonly { readonly type: string; readonly id: string }[];
}

/**
 * Wait for a promise, but not for ever — the driver's exit, which a stuck hold would never give.
 *
 * @param promise - What is awaited.
 * @param ms - How long.
 * @param what - What it is, for the failure.
 * @returns What it resolved with.
 */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} did not come within ${String(ms)}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The message about one loop in a channel, as Slack now holds it.
 *
 * @param channel - The channel's Slack id.
 * @param loopSeq - The loop.
 * @param starting - What its fallback text starts with — `⏸` for the card, `✓ Ken` for the line.
 * @returns The message, or undefined until there is one.
 */
async function messageOf(
  channel: string,
  loopSeq: number,
  starting = "",
): Promise<SlackMessage | undefined> {
  return (await slackMessages(channel)).find(
    (message) =>
      textOf(message).includes(`loop #${String(loopSeq)}`) && message.text.includes(starting),
  );
}

/**
 * The published decision card of a loop, once Slack has it.
 *
 * @param channel - The channel it should land in.
 * @param loopSeq - The loop.
 * @returns The card.
 */
async function publishedCard(channel: string, loopSeq: number): Promise<SlackMessage> {
  let card: SlackMessage | undefined;

  await expect
    .poll(
      async () => {
        card = await messageOf(channel, loopSeq, "Allow a one-time edit to a protected path?");
        return card !== undefined;
      },
      {
        message: `the decision card for loop #${String(loopSeq)} must be published to Slack channel ${channel}`,
        timeout: PUBLISH_TIMEOUT_MS,
      },
    )
    .toBe(true);

  return card as SlackMessage;
}

/**
 * The inbox item a run's stop filed.
 *
 * @param context - Whose session.
 * @param runId - The run.
 * @returns The item, or undefined while there is none.
 */
async function stopOf(context: BrowserContext, runId: string): Promise<QueueItem | undefined> {
  const queue = await requestAs<{ items: readonly QueueItem[] }>(
    context,
    "GET",
    "/api/v1/inbox",
    null,
    "GET /api/v1/inbox",
  );

  return queue?.items.find(
    (item) =>
      item.kindId === KIND && item.refs.some((ref) => ref.type === "run" && ref.id === runId),
  );
}

/**
 * Press **Allow once** on a card, in Slack, as Ken.
 *
 * @param card - The card, as Slack holds it.
 * @param tampered - Whether the press is signed with a secret that is not the app's.
 * @returns The service's acknowledgement.
 */
async function pressAllowOnce(card: SlackMessage, tampered = false) {
  const allow = buttonsOf(card).find((button) => button.label === "Allow once");

  expect(allow, "the published card must carry an Allow once button").toBeDefined();

  return emitPress(
    {
      team: LEG_TEAM.id,
      user: KEN.slack,
      button: allow ?? { actionId: "", value: "" },
      message: card,
    },
    tampered ? { secret: "not-the-apps-signing-secret-0123456789" } : {},
  );
}

/**
 * Run `/ouro <text>` in Slack and read its result off the `response_url`.
 *
 * @param text - The text after `/ouro`.
 * @returns What the dispatcher answered.
 */
async function inSlack(text: string): Promise<string> {
  const sent = await emitCommand({
    team: LEG_TEAM.id,
    user: KEN.slack,
    channel: SEEDED_CHANNELS.loops.slack,
    text,
  });

  expect(sent.status, `Slack's /ouro ${text} must be acknowledged: ${sent.body}`).toBe(200);

  let replies: readonly string[] = [];

  await expect
    .poll(async () => (replies = await slackReplies(sent.replyPath)).length, {
      message: `/ouro ${text} must be answered at its response_url`,
    })
    .toBeGreaterThan(0);

  return replies[0] ?? "";
}

/**
 * Run `/ouro <text>` from the in-app console.
 *
 * @param context - Whose session.
 * @param text - The text after `/ouro`.
 * @returns What the dispatcher answered.
 */
async function inConsole(context: BrowserContext, text: string): Promise<string> {
  const ran = await requestAs<{ reply?: { text?: string } }>(
    context,
    "POST",
    "/api/v1/chat/commands",
    { text: `/ouro ${text}` },
    `the console's /ouro ${text}`,
  );

  return ran?.reply?.text ?? "";
}

/** The mirror showing on a page, whichever channel's it is. */
function mirror(page: Page, channel: string): Locator {
  return page.getByRole("region", { name: `Mirror of #${channel}` });
}

test.describe("leg 30: chat ops — the chain, against Slack", () => {
  test.describe.configure({ mode: "serial" });

  let owner: BrowserContext;
  let restoreConnection: (() => Promise<void>) | undefined;
  /** The leg's own channel, by its id in this workspace. */
  let drillsId = "";
  /** Simulations still running, to be stopped whatever happened. */
  const simulations: Simulation[] = [];

  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    await signIn(owner, SEED_OWNER.id);
    await selectWorkspace(owner, SEED_TENANT.slug);

    // First, and before anything is written: with the stub gone this is where the leg stops, by
    // name, leaving the stack as it found it.
    await resetSlack();
    await declareTeam(LEG_TEAM);

    restoreConnection = await holdSeededConnection();
    await installSlack(owner);

    // A run of this leg that stopped half-way may have left the route on the leg's channel.
    await requestAs(
      owner,
      "PATCH",
      `/api/v1/settings/notifications/${encodeURIComponent(QUESTIONS_ROUTE.kind)}`,
      { chatChannelId: SEEDED_CHANNELS.loops.id },
      "pointing the questions route at the seeded channel",
    );

    // And its outbox — or an earlier leg's, which the seeded token could not deliver — may hold
    // messages: they go now, so the chain starts from a quiet queue.
    await drainDelivery(owner);

    const drills = await channelBySlackId(owner, DRILLS.slack);

    drillsId = drills.id;
    if (drills.purpose === null) {
      await requestAs(
        owner,
        "PUT",
        `/api/v1/slack/channels/${drills.id}/binding`,
        { purpose: "alerts" },
        "binding the leg's channel",
      );
    }
  });

  test.afterAll(async () => {
    for (const simulation of simulations) simulation.stop();

    await quietly(
      () =>
        psql(
          `delete from ouroboros.decision_escalation_overrides ` +
            `where organization_id = '${SEED_TENANT.id}' and kind_id = '${KIND}'`,
        ).then(() => undefined),
      "the leg's escalation window is still in place; later questions of its kind escalate in seconds.",
    );
    await quietly(
      () =>
        requestAs(
          owner,
          "PATCH",
          `/api/v1/settings/notifications/${encodeURIComponent(QUESTIONS_ROUTE.kind)}`,
          { chatChannelId: SEEDED_CHANNELS.loops.id },
          "putting the questions route back",
        ).then(() => undefined),
      "the questions route still points at the leg's channel.",
    );
    if (drillsId !== "") {
      await quietly(
        () =>
          requestAs(
            owner,
            "DELETE",
            `/api/v1/slack/channels/${drillsId}/binding`,
            null,
            "unbinding the leg's channel",
          ).then(() => undefined),
        "the leg's channel is still bound.",
      );
    }
    // A purpose has one channel: binding the leg's for alerts took that purpose from the seeded
    // one, and its routes with it. Binding the seeded channel again points them back.
    await quietly(
      () =>
        requestAs(
          owner,
          "PUT",
          `/api/v1/slack/channels/${SEEDED_CHANNELS.alerts.id}/binding`,
          { purpose: "alerts" },
          "binding the seeded alerts channel again",
        ).then(() => undefined),
      "the seeded alerts channel was left unbound; build failures post nowhere.",
    );
    if (restoreConnection !== undefined) {
      await quietly(
        restoreConnection,
        "the seeded Slack connection was not restored; the strip reads the stub's install.",
      );
    }
    await quietly(resetSlack, "the Slack stub still holds the leg's workspace.");
    await owner.close();
  });

  test("install and bind: the consent screen's return connects, and a channel bound in the picker is listed", async ({
    context,
    page,
  }) => {
    // ---- Start from a channel that is listed and not bound: the picker's own work.
    await requestAs(
      owner,
      "DELETE",
      `/api/v1/slack/channels/${drillsId}/binding`,
      null,
      "unbinding",
    );

    const exchanged = (await slackCalls("oauth.v2.access")).length;

    await openChatOps(context, page);
    await approveInstallIn(page);

    // ---- The install, as a browser makes it: to Slack's consent screen and back.
    await page.goto("/api/v1/slack/oauth/install");
    await expect(page).toHaveURL(/\/settings\?slack=connected#integrations$/);
    expect(
      (await slackCalls("oauth.v2.access")).length,
      "the code must be exchanged with Slack — which here is the stub, at OURO_SLACK_API_BASE_URL",
    ).toBe(exchanged + 1);
    expect(
      (await slackCalls("conversations.list")).length,
      "an install lists the channels",
    ).toBeGreaterThan(0);

    const connection = await connectionOf(owner);

    expect(connection.state).toBe("connected");
    expect(
      connection.viewerLinked,
      "the owner's link survives a re-install of the same workspace",
    ).toBe(true);

    // ---- Bind the channel the install just listed.
    await page.goto("/chatops");
    await drawnChatOps(page);
    await expect(page.getByRole("region", { name: CHATOPS_COPY.health })).toContainText("active");

    await page.getByRole("button", { name: CHATOPS_COPY.addChannel }).click();

    const picker = page.getByRole("dialog", { name: CHATOPS_COPY.pickerTitle });

    await picker.getByRole("button", { name: new RegExp(`^#${DRILLS.name}\\b`) }).click();
    await picker.getByRole("radio", { name: /^Alerts/ }).check();
    await picker.getByRole("button", { name: CHATOPS_COPY.bind, exact: true }).click();

    await expect
      .poll(async () => (await channelBySlackId(owner, DRILLS.slack)).purpose, {
        message: "the picker's Bind must bind the channel for alerts",
      })
      .toBe("alerts");

    await picker.getByRole("button", { name: CHATOPS_COPY.done }).click();
    await expect(
      page.getByRole("region", { name: CHATOPS_COPY.boundTitle }).getByText(`#${DRILLS.name}`),
    ).toBeVisible();
  });

  test("publish, answer, resume: a card reaches Slack and the mirror, Allow once pressed there resumes the loop, and both surfaces answer a command alike", async ({
    context,
    page,
  }) => {
    test.slow();

    // The mirror, open before anything happens: what arrives must arrive on its own poll.
    await openChatOps(context, page, { channel: SEEDED_CHANNELS.loops.id });

    const stream = mirror(page, SEEDED_CHANNELS.loops.name).getByRole("log", {
      name: CHATOPS_COPY.stream,
    });

    await expect(stream).toBeVisible();

    if (brokenChatOps("publishing")) {
      // Slack refuses every post from here on: nothing can be published.
      await scriptSlack(
        "chat.postMessage",
        ...Array.from({ length: 60 }, () => ({ error: "invalid_blocks" })),
      );
    }

    // ---- A loop stops on its protected path, and the plane publishes the question.
    const run = await startSimulation(SCENARIO, SPEED);

    simulations.push(run);

    const loop = `loop #${String(run.loopSeq)}`;
    const card = await publishedCard(SEEDED_CHANNELS.loops.slack, run.loopSeq);

    expect(card.text).toContain("⏸");

    // ---- …and the mirror shows it within a poll, without a reload.
    await expect(
      stream.getByText(loop).first(),
      "the mirror must show the published card within a poll",
    ).toBeVisible({
      timeout: POLL_TIMEOUT_MS,
    });

    // ---- Allow once, pressed in Slack — by the fixture, signed as Slack signs.
    const pressed = await pressAllowOnce(card, brokenChatOps("interactivity"));

    expect(
      pressed.status,
      `the interactivity handler must accept a signed Allow once press: ${pressed.body}`,
    ).toBe(200);

    let answer: readonly string[] = [];

    await expect
      .poll(async () => (answer = await slackReplies(pressed.replyPath)).length, {
        message: "the press must be answered at its response_url",
      })
      .toBeGreaterThan(0);
    expect(answer[0]).toContain("Answered: Allow once");

    // ---- The effect: the hold ended. The driver, waiting on a resume, was sent one and claimed
    // it — which is the press in Slack reaching the run. (Whether the resumed change-set then
    // passes its guardrails is the guardrail plane's, and the inbox leg's to hold: an in-app
    // answer and this one go through the same executor.)
    const { code, output } = await within(run.finished, 60_000, "the driver's exit");

    expect(output, "the press in Slack must resume the driver's run").toContain(
      "resume: resumed at implement",
    );
    expect(code).toBe(0);

    // ---- The card is edited in place — answered, its buttons gone — and the system line posted.
    const line = `✓ ${SEED_OWNER.displayName} answered: allow once — ${loop}`;

    await expect
      .poll(
        async () =>
          (await slackMessages(SEEDED_CHANNELS.loops.slack)).find((one) => one.ts === card.ts)
            ?.edits,
        {
          message: "the card in Slack must be updated once it is answered (chat.update)",
          timeout: PUBLISH_TIMEOUT_MS,
        },
      )
      .toBeGreaterThan(0);

    const answered = (await slackMessages(SEEDED_CHANNELS.loops.slack)).find(
      (one) => one.ts === card.ts,
    );

    expect(answered?.text).toContain("✓");
    expect(buttonsOf(answered ?? card), "an answered card offers nothing to press").toEqual([]);

    await expect
      .poll(
        async () =>
          (await messageOf(SEEDED_CHANNELS.loops.slack, run.loopSeq, "answered: allow once"))?.text,
        {
          message: "the system line must be posted to Slack",
          timeout: PUBLISH_TIMEOUT_MS,
        },
      )
      .toBe(line);
    await expect(
      stream.getByText(line),
      "the mirror must show the system line within a poll",
    ).toBeVisible({
      timeout: POLL_TIMEOUT_MS,
    });

    // ---- Command parity: what Slack is answered, the console is answered.
    if (brokenChatOps("dispatcher")) {
      await psql(
        `update ouroboros.chat_connections set status = 'error', status_detail = 'e2e_break' ` +
          `where id = '${SEEDED_CONNECTION_ID}'`,
      );
    }

    try {
      // `status` reads the plane; `queue` is a write, so it is run on a ticket the plane refuses
      // — the same refusal from both surfaces, and nothing queued twice.
      for (const text of ["status", "queue #482"]) {
        const slack = await inSlack(text);
        const here = await inConsole(owner, text);

        expect(slack, `/ouro ${text} must answer something in Slack`).not.toBe("");
        expect(
          slack,
          `command parity: the console result ≡ the Slack result for /ouro ${text}`,
        ).toBe(here);
      }

      expect(await inSlack("status")).toMatch(/loops live · \d+ queued/);
    } finally {
      if (brokenChatOps("dispatcher")) {
        await psql(
          `update ouroboros.chat_connections set status = 'active', status_detail = null ` +
            `where id = '${SEEDED_CONNECTION_ID}'`,
        );
      }
    }
  });

  test("route, escalate, dead-letter: a moved route changes delivery, an unanswered question escalates, and a refused post raises the banner until it is retried", async ({
    context,
    page,
  }) => {
    test.slow();

    await openChatOps(context, page, { channel: drillsId });

    // ---- The routing edit, on the card: questions go to the leg's channel instead.
    const routing = page.getByRole("region", { name: CHATOPS_COPY.routingTitle });
    const picker = routing.getByRole("combobox", { name: `Channel for ${QUESTIONS_ROUTE.label}` });

    await picker.selectOption({ label: `#${DRILLS.name}` });
    await expect
      .poll(
        async () =>
          (
            await psql(
              `select chat_channel_id from ouroboros.notification_routes ` +
                `where organization_id = '${SEED_TENANT.id}' and kind = '${QUESTIONS_ROUTE.kind}'`,
            )
          ).trim(),
        { message: "the routing edit must be stored" },
      )
      .toBe(drillsId);

    // It round-trips: a reload reads back what was written.
    await page.reload();
    await drawnChatOps(page);
    await expect(picker).toHaveValue(drillsId);

    // ---- A short window, so a question nobody answers escalates while the leg watches.
    if (!brokenChatOps("timer")) {
      await psql(
        `insert into ouroboros.decision_escalation_overrides (organization_id, kind_id, escalation_window) ` +
          `values ('${SEED_TENANT.id}', '${KIND}', interval '${String(ESCALATION_SECONDS)} seconds') ` +
          `on conflict (organization_id, kind_id) do update set escalation_window = excluded.escalation_window`,
      );
    }

    const run = await startSimulation(SCENARIO, SPEED);

    simulations.push(run);

    const loop = `loop #${String(run.loopSeq)}`;

    // ---- Delivery followed the edit: the card is in the leg's channel, and not in the old one.
    const card = await publishedCard(DRILLS.slack, run.loopSeq);

    expect(
      await messageOf(SEEDED_CHANNELS.loops.slack, run.loopSeq),
      "a routing edit must change delivery: nothing of this loop goes to the old channel",
    ).toBeUndefined();

    // ---- Nobody answers. The timer fires: priority in the inbox…
    await expect
      .poll(async () => (await stopOf(owner, run.runId))?.escalatedAt ?? null, {
        message: "the escalation timer must fire: the item is marked escalated in the inbox",
        timeout: 45_000,
      })
      .not.toBeNull();

    const queue = await requestAs<{ items: readonly QueueItem[] }>(
      owner,
      "GET",
      "/api/v1/inbox",
      null,
      "inbox",
    );

    expect(
      queue?.items[0]?.refs.some((ref) => ref.id === run.runId),
      "an escalated item is listed first",
    ).toBe(true);

    // …the annotation on the card, in Slack and in the mirror…
    await expect
      .poll(
        async () => (await slackMessages(DRILLS.slack)).find((one) => one.ts === card.ts)?.edits,
        {
          message: "the escalation must annotate the published card (chat.update)",
          timeout: PUBLISH_TIMEOUT_MS,
        },
      )
      .toBeGreaterThan(0);
    await expect(
      mirror(page, DRILLS.name).getByText(CHATOPS_COPY.escalated).first(),
      "the mirror must mark the card escalated within a poll",
    ).toBeVisible({ timeout: POLL_TIMEOUT_MS });

    // …and the on-call person holds the question as a DM.
    await expect
      .poll(async () => (await messageOf(KEN.dm, run.loopSeq)) !== undefined, {
        message: "the on-call designee must hold the question as a DM",
        timeout: PUBLISH_TIMEOUT_MS,
      })
      .toBe(true);

    // ---- Now Slack refuses one post: the system line the answer below would publish.
    const strip = page.getByRole("region", { name: CHATOPS_COPY.health });
    const banner = page.getByRole("status", { name: CHATOPS_COPY.deliveryLabel });

    await expect(banner, "nothing was refused yet, so nothing says so").toHaveCount(0);
    await scriptSlack("chat.postMessage", { error: "invalid_blocks" });

    const current = (await slackMessages(DRILLS.slack)).find((one) => one.ts === card.ts) ?? card;

    expect((await pressAllowOnce(current)).status).toBe(200);

    // ---- The banner appears on the page's own poll, naming the route and Slack's answer.
    await expect(
      banner,
      "a dead-lettered publish must raise the publish-health banner",
    ).toBeVisible({
      timeout: PUBLISH_TIMEOUT_MS,
    });
    await expect(banner).toContainText("1 message could not be delivered to Slack.");
    await expect(banner).toContainText("invalid_blocks");
    await expect(banner.getByRole("link", { name: CHATOPS_COPY.deliveryAudit })).toHaveAttribute(
      "href",
      "/settings#audit",
    );
    await expect(strip).toContainText("active");

    // The answer publishes its line to the channel and to the on-call DM; Slack refused whichever
    // was sent first, and the banner names that route — by the routing card's label, or as the
    // on-call DM, which is on no row of it.
    const { delivery: refused } = await connectionOf(owner);

    expect(refused).toMatchObject({ state: "dead_lettered", deadLettered: 1 });
    expect(refused.affectedRoutes).toHaveLength(1);
    expect([QUESTIONS_ROUTE.kind, ON_CALL_DM.kind]).toContain(refused.affectedRoutes[0]);
    await expect(banner).toContainText(
      `Affected: ${refused.affectedRoutes[0] === ON_CALL_DM.kind ? ON_CALL_DM.label : QUESTIONS_ROUTE.label}.`,
    );

    // ---- Retry: the message is queued again, delivered, and the banner goes with the queue.
    await banner.getByRole("button", { name: CHATOPS_COPY.deliveryRetry }).click();
    await expect(banner, "the banner must disappear when the queue drains").toHaveCount(0, {
      timeout: POLL_TIMEOUT_MS,
    });
    for (const place of [DRILLS.slack, KEN.dm]) {
      await expect
        .poll(async () => (await messageOf(place, run.loopSeq, "answered: allow once"))?.text, {
          message: `the system line must reach ${place} once the refused post is retried`,
          timeout: PUBLISH_TIMEOUT_MS,
        })
        .toBe(`✓ ${SEED_OWNER.displayName} answered: allow once — ${loop}`);
    }
    expect((await connectionOf(owner)).delivery).toMatchObject({
      deadLettered: 0,
      stuck: 0,
      affectedRoutes: [],
    });

    // Still gone after the next poll: it was the queue that drained, not the click that hid it.
    await page.reload();
    await drawnChatOps(page);
    await expect(banner).toHaveCount(0);

    expect((await within(run.finished, 60_000, "the driver's exit")).code).toBe(0);
  });

  test("removed, then revoked: a kicked bot is explained with the way back, and a revoked app turns the page to history with a re-install", async ({
    context,
    page,
  }) => {
    await openChatOps(context, page, { channel: drillsId });

    const card = mirror(page, DRILLS.name);
    const strip = page.getByRole("region", { name: CHATOPS_COPY.health });
    const warning = card.locator(".chatops-mirror__warning");

    await expect(warning).toHaveCount(0);

    // ---- The bot is removed from the leg's channel. Verify asks Slack, which lists it as left.
    await setBotMembership(LEG_TEAM.id, DRILLS.slack, false);
    await strip.getByRole("button", { name: CHATOPS_COPY.verify }).click();

    await expect(
      warning,
      "a channel the bot was removed from must say so in its mirror",
    ).toContainText(`Ouroboros was removed from #${DRILLS.name}`, { timeout: POLL_TIMEOUT_MS });
    await expect(warning).toContainText("/invite @Ouroboros");
    await expect(warning.getByRole("button", { name: `Unbind #${DRILLS.name}` })).toBeVisible();

    // ---- Invited back in Slack; the warning's own refresh notices.
    await setBotMembership(LEG_TEAM.id, DRILLS.slack, true);
    await warning.getByRole("button", { name: CHATOPS_COPY.rejoined }).click();
    await expect(
      warning,
      "the warning goes once Slack lists the bot in the channel again",
    ).toHaveCount(0, {
      timeout: POLL_TIMEOUT_MS,
    });

    // ---- Slack revokes the app. The next check finds out, and the page says so plainly.
    await revokeTeam(LEG_TEAM.id);
    await strip.getByRole("button", { name: CHATOPS_COPY.verify }).click();

    await expect(strip).toContainText("revoked — invalid_auth");
    await expect(strip).toContainText(CHATOPS_COPY.invalidAuthReason);
    await expect(strip).toContainText(CHATOPS_COPY.revokedNote);
    expect((await connectionOf(owner)).state).toBe("revoked");

    // The mirror is history: what was published stays readable, and nothing can be run.
    const history = page.getByRole("region", { name: CHATOPS_COPY.historyLabel });

    await expect(history.getByRole("log", { name: CHATOPS_COPY.stream })).toContainText(
      "answered: allow once",
    );
    await expect(history).toContainText(CHATOPS_COPY.historyNote);
    await expect(history.getByRole("combobox", { name: CHATOPS_COPY.composer })).toHaveCount(0);
    await expect(page.getByRole("button", { name: CHATOPS_COPY.addChannel })).toHaveCount(0);
    await expect(page.getByRole("region", { name: CHATOPS_COPY.routingTitle })).toHaveCount(0);

    // ---- The way back is on the strip: re-install, through Slack's consent screen again.
    await revokeTeam(LEG_TEAM.id, false);
    await approveInstallIn(page);
    await strip.getByRole("link", { name: CHATOPS_COPY.reinstall }).click();
    await expect(page).toHaveURL(/\/settings\?slack=connected#integrations$/);

    await page.goto("/chatops");
    await drawnChatOps(page);
    await expect(strip).toContainText("active");
    await expect(page.getByRole("region", { name: CHATOPS_COPY.historyLabel })).toHaveCount(0);
    await expect(
      mirror(page, SEEDED_CHANNELS.loops.name).getByRole("combobox", {
        name: CHATOPS_COPY.composer,
      }),
    ).toBeVisible();
  });
});
