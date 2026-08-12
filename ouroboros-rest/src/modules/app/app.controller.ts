import { Controller, Get } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { AppService, type Heartbeat } from "./app.service";

/**
 * `GET /api/v1` — the heartbeat.
 *
 * The controller declares no path of its own and no version of its own, so it answers on
 * the root of whatever prefix and version `src/application.ts` configures. That is the
 * point: the API's base path is settled in one place, and a controller cannot drift from
 * it by hard-coding half of it here.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Answer the heartbeat.
   *
   * `@AllowAnonymous()`, because this route says which build is answering and nothing else
   * — and whatever polls it holds no session
   * ([#33](https://github.com/NobuData/ouroboros/issues/33)). The version it reports is
   * already published in `openapi.yaml`, which is served to anyone as well.
   *
   * The decorator is the library's, and it is the same exemption `@Public()` carried before
   * [#703](https://github.com/NobuData/ouroboros/issues/703) swapped the guard reading it.
   *
   * @returns The {@link Heartbeat} {@link AppService} assembled, serialised as JSON by
   *   Nest's default interceptor.
   */
  @AllowAnonymous()
  @Get()
  heartbeat(): Heartbeat {
    return this.appService.heartbeat();
  }
}
