import { Module } from "@nestjs/common";

import { EngineClient } from "./engine.client";
import { EngineController } from "./engine.controller";

/**
 * The engine gateway — the boundary between this service and `ouroboros-engine`.
 *
 * One controller and one provider, and the ratio is the point: the *client* is what this
 * module exists for, and the route is one caller of it. `docs/ARCHITECTURE.md` § 10's first
 * invariant says the UI never touches the engine, so every future engine feature is another
 * operation in a controller that calls a typed method here — and this module is what makes
 * "who may call the engine" a question the `imports` lists answer.
 *
 * {@link EngineClient} is exported for that reason. Nothing imports this module yet;
 * `AppModule` registers it so the route exists, and the export is what the next feature
 * module needs rather than a second client of its own.
 *
 * It reads `OURO_ENGINE_URL` and `OURO_ENGINE_SHARED_SECRET` by injecting
 * `AppConfigService` and imports nothing to do it: the configuration module is global
 * ([#28](https://github.com/NobuData/ouroboros/issues/28)).
 *
 * There is no `HttpModule`. The client is a `fetch` with a base URL, a header, a deadline
 * and one retry — see `engine.client.ts` for why that is the whole dependency.
 */
@Module({
  controllers: [EngineController],
  providers: [EngineClient],
  exports: [EngineClient],
})
export class EngineModule {}
