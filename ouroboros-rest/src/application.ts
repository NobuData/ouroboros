import { VersioningType, type INestApplication, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./modules/app/app.module";

/**
 * How the application is assembled — everything about the HTTP surface that is decided
 * once, for every route, rather than per controller.
 *
 * It is separate from `main.ts` because `main.ts` binds a socket and this does not: a
 * test can build exactly the application the process runs, ask it questions over
 * Supertest, and close it again without anything listening. That is what makes "the
 * routes are really under `/api/v1`" an assertion rather than a comment.
 */

/** Path segment every route sits under. Combined with the version below by Nest. */
export const API_PREFIX = "api";

/** Version served when a route does not ask for a different one. */
export const API_VERSION = "1";

/**
 * The base path of the API, as a client sees it: `/api/v1`.
 *
 * Composed from the two constants above rather than written out, so the string in the
 * logs and the string the router matches cannot disagree.
 */
export const API_BASE_PATH = `/${API_PREFIX}/v${API_VERSION}`;

/**
 * Build the Nest application.
 *
 * Three decisions are applied here and nowhere else:
 *
 *   * **The global prefix.** Every route is under `/api`, which leaves the origin's root
 *     free for whatever fronts the service later.
 *   * **URI versioning, defaulting to v1.** The version is in the path because that is
 *     what a generated client, a browser address bar and a log line can all carry
 *     without negotiation. Defaulting it means a controller opts *out* of v1 rather than
 *     into it, so a route can never be published unversioned by omission.
 *   * **Shutdown hooks.** Nest listens for `SIGTERM` and friends and runs every
 *     provider's `onApplicationShutdown` before the process ends. Nothing needs that
 *     yet; the database pool (#30) and the engine client (#35) will, and a pool that
 *     learns to drain only after something is already using it drains for the first time
 *     in production.
 *
 * @param options - Passed straight to `NestFactory.create`. The process passes nothing;
 *   the seam exists so a test can silence the framework's boot logging, which is the one
 *   thing about a real application a suite has no use for.
 * @returns An initialised-on-demand application. The caller decides whether to
 *   `listen()` (the process) or `init()` (a test).
 */
export async function createApplication(
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, options);

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  app.enableShutdownHooks();

  return app;
}
