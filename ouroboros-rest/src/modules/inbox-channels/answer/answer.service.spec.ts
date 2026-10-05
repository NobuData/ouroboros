import type { AppConfigService } from "../../config/config.service";
import type { OrganizationRole } from "../../db/schema";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../../decisions/decision.kinds.fixture";
import { renderDecision } from "../../decisions/decision.templates";
import type { PublishedDecisionKind } from "../../decisions/decision.types";
import type { InboxItemRow, InboxRepository } from "../../decisions/inbox.repository";
import { ConflictError } from "../../errors/error.envelope";
import { decisionAlreadyAnswered } from "../../inbox-actions/inbox-actions.errors";
import type { ActionResultResource } from "../../inbox-actions/inbox-actions.resources";
import type { InboxActionsService } from "../../inbox-actions/inbox-actions.service";
import type { DecisionMailRepository, MailRecipient } from "../mail/decision-mail.repository";
import { FakeTokenStore, FakeVault } from "../tokens/action-token.fixture";
import { ActionTokenService } from "../tokens/action-token.service";
import { AnswerService, problemOf, receiptText } from "./answer.service";

const ORG = "org-1";
const ALLOW_ITEM = "item-allow";
const MERGE_ITEM = "item-merge";

/** The data-problem marker of a page, if any. */
const problem = (html: string) => /data-problem="([a-z_]+)"/.exec(html)?.[1];

describe("AnswerService (#463)", () => {
  let store: FakeTokenStore;
  let tokens: ActionTokenService;
  let members: MailRecipient[];
  let executed: Parameters<InboxActionsService["execute"]>[];
  let failWith: Error | undefined;
  let service: AnswerService;

  const items = new Map<string, InboxItemRow>(
    [
      [ALLOW_ITEM, "protected_path_allow_once"],
      [MERGE_ITEM, "merge_approval"],
    ].map(([id, kindId]) => [
      id,
      {
        id,
        kindId,
        kindVersion: 1,
        severity: "err",
        status: "open",
        payload: SEEDED_PAYLOADS[kindId] ?? {},
        refs: [],
        sourceRef: `test:${kindId}`,
        createdAt: new Date("2026-10-04T08:00:00Z"),
        snoozedUntil: null,
        snoozedBy: null,
        snoozeReason: null,
      },
    ]),
  );

  /** A member of the workspace. */
  const member = (userId: string, roles: OrganizationRole[]): MailRecipient => ({
    userId,
    email: `${userId}@acme.test`,
    name: `Person ${userId}`,
    roles,
    explicitCanApproveLoops: null,
    preferences: undefined,
  });

  beforeEach(() => {
    store = new FakeTokenStore();
    store.itemOrganizations.set(ALLOW_ITEM, ORG);
    store.itemOrganizations.set(MERGE_ITEM, ORG);
    store.mergeClassItems.add(MERGE_ITEM);
    tokens = new ActionTokenService(store.repository(), new FakeVault().service());
    members = [member("ken", ["admin"]), member("priya", ["admin"])];
    executed = [];
    failWith = undefined;

    const actions = {
      execute: (...args: Parameters<InboxActionsService["execute"]>) => {
        executed.push(args);

        if (failWith !== undefined) {
          return Promise.reject(failWith);
        }

        return Promise.resolve<ActionResultResource>({
          itemId: args[1],
          kindId: "protected_path_allow_once",
          status: "resolved",
          replayed: false,
          attempt: { id: "attempt-1", idempotencyKey: args[4].idempotencyKey ?? "" },
          resolution: {
            actionId: args[2],
            resolver: "human",
            policy: null,
            actor: { id: args[3]?.id ?? "", name: args[3]?.name ?? "" },
            channel: args[5] ?? "web",
            note: args[4].note ?? null,
            outcome: { exception_id: "ex-1", control_id: "ctl-1", nested: { x: 1 } },
            resolvedAt: "2026-10-04T09:12:00.000Z",
          },
          receipt: { effects: ["exception granted"], links: [] },
        });
      },
    } as unknown as InboxActionsService;

    service = new AnswerService(
      tokens,
      {
        item: (_org: string, id: string) => Promise.resolve(items.get(id)),
      } as unknown as InboxRepository,
      {
        pinnedKind: (kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId]),
        render: (kind: PublishedDecisionKind, payload: Record<string, unknown>) =>
          renderDecision(kind, payload),
      } as unknown as DecisionKindRegistry,
      {
        recipients: (_org: string, userId?: string) =>
          Promise.resolve(members.filter((m) => m.userId === userId)),
        workspaceName: () => Promise.resolve("Acme Robotics"),
      } as unknown as DecisionMailRepository,
      actions,
      { uiUrl: "https://ouro.example" } as AppConfigService,
    );
  });

  /** Mint a token for ken. */
  const mint = (itemId: string, actionId: string, userId = "ken") =>
    tokens.mint(ORG, itemId, actionId, userId, "email");

  describe("link-open (GET, and the HEAD a prefetcher sends)", () => {
    it("renders the confirm page and executes nothing, spends nothing", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");

      for (let opened = 0; opened < 3; opened += 1) {
        const page = await service.page(token, undefined);

        expect(page.status).toBe(200);
        expect(page.html).toContain("Allow a one-time edit to a protected path?");
        expect(page.html).toContain(`action="/api/v1/inbox/answer/${token}"`);
      }

      expect(executed).toHaveLength(0);
      expect(store.tokens[0]?.usedAt).toBeNull();
    });

    it("asks a merge-class link to sign in, without a form", async () => {
      const token = await mint(MERGE_ITEM, "approve_merge");
      const page = await service.page(token, undefined);

      expect(page.status).toBe(200);
      expect(page.html).toContain("Sign in to confirm");
      expect(page.html).toContain(
        `https://ouro.example/login?next=${encodeURIComponent(`/api/v1/inbox/answer/${token}`)}`,
      );
      expect(page.html).not.toContain("<form");
    });

    it("shows the merge-class confirm button to its own signed-in person", async () => {
      const token = await mint(MERGE_ITEM, "approve_merge");
      const page = await service.page(token, { userId: "ken", name: "Ken" });

      expect(page.html).toContain("<form");
    });
  });

  describe("the answer (POST)", () => {
    it("executes a non-sensitive action from the page and returns a receipt", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");
      const page = await service.answer(token, undefined, undefined);

      expect(page.status).toBe(200);
      expect(page.html).toContain("✓ Allow once");
      expect(page.html).toContain("by Person ken · by email");
      expect(executed).toHaveLength(1);
      expect(executed[0]?.slice(0, 3)).toEqual([ORG, ALLOW_ITEM, "allow_once"]);
      expect(executed[0]?.[3]).toEqual({ id: "ken", name: "Person ken", roles: ["admin"] });
      expect(executed[0]?.[4]).toEqual({ note: undefined, idempotencyKey: "token:token-1" });
      expect(executed[0]?.[5]).toBe("email");
    });

    it("is single-use: the second press renders the used page and executes nothing", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");

      await service.answer(token, undefined, undefined);
      const again = await service.answer(token, undefined, undefined);

      expect(problem(again.html)).toBe("used");
      expect(again.status).toBe(410);
      expect(executed).toHaveLength(1);
    });

    it("refuses a merge-class answer without a session, and spends nothing", async () => {
      const token = await mint(MERGE_ITEM, "approve_merge");
      const page = await service.answer(token, undefined, undefined);

      expect(page.status).toBe(401);
      expect(page.html).toContain("Nothing was done");
      expect(executed).toHaveLength(0);
      expect(store.tokens[0]?.usedAt).toBeNull();
    });

    it("executes a merge-class answer for its own signed-in person", async () => {
      const token = await mint(MERGE_ITEM, "approve_merge");
      const page = await service.answer(token, { userId: "ken", name: "Ken S" }, undefined);

      expect(page.status).toBe(200);
      expect(executed[0]?.[3]?.name).toBe("Ken S");
    });

    it("re-renders a missing note as 422 without spending the token", async () => {
      const token = await mint(MERGE_ITEM, "return_to_loop");
      const session = { userId: "ken", name: "Ken" };
      const page = await service.answer(token, session, "   ");

      expect(page.status).toBe(422);
      expect(store.tokens[0]?.usedAt).toBeNull();

      const done = await service.answer(token, session, "  use the HAL timer  ");

      expect(done.status).toBe(200);
      expect(executed[0]?.[4].note).toBe("use the HAL timer");
    });

    it("says the decision was already answered when someone else won the race", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");

      failWith = decisionAlreadyAnswered(ALLOW_ITEM, {
        actionId: "deny",
        resolver: "human",
        policy: null,
        actor: { id: "priya", name: "Priya" },
        channel: "web",
        resolvedAt: "2026-10-04T09:00:00.000Z",
      });

      expect(problem((await service.answer(token, undefined, undefined)).html)).toBe("answered");
    });

    it("shows the plane's refusal and keeps the decision open", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");

      failWith = new ConflictError("allow_once_still_blocked", "The path is still blocked.");
      const page = await service.answer(token, undefined, undefined);

      expect(page.status).toBe(409);
      expect(page.html).toContain("The path is still blocked.");
      expect(page.html).toContain("still open");
    });
  });

  describe("one person's token", () => {
    it("does not work for another signed-in person — on GET or POST", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once", "ken");
      const priya = { userId: "priya", name: "Priya" };

      expect(problem((await service.page(token, priya)).html)).toBe("wrong_user");
      expect(problem((await service.answer(token, priya, undefined)).html)).toBe("wrong_user");
      expect(executed).toHaveLength(0);
      expect(store.tokens[0]?.usedAt).toBeNull();
    });

    it("stops working once its person leaves the workspace", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once", "ken");

      members = members.filter((m) => m.userId !== "ken");

      expect(problem((await service.answer(token, undefined, undefined)).html)).toBe("not_member");
      expect(executed).toHaveLength(0);
    });
  });

  describe("expired, used and revoked links", () => {
    it("render three distinguishable designed pages", async () => {
      const revokedItem = "item-revoked";

      items.set(revokedItem, { ...(items.get(ALLOW_ITEM) as InboxItemRow), id: revokedItem });
      store.itemOrganizations.set(revokedItem, ORG);

      const expired = await mint(ALLOW_ITEM, "allow_once");
      const used = await mint(ALLOW_ITEM, "allow_once", "priya");
      const revoked = await mint(revokedItem, "allow_once");

      await service.answer(used, undefined, undefined);
      store.closeItem(revokedItem);
      // Past every token's TTL: used and revoked still say why they stopped first.
      store.now = new Date(store.now.getTime() + store.ttlMs + 1);

      const pages = await Promise.all(
        [expired, used, revoked].map(async (token) => {
          const page = await service.page(token, undefined);

          return [problem(page.html), page.status];
        }),
      );

      expect(pages).toEqual([
        ["expired", 410],
        ["used", 410],
        ["answered", 410],
      ]);
    });

    it("revokes outstanding tokens when the item is resolved anywhere", async () => {
      const token = await mint(ALLOW_ITEM, "allow_once");

      store.closeItem(ALLOW_ITEM);
      const page = await service.answer(token, undefined, undefined);

      expect(problem(page.html)).toBe("answered");
      expect(executed).toHaveLength(0);
    });

    it("says a newer mail replaced a superseded link", async () => {
      const first = await mint(ALLOW_ITEM, "allow_once");
      await mint(ALLOW_ITEM, "allow_once");

      expect(problem((await service.page(first, undefined)).html)).toBe("superseded");
    });

    it("answers a link that names nothing with the unknown page", async () => {
      expect(problem((await service.page("ouro_act_nope", undefined)).html)).toBe("unknown");
      expect((await service.answer("ouro_act_nope", undefined, undefined)).status).toBe(404);
    });
  });

  it("maps a token's state to its problem", () => {
    expect(problemOf({ state: "live", revokeReason: null })).toBeUndefined();
    expect(problemOf({ state: "revoked", revokeReason: "withdrawn" })).toBe("withdrawn");
    expect(problemOf({ state: "revoked", revokeReason: "item_closed" })).toBe("answered");
  });

  it("writes a receipt from scalar outcome fields only", () => {
    expect(
      receiptText({
        actionId: "approve_merge",
        resolver: "human",
        policy: null,
        actor: { id: "ken", name: "Ken" },
        channel: "email",
        note: null,
        outcome: { merge: "armed", nested: { a: 1 } },
        resolvedAt: "2026-10-04T09:12:00.000Z",
      }),
    ).toBe("approved by Ken · by email · 2026-10-04 09:12 UTC · merge armed");
  });
});
