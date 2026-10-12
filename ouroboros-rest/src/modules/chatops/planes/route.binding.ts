/**
 * `/ouro route <task kind> <alias>` — repin a stage's model (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537), per its model-registry amendment).
 *
 * The save is `RoutingManagementService.save` with one route — exactly what
 * `PUT /api/v1/routing/routes/{taskKind}` hands it — so the chain is validated, a revision is
 * written and the change is audited by the editor's own code.
 *
 * ```
 * alias    RegistryService.resolve   an unknown alias or a raw model id is refused by the registry
 * policy   …ManagementService.matrix the route as it stands
 * save     …ManagementService.save   the same chain with hop 1's alias replaced, nothing else
 * ```
 *
 * **Only the primary hop changes.** The fallbacks, each hop's note, the local-fallback switch,
 * the floor and the per-run cost cap are sent back as they were read.
 */

import { Injectable } from "@nestjs/common";

import { RegistryService } from "../../registry/registry.service";
import { RoutingManagementService } from "../../routing/management.service";
import type { BindingResult, CommandBinding, CommandContext } from "../grammar.types";
import { argument } from "./binding.arguments";
import { routeNotConfigured } from "./planes.errors";

@Injectable()
export class RouteBinding implements CommandBinding {
  readonly command = "route";

  /**
   * @param registry - The model registry, which says what an alias is.
   * @param routing - The routing editor's service.
   */
  constructor(
    private readonly registry: RegistryService,
    private readonly routing: RoutingManagementService,
  ) {}

  /**
   * Replace the primary hop's alias and save.
   *
   * @param context - The invocation.
   * @returns What the task kind now routes to — or that it already did.
   * @throws {NotFoundError} `model_alias_not_found` from the registry; `chat_route_not_configured`
   *   for a task kind with no route.
   * @throws {InvalidRequestError} `route_save_invalid` from the editor — e.g. the alias is already
   *   a fallback in the same chain.
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const { organizationId, invoker } = context;
    const taskKind = argument(context, "task", "task_kind").name;
    const alias = argument(context, "alias", "alias").alias;

    const resolved = await this.registry.resolve(organizationId, alias);
    const matrix = await this.routing.matrix(organizationId);
    const route = matrix.taskKinds.find((kind) => kind.name === taskKind)?.route ?? null;

    if (route === null) throw routeNotConfigured(taskKind);

    const hops = [...route.hops].sort((a, b) => a.position - b.position);
    const previous = hops[0]?.alias;
    const saved = await this.routing.save(organizationId, invoker.userId, [
      {
        taskKind,
        hops: hops.map((hop, index) => ({
          alias: index === 0 ? resolved.alias : hop.alias,
          note: hop.note,
        })),
        allowLocalFallback: route.allowLocalFallback,
        floorHopIndex: route.floorHopIndex,
        maxCostCentsPerRun: route.maxCostCentsPerRun,
      },
    ]);
    const target = `${resolved.alias} (${resolved.modelId})`;

    if (saved.revisionId === null) {
      return {
        kind: "done",
        reply: { text: `${taskKind} is already routed to ${target} — nothing changed.` },
        ref: { taskKind, alias: resolved.alias },
      };
    }

    return {
      kind: "done",
      reply: {
        text: `${taskKind} now routes to ${target}${
          previous === undefined ? "" : ` — was ${previous}`
        }.`,
      },
      ref: { taskKind, alias: resolved.alias, revisionId: saved.revisionId },
    };
  }
}
