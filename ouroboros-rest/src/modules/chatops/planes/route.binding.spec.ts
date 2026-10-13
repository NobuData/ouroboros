import { InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import { REGISTRY_ERRORS } from "../../registry/registry.errors";
import type { RegistryService } from "../../registry/registry.service";
import type { RoutingManagementService } from "../../routing/management.service";
import type { ResolvedArgument } from "../grammar.types";
import { CHAT_PLANE_ERRORS } from "./planes.errors";
import { bindsOf, contextFor, INVOKER, strictDouble, WORKSPACE } from "./planes.fixture";
import { RouteBinding } from "./route.binding";

/**
 * `/ouro route <task kind> <alias>` (#537) saves through `RoutingManagementService.save` with a
 * batch of one — exactly what `PUT /api/v1/routing/routes/:taskKind` hands it
 * (`RoutingController.saveOne`: `this.routing.save(tenant.id, principal.user.id, [entry])`).
 * The two reads before it are the editor's own too: `RegistryService.resolve` is how the
 * registry says what an alias is, and `routing.matrix` is `GET /api/v1/routing`
 * (`RoutingController.matrix`). The doubles have those three methods and no others, so the
 * chain cannot be written any way but the editor's — validated, revisioned and audited there.
 */

/** The arguments, under the names the registry gives them. */
const ARGS: Readonly<Record<string, ResolvedArgument>> = {
  task: { type: "task_kind", name: "implement" },
  alias: { type: "alias", alias: "claude-fable-5" },
};

/** The `implement` route as it stands: hops stored out of order, a fallback, a note, a cap. */
const ROUTE = {
  hops: [
    { position: 2, alias: "claude-haiku-4", note: "cheap fallback" },
    { position: 1, alias: "claude-opus-4", note: "primary" },
  ],
  allowLocalFallback: true,
  floorHopIndex: 1,
  maxCostCentsPerRun: 450,
};

const MATRIX = {
  taskKinds: [
    { name: "plan", description: "Planning", route: null },
    { name: "implement", description: "Implementation", route: ROUTE },
  ],
};

describe("the /ouro route binding", () => {
  let resolve: jest.Mock;
  let matrix: jest.Mock;
  let save: jest.Mock;
  let binding: RouteBinding;

  beforeEach(() => {
    resolve = jest.fn().mockResolvedValue({ alias: "claude-fable-5", modelId: "fable-5-20260901" });
    matrix = jest.fn().mockResolvedValue(MATRIX);
    save = jest.fn().mockResolvedValue({ revisionId: "revision-7" });
    binding = new RouteBinding(
      strictDouble<RegistryService>("RegistryService", { resolve }),
      strictDouble<RoutingManagementService>("RoutingManagementService", { matrix, save }),
    );
  });

  it("serves the route command, which the registry binds to the routing editor's save", () => {
    expect(binding.command).toBe("route");
    expect(bindsOf("route")).toBe("PUT /api/v1/routing/routes/{taskKind}");
  });

  it("saves one route through the editor's service, as the invoker", async () => {
    await binding.run(contextFor("route", ARGS));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(WORKSPACE, "claude-fable-5");
    expect(matrix).toHaveBeenCalledTimes(1);
    expect(matrix).toHaveBeenCalledWith(WORKSPACE);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(WORKSPACE, INVOKER.userId, expect.any(Array));
  });

  it("replaces the primary hop's alias and sends everything else back as it was read", async () => {
    await binding.run(contextFor("route", ARGS));

    expect(save).toHaveBeenCalledWith(WORKSPACE, INVOKER.userId, [
      {
        taskKind: "implement",
        hops: [
          { alias: "claude-fable-5", note: "primary" },
          { alias: "claude-haiku-4", note: "cheap fallback" },
        ],
        allowLocalFallback: true,
        floorHopIndex: 1,
        maxCostCentsPerRun: 450,
      },
    ]);
  });

  it("answers what the task kind now routes to, and what it routed to before", async () => {
    expect(await binding.run(contextFor("route", ARGS))).toEqual({
      kind: "done",
      reply: {
        text: "implement now routes to claude-fable-5 (fable-5-20260901) — was claude-opus-4.",
      },
      ref: { taskKind: "implement", alias: "claude-fable-5", revisionId: "revision-7" },
    });
  });

  it("says nothing changed when the editor wrote no revision", async () => {
    save.mockResolvedValue({ revisionId: null });

    expect(await binding.run(contextFor("route", ARGS))).toEqual({
      kind: "done",
      reply: {
        text: "implement is already routed to claude-fable-5 (fable-5-20260901) — nothing changed.",
      },
      ref: { taskKind: "implement", alias: "claude-fable-5" },
    });
  });

  it("refuses a task kind with no route before any save, with a code of its own", async () => {
    const context = contextFor("route", { ...ARGS, task: { type: "task_kind", name: "plan" } });

    const refusal = await binding.run(context).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(NotFoundError);
    expect(refusal).toMatchObject({
      code: CHAT_PLANE_ERRORS.routeNotConfigured,
      details: { taskKind: "plan" },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("relays the registry's unknown-alias refusal as thrown, reading and saving nothing", async () => {
    const refusal = new NotFoundError(REGISTRY_ERRORS.aliasNotFound, "No such alias.");
    resolve.mockRejectedValue(refusal);

    await expect(binding.run(contextFor("route", ARGS))).rejects.toBe(refusal);
    expect(matrix).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("relays the editor's route_save_invalid refusal as the plane threw it", async () => {
    const refusal = new InvalidRequestError(
      "route_save_invalid",
      "claude-fable-5 is already a fallback in this chain.",
    );
    save.mockRejectedValue(refusal);

    await expect(binding.run(contextFor("route", ARGS))).rejects.toBe(refusal);
  });
});
