// Nest resolves constructor dependencies from decorator metadata, and the polyfill that
// stores it has to be installed before the first decorated class is loaded. This import
// is first for that reason and must stay first — everything below it imports a module
// with an @Injectable() or an @Module() in it.
import "reflect-metadata";

import { Logger, type INestApplication, type NestApplicationOptions } from "@nestjs/common";

import { API_BASE_PATH, createApplication } from "./application";
import { ConfigurationError, readListenHost, readPort } from "./env";
import { SERVICE_NAME, serviceVersion } from "./version";

/**
 * The process entry point: read the environment, build the application, listen.
 *
 * `yarn dev` runs this through `nest start --watch`; `yarn start` and the container
 * (#36) run the compiled `dist/main.js` directly.
 */

/**
 * The part of an application {@link main} uses.
 *
 * Narrower than `INestApplication` on purpose: it is what lets a test hand {@link main} a
 * stand-in and check what it logs and what it returns, without a socket being bound
 * anywhere. `INestApplication` satisfies it structurally, so {@link bootstrap} needs no
 * adapter.
 */
export interface StartedApplication {
  /** The URL the server is actually listening on, once it is. */
  getUrl(): Promise<string>;
}

/** The logging surface {@link main} uses — satisfied by Nest's `Logger`. */
export interface MainLogger {
  log(message: string): void;
  error(message: string): void;
}

/** Overrides {@link main} accepts. Every one of them exists so the function is testable. */
export interface MainOptions {
  /** Environment to configure from. Defaults to the process environment. */
  env?: NodeJS.ProcessEnv;
  /** Where the two lines of output go. Defaults to a Nest `Logger` named for the service. */
  logger?: MainLogger;
  /** How the application is started. Defaults to {@link bootstrap}. */
  start?: (env: NodeJS.ProcessEnv) => Promise<StartedApplication>;
}

/** Exit code used when the environment does not validate — matching `ouroboros-engine`. */
export const CONFIGURATION_EXIT_CODE = 2;

/**
 * Build the application and start listening.
 *
 * The environment is read *before* the application is built, so a malformed `PORT` costs
 * nothing and reports immediately rather than after a module tree has been instantiated.
 *
 * @param env - Environment to configure from, normally `process.env`.
 * @param options - Passed through to `createApplication`. The process passes nothing.
 * @returns The listening application, so the caller can ask it for its URL and close it.
 * @throws {ConfigurationError} If the environment does not validate — see `env.ts`.
 */
export async function bootstrap(
  env: NodeJS.ProcessEnv = process.env,
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const port = readPort(env);
  const host = readListenHost(env);

  const app = await createApplication(options);
  await app.listen(port, host);

  return app;
}

/**
 * Start the service and report the outcome, translating a configuration mistake into an
 * exit code rather than a stack trace.
 *
 * @param options - See {@link MainOptions}; every field defaults to the real thing.
 * @returns `0` once the service is listening, or {@link CONFIGURATION_EXIT_CODE} when the
 *   environment did not validate.
 * @throws Whatever {@link bootstrap} threw, when it was not a {@link ConfigurationError}.
 *   A port already in use or a broken module tree is a failure, not a misconfiguration,
 *   and swallowing it into an exit code would throw away the only diagnosis there is.
 */
export async function main({
  env = process.env,
  logger = new Logger(SERVICE_NAME),
  start = bootstrap,
}: MainOptions = {}): Promise<number> {
  try {
    const app = await start(env);
    logger.log(
      `${SERVICE_NAME} ${serviceVersion()} listening on ${await app.getUrl()}${API_BASE_PATH}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error(error.message);
      return CONFIGURATION_EXIT_CODE;
    }
    throw error;
  }
}

/**
 * Run {@link main} and turn its answer into this process's exit code.
 *
 * @param options - See {@link MainOptions}; passed straight through.
 */
export async function runAsProgram(options: MainOptions = {}): Promise<void> {
  const code = await main(options);
  if (code !== 0) {
    // Set rather than passed to `process.exit()`, which would discard buffered output on
    // its way out — including the line naming the variable that caused the exit.
    process.exitCode = code;
  }
}

// Only when this file is the process entry point. Importing it — which the spec beside
// it does — must not start a server.
if (require.main === module) {
  void runAsProgram();
}
