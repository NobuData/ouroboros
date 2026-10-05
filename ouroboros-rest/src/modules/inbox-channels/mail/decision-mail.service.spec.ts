import type { AppConfigService } from "../../config/config.service";
import type { OrganizationRole } from "../../db/schema";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { DecisionLifecycle } from "../../decisions/decision.lifecycle";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { renderDecision } from "../../decisions/decision.templates";
import type { PublishedDecisionKind } from "../../decisions/decision.types";
import type { InboxItemRow, InboxRepository } from "../../decisions/inbox.repository";
import { RecordingMailer } from "../../mail/mail.fixture";
import type {
  PreferencesRepository,
  StoredPreferences,
} from "../notifications/preferences.repository";
import { FakeTokenStore, FakeVault } from "../tokens/action-token.fixture";
import { ActionTokenService } from "../tokens/action-token.service";
import type {
  DecisionMailRepository,
  MailClaim,
  MailRecipient,
  RecentResolution,
} from "./decision-mail.repository";
import {
  DecisionMailService,
  MAX_SEND_ATTEMPTS,
  answerable,
  decisionMessageId,
} from "./decision-mail.service";

const ORG = "org-1";
const NOW = new Date("2026-10-04T09:00:30Z");

/** A send row, in memory. */
interface Send {
  id: string;
  kind: "instant" | "digest";
  userId: string;
  itemId?: string;
  slotAt?: Date;
  attempt: number;
  status: "claimed" | "sent" | "failed";
}

/** V100's send table and the recipients, in memory. */
class FakeMail {
  recipients: MailRecipient[] = [];

  sends: Send[] = [];

  resolutions: RecentResolution[] = [];

  repository(): DecisionMailRepository {
    const claim = (send: Omit<Send, "id" | "status">) => {
      const clash = this.sends.some(
        (other) =>
          other.kind === send.kind &&
          other.userId === send.userId &&
          other.attempt === send.attempt &&
          (send.kind === "instant"
            ? other.itemId === send.itemId
            : other.slotAt?.getTime() === send.slotAt?.getTime()),
      );

      if (clash) {
        return undefined;
      }

      const id = `send-${String(this.sends.length + 1)}`;

      this.sends.push({ ...send, id, status: "claimed" });

      return id;
    };

    return {
      recipients: (_org: string, userId?: string) =>
        Promise.resolve(this.recipients.filter((r) => userId === undefined || r.userId === userId)),
      digestSubscribers: () =>
        Promise.resolve(
          this.recipients
            .filter((r) => r.preferences?.digestEnabled === true)
            .map((r) => ({
              organizationId: ORG,
              userId: r.userId,
              digestTime: r.preferences?.digestTime ?? "09:00",
            })),
        ),
      claimInstant: (c: MailClaim, itemId: string) =>
        Promise.resolve(claim({ kind: "instant", userId: c.userId, itemId, attempt: c.attempt })),
      claimDigest: (c: MailClaim, slotAt: Date) =>
        Promise.resolve(claim({ kind: "digest", userId: c.userId, slotAt, attempt: c.attempt })),
      settle: (sendId: string, error?: string) => {
        const send = this.sends.find((s) => s.id === sendId);

        if (send?.status === "claimed") {
          send.status = error === undefined ? "sent" : "failed";
        }

        return Promise.resolve();
      },
      failAbandoned: () => Promise.resolve(0),
      instantRetries: (max: number) => {
        const groups = new Map<string, Send[]>();

        for (const send of this.sends.filter((s) => s.kind === "instant")) {
          const key = `${send.userId}|${send.itemId ?? ""}`;

          groups.set(key, [...(groups.get(key) ?? []), send]);
        }

        return Promise.resolve(
          [...groups.values()]
            .filter((g) => g.every((s) => s.status === "failed") && g.length < max)
            .map((g) => ({
              organizationId: ORG,
              userId: g[0]?.userId ?? "",
              itemId: g[0]?.itemId ?? "",
              attempt: g.length + 1,
            })),
        );
      },
      slotAttempts: (_org: string, userId: string, slotAt: Date) => {
        const mine = this.sends.filter(
          (s) =>
            s.kind === "digest" && s.userId === userId && s.slotAt?.getTime() === slotAt.getTime(),
        );

        return Promise.resolve({
          attempts: Math.max(0, ...mine.map((s) => s.attempt)),
          sent: mine.some((s) => s.status === "sent"),
          inFlight: mine.some((s) => s.status === "claimed"),
        });
      },
      resolvedBefore: () => Promise.resolve(this.resolutions),
      workspaceName: () => Promise.resolve("Acme Robotics"),
    } as unknown as DecisionMailRepository;
  }

  preferences(): PreferencesRepository {
    return {
      lastDigestSlot: (_org: string, userId: string) => {
        const sent = this.sends
          .filter((s) => s.kind === "digest" && s.userId === userId && s.status === "sent")
          .map((s) => s.slotAt?.getTime() ?? 0);

        return Promise.resolve(sent.length === 0 ? undefined : new Date(Math.max(...sent)));
      },
    } as unknown as PreferencesRepository;
  }
}

/** A member who may be mailed. */
function member(
  userId: string,
  roles: OrganizationRole[],
  preferences?: Partial<StoredPreferences>,
): MailRecipient {
  return {
    userId,
    email: `${userId}@acme.test`,
    name: userId,
    roles,
    explicitCanApproveLoops: null,
    preferences:
      preferences === undefined
        ? undefined
        : {
            digestEnabled: false,
            digestTime: "09:00",
            instantSeverity: "err",
            mutedKinds: [],
            updatedAt: new Date(0),
            ...preferences,
          },
  };
}

/** An open item. */
function item(
  id: string,
  kindId: string,
  severity: InboxItemRow["severity"],
  ageMs = 60_000,
): InboxItemRow {
  return {
    id,
    kindId,
    kindVersion: 1,
    severity,
    status: "open",
    payload: SEEDED_PAYLOADS[kindId] ?? {},
    refs: [],
    sourceRef: `test:${kindId}`,
    createdAt: new Date(NOW.getTime() - ageMs),
    snoozedUntil: null,
    snoozedBy: null,
    snoozeReason: null,
  };
}

describe("DecisionMailService (#463)", () => {
  let fake: FakeMail;
  let items: Map<string, InboxItemRow>;
  let tokens: FakeTokenStore;
  let mailer: RecordingMailer;
  let lifecycle: DecisionLifecycle;
  let service: DecisionMailService;

  const registry = {
    pinnedKind: (kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId]),
    render: (kind: PublishedDecisionKind, payload: Record<string, unknown>) =>
      renderDecision(kind, payload),
  } as unknown as DecisionKindRegistry;

  /** Build the service over the fakes, with `transport`. */
  function build(transport: "smtp" | "none" = "smtp"): DecisionMailService {
    mailer = new RecordingMailer(transport);

    const inbox = {
      item: (_org: string, id: string) => Promise.resolve(items.get(id)),
      open: () => Promise.resolve([...items.values()].filter((i) => i.status === "open")),
    } as unknown as InboxRepository;
    const built = new DecisionMailService(
      fake.repository(),
      fake.preferences(),
      inbox,
      registry,
      new ActionTokenService(tokens.repository(), new FakeVault().service()),
      lifecycle,
      mailer,
      { uiUrl: "https://ouro.example", mailFrom: "ouroboros@acme.test" } as AppConfigService,
    );

    jest.spyOn(built, "now").mockReturnValue(NOW);

    return built;
  }

  beforeEach(() => {
    fake = new FakeMail();
    items = new Map();
    tokens = new FakeTokenStore();
    tokens.now = NOW;
    lifecycle = new DecisionLifecycle();
    fake.recipients = [member("admin-a", ["admin"]), member("viewer-v", ["viewer"])];
    service = build();
  });

  describe("instant mails", () => {
    it("fire for an err item, to members who may answer it, with one token link per action", async () => {
      items.set("item-err", item("item-err", "merge_approval", "err"));

      expect(await service.itemAsked(ORG, "item-err")).toBe(1);
      expect(mailer.sent.map((m) => m.to)).toEqual(["admin-a@acme.test"]);

      const [mail] = mailer.sent;
      const links = mail?.text.match(/\/api\/v1\/inbox\/answer\/ouro_act_[\w-]+/g) ?? [];

      // approve_merge + return_to_loop; the navigate.* link mints nothing.
      expect(links).toHaveLength(2);
      expect(tokens.tokens.map((t) => t.actionId).sort()).toEqual([
        "approve_merge",
        "return_to_loop",
      ]);
      expect(tokens.tokens.every((t) => t.userId === "admin-a" && t.channel === "email")).toBe(
        true,
      );
      expect(mail?.messageId).toBe(
        decisionMessageId(["instant", "item-err", "admin-a"], "ouroboros@acme.test"),
      );
    });

    it.each(["warn", "info"] as const)("never fire for a %s item", async (severity) => {
      items.set("item", item("item", "fact_review", severity));

      expect(await service.itemAsked(ORG, "item")).toBe(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it("fire once per person however often the item is refreshed", async () => {
      items.set("item-err", item("item-err", "merge_approval", "err"));

      await service.itemAsked(ORG, "item-err");
      await service.itemAsked(ORG, "item-err");

      expect(mailer.sent).toHaveLength(1);
    });

    it("respect instant off and per-kind mutes", async () => {
      items.set("item-err", item("item-err", "merge_approval", "err"));
      fake.recipients = [
        member("off", ["owner"], { instantSeverity: "off" }),
        member("muted", ["owner"], { mutedKinds: ["merge_approval"] }),
        member("on", ["owner"]),
      ];

      await service.itemAsked(ORG, "item-err");

      expect(mailer.sent.map((m) => m.to)).toEqual(["on@acme.test"]);
    });

    it("send nothing without a mail server", async () => {
      service = build("none");
      items.set("item-err", item("item-err", "merge_approval", "err"));

      expect(await service.itemAsked(ORG, "item-err")).toBe(0);
      expect(fake.sends).toHaveLength(0);
    });

    it("hear the lifecycle's filed event", async () => {
      service.onModuleInit();
      items.set("item-err", item("item-err", "merge_approval", "err"));

      lifecycle.emit({
        type: "filed",
        itemId: "item-err",
        organizationId: ORG,
        kindId: "merge_approval",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.onModuleDestroy();

      expect(mailer.sent).toHaveLength(1);
    });

    it("record a failed send and retry it on the next pass, up to the limit", async () => {
      items.set("item-err", item("item-err", "merge_approval", "err"));
      mailer.failFor("admin-a@acme.test", MAX_SEND_ATTEMPTS + 1);

      await service.itemAsked(ORG, "item-err");
      expect(fake.sends.map((s) => s.status)).toEqual(["failed"]);

      expect((await service.pass()).failed).toBe(1);
      expect((await service.pass()).failed).toBe(1);
      expect(await service.pass()).toEqual({ instantSent: 0, digestSent: 0, failed: 0 });
      expect(fake.sends.map((s) => s.attempt)).toEqual([1, 2, 3]);
    });

    it("re-mint on a retry, superseding the failed mail's links", async () => {
      items.set("item-err", item("item-err", "merge_approval", "err"));
      mailer.failFor("admin-a@acme.test", 1);

      await service.itemAsked(ORG, "item-err");
      expect((await service.pass()).instantSent).toBe(1);

      const approve = tokens.tokens.filter((t) => t.actionId === "approve_merge");

      expect(approve).toHaveLength(2);
      expect(approve[0]?.revokeReason).toBe("superseded");
      expect(approve[1]?.revokedAt).toBeNull();
    });
  });

  describe("the daily digest", () => {
    beforeEach(() => {
      fake.recipients = [
        member("admin-a", ["admin"], { digestEnabled: true, digestTime: "09:00" }),
      ];
      items.set("info-old", item("info-old", "fact_review", "info", 3 * 3_600_000));
      items.set("err-new", item("err-new", "merge_approval", "err", 60_000));
      items.set("warn", item("warn", "protected_path_allow_once", "warn", 7_200_000));
    });

    it("lands at the configured time with the open decisions by severity and age, and the resolved summary", async () => {
      fake.resolutions = [
        {
          itemId: "x",
          kindId: "split_approval",
          kindVersion: 1,
          payload: SEEDED_PAYLOADS.split_approval ?? {},
          refs: [],
          actionId: "approve_split",
          resolver: "human",
          policy: null,
          channel: "web",
          resolvedAt: new Date("2026-10-04T08:00:00Z"),
        },
      ];

      expect((await service.pass()).digestSent).toBe(1);

      const [mail] = mailer.sent;
      const text = mail?.text ?? "";

      expect(mail?.subject).toBe("[Ouroboros] 3 decisions waiting · Acme Robotics");
      expect(text.indexOf("[Blocking]")).toBeLessThan(text.indexOf("[Waiting]"));
      expect(text.indexOf("[Waiting]")).toBeLessThan(text.indexOf("[FYI]"));
      expect(text).toContain("Resolved in the last day (1)");
      expect(text).toContain("— approved");
      expect(fake.sends[0]).toMatchObject({
        kind: "digest",
        slotAt: new Date("2026-10-04T09:00:00Z"),
      });
    });

    it("is not sent before the slot, and not twice for one slot", async () => {
      jest.spyOn(service, "now").mockReturnValue(new Date("2026-10-04T08:59:00Z"));
      expect(await service.digestFor(ORG, "admin-a", new Date("2026-10-04T08:59:00Z"))).toBe(
        "skipped",
      );

      expect(await service.digestFor(ORG, "admin-a", NOW)).toBe("sent");
      expect(await service.digestFor(ORG, "admin-a", NOW)).toBe("skipped");
      expect(mailer.sent).toHaveLength(1);
    });

    it("leaves muted kinds out", async () => {
      fake.recipients = [
        member("admin-a", ["admin"], { digestEnabled: true, mutedKinds: ["fact_review"] }),
      ];

      await service.digestFor(ORG, "admin-a", NOW);

      expect(mailer.sent[0]?.text).not.toContain("[FYI]");
    });

    it("shows a card the person cannot answer without action links", async () => {
      fake.recipients = [member("viewer-v", ["viewer"], { digestEnabled: true })];

      await service.digestFor(ORG, "viewer-v", NOW);

      expect(mailer.sent[0]?.text).toContain("[Blocking]");
      expect(tokens.tokens).toHaveLength(0);
    });

    it("is not sent while off", async () => {
      fake.recipients = [member("admin-a", ["admin"], { digestEnabled: false })];

      expect(await service.digestFor(ORG, "admin-a", NOW)).toBe("skipped");
    });

    it("retries a failed digest for the same slot", async () => {
      mailer.failFor("admin-a@acme.test", 1);

      expect(await service.digestFor(ORG, "admin-a", NOW)).toBe("failed");
      expect(await service.digestFor(ORG, "admin-a", NOW)).toBe("sent");
      expect(fake.sends.map((s) => [s.attempt, s.status])).toEqual([
        [1, "failed"],
        [2, "sent"],
      ]);
    });
  });

  it("mints for answering actions the person holds — never a link or a non-answer", () => {
    const kind = SHIPPED_KINDS.protected_path_allow_once;

    expect(answerable(kind, member("m", ["member"])).map((a) => a.id)).toEqual([]);
    expect(answerable(kind, member("a", ["admin"])).map((a) => a.id)).toEqual([
      "allow_once",
      "deny",
    ]);
    expect(
      answerable(kind, { ...member("m", ["member"]), explicitCanApproveLoops: true }).map(
        (a) => a.id,
      ),
    ).toEqual(["allow_once", "deny"]);
  });
});
