import { NotFoundError } from "../errors/error.envelope";
import type { Resolution } from "../routing/resolution";
import type { ResolutionService } from "../routing/resolution.service";
import { routeNotFound } from "../routing/routing.errors";
import {
  ESTIMATE_TASK_KIND,
  ESTIMATION_DEFAULT_MODEL,
  EstimationModelService,
} from "./estimation.model";
import type { EstimationRepository } from "./estimation.repository";

const WORKSPACE = "org-estimation";
const SUBJECT = { kind: "issue" as const, id: "e1000000-0000-0000-0000-000000000485" };
const OLLAMA = "5eed000c-0000-4000-8000-000000000005";

/** A hop of a resolution, as the chain carries it. */
function hop(alias: string, modelId: string, decision: "kept" | "dropped") {
  return { alias, modelId, decision };
}

/** A resolution with the given chain and outcome. */
function resolution(
  chain: ReturnType<typeof hop>[],
  overrides: Partial<Resolution> = {},
): Resolution {
  return {
    resolutionVersion: "r1",
    taskKind: ESTIMATE_TASK_KIND,
    outcome: "resolved",
    chain,
    maxCostCents: 25,
    failure: null,
    ...overrides,
  } as unknown as Resolution;
}

/**
 * The service over stand-ins.
 *
 * @param resolve - What routing answers, or throws.
 * @param ollama - The workspace's Ollama connection, or what reading it throws.
 * @returns The service and its stand-ins.
 */
function rig(resolve: () => Promise<Resolution>, ollama: () => Promise<string | undefined>) {
  const routing = { resolve: jest.fn(resolve) };
  const estimates = { ollamaConnection: jest.fn(ollama) };
  const service = new EstimationModelService(
    routing as unknown as ResolutionService,
    estimates as unknown as EstimationRepository,
  );

  return { service, routing, estimates };
}

describe("which model sizes an issue (#123)", () => {
  it("is the estimate route's first kept hop, as an alias the gateway walks", async () => {
    const { service, routing, estimates } = rig(
      () =>
        Promise.resolve(
          resolution([
            hop("sizer", "claude-haiku-4-5", "dropped"),
            hop("local-free", "llama-4", "kept"),
          ]),
        ),
      () => Promise.resolve(OLLAMA),
    );

    await expect(service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      model: {
        alias: "local-free",
        label: "llama-4",
        resolutionVersion: "r1",
        costCapCents: 25,
        subject: SUBJECT,
      },
    });
    expect(routing.resolve).toHaveBeenCalledWith(WORKSPACE, "estimate");
    // A workspace that chose a model is never second-guessed by the default.
    expect(estimates.ollamaConnection).not.toHaveBeenCalled();
  });

  it("defaults to the workspace's Ollama connection and llama3.1:8b when nothing is routed", async () => {
    const { service, estimates } = rig(
      () => Promise.reject(routeNotFound("estimate")),
      () => Promise.resolve(OLLAMA),
    );

    await expect(service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      model: {
        connection: OLLAMA,
        modelId: "llama3.1:8b",
        label: "llama3.1:8b",
        resolutionVersion: null,
        costCapCents: null,
        subject: SUBJECT,
      },
    });
    expect(estimates.ollamaConnection).toHaveBeenCalledWith(WORKSPACE);
    expect(ESTIMATION_DEFAULT_MODEL).toBe("llama3.1:8b");
  });

  it("has no model, and says why, when nothing is routed and there is no Ollama connection", async () => {
    const { service } = rig(
      () => Promise.reject(routeNotFound("estimate")),
      () => Promise.resolve(undefined),
    );

    const choice = await service.choose(WORKSPACE, SUBJECT);

    expect(choice.model).toBeUndefined();
    expect(choice.unavailable).toMatch(/no estimate route and no Ollama connection/);
  });

  it("does not fall back to Ollama when the workspace's own route does not resolve", async () => {
    // The workspace chose; its choice failing is not a reason to use a model it did not pick.
    const { service, estimates } = rig(
      () =>
        Promise.resolve(
          resolution([hop("sizer", "claude-haiku-4-5", "dropped")], {
            outcome: "fail_run",
            failure: { code: "no_eligible_hop", explanation: "every hop was dropped" },
          }),
        ),
      () => Promise.resolve(OLLAMA),
    );

    await expect(service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      unavailable: "the estimate route did not resolve — every hop was dropped",
    });
    expect(estimates.ollamaConnection).not.toHaveBeenCalled();
  });

  it("has no model when the route resolves with no kept hop", async () => {
    const { service } = rig(
      () => Promise.resolve(resolution([hop("sizer", "claude-haiku-4-5", "dropped")])),
      () => Promise.resolve(OLLAMA),
    );

    await expect(service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      unavailable: "the estimate route did not resolve",
    });
  });

  it("never throws: a failed read is no model, with the reason", async () => {
    const unreadableRoute = rig(
      () => Promise.reject(new Error("connection reset")),
      () => Promise.resolve(OLLAMA),
    );
    await expect(unreadableRoute.service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      unavailable: "the estimate route could not be read",
    });

    const anotherNotFound = rig(
      () => Promise.reject(new NotFoundError("workflow_not_found", "Not that one.")),
      () => Promise.resolve(OLLAMA),
    );
    await expect(anotherNotFound.service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      unavailable: "the estimate route could not be read",
    });

    const unreadableOllama = rig(
      () => Promise.reject(routeNotFound("estimate")),
      () => Promise.reject(new Error("connection reset")),
    );
    await expect(unreadableOllama.service.choose(WORKSPACE, SUBJECT)).resolves.toEqual({
      unavailable: "the workspace's Ollama connection could not be read",
    });
  });
});
