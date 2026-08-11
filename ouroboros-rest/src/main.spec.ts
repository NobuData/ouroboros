import { createServer } from "node:net";

import { Logger } from "@nestjs/common";

import { API_BASE_PATH } from "./application";
import {
  ConfigurationError,
  LOOPBACK_HOST,
  loadConfiguration,
  type Configuration,
} from "./modules/config/configuration";
import {
  DEVELOPMENT_ENVIRONMENT,
  testConfiguration,
  testEnvironment,
} from "./modules/config/configuration.fixture";
import { REDACTED } from "./modules/config/redaction";
import { CONFIGURATION_EXIT_CODE, bootstrap, main, runAsProgram } from "./main";
import { SERVICE_NAME, serviceVersion } from "./version";

/** A logger whose calls can be asserted on. */
function testLogger(): { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(), error: jest.fn() };
}

/**
 * Ask the operating system for a port nothing is listening on.
 *
 * Binding port 0 and reading back what was assigned is the only way to get one without
 * guessing; the socket is closed again before the number is returned, so the service
 * under test is what binds it.
 *
 * @returns A port number that was free a moment ago.
 */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK_HOST, resolve));

  const address = probe.address();
  if (address === null || typeof address === "string") {
    throw new Error("the probe socket reported no port");
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  return port;
}

describe("bootstrap", () => {
  it("listens on the port the configuration names and serves the heartbeat over HTTP", async () => {
    const port = await freePort();
    const app = await bootstrap(testConfiguration({ PORT: String(port) }), { logger: false });

    try {
      expect(await app.getUrl()).toBe(`http://${LOOPBACK_HOST}:${port}`);

      const response = await fetch(`http://${LOOPBACK_HOST}:${port}${API_BASE_PATH}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ service: SERVICE_NAME, status: "ok" });
    } finally {
      await app.close();
    }
  });

  // It takes a Configuration rather than an environment, and the only way to make one is
  // loadConfiguration — so "was this validated?" is a question the compiler answers and
  // this suite does not have to ask again.
  it("cannot be reached with an environment that was never validated", () => {
    expect(() => loadConfiguration({ PORT: "not-a-port" })).toThrow(ConfigurationError);
  });
});

/**
 * A stand-in for a started application, so nothing binds a socket.
 *
 * @param url - What the fake application reports as its address.
 * @returns A `start` function recording the configuration it was called with.
 */
const started = (url: string) =>
  jest.fn((_configuration: Configuration) =>
    Promise.resolve({ getUrl: () => Promise.resolve(url) }),
  );

describe("main", () => {
  it("reports the service, the build and the address it can be reached at", async () => {
    const logger = testLogger();

    const code = await main({
      env: testEnvironment(),
      logger,
      start: started("http://127.0.0.1:4000"),
    });

    expect(code).toBe(0);
    expect(logger.log).toHaveBeenLastCalledWith(
      `${SERVICE_NAME} ${serviceVersion()} listening on http://127.0.0.1:4000${API_BASE_PATH}`,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("writes the configuration to the log with the secrets redacted", async () => {
    const logger = testLogger();

    await main({
      env: testEnvironment(),
      logger,
      start: started("http://127.0.0.1:4000"),
    });

    const [described] = logger.log.mock.calls[0] as [string];
    expect(described).toContain("ouroboros-rest: configuration");
    expect(described).toContain(`OURO_SESSION_SECRET=${REDACTED}`);
    expect(described).not.toContain("dev-session-secret-change-me");
  });

  // Before, not after: a process that then fails to bind its port has still said what it
  // was configured with, which is usually the answer.
  it("writes it before the service is started", async () => {
    const logger = testLogger();
    const start = jest.fn((_configuration: Configuration) => {
      expect(logger.log).toHaveBeenCalledTimes(1);
      return Promise.resolve({ getUrl: () => Promise.resolve("http://127.0.0.1:4000") });
    });

    await main({ env: testEnvironment(), logger, start });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("configures from the environment it was handed", async () => {
    const start = started("http://127.0.0.1:9999");
    const env = testEnvironment({ PORT: "9999" });

    await main({ env, logger: testLogger(), start });

    expect(start).toHaveBeenCalledWith(loadConfiguration(env));
  });

  it("exits non-zero naming the variable when a value is malformed", async () => {
    const logger = testLogger();

    const code = await main({ env: testEnvironment({ PORT: "not-a-port" }), logger });

    expect(code).toBe(CONFIGURATION_EXIT_CODE);
    expect(CONFIGURATION_EXIT_CODE).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("PORT:"));
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("exits non-zero naming the variable when one is missing", async () => {
    const logger = testLogger();

    const code = await main({ env: {}, logger });

    expect(code).toBe(CONFIGURATION_EXIT_CODE);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("OURO_DATABASE_URL:"));
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is not a misconfiguration", async () => {
    const logger = testLogger();
    const start = jest.fn((_configuration: Configuration) =>
      Promise.reject(new Error("EADDRINUSE")),
    );

    await expect(main({ env: testEnvironment(), logger, start })).rejects.toThrow("EADDRINUSE");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reads the process environment when it is handed none", async () => {
    const start = started("http://127.0.0.1:4000");
    Object.assign(process.env, DEVELOPMENT_ENVIRONMENT);

    try {
      const code = await main({ logger: testLogger(), start });

      expect(code).toBe(0);
      expect(start).toHaveBeenCalledWith(loadConfiguration(process.env));
    } finally {
      for (const name of Object.keys(DEVELOPMENT_ENVIRONMENT)) {
        delete process.env[name];
      }
    }
  });

  it("logs through a Nest logger named for the service when it is handed none", async () => {
    // Spied rather than left to write to the console: what is asserted is which logger
    // the default is, and a suite that prints its own fixtures is a suite nobody reads.
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

    await main({ env: testEnvironment(), start: started("http://127.0.0.1:4000") });

    expect(log).toHaveBeenCalledWith(expect.stringContaining(API_BASE_PATH));
  });
});

describe("runAsProgram", () => {
  // The exit code is process-wide state, and a test that leaves it set fails the whole
  // run — including, confusingly, when every assertion in it passed.
  const original = process.exitCode;

  afterEach(() => {
    process.exitCode = original;
  });

  it("leaves the exit code alone when the service started", async () => {
    await runAsProgram({
      env: testEnvironment(),
      logger: testLogger(),
      start: started("http://127.0.0.1:4000"),
    });

    expect(process.exitCode).toBe(original);
  });

  it("sets the exit code when the environment did not validate", async () => {
    await runAsProgram({ env: testEnvironment({ PORT: "not-a-port" }), logger: testLogger() });

    expect(process.exitCode).toBe(CONFIGURATION_EXIT_CODE);
  });
});
