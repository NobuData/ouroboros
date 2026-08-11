import { VARIABLES } from "./configuration";
import { testConfiguration } from "./configuration.fixture";
import {
  REDACTED,
  REDACTED_PASSWORD,
  SECRET_VARIABLES,
  describeConfiguration,
  redactDatabaseUrl,
  redactedEnvironment,
} from "./redaction";

/** An environment carrying a recognisable secret in every place one can hide. */
const PLANTED = {
  OURO_ENGINE_SHARED_SECRET: "engine-secret-that-must-not-leak",
  OURO_SESSION_SECRET: "session-secret-that-must-not-leak",
  OURO_GITHUB_CLIENT_SECRET: "github-secret-that-must-not-leak",
  OURO_DATABASE_URL:
    "postgresql://ouroboros:database-password-that-must-not-leak@db:5432/ouroboros",
};

/**
 * The substrings none of the output may contain.
 *
 * Three of them are whole values from {@link PLANTED}; the fourth is the password buried
 * inside the connection string, which is the only *part* of a value that has to disappear.
 */
const MUST_NOT_LEAK = [
  "engine-secret-that-must-not-leak",
  "session-secret-that-must-not-leak",
  "github-secret-that-must-not-leak",
  "database-password-that-must-not-leak",
];

describe("redactedEnvironment", () => {
  it("reports every variable, keyed the way an operator would set it", () => {
    const redacted = redactedEnvironment(testConfiguration());

    expect(Object.keys(redacted)).toEqual(Object.values(VARIABLES));
  });

  it("leads with the platform variables, then the OURO_ set in template order", () => {
    expect(Object.keys(redactedEnvironment(testConfiguration())).slice(0, 3)).toEqual([
      "PORT",
      "NODE_ENV",
      "OURO_DATABASE_URL",
    ]);
  });

  it.each([...SECRET_VARIABLES])("replaces %s entirely", (variable) => {
    expect(redactedEnvironment(testConfiguration(PLANTED))[variable]).toBe(REDACTED);
  });

  it("masks the password inside the connection string and keeps the rest legible", () => {
    const redacted = redactedEnvironment(testConfiguration(PLANTED))[VARIABLES.databaseUrl];

    expect(redacted).toBe(`postgresql://ouroboros:${REDACTED_PASSWORD}@db:5432/ouroboros`);
  });

  // Publishing the client id costs nothing — it is in the OAuth redirect every browser
  // follows — and hiding it would cost the one field that says which app is configured.
  it("leaves the public values readable", () => {
    const redacted = redactedEnvironment(testConfiguration());

    expect(redacted[VARIABLES.githubClientId]).toBe("dev-github-client-id");
    expect(redacted[VARIABLES.engineUrl]).toBe("http://localhost:8000");
    expect(redacted.PORT).toBe("4000");
    expect(redacted.NODE_ENV).toBe("development");
  });

  it("writes the origin list back the way it was set", () => {
    const origins = "http://localhost:3000,https://app.ouroboros.build";
    const redacted = redactedEnvironment(testConfiguration({ OURO_CORS_ORIGINS: origins }));

    expect(redacted[VARIABLES.corsOrigins]).toBe(origins);
  });

  it("prints an unset variable with nothing after the equals sign", () => {
    // Which is how an env file spells "not set". `undefined` or `null` printed literally
    // would read as a value somebody had configured.
    expect(redactedEnvironment(testConfiguration())[VARIABLES.authDevUser]).toBe("");
  });

  it("prints the development bypass rather than redacting it", () => {
    // This line is the acceptance criterion an operator reads: the bypass is off when it is
    // empty and on when it names somebody. Redacting it would make both print the same.
    const redacted = redactedEnvironment(
      testConfiguration({ OURO_AUTH_DEV_USER: "ken@acme-robotics.dev" }),
    );

    expect(redacted[VARIABLES.authDevUser]).toBe("ken@acme-robotics.dev");
  });

  it("prints it empty in production even when the environment set it", () => {
    // `loadConfiguration` drops the variable there, so there is nothing to print — which is
    // what makes "provably off in a production build" something a boot log states.
    const redacted = redactedEnvironment(
      testConfiguration({ OURO_AUTH_DEV_USER: "ken@acme-robotics.dev", NODE_ENV: "production" }),
    );

    expect(redacted[VARIABLES.authDevUser]).toBe("");
  });
});

describe("redactDatabaseUrl", () => {
  it("masks a password", () => {
    expect(redactDatabaseUrl("postgresql://user:swordfish@host:5432/db")).toBe(
      `postgresql://user:${REDACTED_PASSWORD}@host:5432/db`,
    );
  });

  it("leaves a connection string that carries no password alone", () => {
    expect(redactDatabaseUrl("postgresql://host:5432/db")).toBe("postgresql://host:5432/db");
    expect(redactDatabaseUrl("postgresql://user@host:5432/db")).toBe(
      "postgresql://user@host:5432/db",
    );
  });

  // All unreachable through the schema, which is the point: a later caller that skipped
  // validation gets nothing rather than a guess at where the password was. The middle
  // case is the trap — it parses, as a scheme and an opaque path, so a redactor that
  // only caught the throw would print the password in the middle of it.
  it.each([
    ["a string that is not a URL at all", "not a url"],
    ["a URL with no host", "user:swordfish@host"],
    ["a scheme with an empty host", "postgresql:///ouroboros"],
  ])("replaces %s rather than guessing at it", (_description, value) => {
    expect(redactDatabaseUrl(value)).toBe(REDACTED);
  });
});

describe("describeConfiguration", () => {
  const block = () => describeConfiguration(testConfiguration(PLANTED));

  it("names the service and lists one variable per line", () => {
    const lines = block().split("\n");

    expect(lines[0]).toBe("ouroboros-rest: configuration");
    expect(lines).toHaveLength(Object.keys(VARIABLES).length + 1);
    expect(lines.slice(1).every((line) => line.startsWith("  ") && line.includes("="))).toBe(true);
  });

  // The acceptance criterion, asserted against the rendered text rather than against the
  // classification: this is the string that reaches a log.
  it.each(MUST_NOT_LEAK)("does not contain %s", (secret) => {
    expect(block()).not.toContain(secret);
  });

  it("still says which database and which engine the service is pointed at", () => {
    expect(block()).toContain("OURO_DATABASE_URL=postgresql://ouroboros:");
    expect(block()).toContain("@db:5432/ouroboros");
    expect(block()).toContain("OURO_ENGINE_URL=http://localhost:8000");
  });
});
