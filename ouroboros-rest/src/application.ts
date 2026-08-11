import {
  VersioningType,
  type HttpServer,
  type INestApplication,
  type NestApplicationOptions,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./modules/app/app.module";
import type { Configuration } from "./modules/config/configuration";
import { PROBE_PATHS } from "./modules/health/health.paths";
import { document, specificationYaml } from "./openapi/specification";
import { SERVICE_NAME } from "./version";

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
 * Where the specification is published, as a client sees it.
 *
 * All three sit under `/api` rather than under `/api/v1`: the document *describes* the
 * versions, so it cannot live inside one of them. They are the only paths this service
 * serves that are not in `openapi.yaml`, for the same reason — a document that described
 * itself would be a route the drift check has to special-case rather than a contract.
 */
export const DOCS_PATH = `/${API_PREFIX}/docs`;
export const OPENAPI_JSON_PATH = `/${API_PREFIX}/openapi.json`;
export const OPENAPI_YAML_PATH = `/${API_PREFIX}/openapi.yaml`;

/** Media type for the authoritative document — registered by RFC 9512. */
export const YAML_MEDIA_TYPE = "application/yaml";

/**
 * The part of a platform response {@link publishSpecification} uses.
 *
 * The YAML document is served straight from the HTTP adapter rather than from a
 * controller, because a controller would be a route in the API's own surface — and a
 * contract that describes the endpoint serving it is a route the drift check has to
 * forgive rather than a promise about the product. `SwaggerModule` registers its own
 * routes the same way, for the same reason.
 */
interface RawResponse {
  type(mediaType: string): unknown;
  send(body: string): unknown;
}

/**
 * Build the Nest application.
 *
 * Four decisions are applied here and nowhere else:
 *
 *   * **The global prefix.** Every route is under `/api`, which leaves the origin's root
 *     free for whatever fronts the service later — every route but the health probes,
 *     which are excluded by name. A probe is read by infrastructure that has no notion of
 *     an API version and is configured once, so it answers at the origin root; see
 *     `src/modules/health/health.paths.ts`, which is where those paths are written down.
 *   * **URI versioning, defaulting to v1.** The version is in the path because that is
 *     what a generated client, a browser address bar and a log line can all carry
 *     without negotiation. Defaulting it means a controller opts *out* of v1 rather than
 *     into it, so a route can never be published unversioned by omission.
 *   * **Shutdown hooks.** Nest listens for `SIGTERM` and friends and runs every
 *     provider's `onApplicationShutdown` before the process ends. The readiness probe's
 *     own connection is the first thing that needs it (#29); the request pool (#30) and
 *     the engine client (#35) are next, and a pool that learns to drain only after
 *     something is already using it drains for the first time in production.
 *   * **The published specification.** `openapi.yaml` is the contract and this hands it
 *     out unchanged — Swagger UI at {@link DOCS_PATH} for a human, the document itself at
 *     {@link OPENAPI_JSON_PATH} and {@link OPENAPI_YAML_PATH} for a client generator.
 *     `SwaggerModule` is used only to *render and serve*; it generates nothing, which is
 *     what makes the document a browser reads and the file `ouroboros-ui` codegens from
 *     the same bytes. Reading it here also means a build packaged without its
 *     specification fails while the application is being constructed rather than on the
 *     first request for the document.
 *
 * The specification is served in every environment, deliberately. It describes only what
 * the service already answers, it holds no secret, and it is committed in a public
 * repository — while hiding it in production would mean production served a different
 * surface than development, which is the exact drift being spec-first exists to prevent.
 *
 * @param configuration - The validated configuration, registered globally for every
 *   feature module to read through `AppConfigService`. It is a parameter rather than
 *   something this function reads for itself because the environment is validated before
 *   an application exists — see `src/modules/config/config.module.ts`.
 * @param options - Passed straight to `NestFactory.create`. The process passes nothing;
 *   the seam exists so a test can silence the framework's boot logging, which is the one
 *   thing about a real application a suite has no use for.
 * @returns An initialised-on-demand application. The caller decides whether to
 *   `listen()` (the process) or `init()` (a test).
 * @throws {SpecificationError} If the committed `openapi.json` is missing or malformed —
 *   see `src/openapi/specification.ts`.
 */
export async function createApplication(
  configuration: Configuration,
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(configuration), options);
  configureApplication(app);

  return app;
}

/**
 * Apply the four decisions above to an application that has already been built.
 *
 * Separate from {@link createApplication} for one reason: a suite that has to *replace* a
 * provider builds its application through `@nestjs/testing` rather than through
 * `NestFactory`, and without this it would have to restate the prefix, the versioning and
 * the exclusions — so the surface it asserted against would be a copy of the real one that
 * could drift from it. Overriding the database probe's connection to prove that
 * `/health/ready` degrades to a 503 is exactly that case
 * ([#29](https://github.com/NobuData/ouroboros/issues/29)).
 *
 * @param app - The application to configure. Not yet initialised; `init()` or `listen()`
 *   comes after.
 * @throws {SpecificationError} If the committed specification is missing or malformed —
 *   see {@link publishSpecification}.
 */
export function configureApplication(app: INestApplication): void {
  // The exclusion list is spread into a mutable array because Nest's option type asks for
  // one; `PROBE_PATHS` stays readonly, so nothing can add a route to the set that escapes
  // the prefix by mutating it from somewhere else.
  app.setGlobalPrefix(API_PREFIX, { exclude: [...PROBE_PATHS] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  app.enableShutdownHooks();

  publishSpecification(app);
}

/**
 * Publish the committed specification: Swagger UI for a human, the document itself for a
 * client generator.
 *
 * `SwaggerModule` renders and serves; it is never asked to *build* a document. `raw` is
 * narrowed to JSON for that reason — its YAML route re-serialises the parsed document,
 * which would publish a file that agrees with `openapi.yaml` as data and differs from it
 * as bytes. The YAML this service hands out is the authored file itself.
 *
 * @param app - The application to register the routes on.
 * @throws {SpecificationError} If either committed file is missing or malformed. Reading
 *   both here is what makes that a failure at boot rather than a `500` on the first
 *   request for the contract.
 */
function publishSpecification(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, document(), {
    raw: ["json"],
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    customSiteTitle: `${SERVICE_NAME} · API`,
  });

  const yaml = specificationYaml();
  const adapter = app.getHttpAdapter() as HttpServer<unknown, RawResponse>;
  adapter.get(OPENAPI_YAML_PATH, (_request, response) => {
    response.type(YAML_MEDIA_TYPE);
    response.send(yaml);
  });
}
