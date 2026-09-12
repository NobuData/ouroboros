import { Logger } from "@nestjs/common";

import type { EngineClient } from "../engine/engine.client";
import { readFixture } from "./dsl.golden.fixture";
import { WorkflowPublishGate } from "./publish.gate";

/**
 * The gate, and the three properties publishing rests on.
 *
 * **The order.** Cheap first, and a document that fails the zod stage never reaches the
 * engine — so the common failure costs no hop, and a list of findings never says the same
 * thing twice in two vocabularies.
 *
 * **The verdict is the conjunction.** A finding from either validator is a finding, and only
 * an empty list may publish.
 *
 * **The tolerance is exactly one status wide.** An engine build that does not publish R.2's
 * route ([#144](https://github.com/NobuData/ouroboros/issues/144)) is a deployment state and
 * the publish proceeds on the DSL verdict; an engine that is *down* is an
 * `engine_unavailable` that refuses it.
 *
 * The documents are the committed fixtures rather than documents written here:
 * `schemas/workflow-dsl/fixtures/valid/standard-fix.json` *is* mockup 04's canvas, node for
 * node, so a green verdict here is a green verdict about the design.
 */

/** Mockup 04's canvas, as P.2 committed it. */
const STANDARD_FIX = readFixture("valid/standard-fix.json");

/** A document P.2 refuses: no trigger node at all. */
const NO_TRIGGER = readFixture("invalid/no-trigger.json");

/** The one engine call this gate makes, as a spy a test scripts. */
type ValidateWorkflow = jest.MockedFunction<EngineClient["validateWorkflow"]>;

/**
 * An engine that answers whatever a test says.
 *
 * Typed against the client's own method rather than as a bare `jest.Mock`, so a spec that
 * scripted an answer the contract does not allow would not compile — which is the same
 * argument `engine.stub.fixture.ts` makes about a stub that is free to be wrong in the same
 * direction as the code.
 *
 * @param validateWorkflow - What `EngineClient.validateWorkflow` should do.
 * @returns The client to construct the gate with, and the spy to assert against.
 */
function engineAnswering(validateWorkflow: ValidateWorkflow): {
  client: EngineClient;
  validateWorkflow: ValidateWorkflow;
} {
  return { client: { validateWorkflow } as unknown as EngineClient, validateWorkflow };
}

describe("the publish gate", () => {
  it("passes a document both validators accept", async () => {
    const { client, validateWorkflow } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [] }),
    );

    const verdict = await new WorkflowPublishGate(client).check(STANDARD_FIX);

    expect(verdict.findings).toEqual([]);
    expect(verdict.engineConsulted).toBe(true);
    expect(validateWorkflow).toHaveBeenCalledWith(STANDARD_FIX);
  });

  it("refuses on the DSL stage without asking the engine", async () => {
    const { client, validateWorkflow } = engineAnswering(jest.fn());

    const verdict = await new WorkflowPublishGate(client).check(NO_TRIGGER);

    expect(verdict.findings.length).toBeGreaterThan(0);
    expect(verdict.findings.every((finding) => finding.source === "dsl")).toBe(true);
    expect(verdict.engineConsulted).toBe(false);
    expect(validateWorkflow).not.toHaveBeenCalled();
  });

  it("anchors a DSL finding where the diagnostic anchored it", async () => {
    // The acceptance criterion: a finding a person clicks has to name a node or an edge, and
    // a pointer so a raw editor can jump to it.
    const { client } = engineAnswering(jest.fn());

    const [finding] = (await new WorkflowPublishGate(client).check(NO_TRIGGER)).findings;

    expect(finding.source).toBe("dsl");
    expect(finding.code).not.toBe("");
    expect(typeof finding.path).toBe("string");
    expect(finding.message).not.toBe("");
  });

  it("carries a node anchor through from the DSL validator", async () => {
    const { client } = engineAnswering(jest.fn());

    const verdict = await new WorkflowPublishGate(client).check(
      readFixture("invalid/node-duplicate-id.json"),
    );

    expect(verdict.findings.some((finding) => finding.node !== undefined)).toBe(true);
  });

  it("carries an edge anchor through from the DSL validator", async () => {
    const { client } = engineAnswering(jest.fn());

    const verdict = await new WorkflowPublishGate(client).check(
      readFixture("invalid/edge-unknown-to.json"),
    );

    expect(verdict.findings.some((finding) => finding.edge !== undefined)).toBe(true);
  });

  it("refuses on the engine's findings, in the engine's own vocabulary", async () => {
    const { client } = engineAnswering(
      jest.fn().mockResolvedValue({
        findings: [
          { code: "unreachable_node", message: "Nothing reaches this node.", node: "review" },
        ],
      }),
    );

    const verdict = await new WorkflowPublishGate(client).check(STANDARD_FIX);

    expect(verdict.findings).toEqual([
      {
        source: "engine",
        code: "unreachable_node",
        message: "Nothing reaches this node.",
        node: "review",
      },
    ]);
    expect(verdict.engineConsulted).toBe(true);
  });

  it("does not claim an anchor the engine did not send", async () => {
    const { client } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [{ code: "graph_cyclic", message: "…" }] }),
    );

    const [finding] = (await new WorkflowPublishGate(client).check(STANDARD_FIX)).findings;

    expect(finding).not.toHaveProperty("node");
    expect(finding).not.toHaveProperty("edge");
    expect(finding).not.toHaveProperty("path");
  });

  it("passes, un-seconded, when the engine build does not publish the route", async () => {
    // The state of every build until #144 lands. What is lost is a redundant check — the two
    // validators are held to one verdict by `dsl.parity.spec.ts` — and it is reported, which
    // is the second half of this assertion: a gate that quietly halved itself would be worse
    // than one that refused. At `debug` here and at `warn` in the caller, which is what knows
    // which workflow was published.
    const debug = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    const { client } = engineAnswering(jest.fn().mockResolvedValue(undefined));

    const verdict = await new WorkflowPublishGate(client).check(STANDARD_FIX);

    expect(verdict.findings).toEqual([]);
    expect(verdict.engineConsulted).toBe(false);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("/v0/workflows/validate"));
  });

  it("does not swallow an engine that is unwell", async () => {
    // The tolerance is one status wide. An outage must refuse a publish rather than wave it
    // through, which is the difference between *cannot ask* and *asked and got nothing*.
    const failure = new Error("engine_unavailable");
    const { client } = engineAnswering(jest.fn().mockRejectedValue(failure));

    await expect(new WorkflowPublishGate(client).check(STANDARD_FIX)).rejects.toBe(failure);
  });

  it("hands the engine the document exactly as it was stored", async () => {
    // What is judged has to be what becomes immutable; a gateway that reshaped it on the way
    // would be asking about a different document.
    const { client, validateWorkflow } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [] }),
    );

    await new WorkflowPublishGate(client).check(STANDARD_FIX);

    expect(validateWorkflow).toHaveBeenCalledTimes(1);
    expect(validateWorkflow.mock.calls[0][0]).toBe(STANDARD_FIX);
  });
});
