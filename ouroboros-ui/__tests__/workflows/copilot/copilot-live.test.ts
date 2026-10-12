import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_LIVE,
  publishDraft,
  publishOperation,
  publishStreaming,
  readCopilotLive,
  resetCopilotLive,
  subscribeCopilotLive,
  useCopilotLive,
} from "@/app/workflows/copilot/copilot-live";

import { copilotConversation } from "../../helpers/workflow-copilot";

/**
 * The seam the stage list (CE.3, #567) subscribes to (CE.2, #566): what the conversation applied
 * in this page session, in order, per workflow.
 */

const OPERATION = {
  op: { kind: "add_stage", params: { node: { id: "exploit-verify" } } },
  outcome: "applied" as const,
  draftRev: 4,
  warnings: [],
};

beforeEach(() => resetCopilotLive());

describe("the store", () => {
  it("starts empty, as the same object for every workflow nobody has conversed with", () => {
    expect(readCopilotLive("wf-1")).toBe(EMPTY_LIVE);
    expect(EMPTY_LIVE).toEqual({ operations: [], draft: null, streaming: false });
  });

  it("keeps operations in the order they were published, numbered from 1, per workflow", () => {
    publishOperation("wf-1", OPERATION);
    publishOperation("wf-1", { ...OPERATION, op: { kind: "set_guard" }, outcome: "proposed", draftRev: null });
    publishOperation("wf-2", OPERATION);

    expect(readCopilotLive("wf-1").operations.map((operation) => [operation.ordinal, operation.op.kind, operation.outcome])).toEqual([
      [1, "add_stage", "applied"],
      [2, "set_guard", "proposed"],
    ]);
    expect(readCopilotLive("wf-2").operations).toHaveLength(1);
  });

  it("records the draft a finished reply left, and whether one is arriving", () => {
    const { draft } = copilotConversation();

    publishStreaming("wf-1", true);
    expect(readCopilotLive("wf-1").streaming).toBe(true);

    publishDraft("wf-1", draft);
    publishStreaming("wf-1", false);

    expect(readCopilotLive("wf-1")).toEqual({ operations: [], draft, streaming: false });
  });

  it("hands back the same object until something changes, and tells subscribers when it does", () => {
    const listener = vi.fn();
    const stop = subscribeCopilotLive(listener);

    publishStreaming("wf-1", false);
    expect(listener).not.toHaveBeenCalled();

    publishOperation("wf-1", OPERATION);
    const first = readCopilotLive("wf-1");

    expect(listener).toHaveBeenCalledOnce();
    expect(readCopilotLive("wf-1")).toBe(first);

    stop();
    publishOperation("wf-1", OPERATION);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("forgets one workflow, or all of them", () => {
    publishOperation("wf-1", OPERATION);
    publishOperation("wf-2", OPERATION);

    resetCopilotLive("wf-1");
    expect(readCopilotLive("wf-1")).toBe(EMPTY_LIVE);
    expect(readCopilotLive("wf-2").operations).toHaveLength(1);

    resetCopilotLive();
    expect(readCopilotLive("wf-2")).toBe(EMPTY_LIVE);
  });
});

describe("useCopilotLive", () => {
  it("re-renders its caller as operations land", () => {
    const { result } = renderHook(() => useCopilotLive("wf-1"));

    expect(result.current).toBe(EMPTY_LIVE);

    act(() => publishOperation("wf-1", OPERATION));

    expect(result.current.operations).toHaveLength(1);
  });
});
