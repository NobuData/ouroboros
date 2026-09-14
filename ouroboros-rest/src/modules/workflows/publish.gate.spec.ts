import type { EngineClient } from "../engine/engine.client";
import type { RegistryAlias } from "./alias.suggestion";
import type { WorkflowCatalogRepository } from "./catalog.repository";
import { DslErrorCode, DslWarningCode } from "./dsl.errors";
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
 * **An engine that cannot answer refuses the publish.** Whatever the reason — down, refusing,
 * or a build that does not publish R.2's route
 * ([#144](https://github.com/NobuData/ouroboros/issues/144)) — the gate never publishes a
 * version on the DSL verdict alone.
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

/** The workspace publishing. */
const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/**
 * The workspace's model registry — the two aliases mockup 04's canvas pins, one more that is
 * unbound, and a fallback nothing pins. Name order, as the repository reads it.
 */
const REGISTRY: readonly RegistryAlias[] = [
  { alias: "coder-fallback", modelId: "gpt-5-codex" },
  { alias: "coder-max", modelId: "claude-fable-5" },
  { alias: "coder-std", modelId: "claude-sonnet-5" },
  { alias: "gpt5-experiments", modelId: "gpt-5.2-preview" },
];

/**
 * The gate, over an engine and a workspace's registry.
 *
 * @param client - The engine.
 * @param aliases - What the workspace's registry holds.
 * @returns The gate, and the registry read to assert against.
 */
function gateWith(
  client: EngineClient,
  aliases: readonly RegistryAlias[] = REGISTRY,
): WorkflowPublishGate {
  const catalog = {
    registryAliases: jest.fn().mockResolvedValue([...aliases]),
  } as unknown as WorkflowCatalogRepository;

  return new WorkflowPublishGate(client, catalog);
}

/**
 * Mockup 04's canvas with `plan`'s routing replaced.
 *
 * @param routing - The routing to give `plan`.
 * @param change - Anything else to change on the copy.
 * @returns The document.
 */
function withPlanRouting(
  routing: unknown,
  change: (nodes: { id: string; config: Record<string, unknown> }[]) => void = () => undefined,
): unknown {
  const document = structuredClone(STANDARD_FIX) as {
    nodes: { id: string; config: Record<string, unknown> }[];
  };

  document.nodes.find((node) => node.id === "plan")!.config.routing = routing;
  change(document.nodes);

  return document;
}

describe("the publish gate", () => {
  it("passes a document both validators accept", async () => {
    const { client, validateWorkflow } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [] }),
    );

    const verdict = await gateWith(client).check(WORKSPACE, STANDARD_FIX);

    expect(verdict.findings).toEqual([]);
    expect(verdict.engineConsulted).toBe(true);
    expect(validateWorkflow).toHaveBeenCalledWith(STANDARD_FIX);
  });

  it("refuses on the DSL stage without asking the engine", async () => {
    const { client, validateWorkflow } = engineAnswering(jest.fn());

    const verdict = await gateWith(client).check(WORKSPACE, NO_TRIGGER);

    expect(verdict.findings.length).toBeGreaterThan(0);
    expect(verdict.findings.every((finding) => finding.source === "dsl")).toBe(true);
    expect(verdict.engineConsulted).toBe(false);
    expect(validateWorkflow).not.toHaveBeenCalled();
  });

  it("anchors a DSL finding where the diagnostic anchored it", async () => {
    // The acceptance criterion: a finding a person clicks has to name a node or an edge, and
    // a pointer so a raw editor can jump to it.
    const { client } = engineAnswering(jest.fn());

    const [finding] = (await gateWith(client).check(WORKSPACE, NO_TRIGGER)).findings;

    expect(finding.source).toBe("dsl");
    expect(finding.code).not.toBe("");
    expect(typeof finding.path).toBe("string");
    expect(finding.message).not.toBe("");
  });

  it("carries a node anchor through from the DSL validator", async () => {
    const { client } = engineAnswering(jest.fn());

    const verdict = await gateWith(client).check(
      WORKSPACE,
      readFixture("invalid/node-duplicate-id.json"),
    );

    expect(verdict.findings.some((finding) => finding.node !== undefined)).toBe(true);
  });

  it("carries an edge anchor through from the DSL validator", async () => {
    const { client } = engineAnswering(jest.fn());

    const verdict = await gateWith(client).check(
      WORKSPACE,
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

    const verdict = await gateWith(client).check(WORKSPACE, STANDARD_FIX);

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

    const [finding] = (await gateWith(client).check(WORKSPACE, STANDARD_FIX)).findings;

    expect(finding).not.toHaveProperty("node");
    expect(finding).not.toHaveProperty("edge");
    expect(finding).not.toHaveProperty("path");
  });

  it("does not swallow an engine that is unwell", async () => {
    // An outage must refuse a publish rather than wave it through: the engine's reading is part
    // of the verdict, not a bonus on top of it.
    const failure = new Error("engine_unavailable");
    const { client } = engineAnswering(jest.fn().mockRejectedValue(failure));

    await expect(gateWith(client).check(WORKSPACE, STANDARD_FIX)).rejects.toBe(failure);
  });

  it("hands the engine the document exactly as it was stored", async () => {
    // What is judged has to be what becomes immutable; a gateway that reshaped it on the way
    // would be asking about a different document.
    const { client, validateWorkflow } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [] }),
    );

    await gateWith(client).check(WORKSPACE, STANDARD_FIX);

    expect(validateWorkflow).toHaveBeenCalledTimes(1);
    expect(validateWorkflow.mock.calls[0][0]).toBe(STANDARD_FIX);
  });
});

describe("the publish gate's governance stage (CH.6, #589)", () => {
  it("reads the registry of the workspace that is publishing", async () => {
    const registryAliases = jest.fn().mockResolvedValue([...REGISTRY]);
    const { client } = engineAnswering(jest.fn().mockResolvedValue({ findings: [] }));
    const gate = new WorkflowPublishGate(client, {
      registryAliases,
    } as unknown as WorkflowCatalogRepository);

    await gate.check(WORKSPACE, STANDARD_FIX);

    expect(registryAliases).toHaveBeenCalledWith(WORKSPACE);
  });

  it("refuses a raw model id with the designed error naming the node and the alias", async () => {
    const { client, validateWorkflow } = engineAnswering(jest.fn());

    const verdict = await gateWith(client).check(
      WORKSPACE,
      withPlanRouting({ pinned_model: "claude-fable-5" }),
    );

    expect(verdict.findings).toEqual([
      {
        source: "dsl",
        code: DslErrorCode.CONFIG_ROUTING_RAW_MODEL,
        path: "/nodes/3/config/routing/pinned_model",
        node: "plan",
        message:
          "Stage `plan` pins the raw model id `claude-fable-5` — raw model ids are not allowed; " +
          "reference a registry alias (did you mean coder-max?).",
        suggestion: "coder-max",
      },
    ]);
    expect(verdict.engineConsulted).toBe(false);
    expect(validateWorkflow).not.toHaveBeenCalled();
  });

  it("publishes the same stage once it names the alias", async () => {
    const { client, validateWorkflow } = engineAnswering(
      jest.fn().mockResolvedValue({ findings: [] }),
    );

    const verdict = await gateWith(client).check(
      WORKSPACE,
      withPlanRouting({ pinned_model: { alias: "coder-max" } }),
    );

    expect(verdict).toEqual({ findings: [], engineConsulted: true });
    expect(validateWorkflow).toHaveBeenCalledTimes(1);
  });

  it("refuses an alias the registry does not hold, in the same shape", async () => {
    const { client, validateWorkflow } = engineAnswering(jest.fn());

    const verdict = await gateWith(client).check(
      WORKSPACE,
      withPlanRouting({ pinned_model: { alias: "coder-maxx" } }),
    );

    expect(verdict.findings).toEqual([
      {
        source: "registry",
        code: DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
        path: "/nodes/3/config/routing/pinned_model/alias",
        node: "plan",
        message:
          "Stage `plan` pins `coder-maxx`, which is not in this workspace's model registry — " +
          "reference a registry alias (did you mean coder-max?).",
        suggestion: "coder-max",
      },
    ]);
    expect(verdict.engineConsulted).toBe(false);
    expect(validateWorkflow).not.toHaveBeenCalled();
  });

  it("answers a model id written as an alias with the alias that means it", async () => {
    const { client } = engineAnswering(jest.fn());

    const [finding] = (
      await gateWith(client).check(
        WORKSPACE,
        withPlanRouting({ pinned_model: { alias: "claude-fable-5" } }),
      )
    ).findings;

    expect(finding.code).toBe(DslWarningCode.REFERENCE_UNKNOWN_ALIAS);
    expect(finding.suggestion).toBe("coder-max");
  });

  it("claims no suggestion it does not have", async () => {
    const { client } = engineAnswering(jest.fn());

    const [finding] = (
      await gateWith(client).check(
        WORKSPACE,
        withPlanRouting({ pinned_model: { alias: "nothing-like-it" } }),
      )
    ).findings;

    expect(finding).not.toHaveProperty("suggestion");
    expect(finding.message.endsWith("reference a registry alias.")).toBe(true);
  });

  it("refuses every pin of a workspace whose registry is empty", async () => {
    const { client } = engineAnswering(jest.fn());

    const verdict = await gateWith(client, []).check(WORKSPACE, STANDARD_FIX);

    expect(verdict.findings.map((finding) => [finding.node, finding.source])).toEqual([
      ["analyze", "registry"],
      ["plan", "registry"],
      ["review", "registry"],
    ]);
  });

  it("accepts an alias that exists but is unbound or switched off", async () => {
    // The switch keeps every reference; resolution is where it takes effect. A publish that
    // refused this would make switching an alias off the same as deleting it.
    const { client } = engineAnswering(jest.fn().mockResolvedValue({ findings: [] }));

    const verdict = await gateWith(client).check(
      WORKSPACE,
      withPlanRouting({ pinned_model: { alias: "gpt5-experiments" } }),
    );

    expect(verdict.findings).toEqual([]);
  });

  it("leaves an unknown skill advisory, because the rule is about aliases alone", async () => {
    const { client } = engineAnswering(jest.fn().mockResolvedValue({ findings: [] }));

    const verdict = await gateWith(client).check(
      WORKSPACE,
      withPlanRouting({ pinned_model: { alias: "coder-max" } }, (nodes) => {
        nodes.find((node) => node.id === "analyze")!.config.skill = "no-such-skill";
      }),
    );

    expect(verdict).toEqual({ findings: [], engineConsulted: true });
  });
});
