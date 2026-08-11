import { Controller, Get } from "@nestjs/common";

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
   * @returns The {@link Heartbeat} {@link AppService} assembled, serialised as JSON by
   *   Nest's default interceptor.
   */
  @Get()
  heartbeat(): Heartbeat {
    return this.appService.heartbeat();
  }
}
