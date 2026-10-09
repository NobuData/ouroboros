import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CopilotAnswerBody,
  CopilotMessageBody,
  CopilotMessageParams,
  CopilotSessionParams,
  StartCopilotSessionBody,
} from "./copilot.dto";

const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const SESSION = "5eed008a-0000-4000-8000-000000000001";

async function problems(instance: object): Promise<string[]> {
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
}

describe("the copilot DTOs", () => {
  it("accepts a well-formed session start, with or without a draft name", async () => {
    expect(await problems(plainToInstance(StartCopilotSessionBody, {}))).toEqual([]);
    expect(
      await problems(plainToInstance(StartCopilotSessionBody, { draftName: "security-patch" })),
    ).toEqual([]);
  });

  it("holds the draft name to the slug grammar", async () => {
    expect(
      await problems(plainToInstance(StartCopilotSessionBody, { draftName: "Security Patch" })),
    ).toEqual(["draftName"]);
    expect(
      await problems(plainToInstance(StartCopilotSessionBody, { draftName: "a".repeat(65) })),
    ).toEqual(["draftName"]);
  });

  it("requires a non-blank message within the bound", async () => {
    expect(
      await problems(plainToInstance(CopilotMessageBody, { text: "label security." })),
    ).toEqual([]);
    expect(await problems(plainToInstance(CopilotMessageBody, { text: "" }))).toEqual(["text"]);
    expect(
      await problems(plainToInstance(CopilotMessageBody, { text: "x".repeat(20_001) })),
    ).toEqual(["text"]);
    expect(await problems(plainToInstance(CopilotMessageBody, {}))).toEqual(["text"]);
  });

  it("requires a question index and a chosen option", async () => {
    expect(
      await problems(
        plainToInstance(CopilotAnswerBody, { question: 0, selected: "label:security" }),
      ),
    ).toEqual([]);
    expect(
      await problems(plainToInstance(CopilotAnswerBody, { question: -1, selected: "x" })),
    ).toEqual(["question"]);
    expect(
      await problems(plainToInstance(CopilotAnswerBody, { question: 0, selected: "" })),
    ).toEqual(["selected"]);
  });

  it("requires uuids in the path", async () => {
    expect(
      await problems(plainToInstance(CopilotSessionParams, { id: WORKFLOW, sessionId: SESSION })),
    ).toEqual([]);
    expect(
      await problems(plainToInstance(CopilotSessionParams, { id: "nope", sessionId: SESSION })),
    ).toEqual(["id"]);
    expect(
      await problems(
        plainToInstance(CopilotMessageParams, { id: WORKFLOW, sessionId: SESSION, messageId: "x" }),
      ),
    ).toEqual(["messageId"]);
  });

  it("refuses a property it does not declare", async () => {
    expect(
      await problems(plainToInstance(CopilotMessageBody, { text: "hi", definition: {} })),
    ).toEqual(["definition"]);
  });
});
