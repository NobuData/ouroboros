/**
 * The decision mails as a real SMTP server receives them (#463, #465) — mailpit, the BJ.4 mailer,
 * a migrated database. What a person's mailbox actually holds:
 *
 *   - the instant mail for an `err` card: subject, the card's prose, one working link per action
 *     the person may press, and a `Message-ID` under the sending domain;
 *   - the daily digest: the open card and the day's resolved summary;
 *   - a preference change applies to the next send — a muted kind leaves the digest, instant mail
 *     switched off sends nothing.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import { startMailpit, type CaughtMail, type StartedMailpit } from "../mail/mailpit.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { DecisionMailService } from "./mail/decision-mail.service";

/** Retry a read until it holds or five seconds pass. */
async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  let value = await read();

  while (!holds(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }

  return value;
}

describe("decision mails, as mailpit receives them", () => {
  let mailpit: StartedMailpit;
  let api: ApiHarness;

  beforeAll(async () => {
    mailpit = await startMailpit();
    api = await ApiHarness.start({
      OURO_SMTP_URL: mailpit.smtpUrl,
      OURO_MAIL_FROM: "no-reply@ouroboros.test",
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
  }, 180_000);

  afterAll(async () => {
    await (api as ApiHarness | undefined)?.close();
    await (mailpit as StartedMailpit | undefined)?.stop();
  });

  afterEach(async () => {
    await api.truncate();
    await mailpit.clear();
  });

  /** File a card of a kind in a bench. */
  async function file(bench: IngestBench, kindId: string, key: string): Promise<string> {
    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: bench.workspace.id,
      kindId,
      payload: SEEDED_PAYLOADS[kindId],
      refs: [],
      key: { plane: "suite", sourceRef: key },
    });

    return itemId ?? "";
  }

  /** Set the caller's preferences in the bench. */
  async function prefer(person: Person, bench: IngestBench, body: Record<string, unknown>) {
    await api
      .as(person)("patch", "/api/v1/inbox/notifications")
      .set(TENANT_HEADER, bench.workspace.slug)
      .send(body)
      .expect(200);
  }

  /** Mails to one address. */
  async function inbox(person: Person): Promise<CaughtMail[]> {
    return (await mailpit.messages()).filter((mail) => mail.to.includes(person.email));
  }

  it("delivers an instant mail for an err card, carrying one working link per action", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);

    // An info card stays in the app; the same kind raised to err by its emitter is mailed.
    await file(bench, "split_approval", "split");
    await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: bench.workspace.id,
      kindId: "fact_review",
      payload: SEEDED_PAYLOADS.fact_review,
      refs: [],
      key: { plane: "suite", sourceRef: "fact" },
      severity: "err",
    });

    const [mail] = await eventually(
      () => inbox(owner),
      (mails) => mails.length > 0,
    );

    expect(mail?.subject).toBe("[Ouroboros] Needs you: Should the loops trust this fact?");
    expect(mail?.fromName).toBe("Ouroboros");
    expect(mail?.messageId).toMatch(/@ouroboros\.test>?$/);
    expect(mail?.text).toContain("CAN frames are DMA-backed on helios-firmware");
    expect(mail?.html).toContain("Confirm");

    const links = [...(mail?.text ?? "").matchAll(/(\/api\/v1\/inbox\/answer\/ouro_act_[\w-]+)/g)];

    // Confirm and Retire; the Open-in-Knowledge link mints nothing.
    expect(links).toHaveLength(2);
    for (const [, path] of links) {
      const page = await api.anonymous("get", path ?? "").expect(200);

      expect(page.text).toContain("Should the loops trust this fact?");
    }

    expect(await inbox(owner)).toHaveLength(1);
  });

  it("delivers the digest with the open card and the resolved summary, and honours a mute on the next send", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const time = new Date().toISOString().slice(11, 16);

    await prefer(owner, bench, { digestEnabled: true, digestTime: time, instantSeverity: "off" });
    await file(bench, "fact_review", "fact");
    await file(bench, "split_approval", "split");

    const mails = api.nest.get(DecisionMailService, { strict: false });

    expect((await mails.pass()).digestSent).toBe(1);

    const [digest] = await eventually(
      () => inbox(owner),
      (caught) => caught.length > 0,
    );

    expect(digest?.subject).toMatch(/^\[Ouroboros\] 2 decisions waiting · /);
    expect(digest?.text).toContain("Should the loops trust this fact?");
    expect(digest?.text).toContain("Approve a split into 6 tickets?");
    expect(digest?.text).toContain("Resolved in the last day (0)");

    // The next send honours the mute: tomorrow's slot, fact_review left out.
    await prefer(owner, bench, { mutedKinds: ["fact_review"] });
    await mailpit.clear();

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    jest.spyOn(mails, "now").mockReturnValue(tomorrow);
    try {
      expect(await mails.digestFor(bench.workspace.id, owner.id, tomorrow)).toBe("sent");
    } finally {
      jest.restoreAllMocks();
    }

    const [next] = await eventually(
      () => inbox(owner),
      (caught) => caught.length > 0,
    );

    expect(next?.subject).toMatch(/^\[Ouroboros\] 1 decision waiting · /);
    expect(next?.text).not.toContain("Should the loops trust this fact?");
  });

  it("sends nothing instantly once a person switches instant mail off", async () => {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);

    await prefer(owner, bench, { instantSeverity: "off" });
    await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: bench.workspace.id,
      kindId: "fact_review",
      payload: SEEDED_PAYLOADS.fact_review,
      refs: [],
      key: { plane: "suite", sourceRef: "fact" },
      severity: "err",
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await inbox(owner)).toEqual([]);
  });
});
