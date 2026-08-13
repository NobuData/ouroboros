/**
 * `/api/v1/me/preferences` — the caller's own product preferences
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * `me/` is a new prefix and a deliberate one: everything else under `/api/v1` is scoped to
 * a workspace, and these two routes are scoped to a *person* — the same person whatever
 * workspace their session is acting in, because a font size is chosen by the reader's eyes
 * and not by where they are reading. That is the whole argument for `@TenantOptional()`
 * here, recorded in `tenant.decorators.ts`'s enumeration of exceptions.
 *
 * The class carries the decorator so both routes are exempt together — a PATCH that
 * required a workspace while its GET did not would be the kind of asymmetry a client only
 * discovers in production.
 *
 * Sessions are required without anything here saying so: the guard #703 registers is
 * global, and a controller is protected because somebody wrote a controller.
 */

import { Body, Controller, Get, Patch } from "@nestjs/common";

import { TenantOptional } from "../tenancy/tenant.decorators";
import { PatchPreferencesDto } from "./preferences.dto";
import { PreferencesService } from "./preferences.service";
import type { PreferencesResource } from "./resources";

@Controller("me/preferences")
@TenantOptional()
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  /**
   * The caller's preferences — stored choices where they exist, defaults where none do.
   *
   * @returns The resource. Never a 404: a preference always has a value.
   */
  @Get()
  read(): Promise<PreferencesResource> {
    return this.preferences.read();
  }

  /**
   * Change what the body carries; answer with the whole surface as it now stands.
   *
   * @param patch - The change. A value outside the five steps is a `422` from the
   *   validation pipe, naming the field — the CHECK behind it (V007) is the authority this
   *   restates, per `preferences.dto.ts`.
   * @returns The resource after the write.
   */
  @Patch()
  update(@Body() patch: PatchPreferencesDto): Promise<PreferencesResource> {
    return this.preferences.update(patch);
  }
}
