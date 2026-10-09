import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { CopilotController } from "./copilot.controller";
import type { CopilotService } from "./copilot.service";
import { formatSse, type CopilotStreamEvent, type SseResponse } from "./copilot.stream";

const TENANT = {
  id: "acme-robotics-id",
  name: "Acme Robotics",
  slug: "acme-robotics",
  logo: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  metadata: null,
};
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const SESSION = "5eed008a-0000-4000-8000-000000000001";
const PRINCIPAL = { user: { id: "user-1" } } as never;

async function* stream(...events: CopilotStreamEvent[]) {
  await Promise.resolve();
  for (const event of events) yield event;
}

function response() {
  const written: string[] = [];
  const target: SseResponse = {
    setHeader: () => undefined,
    write: (chunk) => written.push(chunk),
    end: () => undefined,
  };
  return { target, written };
}

describe("the copilot controller", () => {
  let service: jest.Mocked<Pick<CopilotService, "start" | "conversation" | "send" | "answer">>;
  let controller: CopilotController;
  let reflector: Reflector;

  beforeEach(() => {
    service = {
      start: jest.fn().mockResolvedValue({ id: SESSION }),
      conversation: jest
        .fn()
        .mockResolvedValue({ session: { id: SESSION }, messages: [], draft: {} }),
      send: jest.fn().mockImplementation(() => stream({ kind: "delta", text: "hi" })),
      answer: jest.fn().mockImplementation(() => stream({ kind: "delta", text: "ok" })),
    };
    controller = new CopilotController(service as unknown as CopilotService);
    reflector = new Reflector();
  });

  it("lives under the workflow's copilot path", () => {
    expect(reflector.get<string>(PATH_METADATA, CopilotController)).toBe("workflows/:id/copilot");
  });

  it("starts a session for the tenant, the workflow and the person", async () => {
    await expect(
      controller.start(TENANT, { id: WORKFLOW }, PRINCIPAL, { draftName: "security-patch" }),
    ).resolves.toEqual({ id: SESSION });

    expect(service.start).toHaveBeenCalledWith(TENANT.id, WORKFLOW, "user-1", {
      draftName: "security-patch",
    });
  });

  it("reads the conversation for every member", async () => {
    await controller.conversation(TENANT, { id: WORKFLOW });

    expect(service.conversation).toHaveBeenCalledWith(TENANT.id, WORKFLOW);
    expect(reflector.get(REQUIRED_ROLES, controller.conversation)).toBeUndefined();
  });

  it("streams a message's reply as server-sent events", async () => {
    const sink = response();

    await controller.send(
      TENANT,
      { id: WORKFLOW, sessionId: SESSION },
      PRINCIPAL,
      { text: "hello" },
      sink.target,
    );

    expect(service.send).toHaveBeenCalledWith(TENANT.id, WORKFLOW, SESSION, "user-1", "hello");
    expect(sink.written).toEqual([formatSse({ kind: "delta", text: "hi" })]);
  });

  it("streams an answer's reply the same way", async () => {
    const sink = response();

    await controller.answer(
      TENANT,
      { id: WORKFLOW, sessionId: SESSION, messageId: "m-2" },
      PRINCIPAL,
      { question: 0, selected: "label:security" },
      sink.target,
    );

    expect(service.answer).toHaveBeenCalledWith(TENANT.id, WORKFLOW, SESSION, "m-2", "user-1", {
      question: 0,
      selected: "label:security",
    });
    expect(sink.written).toEqual([formatSse({ kind: "delta", text: "ok" })]);
  });

  it("reserves the writes for administrators, like the draft's own save", () => {
    for (const handler of [controller.start, controller.send, controller.answer]) {
      expect(reflector.get(REQUIRED_ROLES, handler)).toEqual(ADMINISTRATORS);
    }
  });
});
