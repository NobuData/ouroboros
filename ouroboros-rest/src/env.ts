/**
 * The two environment variables the scaffold itself reads, and the error it fails with.
 *
 * This is deliberately small. The validated `OURO_*` configuration module — zod schema,
 * typed accessor service, secrets redacted from logging — is
 * [#28](https://github.com/NobuData/ouroboros/issues/28), and every variable in
 * `README.md`'s configuration table arrives with it. What a scaffold cannot defer is the
 * pair of platform variables it needs to bind a socket at all, so they are read here and
 * validated to the same rule #28 will apply to the rest: a malformed value stops the
 * process while it is starting, naming the variable, rather than surfacing as a stack
 * trace on the first request (`docs/CONVENTIONS.md` § 4).
 *
 * Both are unprefixed, which is the documented exception — `PORT` and `NODE_ENV` are set
 * by container platforms, not by Ouroboros.
 */

/**
 * A required environment variable is missing or malformed.
 *
 * Carries a message naming the offending variable and what was wrong with it, ready to
 * print before exiting non-zero. It is a distinct class so `main` can tell a
 * configuration mistake — which is the operator's to fix, and deserves one line rather
 * than a stack — from a genuine failure, which does not.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Listen port when `PORT` is not set — `docs/CONVENTIONS.md` § 4's port map. */
export const DEFAULT_PORT = 4000;

/** Interface bound when the service is not running in production. */
export const LOOPBACK_HOST = "127.0.0.1";

/** Interface bound in production, where the platform routes to the container. */
export const ALL_INTERFACES_HOST = "0.0.0.0";

/** Highest port number a socket can be bound to. */
const MAX_PORT = 65535;

/**
 * Read and validate the TCP port the service should listen on.
 *
 * @param env - Environment to read, normally `process.env`. Passed in rather than
 *   reached for so a test can exercise a value without mutating the process.
 * @returns The port from `PORT`, or {@link DEFAULT_PORT} when it is unset or empty. An
 *   empty value is treated as unset because that is what an unfilled `PORT=` line in an
 *   env file produces, and failing on it would be a worse answer than the default.
 * @throws {ConfigurationError} If `PORT` is set to anything but a decimal integer
 *   between 1 and {@link MAX_PORT}. `0` is rejected along with the rest: to the operating
 *   system it means "any free port", which is never what someone deploying a service
 *   meant to write.
 */
export function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT;
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }

  // Anchored and digits-only rather than Number()/parseInt(): both of those accept
  // "4000abc", " 4000", "0x4000" or "4e3" and answer with something plausible.
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(
      `PORT: expected a whole number between 1 and ${MAX_PORT}, got "${raw}"`,
    );
  }

  const port = Number(raw);
  if (port < 1 || port > MAX_PORT) {
    throw new ConfigurationError(`PORT: expected a port between 1 and ${MAX_PORT}, got ${port}`);
  }

  return port;
}

/**
 * Decide which interface to bind.
 *
 * Development binds the loopback interface only. A service that answers on every
 * interface of a developer's machine is reachable from whatever network that machine is
 * on, and this one will hold session cookies and a database connection long before it
 * holds an authorization rule. In production the platform is what decides who can reach
 * the container, and a process bound to loopback inside one is a process nothing can
 * route to — so there, every interface is the only workable answer.
 *
 * @param env - Environment to read, normally `process.env`.
 * @returns {@link ALL_INTERFACES_HOST} when `NODE_ENV` is exactly `production`,
 *   {@link LOOPBACK_HOST} otherwise. Unset, misspelt or empty means not production,
 *   which is the safe direction for a value to fail in.
 */
export function readListenHost(env: NodeJS.ProcessEnv): string {
  return env.NODE_ENV === "production" ? ALL_INTERFACES_HOST : LOOPBACK_HOST;
}
