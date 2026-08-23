import {
  VersioningType,
  type HttpServer,
  type INestApplication,
  type NestApplicationOptions,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";

import { AUTH_PREFIX_EXCLUSIONS } from "./auth/auth.routes";
import { AppModule } from "./modules/app/app.module";
import type { Configuration } from "./modules/config/configuration";
import { ErrorEnvelopeFilter } from "./modules/errors/error.filter";
import { validationPipe } from "./modules/errors/validation";
import { PROBE_PATHS } from "./modules/health/health.paths";
import { INTERNAL_PATHS } from "./modules/internal/internal.paths";
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
 * Six decisions are applied here and nowhere else:
 *
 *   * **The global prefix.** Every route is under `/api`, which leaves the origin's root
 *     free for whatever fronts the service later — every route but the health probes and
 *     BetterAuth's, which are excluded by name. A probe is read by infrastructure that has
 *     no notion of an API version and is configured once, so it answers at the origin
 *     root; see `src/modules/health/health.paths.ts`, which is where those paths are
 *     written down. BetterAuth's are excluded because the library serves them itself, one
 *     level up at `/api/auth`, where its own versions live rather than this service's; see
 *     `src/auth/auth.routes.ts`. The engine-facing surface
 *     ([#224](https://github.com/NobuData/ouroboros/issues/224)) is excluded for a third
 *     reason: `/api` is the *browser's* boundary — CORS-configured, session-authenticated,
 *     and published in the document `ouroboros-ui` generates a client from — and two routes
 *     that answer only to a worker inside the network belong outside it; see
 *     `src/modules/internal/internal.paths.ts`.
 *   * **URI versioning, defaulting to v1.** The version is in the path because that is
 *     what a generated client, a browser address bar and a log line can all carry
 *     without negotiation. Defaulting it means a controller opts *out* of v1 rather than
 *     into it, so a route can never be published unversioned by omission.
 *   * **Shutdown hooks.** Nest listens for `SIGTERM` and friends and runs every
 *     provider's `onApplicationShutdown` before the process ends. The readiness probe's
 *     own connection is the first thing that needs it (#29); the request pool (#30) and
 *     the engine client (#35) are next, and a pool that learns to drain only after
 *     something is already using it drains for the first time in production.
 *   * **Validation, before every handler.** DTOs are `class-validator` classes and this is
 *     the pipe that enforces them ([#31](https://github.com/NobuData/ouroboros/issues/31)).
 *     It transforms — so a query string's `limit=10` arrives as the number the DTO declares
 *     — and it *whitelists*: a property no DTO declares is refused rather than passed
 *     through, which closes mass assignment for every route at once instead of per service.
 *   * **The error envelope, for every failure.** `{code, message, details}`
 *     (`docs/ARCHITECTURE.md` § 5.3) is what a client parses, and a filter is the only place
 *     it can be made true of the answers *no* handler produced — Nest's `404` for an unknown
 *     path, a body the parser rejected, a connection the database refused. The probes are
 *     exempt by the same enumerated list that escapes the prefix above: their reader is a
 *     healthcheck, not a browser, and their body is described in `openapi.yaml` as it is.
 *   * **The published specification.** `openapi.yaml` is the contract and this hands it
 *     out unchanged — Swagger UI at {@link DOCS_PATH} for a human, the document itself at
 *     {@link OPENAPI_JSON_PATH} and {@link OPENAPI_YAML_PATH} for a client generator.
 *     `SwaggerModule` is used only to *render and serve*; it generates nothing, which is
 *     what makes the document a browser reads and the file `ouroboros-ui` codegens from
 *     the same bytes. Reading it here also means a build packaged without its
 *     specification fails while the application is being constructed rather than on the
 *     first request for the document.
 *
 * A seventh decision — **which browser origins may call this API with credentials** — is
 * applied by {@link permitBrowserOrigins} rather than by {@link configureApplication},
 * because it is the one that needs a value from the environment. A suite building its own
 * application through `@nestjs/testing` calls it too when it is asserting about CORS, and
 * otherwise does not: an origin policy changes nothing about a request Supertest makes
 * over a socket with no `Origin` header.
 *
 * An eighth — **that Nest parses no body at all** — is {@link applicationOptions}, because
 * it has to be decided before the application exists rather than applied to one that does.
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
 * @param options - Merged into {@link applicationOptions} and passed to
 *   `NestFactory.create`. The process passes nothing; the seam exists so a test can
 *   silence the framework's boot logging, which is the one thing about a real application
 *   a suite has no use for.
 * @returns An initialised-on-demand application. The caller decides whether to
 *   `listen()` (the process) or `init()` (a test).
 * @throws {SpecificationError} If the committed `openapi.json` is missing or malformed —
 *   see `src/openapi/specification.ts`.
 */
export async function createApplication(
  configuration: Configuration,
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(
    AppModule.forRoot(configuration),
    applicationOptions(options),
  );
  configureApplication(app);
  permitBrowserOrigins(app, configuration.corsOrigins);

  return app;
}

/**
 * The options every application this service builds is created with.
 *
 * One of them, and it is not negotiable: **Nest parses no request body.**
 * BetterAuth serves its own routes and reads the raw request stream, so a body Nest had
 * already parsed into an object would reach the library as nothing at all — and the
 * failure that produces looks like a bad signature or a malformed payload rather than
 * like a bootstrap setting, which is why this is stated here once instead of being
 * remembered at each call site
 * ([#701](https://github.com/NobuData/ouroboros/issues/701)).
 *
 * **Every other route still parses JSON**, and by the same mechanism rather than by luck:
 * `@thallesp/nestjs-better-auth` re-adds `express.json()` and `express.urlencoded()` as
 * middleware for every path that is *not* under `/api/auth` — see `src/auth/auth.module.ts`.
 * That indirection is the regression surface this issue was written around, so it is
 * asserted across the service's real endpoints in `application.spec.ts` rather than
 * assumed from a library's README.
 *
 * A consequence worth knowing before reaching for it: `NestApplicationOptions.rawBody` no
 * longer does anything, because it is implemented *by* the parser that is now off. A route
 * that needs the unparsed bytes — a webhook signature, say — asks the library's module for
 * them instead, through its `bodyParser.rawBody` option.
 *
 * @param options - What the caller wants. Anything it says about the body parser is
 *   discarded: an application that parsed bodies globally would not serve
 *   `/api/auth/*` correctly, so there is no caller for whom the answer differs.
 * @returns The caller's options with the body parser switched off.
 */
export function applicationOptions(options?: NestApplicationOptions): NestApplicationOptions {
  return { ...options, bodyParser: false };
}

/**
 * Let the browser origins in `OURO_CORS_ORIGINS` call this API *with their cookies*.
 *
 * Two things make this necessary rather than a nicety, and both arrived with the session
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)). `ouroboros-ui` is served from a
 * different origin than this service — `:3000` and `:4000` in development, and two
 * hostnames in a deployment — so every call it makes is cross-origin; and a cross-origin
 * request only carries a cookie when the server says `Access-Control-Allow-Credentials`
 * *and* names the origin exactly. Without this the OAuth flow still completes, because a
 * redirect is a navigation rather than a fetch, and then `/auth/me` answers `401` to a
 * browser that is holding a perfectly good session.
 *
 * The list is validated as *origins* — scheme, host, optional port, no path, no wildcard —
 * in `src/modules/config/configuration.ts`, and never empty. A wildcard is not merely
 * discouraged here: a credentialed request may not be answered with one at all, so `*`
 * would produce a service that appears configured and refuses every call the UI makes.
 *
 * This is the CORS *policy*, not the security baseline. Helmet, rate limiting and the
 * cookie hardening review are [#38](https://github.com/NobuData/ouroboros/issues/38); what
 * is here is the minimum without which the session cannot be exercised by the client it
 * exists for.
 *
 * @param app - The application to configure.
 * @param origins - The validated origins, from `OURO_CORS_ORIGINS`.
 */
export function permitBrowserOrigins(app: INestApplication, origins: readonly string[]): void {
  app.enableCors({
    // Spread because Nest's option type asks for a mutable array; the configuration's own
    // copy stays frozen, so nothing can widen the policy by mutating it from elsewhere.
    origin: [...origins],
    credentials: true,
    // `X-Ouro-Tenant` is #32's, and is listed here because a header a browser is not told
    // it may send is a preflight failure rather than a missing header — a failure that
    // would land on that issue looking like its own bug.
    allowedHeaders: ["Content-Type", "X-Ouro-Tenant"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
}

/**
 * Apply the six decisions above to an application that has already been built.
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
  // one; `PROBE_PATHS`, `INTERNAL_PATHS` and `AUTH_PREFIX_EXCLUSIONS` stay readonly, so
  // nothing can add a route to the set that escapes the prefix by mutating it from
  // somewhere else.
  //
  // BetterAuth's paths are in it because this call *replaces* the exclusions rather than
  // adding to them, and `@thallesp/nestjs-better-auth` has already added its own from a
  // constructor that ran during `NestFactory.create` — see `src/auth/auth.routes.ts`.
  // Restating them here is what survives; leaving it to the library would put the
  // difference between an excluded path and a swallowed one in the order two lines happen
  // to execute.
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [...PROBE_PATHS, ...INTERNAL_PATHS, ...AUTH_PREFIX_EXCLUSIONS],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
  app.enableShutdownHooks();

  app.useGlobalPipes(validationPipe());
  // The same list, for the same reason: a probe answers to infrastructure, so the one body
  // in this service that is not an envelope is the one the prefix already exempts.
  app.useGlobalFilters(new ErrorEnvelopeFilter(PROBE_PATHS));

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
