/**
 * `/api/v1/knowledge/env-recipe` — mockup 14's Environment block (BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * **The read is every member's** — a viewer included — because the block is where someone looks
 * when the build breaks. **The save is `owner`/`admin`** (`@Roles(...ADMINISTRATORS)`): the recipe
 * is what the farm's container pools, the prebuild tier and execution workspace prep run, so
 * changing it is the gate writing a skill takes. Every save is audited as
 * `knowledge.env_recipe_saved` in the signed-in person's name.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Put, Query } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { currentUser } from "../tenancy/tenant.context";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { EnvRecipeQuery, SaveEnvRecipeBody } from "./env-recipes.dto";
import type { EnvRecipeResource } from "./env-recipes.resources";
import { EnvRecipesService } from "./env-recipes.service";

@Controller("knowledge/env-recipe")
export class EnvRecipesController {
  /** @param recipes - The service. */
  constructor(private readonly recipes: EnvRecipesService) {}

  /**
   * `GET /api/v1/knowledge/env-recipe?repo=` — the version in force.
   *
   * @param tenant - The workspace.
   * @param query - The repository.
   * @returns The recipe; `404 env_recipe_not_found` for a repository with none.
   */
  @Get()
  read(
    @CurrentTenant() tenant: Organization,
    @Query() query: EnvRecipeQuery,
  ): Promise<EnvRecipeResource> {
    return this.recipes.read(tenant.id, query.repo);
  }

  /**
   * `PUT /api/v1/knowledge/env-recipe` — the block, saved as the next version. `201`: a version
   * row was created.
   *
   * @param tenant - The workspace.
   * @param body - The repository and the commands.
   * @returns The version now in force.
   */
  @Put()
  @Roles(...ADMINISTRATORS)
  @HttpCode(HttpStatus.CREATED)
  save(
    @CurrentTenant() tenant: Organization,
    @Body() body: SaveEnvRecipeBody,
  ): Promise<EnvRecipeResource> {
    return this.recipes.save(tenant.id, actorId(), body);
  }
}

/**
 * The signed-in person's id.
 *
 * @returns It.
 * @throws {Error} When there is no signed-in person, which the session guard makes unreachable —
 *   a version nobody can be named for would be an audit row that lied.
 */
function actorId(): string {
  const user = currentUser();

  if (user === undefined) {
    throw new Error(
      "/api/v1/knowledge/env-recipe was reached with no signed-in person. The route is neither " +
        "@AllowAnonymous() nor @TenantOptional(), and a recipe version belongs to somebody.",
    );
  }

  return user.id;
}
