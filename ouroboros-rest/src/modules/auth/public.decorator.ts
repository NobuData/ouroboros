/**
 * `@Public()` — the opt-out from a service that is otherwise entirely authenticated.
 *
 * The guard is registered globally (`auth.module.ts`), so **every route is authenticated
 * unless it says otherwise**. That polarity is the whole point: a route added next year is
 * protected because somebody wrote a controller, not because they remembered a decorator.
 * The inverse — a `@Protected()` on the routes that need it — is one forgotten line away
 * from a tenancy endpoint answering to anybody, and the forgetting is silent.
 *
 * So the exceptions are few, deliberate, and each of them justified where it is written:
 *
 *   * **`GET /api/v1`** — the heartbeat. It says which build is answering and nothing else;
 *     whatever polls it holds no session.
 *   * **`/health/live` and `/health/ready`** — read by a container platform, which has no
 *     session either. `src/modules/health/` already keeps them from saying anything a
 *     stranger should not read.
 *   * **The sign-in routes** — a person signing in does not yet have a session, which is
 *     the point of signing in. `GET /api/v1/auth/me` is *not* among them.
 *
 * Swagger UI and the two specification routes need no decorator: they are registered on
 * the HTTP adapter rather than declared by a controller, so no guard sees them. That is
 * the same reason they are absent from `openapi.yaml`.
 */

import { SetMetadata, type CustomDecorator } from "@nestjs/common";

/**
 * The metadata key the guard reads.
 *
 * Namespaced, because `Reflector` metadata is a single flat space shared with every
 * library in the process, and `"isPublic"` is a name more than one of them uses.
 */
export const IS_PUBLIC = "ouroboros:auth:public";

/**
 * Mark a handler — or a whole controller — as reachable without a session.
 *
 * @returns The decorator. Applied to a class, it covers every route in it; the guard reads
 *   the handler first and then the class, so a controller can be public with no exceptions
 *   or a single handler public within a protected one.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC, true);
