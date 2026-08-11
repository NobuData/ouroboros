import { createServer } from "node:net";

import { Logger } from "@nestjs/common";

import { API_BASE_PATH } from "./application";
import { ConfigurationError, LOOPBACK_HOST } from "./env";
import { CONFIGURATION_EXIT_CODE, bootstrap, main, runAsProgram } from "./main";
import { SERVICE_NAME, serviceVersion } from "./version";

/** A logger whose two calls can be asserted on. */
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
  it("listens on the port PORT names and serves the heartbeat over real HTTP", async () => {
    const port = await freePort();
    const app = await bootstrap({ PORT: String(port) }, { logger: false });

    try {
      expect(await app.getUrl()).toBe(`http://${LOOPBACK_HOST}:${port}`);

      const response = await fetch(`http://${LOOPBACK_HOST}:${port}${API_BASE_PATH}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ service: SERVICE_NAME, status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("refuses a malformed environment before it builds anything", async () => {
    await expect(bootstrap({ PORT: "not-a-port" })).rejects.toBeInstanceOf(ConfigurationError);
  });
});

/**
 * A stand-in for a started application, so nothing binds a socket.
 *
 * @param url - What the fake application reports as its address.
 * @returns A `start` function recording the environment it was called with.
 */
const started = (url: string) =>
  jest.fn((_env: NodeJS.ProcessEnv) => Promise.resolve({ getUrl: () => Promise.resolve(url) }));

describe("main", () => {
  it("reports the service, the build and the address it can be reached at", async () => {
    const logger = testLogger();

    const code = await main({ env: {}, logger, start: started("http://127.0.0.1:4000") });

    expect(code).toBe(0);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      `${SERVICE_NAME} ${serviceVersion()} listening on http://127.0.0.1:4000${API_BASE_PATH}`,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("configures from the environment it was handed", async () => {
    const start = started("http://127.0.0.1:9999");
    const env = { PORT: "9999" };

    await main({ env, logger: testLogger(), start });

    expect(start).toHaveBeenCalledWith(env);
  });

  it("exits non-zero naming the variable when the environment does not validate", async () => {
    const logger = testLogger();

    // The real starter: readPort rejects the value before a module tree exists, so this
    // exercises the whole path without anything binding a port.
    const code = await main({ env: { PORT: "not-a-port" }, logger });

    expect(code).toBe(CONFIGURATION_EXIT_CODE);
    expect(CONFIGURATION_EXIT_CODE).toBe(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("PORT:"));
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is not a misconfiguration", async () => {
    const logger = testLogger();
    const start = jest.fn((_env: NodeJS.ProcessEnv) => Promise.reject(new Error("EADDRINUSE")));

    await expect(main({ env: {}, logger, start })).rejects.toThrow("EADDRINUSE");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reads the process environment when it is handed none", async () => {
    const start = started("http://127.0.0.1:4000");

    await main({ logger: testLogger(), start });

    expect(start).toHaveBeenCalledWith(process.env);
  });

  it("logs through a Nest logger named for the service when it is handed none", async () => {
    // Spied rather than left to write to the console: what is asserted is which logger
    // the default is, and a suite that prints its own fixtures is a suite nobody reads.
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

    await main({ env: {}, start: started("http://127.0.0.1:4000") });

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
    await runAsProgram({ env: {}, logger: testLogger(), start: started("http://127.0.0.1:4000") });

    expect(process.exitCode).toBe(original);
  });

  it("sets the exit code when the environment did not validate", async () => {
    await runAsProgram({ env: { PORT: "not-a-port" }, logger: testLogger() });

    expect(process.exitCode).toBe(CONFIGURATION_EXIT_CODE);
  });
});
