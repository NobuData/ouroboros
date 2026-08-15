import {
  ALL_INTERFACES_HOST,
  ConfigurationError,
  DEFAULT_DASHBOARD_POLL_SECONDS,
  DEFAULT_PORT,
  LOOPBACK_HOST,
  MAX_DASHBOARD_POLL_SECONDS,
  MAX_PORT,
  MINIMUM_SECRET_LENGTH,
  NODE_ENVIRONMENTS,
  VARIABLES,
  VAULT_MASTER_KEY_BYTES,
  isBase64Key,
  listenHost,
  loadConfiguration,
  type Configuration,
} from "./configuration";
import { DEVELOPMENT_ENVIRONMENT, testEnvironment } from "./configuration.fixture";

/**
 * Load a configuration that is expected to fail, and return the message.
 *
 * @param env - The environment to validate.
 * @returns The {@link ConfigurationError}'s message.
 */
function failureFor(env: NodeJS.ProcessEnv): string {
  expect(() => loadConfiguration(env)).toThrow(ConfigurationError);

  try {
    loadConfiguration(env);
  } catch (error) {
    return (error as ConfigurationError).message;
  }

  throw new Error("loadConfiguration was expected to reject this environment");
}

/**
 * The environment, minus one variable.
 *
 * @param variable - The variable to leave out.
 * @returns Every other development default.
 */
function without(variable: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...DEVELOPMENT_ENVIRONMENT };
  delete env[variable];
  return env;
}

describe("the development defaults", () => {
  // The template a developer copies has to be a template that starts. If this fails, a
  // clean checkout cannot run, and .env.example is what needs the edit.
  it("validate, so a checkout of .env.example runs as-is", () => {
    expect(() => loadConfiguration(testEnvironment())).not.toThrow();
  });

  it("produce the values the rest of the service is written against", () => {
    const configuration = loadConfiguration(testEnvironment());

    expect(configuration).toEqual<Configuration>({
      port: DEFAULT_PORT,
      nodeEnv: "development",
      databaseUrl: "postgresql://ouroboros:ouroboros@localhost:5432/ouroboros",
      restUrl: "http://localhost:4000",
      uiUrl: "http://localhost:3000",
      engineUrl: "http://localhost:8000",
      engineSharedSecret: "dev-engine-shared-secret-change-me",
      betterAuthSecret: "dev-better-auth-secret-change-me",
      betterAuthUrl: "http://localhost:4000",
      githubClientId: "dev-github-client-id",
      githubClientSecret: "dev-github-client-secret",
      vaultMasterKey: "b3Vyb2Jvcm9zLWRldi12YXVsdC1tYXN0ZXIta2V5ISE=",
      corsOrigins: ["http://localhost:3000"],
      dashboardPollSeconds: DEFAULT_DASHBOARD_POLL_SECONDS,
    });
  });
});

describe("the shape of a configuration", () => {
  it("is frozen, so nothing can reconfigure the service after it has started", () => {
    const configuration = loadConfiguration(testEnvironment());

    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.corsOrigins)).toBe(true);
  });

  it("ignores variables that are not this service's", () => {
    const configuration = loadConfiguration(
      testEnvironment({ HOME: "/root", OURO_LOG_LEVEL: "debug" }),
    );

    expect(configuration).not.toHaveProperty("HOME");
    expect(configuration).not.toHaveProperty("OURO_LOG_LEVEL");
  });

  it("names an environment variable for every field it produces", () => {
    const configuration = loadConfiguration(testEnvironment());

    expect(Object.keys(VARIABLES).sort()).toEqual(Object.keys(configuration).sort());
  });

  // `docs/CONVENTIONS.md` § 4, as an assertion. The exceptions are enumerated rather than
  // pattern-matched, so the next variable that forgets the prefix fails here instead of
  // being absorbed by a rule written loosely enough to admit it.
  it("prefixes every Ouroboros variable and leaves the documented exceptions alone", () => {
    const names = Object.values(VARIABLES);

    expect(names.filter((name) => !name.startsWith("OURO_"))).toEqual([
      // The platform's, because that is what container runtimes set.
      "PORT",
      "NODE_ENV",
      // BetterAuth's own, because the library, its CLI and its documentation all name them
      // — roadmap decision A9 (#700).
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
    ]);
  });

  // Decision A9's other half, and the one worth a test: BetterAuth's GitHub provider
  // (#702) reads `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` from the environment when it is
  // handed nothing, so the way this goes wrong is a second pair of keys appearing beside
  // the ones `.env.example` has documented since #33 — with a deployment then setting one
  // pair and signing in through the other.
  it("declares one GitHub application, under the keys the template already documents", () => {
    const github = Object.values(VARIABLES).filter((name) => name.includes("GITHUB"));

    expect(github).toEqual(["OURO_GITHUB_CLIENT_ID", "OURO_GITHUB_CLIENT_SECRET"]);
  });
});

describe("a missing variable", () => {
  // The acceptance criterion, one variable at a time: whatever is absent, the message
  // names it. PORT and NODE_ENV are excluded because they are the two with defaults.
  it.each([
    VARIABLES.databaseUrl,
    VARIABLES.restUrl,
    VARIABLES.uiUrl,
    VARIABLES.engineUrl,
    VARIABLES.engineSharedSecret,
    VARIABLES.betterAuthSecret,
    VARIABLES.betterAuthUrl,
    VARIABLES.githubClientId,
    VARIABLES.githubClientSecret,
    VARIABLES.vaultMasterKey,
    VARIABLES.corsOrigins,
  ])("is named when %s is unset", (variable) => {
    expect(failureFor(without(variable))).toContain(`${variable}: is required`);
  });

  it.each([
    ["empty", ""],
    ["whitespace, which is what an unfilled env line leaves", "   "],
  ])("is named when %s", (_description, value) => {
    const message = failureFor(testEnvironment({ BETTER_AUTH_SECRET: value }));

    expect(message).toContain(`${VARIABLES.betterAuthSecret}: is required`);
  });

  it("is reported alongside every other problem, not one boot at a time", () => {
    const message = failureFor({ OURO_DATABASE_URL: "postgresql://user@host:5432/db" });

    expect(message).toContain("invalid configuration (10 problems)");
    for (const variable of [
      VARIABLES.restUrl,
      VARIABLES.uiUrl,
      VARIABLES.engineUrl,
      VARIABLES.engineSharedSecret,
      VARIABLES.betterAuthSecret,
      VARIABLES.betterAuthUrl,
      VARIABLES.githubClientId,
      VARIABLES.githubClientSecret,
      VARIABLES.vaultMasterKey,
      VARIABLES.corsOrigins,
    ]) {
      expect(message).toContain(`${variable}: `);
    }
  });

  it("counts a single problem in the singular", () => {
    expect(failureFor(without(VARIABLES.betterAuthSecret))).toContain(
      "invalid configuration (1 problem)",
    );
  });
});

describe("PORT", () => {
  it("falls back to the documented development port when it is unset or blank", () => {
    expect(loadConfiguration(testEnvironment()).port).toBe(DEFAULT_PORT);
    expect(loadConfiguration(testEnvironment({ PORT: "" })).port).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(4000);
  });

  it.each(["1", "4000", "65535"])("reads %s", (value) => {
    expect(loadConfiguration(testEnvironment({ PORT: value })).port).toBe(Number(value));
  });

  // Every one of these is accepted by Number() or parseInt() and turned into something
  // plausible, which is exactly the failure mode this reader exists to prevent.
  it.each([
    ["a word", "http"],
    ["trailing text", "4000abc"],
    ["leading whitespace", " 4000"],
    ["a sign", "+4000"],
    ["hexadecimal", "0x1f40"],
    ["scientific notation", "4e3"],
    ["a fraction", "4000.5"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ PORT: value }))).toContain(
      `PORT: expected a whole number between 1 and ${MAX_PORT}`,
    );
  });

  it.each([
    ["zero, which means any free port to the operating system", "0"],
    ["a port above the maximum", "65536"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ PORT: value }))).toContain(
      `PORT: expected a port between 1 and ${MAX_PORT}`,
    );
    expect(MAX_PORT).toBe(65535);
  });
});

describe("OURO_DASHBOARD_POLL_SECONDS", () => {
  it("falls back to the contract's documented interval when it is unset or blank", () => {
    expect(loadConfiguration(testEnvironment()).dashboardPollSeconds).toBe(
      DEFAULT_DASHBOARD_POLL_SECONDS,
    );
    expect(
      loadConfiguration(testEnvironment({ OURO_DASHBOARD_POLL_SECONDS: "" })).dashboardPollSeconds,
    ).toBe(DEFAULT_DASHBOARD_POLL_SECONDS);
    // The number `docs/ARCHITECTURE.md` § 5.4 and the #87 hook agreed on.
    expect(DEFAULT_DASHBOARD_POLL_SECONDS).toBe(15);
  });

  it.each(["1", "15", "30", "3600"])("reads %s", (value) => {
    expect(
      loadConfiguration(testEnvironment({ OURO_DASHBOARD_POLL_SECONDS: value }))
        .dashboardPollSeconds,
    ).toBe(Number(value));
  });

  // The same trap as PORT: every one of these is something Number() would have turned
  // into a plausible interval instead of a named boot failure.
  it.each([
    ["a word", "fast"],
    ["a unit", "15s"],
    ["leading whitespace", " 15"],
    ["a sign", "+15"],
    ["scientific notation", "1e2"],
    ["a fraction", "1.5"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_DASHBOARD_POLL_SECONDS: value }))).toContain(
      `OURO_DASHBOARD_POLL_SECONDS: expected a whole number of seconds between 1 and ` +
        `${MAX_DASHBOARD_POLL_SECONDS}`,
    );
  });

  it.each([
    ["zero, which would tell every client to poll as fast as it can", "0"],
    ["more than the hour that already means the dashboard never refreshes", "3601"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_DASHBOARD_POLL_SECONDS: value }))).toContain(
      `OURO_DASHBOARD_POLL_SECONDS: expected between 1 and ${MAX_DASHBOARD_POLL_SECONDS} seconds`,
    );
    expect(MAX_DASHBOARD_POLL_SECONDS).toBe(3600);
  });
});

describe("NODE_ENV", () => {
  it("defaults to development, which is the safe direction to fail in", () => {
    expect(loadConfiguration(testEnvironment()).nodeEnv).toBe("development");
  });

  it.each(NODE_ENVIRONMENTS)("reads %s", (value) => {
    expect(loadConfiguration(testEnvironment({ NODE_ENV: value })).nodeEnv).toBe(value);
  });

  // A misspelt NODE_ENV that silently meant "not production" would leave a deployment
  // binding loopback and serving insecure cookies with nothing to say about it.
  it.each([["Production"], ["prod"], ["staging"], ["production "]])("rejects %s", (value) => {
    expect(failureFor(testEnvironment({ NODE_ENV: value }))).toContain(
      `NODE_ENV: expected one of ${NODE_ENVIRONMENTS.join(", ")}`,
    );
  });
});

describe("OURO_DATABASE_URL", () => {
  it.each([
    ["a postgresql:// string", "postgresql://user:pass@db.internal:5432/ouroboros"],
    ["the postgres:// alias", "postgres://user:pass@db.internal:5432/ouroboros"],
    ["a string without credentials", "postgresql://db.internal:5432/ouroboros"],
  ])("accepts %s", (_description, value) => {
    expect(loadConfiguration(testEnvironment({ OURO_DATABASE_URL: value })).databaseUrl).toBe(
      value,
    );
  });

  it.each([
    ["a bare host", "db.internal:5432"],
    ["the wrong scheme", "mysql://user:pass@db.internal:3306/ouroboros"],
    ["an http URL", "http://db.internal:5432/ouroboros"],
    ["a scheme with no host", "postgresql:///ouroboros"],
    ["prose", "the database"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_DATABASE_URL: value }))).toContain(
      `${VARIABLES.databaseUrl}: expected a PostgreSQL connection string`,
    );
  });
});

describe("OURO_ENGINE_URL", () => {
  it.each([
    ["http", "http://localhost:8000"],
    ["https", "https://engine.internal"],
    ["a path, which a base URL may carry", "http://engine.internal/api"],
  ])("accepts %s", (_description, value) => {
    expect(loadConfiguration(testEnvironment({ OURO_ENGINE_URL: value })).engineUrl).toBe(value);
  });

  it.each([
    ["a host with no scheme", "localhost:8000"],
    ["a scheme nothing speaks over HTTP", "ftp://engine.internal"],
    ["a relative path", "/engine"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_ENGINE_URL: value }))).toContain(
      `${VARIABLES.engineUrl}: expected an absolute http:// or https:// URL`,
    );
  });
});

describe("BETTER_AUTH_URL", () => {
  it.each([
    ["this service's development origin", "http://localhost:4000"],
    ["a deployed origin", "https://api.ouroboros.build"],
  ])("accepts %s", (_description, value) => {
    expect(loadConfiguration(testEnvironment({ BETTER_AUTH_URL: value })).betterAuthUrl).toBe(
      value,
    );
  });

  // BetterAuth appends its own base path (`/api/auth`) to this, so a value that already
  // carries one produces callback URLs with the path twice — a sign-in that fails at
  // GitHub's end with a redirect_uri mismatch, which is a long way from the typo.
  it.each([
    ["a base path, which BetterAuth adds for itself", "http://localhost:4000/api/auth"],
    ["a trailing slash", "http://localhost:4000/"],
    ["a bare host", "localhost:4000"],
    ["a wildcard", "*"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ BETTER_AUTH_URL: value }))).toContain(
      `${VARIABLES.betterAuthUrl}: expected this service's own browser origin`,
    );
  });
});

describe("the secrets", () => {
  it.each([VARIABLES.engineSharedSecret, VARIABLES.betterAuthSecret])(
    "rejects a %s short enough to have been typed by hand",
    (variable) => {
      const message = failureFor(testEnvironment({ [variable]: "hunter2" }));

      expect(message).toContain(
        `${variable}: expected at least ${MINIMUM_SECRET_LENGTH} characters`,
      );
      expect(MINIMUM_SECRET_LENGTH).toBe(16);
    },
  );

  it("accepts one exactly at the minimum", () => {
    const secret = "x".repeat(MINIMUM_SECRET_LENGTH);

    expect(
      loadConfiguration(testEnvironment({ BETTER_AUTH_SECRET: secret })).betterAuthSecret,
    ).toBe(secret);
  });

  // The GitHub credentials are whatever GitHub issued, so the only rule is that they are
  // there — a length floor on someone else's format would reject a valid application.
  it("asks only that the GitHub credentials are present", () => {
    const configuration = loadConfiguration(
      testEnvironment({ OURO_GITHUB_CLIENT_ID: "Iv1.a", OURO_GITHUB_CLIENT_SECRET: "s" }),
    );

    expect(configuration.githubClientId).toBe("Iv1.a");
    expect(configuration.githubClientSecret).toBe("s");
  });

  // The whole point of never echoing a value: a message that quoted what it was given
  // would put a signing key in a log the first time somebody pasted one with a typo.
  it("never echoes a value it rejected", () => {
    const message = failureFor(
      testEnvironment({
        BETTER_AUTH_SECRET: "s3cr3t-but-too-short",
        OURO_DATABASE_URL: "postgres-but-not://s3cr3t:s3cr3t@host/db",
        PORT: "s3cr3t",
      }),
    );

    expect(message).not.toContain("s3cr3t");
  });
});

// #222's "boot fails cleanly and legibly on a missing or malformed master key". The
// variable is validated by a rule the other secrets do not get, and the reason is the
// consequence of being wrong: a signing key that is not what the operator meant produces
// sessions nobody can use, and is fixed by correcting it. A KEK that is not what the
// operator meant produces credential ciphertext nobody can *ever* open, and correcting it
// afterwards does not help.
describe("OURO_VAULT_MASTER_KEY", () => {
  /** 32 bytes, standard alphabet — what `openssl rand -base64 32` produces. */
  const key = Buffer.alloc(VAULT_MASTER_KEY_BYTES, 7).toString("base64");

  it("reads a 32-byte key in the standard alphabet", () => {
    expect(loadConfiguration(testEnvironment({ OURO_VAULT_MASTER_KEY: key })).vaultMasterKey).toBe(
      key,
    );
  });

  // A value that has been through a URL, a JWT or a Kubernetes secret may arrive in the
  // URL-safe alphabet. The two differ in two characters and never in what they decode to,
  // so rejecting one would be a rule about transport rather than about key material.
  it("reads the same key in the URL-safe alphabet", () => {
    const urlSafe = Buffer.from([251, 255, 0, ...Array<number>(29).fill(1)]).toString("base64url");

    expect(urlSafe).toMatch(/[_-]/);
    expect(
      loadConfiguration(testEnvironment({ OURO_VAULT_MASTER_KEY: urlSafe })).vaultMasterKey,
    ).toBe(urlSafe);
  });

  // Every one of these is accepted by `Buffer.from(value, "base64")`, which skips whatever
  // it does not recognise — so each decodes to *some* buffer rather than failing, and a
  // service that trusted the decoder would seal credentials with bytes derived from a typo.
  it.each([
    ["a passphrase somebody typed", "correct-horse-battery-staple!!!!"],
    ["31 bytes, one short", Buffer.alloc(VAULT_MASTER_KEY_BYTES - 1, 7).toString("base64")],
    ["33 bytes, one long", Buffer.alloc(VAULT_MASTER_KEY_BYTES + 1, 7).toString("base64")],
    ["an empty-ish value that survived the blank filter", "-"],
    ["base64 with a character that is in neither alphabet", `${key.slice(0, -2)}*=`],
    ["both alphabets at once, so something edited it", `${"-".repeat(21)}${"+".repeat(22)}`],
    ["hexadecimal, which is the other thing an operator might paste", "aa".repeat(32)],
  ])("rejects %s, naming the variable and the fix", (_description, value) => {
    const message = failureFor(testEnvironment({ OURO_VAULT_MASTER_KEY: value }));

    expect(message).toContain(
      `${VARIABLES.vaultMasterKey}: expected exactly ${VAULT_MASTER_KEY_BYTES} bytes of base64`,
    );
    expect(message).toContain(`openssl rand -base64 ${VAULT_MASTER_KEY_BYTES}`);
  });

  it("never echoes the key it rejected", () => {
    const message = failureFor(
      testEnvironment({ OURO_VAULT_MASTER_KEY: "s3cr3t-master-key-that-is-not-base64" }),
    );

    expect(message).not.toContain("s3cr3t");
  });

  // The rule is a length, not a floor. Stated as its own assertion because "at least 32
  // bytes" is the shape every other secret here has, and is the plausible wrong edit.
  it("is exactly 32 bytes, because that is what AES-256 means", () => {
    expect(VAULT_MASTER_KEY_BYTES).toBe(32);
    expect(isBase64Key(key, VAULT_MASTER_KEY_BYTES)).toBe(true);
    expect(isBase64Key(Buffer.alloc(64, 7).toString("base64"), VAULT_MASTER_KEY_BYTES)).toBe(false);
  });
});

describe("OURO_CORS_ORIGINS", () => {
  it("reads a single origin", () => {
    expect(loadConfiguration(testEnvironment()).corsOrigins).toEqual(["http://localhost:3000"]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    const configuration = loadConfiguration(
      testEnvironment({
        OURO_CORS_ORIGINS:
          "http://localhost:3000, https://app.ouroboros.build ,https://ouroboros.build",
      }),
    );

    expect(configuration.corsOrigins).toEqual([
      "http://localhost:3000",
      "https://app.ouroboros.build",
      "https://ouroboros.build",
    ]);
  });

  it("ignores a trailing separator, which is how a list gets edited", () => {
    expect(
      loadConfiguration(testEnvironment({ OURO_CORS_ORIGINS: "http://localhost:3000," }))
        .corsOrigins,
    ).toEqual(["http://localhost:3000"]);
  });

  it("rejects a list that is only separators", () => {
    expect(failureFor(testEnvironment({ OURO_CORS_ORIGINS: ",,," }))).toContain(
      `${VARIABLES.corsOrigins}: expected at least one browser origin`,
    );
  });

  it.each([
    ["a wildcard, which a credentialed request may never be answered with", "*"],
    ["a trailing slash, which is a URL rather than an origin", "http://localhost:3000/"],
    ["a path", "http://localhost:3000/app"],
    ["a query", "http://localhost:3000?a=b"],
    ["credentials", "http://user:pass@localhost:3000"],
    ["a bare host", "localhost:3000"],
    ["a scheme a browser has no origin for", "postgresql://localhost:5432"],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_CORS_ORIGINS: value }))).toContain(
      `${VARIABLES.corsOrigins}: expected a comma-separated list of browser origins`,
    );
  });

  it("rejects a list where only one entry is wrong", () => {
    expect(
      failureFor(testEnvironment({ OURO_CORS_ORIGINS: "http://localhost:3000,not-an-origin" })),
    ).toContain(VARIABLES.corsOrigins);
  });
});

describe("listenHost", () => {
  it("binds every interface in production, where the platform does the routing", () => {
    expect(listenHost({ nodeEnv: "production" })).toBe(ALL_INTERFACES_HOST);
    expect(ALL_INTERFACES_HOST).toBe("0.0.0.0");
  });

  // A development machine that answered on every interface would be reachable from
  // whatever network it is on, holding a session key and a database connection.
  it.each([["development"], ["test"]] as const)("binds loopback only in %s", (nodeEnv) => {
    expect(listenHost({ nodeEnv })).toBe(LOOPBACK_HOST);
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
  });

  // The e2e compose override's whole reason to exist (#647): a non-production stack whose
  // password sign-in answers, reachable through Docker's port publishing.
  it("prefers the override in either direction, whatever the environment says", () => {
    expect(listenHost({ nodeEnv: "test", listenHostOverride: ALL_INTERFACES_HOST })).toBe(
      ALL_INTERFACES_HOST,
    );
    expect(listenHost({ nodeEnv: "production", listenHostOverride: LOOPBACK_HOST })).toBe(
      LOOPBACK_HOST,
    );
  });
});

describe("OURO_LISTEN_HOST", () => {
  it("is unset by default, leaving the environment to decide", () => {
    const configuration = loadConfiguration(testEnvironment());

    expect(configuration.listenHostOverride).toBeUndefined();
  });

  it.each([[LOOPBACK_HOST], [ALL_INTERFACES_HOST]])("accepts %s", (host) => {
    const configuration = loadConfiguration(testEnvironment({ OURO_LISTEN_HOST: host }));

    expect(configuration.listenHostOverride).toBe(host);
    expect(listenHost(configuration)).toBe(host);
  });

  // Anything else would be an interface nobody has reasoned about: the override chooses
  // between the two postures the service understands, it is not a bind-address knob.
  it.each([
    ["a hostname", "localhost"],
    ["an arbitrary address", "10.0.0.7"],
    ["a port beside the address", `${ALL_INTERFACES_HOST}:4000`],
  ])("rejects %s", (_description, value) => {
    expect(failureFor(testEnvironment({ OURO_LISTEN_HOST: value }))).toContain(
      `${VARIABLES.listenHostOverride}: expected ${LOOPBACK_HOST} or ${ALL_INTERFACES_HOST}`,
    );
  });
});

describe("ConfigurationError", () => {
  it("is nameable in a log line and distinguishable from an ordinary failure", () => {
    const error = new ConfigurationError("PORT: nope");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConfigurationError");
    expect(error.message).toBe("PORT: nope");
  });
});
