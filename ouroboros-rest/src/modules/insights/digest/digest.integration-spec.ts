/**
 * The weekly Insights digest against a migrated database and a real mail server (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)).
 *
 * What only a database, a socket and SMTP can answer:
 *
 *   * **A weekly run produces digests in mailpit whose numbers are the page's.** The runner sends
 *     through nodemailer to a mailpit container; the mails are read back over mailpit's API and
 *     every figure is compared with `GET /api/v1/insights?range=7d` for the same workspace and
 *     instant, printed by the same printers.
 *   * **V084 keeps the run honest.** One run per slot, content stored once, a send row per
 *     recipient with the window and content version, and nothing sent twice.
 *   * **Subscribe and unsubscribe round-trip** — and the link in the mail unsubscribes with no
 *     session.
 *   * **An unpriced workspace is mailed no dollar figure; an empty week is mailed one sentence.**
 *   * **Isolation.** Two workspaces mirroring the same repository are each mailed their own
 *     numbers; a person removed from a workspace is mailed nothing.
 *
 * The slot is the next Monday 09:00 UTC after the suite starts, and the application's clock is
 * held to it, so the digest and the page are read as of one instant and every subscription made
 * during the suite predates the slot.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/insights/digest
 * ```
 */

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { insertMetricDays, type MetricDayRow } from "../../../testing/metrics.fixture";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { MAILER, type Mailer } from "../../mail/mailer";
import { startMailpit, type CaughtMail, type StartedMailpit } from "../../mail/mailpit.fixture";
import { nextWeeklySlot } from "../../scheduling/cadence";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { METRICS_CLOCK } from "../metrics/metrics.service";
import { formatCompact, formatDelta, formatFigure, formatMoney } from "../page/page.format";
import type { InsightsResource } from "../page/page.resources";
import { addDays, utcDay } from "../rollup/rollup.days";
import { DIGEST_CONTENT_VERSION } from "./digest.assembly";
import { DIGEST_ERRORS } from "./digest.errors";
import type { InsightsDigestPreviewResource, InsightsDigestResource } from "./digest.resources";
import { DigestRunner } from "./digest.runner";

/** The slot every run in this suite is for: the next Monday 09:00 UTC. */
const SLOT = nextWeeklySlot(new Date(), 1, "09:00");
/** A tick five minutes after the slot. */
const NOW = new Date(SLOT.getTime() + 5 * 60_000);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TODAY = utcDay(SLOT);
/** Days before the slot's day, as `YYYY-MM-DD`. */
const ago = (days: number): string => addDays(TODAY, -days);

/** The repository both workspaces' rollups are filed under — the same string in each. */
const HELIOS = "acme-robotics/helios-firmware";

const DIGEST = "/api/v1/insights/digest";

/** A workspace and its owner. */
interface Bench extends Workspace {
  readonly owner: Person;
}

/**
 * A week of rolled-up history and a thinner prior week.
 *
 * @param scale - A multiplier on every count, so two workspaces never agree by accident.
 * @param priced - False for a workspace nothing prices: every token unpriced, no cost rows.
 * @returns The rows.
 */
function history(scale = 1, priced = true): MetricDayRow[] {
  const day = ago(1);
  const prior = ago(10);
  const at = (
    metricId: string,
    value: number,
    extra: Partial<MetricDayRow> = {},
  ): MetricDayRow => ({
    repoRef: HELIOS,
    metricId,
    day,
    value,
    ...extra,
  });
  const rate = (metricId: string, numerator: number, denominator: number, on = day) =>
    at(metricId, (100 * numerator) / denominator, { numerator, denominator, day: on });

  return [
    at("merged_prs", 4 * scale),
    rate("merge_rate", 4 * scale, 5 * scale),
    rate("merged_untouched_rate", 3 * scale, 4 * scale),
    at("cycle_time", 800_000, { samples: [600_000, 800_000, 1_000_000] }),
    at("tokens", 10_000 * scale),
    at("unpriced_tokens", (priced ? 0 : 10_000) * scale),
    ...(priced ? [at("cost_cents", 400 * scale)] : []),
    at("builds", 10 * scale),
    at("build_failures", scale),
    rate("build_success_rate", 9 * scale, 10 * scale),
    at("test_cases_run", 500 * scale),
    rate("test_pass_rate", 495 * scale, 500 * scale),
    at("human_interventions", 3 * scale, { dimension: "infra_rig" }),
    at("human_interventions", scale, { dimension: "other" }),
    // the prior week
    at("merged_prs", 2 * scale, { day: prior }),
    rate("merge_rate", scale, 4 * scale, prior),
    at("tokens", 5_000 * scale, { day: prior }),
    at("unpriced_tokens", (priced ? 0 : 5_000) * scale, { day: prior }),
    ...(priced ? [at("cost_cents", 900 * scale, { day: prior })] : []),
    at("human_interventions", 5 * scale, { dimension: "infra_rig", day: prior }),
  ];
}

/**
 * The unsubscribe link a mail carries.
 *
 * @param mail - The mail.
 * @returns The link's path on this API.
 */
function unsubscribePath(mail: CaughtMail): string {
  const [header] = mail.headers["List-Unsubscribe"];

  return new URL(header.slice(1, -1)).pathname;
}

describe("the weekly digest, against a migrated database and mailpit", () => {
  let mailpit: StartedMailpit;
  let api: ApiHarness;
  let runner: DigestRunner;

  beforeAll(async () => {
    mailpit = await startMailpit();
    api = await ApiHarness.start(
      {
        OURO_SMTP_URL: mailpit.smtpUrl,
        OURO_MAIL_FROM: "no-reply@ouroboros.test",
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      },
      [{ provide: METRICS_CLOCK, useValue: () => SLOT.getTime() }],
    );
    runner = api.nest.get(DigestRunner);
  }, 180_000);

  afterAll(async () => {
    await (api as ApiHarness | undefined)?.close();
    // Undefined when the start failed — the failure the suite already reports.
    await (mailpit as StartedMailpit | undefined)?.stop();
  });

  afterEach(async () => {
    await api.truncate();
    await mailpit.clear();
  });

  /**
   * A workspace with a week of history.
   *
   * @param rows - Its rollups; a priced week when omitted.
   * @param name - What its digest's subject calls it.
   * @returns The workspace and its owner.
   */
  async function bench(rows: MetricDayRow[] = history(), name = "Acme Robotics"): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner, undefined, name);

    await insertMetricDays(api, workspace.id, rows);

    return { ...workspace, owner };
  }

  /** A digest route as somebody in a workspace. */
  function call(
    method: "get" | "put" | "patch",
    at: Pick<Bench, "slug">,
    person: Person,
    path = "",
  ) {
    return api.as(person)(method, `${DIGEST}${path}`).set(TENANT_HEADER, at.slug);
  }

  /** Opt somebody in. */
  async function subscribe(at: Pick<Bench, "slug">, person: Person): Promise<void> {
    await call("put", at, person, "/subscription").send({ subscribed: true }).expect(200);
  }

  /** The seven-day page, as the workspace's owner reads it over HTTP. */
  async function page(at: Bench): Promise<InsightsResource> {
    return bodyOf<InsightsResource>(
      await api
        .as(at.owner)("get", "/api/v1/insights?range=7d")
        .set(TENANT_HEADER, at.slug)
        .expect(200),
    );
  }

  /** The caller's digest state. */
  async function state(at: Pick<Bench, "slug">, person: Person): Promise<InsightsDigestResource> {
    return bodyOf<InsightsDigestResource>(await call("get", at, person).expect(200));
  }

  /** Every send row of a workspace, oldest first, with its run's record. */
  async function audit(organizationId: string) {
    const { rows } = await api.sql.query<{
      recipient: string;
      attempt: number;
      status: string;
      message_id: string;
      slot_at: Date;
      window_from: string;
      window_to: string;
      content_version: number;
      completed: boolean;
    }>(
      `select s.recipient, s.attempt, s.status, s.message_id, r.slot_at,
              to_char(r.window_from, 'YYYY-MM-DD') as window_from,
              to_char(r.window_to, 'YYYY-MM-DD') as window_to,
              r.content_version, r.completed_at is not null as completed
         from ouroboros.insights_digest_sends s
         join ouroboros.insights_digest_runs r on r.id = s.run_id
        where s.organization_id = $1
        order by r.slot_at, s.recipient, s.attempt`,
      [organizationId],
    );

    return rows;
  }

  describe("a weekly run", () => {
    it("mails every subscriber the page's own numbers — and nobody else", async () => {
      const at = await bench();
      const member = await api.signIn();
      const bystander = await api.signIn();
      await api.join(at.id, member, "viewer");
      await api.join(at.id, bystander, "member");
      await subscribe(at, at.owner);
      await subscribe(at, member);

      const report = await runner.tick(NOW);
      const mails = await mailpit.messages();
      const payload = await page(at);

      expect(report.outcomes).toEqual([
        { organizationId: at.id, slotAt: SLOT, sent: 2, failed: 0, completed: true },
      ]);
      expect(
        mails
          .map((mail) => mail.to)
          .flat()
          .sort(),
      ).toEqual([at.owner.email, member.email].sort());

      for (const mail of mails) {
        expect(mail.from).toBe("no-reply@ouroboros.test");
        expect(mail.fromName).toBe("Ouroboros");
        expect(mail.subject).toContain(at.name);

        // Both parts print each KPI as the page's printers print the page's own value and delta.
        for (const kpi of payload.kpis) {
          const figure = formatFigure(kpi.value, kpi.unit);
          const delta = formatDelta(kpi.delta, kpi.unit);

          expect(mail.text).toContain(`: ${figure}`);
          expect(mail.html).toContain(figure);
          if (delta !== null) {
            expect(mail.text).toContain(delta);
            expect(mail.html).toContain(delta);
          }
        }

        const top = payload.hbars.interventions.bars[0];
        const headline = `${String(payload.head.mergedPrs)} PRs merged this week. ${String(payload.head.interventions)} needed a human.`;
        const cost = `${formatMoney(payload.usage.costCents ?? Number.NaN)} this week across ${formatCompact(payload.usage.tokens)} tokens.`;

        for (const part of [mail.text, mail.html]) {
          expect(part).toContain(headline);
          expect(part).toContain(`${top.label} — ${String(top.value)} of`);
          expect(part).toContain(payload.hbars.interventions.line);
          expect(part).toContain(cost);
        }
      }

      // The fixture's week, so the comparison above is not two empty pages agreeing.
      expect(payload.kpis.map((kpi) => kpi.value)).toEqual([80, 75, 800_000, 100, 4]);
      expect(mails[0].text).toContain("4 PRs merged this week. 4 needed a human.");
      expect(mails[0].text).toContain("Autonomous merge rate: 80% (▲ 55pts vs prior week, better)");
      expect(mails[0].text).toContain("Cost per merged PR: $1 (▼ $3.50 vs prior week, better)");
    });

    it("audits each send with its recipient, window and content version", async () => {
      const at = await bench();
      await subscribe(at, at.owner);

      await runner.tick(NOW);
      const [mail] = await mailpit.messages();

      expect(await audit(at.id)).toEqual([
        {
          recipient: at.owner.email,
          attempt: 1,
          status: "sent",
          message_id: `<${mail.messageId}>`,
          slot_at: SLOT,
          // The page's own seven days, ending on the slot's day.
          window_from: ago(6),
          window_to: TODAY,
          content_version: DIGEST_CONTENT_VERSION,
          completed: true,
        },
      ]);
      expect(mail.messageId).toMatch(/^digest\.[0-9a-f-]{36}\.[0-9a-f]{16}@ouroboros\.test$/);
    });

    it("sends nothing twice: a second tick, and a second runner, find the run complete", async () => {
      const at = await bench();
      await subscribe(at, at.owner);

      await runner.tick(NOW);
      const again = await runner.tick(new Date(NOW.getTime() + 60_000));

      expect(again.outcomes).toEqual([]);
      expect(await mailpit.messages()).toHaveLength(1);
      expect(await audit(at.id)).toHaveLength(1);
    });

    it("mails the run's stored content on a retry, under the same Message-ID", async () => {
      const at = await bench();
      await subscribe(at, at.owner);
      const send = jest
        .spyOn(api.nest.get<Mailer>(MAILER, { strict: false }), "send")
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:1025"));

      // The server is unreachable for the first attempt.
      const first = await runner.tick(NOW);

      expect(first.outcomes).toEqual([
        { organizationId: at.id, slotAt: SLOT, sent: 0, failed: 1, completed: false },
      ]);
      expect(await mailpit.messages()).toEqual([]);

      // The week's numbers move before the retry; the run's stored content does not.
      await api.sql.query(
        `update ouroboros.metric_daily set value = 40
          where organization_id = $1 and metric_id = 'merged_prs' and day = $2`,
        [at.id, ago(1)],
      );
      await runner.tick(new Date(NOW.getTime() + 60_000));
      const [mail] = await mailpit.messages();
      const rows = await audit(at.id);

      expect(mail.text).toContain("4 PRs merged this week.");
      expect(rows.map((row) => [row.attempt, row.status, row.completed])).toEqual([
        [1, "failed", true],
        [2, "sent", true],
      ]);
      // Both attempts went out under one Message-ID — the one the server then saw.
      expect(new Set(rows.map((row) => row.message_id))).toEqual(new Set([`<${mail.messageId}>`]));
      expect(send.mock.calls[0][0].messageId).toBe(`<${mail.messageId}>`);
      send.mockRestore();
    });

    it("leaves out a member who subscribes after the slot — the next slot is theirs", async () => {
      const at = await bench();
      const late = await api.signIn();
      await api.join(at.id, late, "member");
      await subscribe(at, at.owner);
      await subscribe(at, late);
      // The harness connects as the schema's owner, which may post-date a subscription.
      await api.sql.query(
        `update ouroboros.insights_digest_subscriptions set created_at = $2 where user_id = $1`,
        [late.id, new Date(SLOT.getTime() + 60_000)],
      );

      await runner.tick(NOW);

      expect((await mailpit.messages()).map((mail) => mail.to).flat()).toEqual([at.owner.email]);

      await runner.tick(new Date(NOW.getTime() + WEEK_MS));

      expect(
        (await mailpit.messages())
          .map((mail) => mail.to)
          .flat()
          .sort(),
      ).toEqual([at.owner.email, at.owner.email, late.email].sort());
    });
  });

  describe("honesty, in the mail", () => {
    it("gives a workspace nothing prices a token-only cost line and no dollar sign anywhere", async () => {
      const at = await bench(history(1, false));
      await subscribe(at, at.owner);

      await runner.tick(NOW);
      const [mail] = await mailpit.messages();
      const payload = await page(at);

      expect(payload.usage.pricing).toBe("unpriced");
      expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain("$");
      expect(mail.text).toContain(
        "10k tokens this week. No price is configured for this usage, so there is no dollar figure.",
      );
      expect(mail.text).toContain("Tokens per merged PR: 2.5k");
      expect(mail.text).not.toContain("Cost per merged PR");
    });

    it("mails an empty week one honest sentence, not a page of zeroes", async () => {
      const at = await bench([]);
      await subscribe(at, at.owner);

      await runner.tick(NOW);
      const [mail] = await mailpit.messages();

      for (const part of [mail.text, mail.html]) {
        expect(part).toContain("Nothing to report this week.");
        expect(part).not.toContain("Autonomous merge rate");
      }
      expect(mail.text).not.toMatch(/: (0|0%|—)\b/);
    });
  });

  describe("isolation", () => {
    it("mails each of two workspaces mirroring the same repository its own numbers", async () => {
      const mine = await bench(history(1), "Mine Works");
      const theirs = await bench(history(3), "Their Works");
      // Somebody in both: one mail per workspace, each with that workspace's numbers.
      await api.join(theirs.id, mine.owner, "member");
      await subscribe(mine, mine.owner);
      await subscribe(theirs, mine.owner);
      await subscribe(theirs, theirs.owner);

      await runner.tick(NOW);
      const mails = await mailpit.messages();
      const of = (workspace: Bench) =>
        mails.filter((mail) => mail.subject.includes(workspace.name));

      expect(mails).toHaveLength(3);
      expect(
        of(mine)
          .map((mail) => mail.to)
          .flat(),
      ).toEqual([mine.owner.email]);
      expect(
        of(theirs)
          .map((mail) => mail.to)
          .flat()
          .sort(),
      ).toEqual([mine.owner.email, theirs.owner.email].sort());
      for (const mail of of(mine)) {
        expect(mail.text).toContain("4 PRs merged this week. 4 needed a human.");
        expect(mail.text).not.toContain("12 PRs merged");
      }
      for (const mail of of(theirs)) {
        expect(mail.text).toContain("12 PRs merged this week. 12 needed a human.");
        expect(mail.text).not.toContain("4 PRs merged");
      }
      // The send audit is each workspace's own.
      expect((await audit(mine.id)).map((row) => row.recipient)).toEqual([mine.owner.email]);
      expect(await audit(theirs.id)).toHaveLength(2);
    });

    it("mails nothing to a subscriber who is no longer a member", async () => {
      const at = await bench();
      // Still a member somewhere — of a workspace of their own — just no longer of this one.
      const { owner: leaver } = await bench([], "Elsewhere Works");
      await api.join(at.id, leaver, "member");
      await subscribe(at, at.owner);
      await subscribe(at, leaver);
      await api.sql.query(
        `delete from ouroboros.member where "organizationId" = $1 and "userId" = $2`,
        [at.id, leaver.id],
      );

      await runner.tick(NOW);

      expect((await mailpit.messages()).map((mail) => mail.to).flat()).toEqual([at.owner.email]);
    });

    it("keeps one workspace's subscription out of another's state, and a stranger out entirely", async () => {
      const mine = await bench();
      const theirs = await bench();
      await api.join(theirs.id, mine.owner, "member");
      await subscribe(mine, mine.owner);

      expect((await state(mine, mine.owner)).subscribed).toBe(true);
      expect((await state(theirs, mine.owner)).subscribed).toBe(false);
      // Another workspace's header is a 404, never a 403.
      const refused = await call("get", mine, theirs.owner).expect(404);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("tenant_not_found");
      await api.anonymous("get", DIGEST).expect(401);
      await api.anonymous("get", `${DIGEST}/preview`).expect(401);
    });
  });

  describe("subscribing and unsubscribing", () => {
    it("round-trips over HTTP, for any member, and starts as opted out", async () => {
      const at = await bench();
      const viewer = await api.signIn();
      await api.join(at.id, viewer, "viewer");

      expect(await state(at, viewer)).toEqual({
        subscribed: false,
        recipient: viewer.email,
        schedule: {
          weeklyDay: 1,
          weeklyTime: "09:00",
          timezone: "UTC",
          // The application's clock is held to the slot, so the next one is a week on.
          nextRunAt: new Date(SLOT.getTime() + WEEK_MS).toISOString(),
        },
        mail: { transport: "smtp" },
      });

      const on = await call("put", at, viewer, "/subscription")
        .send({ subscribed: true })
        .expect(200);
      expect(bodyOf<InsightsDigestResource>(on).subscribed).toBe(true);
      // Asking twice is asking once.
      await call("put", at, viewer, "/subscription").send({ subscribed: true }).expect(200);
      expect((await state(at, viewer)).subscribed).toBe(true);

      const off = await call("put", at, viewer, "/subscription")
        .send({ subscribed: false })
        .expect(200);
      expect(bodyOf<InsightsDigestResource>(off).subscribed).toBe(false);
      expect((await state(at, at.owner)).subscribed).toBe(false);
    });

    it("refuses a body that is not a boolean, naming the field", async () => {
      const at = await bench();

      const refused = await call("put", at, at.owner, "/subscription")
        .send({ subscribed: "yes" })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(refused)).toMatchObject({ code: "validation_failed" });
      expect(bodyOf<ErrorEnvelope>(refused).details).toHaveProperty("subscribed");
    });

    it("unsubscribes from the mail's link with no session — on the button, not on opening it", async () => {
      const at = await bench();
      const other = await api.signIn();
      await api.join(at.id, other, "member");
      await subscribe(at, at.owner);
      await subscribe(at, other);
      await runner.tick(NOW);
      const mail = (await mailpit.messages()).find((caught) => caught.to[0] === at.owner.email);
      const link = unsubscribePath(mail as CaughtMail);

      // Opening the link — as a mail scanner would — changes nothing.
      const opened = await api.anonymous("get", link).expect(200);

      expect(opened.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(opened.headers["cache-control"]).toBe("no-store");
      expect(opened.headers["referrer-policy"]).toBe("no-referrer");
      expect(opened.text).toContain("Unsubscribe from the weekly digest?");
      expect(opened.text).toContain(at.name);
      expect((await state(at, at.owner)).subscribed).toBe(true);

      // The button — and a mail client's one-click, which posts this body.
      const done = await api
        .anonymous("post", link)
        .type("form")
        .send("List-Unsubscribe=One-Click")
        .expect(200);

      expect(done.text).toContain("You are unsubscribed");
      expect((await state(at, at.owner)).subscribed).toBe(false);
      // Only the link's own person: the other subscriber is untouched.
      expect((await state(at, other)).subscribed).toBe(true);
      // A second press is the same answer.
      await api.anonymous("post", link).expect(200);

      // Next week's digest goes to the one who stayed.
      await mailpit.clear();
      await runner.tick(new Date(NOW.getTime() + WEEK_MS));

      expect((await mailpit.messages()).map((caught) => caught.to).flat()).toEqual([other.email]);
    });

    it("answers a link no mail carried with a page and a 404, and changes nothing", async () => {
      const at = await bench();
      await subscribe(at, at.owner);

      for (const token of ["nope", `ouro_unsub_${"A".repeat(43)}`]) {
        const get = await api.anonymous("get", `${DIGEST}/unsubscribe/${token}`).expect(404);
        const post = await api.anonymous("post", `${DIGEST}/unsubscribe/${token}`).expect(404);

        for (const response of [get, post]) {
          expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
          expect(response.text).toContain("This link is not valid");
        }
      }

      expect((await state(at, at.owner)).subscribed).toBe(true);
    });
  });

  describe("the schedule", () => {
    it("is an administrator's to move and every member's to read", async () => {
      const at = await bench();
      const member = await api.signIn();
      await api.join(at.id, member, "member");

      const refused = await call("patch", at, member, "/schedule")
        .send({ weeklyDay: 5 })
        .expect(403);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");

      const moved = await call("patch", at, at.owner, "/schedule")
        .send({ weeklyDay: 5, weeklyTime: "16:30" })
        .expect(200);

      expect(bodyOf<InsightsDigestResource>(moved).schedule).toMatchObject({
        weeklyDay: 5,
        weeklyTime: "16:30",
        timezone: "UTC",
      });
      // A partial patch keeps the rest; the member reads what the owner saved.
      await call("patch", at, at.owner, "/schedule").send({ weeklyTime: "07:15" }).expect(200);
      expect((await state(at, member)).schedule).toMatchObject({
        weeklyDay: 5,
        weeklyTime: "07:15",
      });
      const { rows } = await api.sql.query<{ updated_by: string }>(
        `select updated_by from ouroboros.insights_digest_schedules where organization_id = $1`,
        [at.id],
      );
      expect(rows).toEqual([{ updated_by: at.owner.id }]);
    });

    it.each([{ weeklyDay: 8 }, { weeklyTime: "9am" }, { timezone: "PST" }])(
      "refuses %j with a 422",
      async (body) => {
        const at = await bench();

        const refused = await call("patch", at, at.owner, "/schedule").send(body).expect(422);

        expect(bodyOf<ErrorEnvelope>(refused).code).toBe("validation_failed");
      },
    );

    it("sends at the workspace's own slot, and not a second time when it is moved mid-week", async () => {
      const at = await bench();
      await subscribe(at, at.owner);

      // Moved to Wednesday 09:00 before Monday's slot: Monday's tick has nothing due.
      await call("patch", at, at.owner, "/schedule").send({ weeklyDay: 3 }).expect(200);
      expect((await runner.tick(NOW)).outcomes).toEqual([]);

      const wednesday = new Date(SLOT.getTime() + 2 * 24 * 60 * 60 * 1000);
      await runner.tick(new Date(wednesday.getTime() + 60_000));
      expect(await mailpit.messages()).toHaveLength(1);

      // Moved again to Thursday: this week has had its digest.
      await call("patch", at, at.owner, "/schedule").send({ weeklyDay: 4 }).expect(200);
      const thursday = new Date(wednesday.getTime() + 24 * 60 * 60 * 1000);
      expect((await runner.tick(new Date(thursday.getTime() + 60_000))).outcomes).toEqual([]);
      expect(await mailpit.messages()).toHaveLength(1);
    });
  });

  describe("the preview", () => {
    it("renders the digest as of now, with the page's numbers and no unsubscribe link", async () => {
      const at = await bench();
      const viewer = await api.signIn();
      await api.join(at.id, viewer, "viewer");

      const preview = bodyOf<InsightsDigestPreviewResource>(
        await call("get", at, viewer, "/preview").expect(200),
      );
      const payload = await page(at);

      expect(preview.window).toEqual(payload.window);
      expect(preview.contentVersion).toBe(DIGEST_CONTENT_VERSION);
      expect(preview.subject).toContain(at.name);
      expect(preview.text).toContain("4 PRs merged this week. 4 needed a human.");
      expect(preview.html).toContain("4 PRs merged this week. 4 needed a human.");
      expect(`${preview.text}${preview.html}`).not.toContain("nsubscribe");
      // A preview sends nothing and records nothing.
      expect(await mailpit.messages()).toEqual([]);
      expect(await audit(at.id)).toEqual([]);
    });
  });
});

describe("the weekly digest on a deployment with no mail server", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  it("says so, refuses a subscription, and sends nothing", async () => {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const as = (method: "get" | "put") => (path: string) =>
      api.as(owner)(method, `${DIGEST}${path}`).set(TENANT_HEADER, workspace.slug);

    const read = await as("get")("").expect(200);
    expect(bodyOf<InsightsDigestResource>(read)).toMatchObject({
      subscribed: false,
      mail: { transport: "none" },
    });

    const refused = await as("put")("/subscription").send({ subscribed: true }).expect(409);
    expect(bodyOf<ErrorEnvelope>(refused).code).toBe(DIGEST_ERRORS.mailUnconfigured);
    // Unsubscribing is never refused.
    await as("put")("/subscription").send({ subscribed: false }).expect(200);

    const { rows } = await api.sql.query(
      `select 1 from ouroboros.insights_digest_subscriptions where organization_id = $1`,
      [workspace.id],
    );
    expect(rows).toEqual([]);
    expect(await api.nest.get(DigestRunner).tick(NOW)).toEqual({ outcomes: [], errors: [] });
    // The preview needs no mail server: it is rendered, not sent.
    await as("get")("/preview").expect(200);
  });
});
