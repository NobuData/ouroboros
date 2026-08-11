import { Module } from "@nestjs/common";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";

/**
 * The root module — the heartbeat, and the place every feature module is imported.
 *
 * `src/modules/` is one directory per concern, and the ones the epic adds next are
 * already named: `config` ([#28](https://github.com/NobuData/ouroboros/issues/28)),
 * `health` ([#29](https://github.com/NobuData/ouroboros/issues/29)), `db`
 * ([#30](https://github.com/NobuData/ouroboros/issues/30)), `tenancy`
 * ([#31](https://github.com/NobuData/ouroboros/issues/31)), `auth`
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)) and `engine`
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)). Each arrives as a sibling
 * directory and one entry in the `imports` array below, so what a module contributes is
 * visible in one line here rather than spread through the tree.
 */
@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
