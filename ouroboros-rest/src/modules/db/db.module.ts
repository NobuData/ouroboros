import { Module } from "@nestjs/common";

import { DatabaseService } from "./db.service";

/**
 * Data access — the module that owns the connection to `ouroboros-db`.
 *
 * It provides one thing, and that is the point:
 * [#30](https://github.com/NobuData/ouroboros/issues/30) sets the convention that
 * **repositories live with their feature module**. Tenancy's repositories belong to
 * `TenancyModule` ([#31](https://github.com/NobuData/ouroboros/issues/31)), auth's to
 * `AuthModule` ([#33](https://github.com/NobuData/ouroboros/issues/33)); each of them
 * imports this module and injects {@link DatabaseService}. A `DbModule` that also held the
 * queries would become the place every feature's SQL accumulated, which is the shape an
 * ORM's "models" directory has and the reason a query is hard to find in one.
 *
 * It reads `OURO_DATABASE_URL` by injecting `AppConfigService` and imports nothing to do
 * it: the configuration module is global
 * ([#28](https://github.com/NobuData/ouroboros/issues/28)).
 *
 * **Not global**, deliberately, where configuration is. Every module needs configuration;
 * only some modules touch the database, and a module that does is stating a real dependency
 * by importing this one — which is what makes "who can reach the tenancy schema" a question
 * the `imports` lists answer. The health module is the example: its readiness probe keeps a
 * single connection of its own rather than sharing this pool, so it does not import this
 * module at all (see `src/modules/health/database.pool.ts`).
 */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DbModule {}
