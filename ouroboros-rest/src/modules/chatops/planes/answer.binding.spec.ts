import { ConflictError, ForbiddenError } from "../../errors/error.envelope";
import type { InboxActionsService } from "../../inbox-actions/inbox-actions.service";
import type { ResolvedArgument } from "../grammar.types";
import { AnswerBinding } from "./answer.binding";
import { APP_URL, bindsOf, contextFor, REQUESTER, strictDouble, WORKSPACE } from "./planes.fixture";

/**
 * `/ouro answer <q-id> <action>` (#537) is `InboxActionsService.execute` — the action executor
 * behind `POST /api/v1/inbox/items/:id/actions/:actionId` (`InboxActionsController.execute`:
 * `this.actions.execute(member.tenant.id, params.id, params.actionId, { id, name, roles },
 * { note, idempotencyKey }, "web")`). Chat makes the same call with the item the short id
 * resolved to, the invoker as the presser, no note, and its own channel. The executor decides
 * whether this person may press the action, so the double has `execute` and nothing else: a
 * binding that resolved the item itself would have nothing to call.
 */

const ARGS: Readonly<Record<string, ResolvedArgument>> = {
  question: { type: "question", itemId: "item-231", shortId: "q-231" },
  action: { type: "action", actionId: "allow_once" },
};

/** What the executor answers a pressed action with. */
const RESULT = {
  itemId: "item-231",
  resolution: { actionId: "allow_once" },
  attempt: { id: "attempt-9" },
  receipt: {
    effects: ["allowed the write once", "loop 1847 resumed"],
    links: [
      { label: "Loop 1847", href: "/runs/run-1847" },
      { label: "Policies", href: "/settings#policies" },
    ],
  },
};

describe("the /ouro answer binding", () => {
  let execute: jest.Mock;
  let binding: AnswerBinding;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue(RESULT);
    binding = new AnswerBinding(
      strictDouble<InboxActionsService>("InboxActionsService", { execute }),
    );
  });

  it("serves the answer command, which the registry binds to the inbox's action route", () => {
    expect(binding.command).toBe("answer");
    expect(bindsOf("answer")).toBe("POST /api/v1/inbox/items/{id}/actions/{actionId}");
  });

  it("presses the action on the item the short id named, as the invoker", async () => {
    await binding.run(contextFor("answer", ARGS));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      WORKSPACE,
      "item-231",
      "allow_once",
      REQUESTER,
      {},
      "slack",
    );
  });

  it("records the console as the web channel, which is what the page's button records", async () => {
    await binding.run(contextFor("answer", ARGS, { surface: "console" }));

    expect(execute).toHaveBeenCalledWith(WORKSPACE, "item-231", "allow_once", REQUESTER, {}, "web");
  });

  it("answers with the plane's receipt and its first link, made absolute", async () => {
    expect(await binding.run(contextFor("answer", ARGS))).toEqual({
      kind: "done",
      reply: {
        text: "q-231 answered with allow_once — allowed the write once · loop 1847 resumed",
        link: { label: "Loop 1847", url: `${APP_URL}/runs/run-1847` },
      },
      ref: { itemId: "item-231", actionId: "allow_once", attemptId: "attempt-9" },
    });
  });

  it("carries no link when the receipt has none", async () => {
    execute.mockResolvedValue({ ...RESULT, receipt: { ...RESULT.receipt, links: [] } });

    const result = await binding.run(contextFor("answer", ARGS));

    expect(result.reply).toEqual({
      text: "q-231 answered with allow_once — allowed the write once · loop 1847 resumed",
    });
  });

  it.each([
    [
      "decision_action_forbidden",
      new ForbiddenError("decision_action_forbidden", "That answer needs an approver."),
    ],
    [
      "decision_already_answered",
      new ConflictError("decision_already_answered", "Somebody answered it first."),
    ],
  ])("relays the executor's %s refusal as the plane threw it", async (_code, refusal) => {
    execute.mockRejectedValue(refusal);

    await expect(binding.run(contextFor("answer", ARGS))).rejects.toBe(refusal);
  });
});
