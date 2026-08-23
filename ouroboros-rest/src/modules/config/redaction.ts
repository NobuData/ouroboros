/**
 * How configuration is written down where somebody can read it.
 *
 * `docs/CONVENTIONS.md` § 4 ends with one sentence — *secrets are redacted from any
 * configuration logging* — and this file is the whole of that promise for
 * `ouroboros-rest`. It exists as a module rather than as a line inside the logger call
 * because it is the kind of rule that is only kept if there is exactly one way to render
 * configuration and it is the safe one.
 *
 * The classification is by variable, in {@link SECRET_VARIABLES}, and it is exhaustive
 * over {@link Configuration} by construction: {@link VARIABLES} maps every field to its
 * variable name and the compiler enforces that mapping, so a field added in #33 or #35
 * appears in this output and has to be classified rather than quietly printed.
 */

import { VARIABLES, type Configuration } from "./configuration";

/** What a secret's value is replaced with. Recognisable, and not mistakable for a value. */
export const REDACTED = "[redacted]";

/** What a connection string's password is replaced with, in place, keeping the rest legible. */
export const REDACTED_PASSWORD = "***";

/**
 * The variables whose values never appear in output.
 *
 * `OURO_GITHUB_CLIENT_ID` is deliberately not among them: it is published in the OAuth
 * redirect every browser follows, so hiding it would cost a useful diagnostic and protect
 * nothing. `OURO_DATABASE_URL` is not among them either, because it is redacted more
 * precisely — see {@link redactDatabaseUrl}. Nor is `BETTER_AUTH_URL`, which is an address
 * a browser is redirected to.
 *
 * `NODE_ENV` is the line an operator now reads to confirm that the development
 * email/password sign-in is off, since that is the only thing gating it
 * ([#705](https://github.com/NobuData/ouroboros/issues/705),
 * `src/auth/password.provider.ts`). It is printed for the same reason everything unredacted
 * here is: a deployment's posture should be legible from its own boot log.
 */
export const SECRET_VARIABLES: ReadonlySet<string> = new Set([
  VARIABLES.engineSharedSecret,
  // BetterAuth signs sessions and encrypts stored OAuth tokens with this one
  // ([#700](https://github.com/NobuData/ouroboros/issues/700)), so it is the single most
  // valuable string this service holds after the database password.
  VARIABLES.betterAuthSecret,
  VARIABLES.githubClientSecret,
  // The vault's key-encryption key ([#222](https://github.com/NobuData/ouroboros/issues/222)),
  // and the one value here whose exposure is not recoverable by rotating it: it seals every
  // workspace's data-encryption key, so a copy of this line beside a copy of `tenant_keys`
  // is every credential the product holds. Rotating it afterwards re-wraps the DEKs but does
  // not un-print the line.
  VARIABLES.vaultMasterKey,
]);

/**
 * Mask the password in a connection string, leaving the rest readable.
 *
 * A connection string is the one value here that is *partly* a secret: the host, port,
 * database and role are exactly what someone reading a boot log needs, and the password
 * beside them is exactly what they must not see. So it is masked in place rather than
 * replaced wholesale.
 *
 * @param value - The connection string, normally already validated.
 * @returns The same string with any password replaced by {@link REDACTED_PASSWORD}. A
 *   value that is not a URL *with a host* is replaced entirely: this function is reachable
 *   only with a validated string today, and guessing at anything else is how a password
 *   ends up printed by a later caller that skipped validation. The host is what the check
 *   turns on rather than merely whether `URL` threw — `user:swordfish@host` parses
 *   happily as a scheme and an opaque path, and reporting it unchanged would publish the
 *   password sitting in the middle of it.
 */
export function redactDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return REDACTED;
  }

  if (url.hostname === "") {
    return REDACTED;
  }

  if (url.password === "") {
    return value;
  }

  url.password = REDACTED_PASSWORD;
  return url.toString();
}

/**
 * The configuration as environment variables, safe to print.
 *
 * @param configuration - The validated configuration.
 * @returns One entry per variable, keyed by the variable's own name so what is printed is
 *   what an operator would set, with every secret replaced. Insertion order follows
 *   {@link VARIABLES}, which lists the platform variables first and then the `OURO_*` set
 *   in the order `.env.example` documents them.
 */
export function redactedEnvironment(configuration: Configuration): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [field, variable] of Object.entries(VARIABLES)) {
    const value = configuration[field as keyof Configuration];

    if (value === null || value === undefined) {
      // Printed with nothing after the `=`, which is how an env file spells "not set".
      // Checked before the secret rule, because a secret that is absent should say so
      // rather than claim to be redacted.
      //
      // One field reaches this from `loadConfiguration`'s output: `OURO_LISTEN_HOST`
      // (#647), whose unset state is the posture every deployment should be in — so the
      // empty line is itself the reassuring one.
      redacted[variable] = "";
    } else if (SECRET_VARIABLES.has(variable)) {
      redacted[variable] = REDACTED;
    } else if (variable === VARIABLES.databaseUrl && typeof value === "string") {
      redacted[variable] = redactDatabaseUrl(value);
    } else {
      redacted[variable] = renderValue(value);
    }
  }

  return redacted;
}

/**
 * One configuration value, written the way the variable it came from is written.
 *
 * The rule is that a boot log should be **copy-pasteable back into an env file**: what an
 * operator reads is what they would set, so a value that was parsed out of a string is
 * rendered back into that string rather than into whatever `String()` makes of it. Three
 * shapes, because the schema produces three:
 *
 *   * a **list** — `OURO_CORS_ORIGINS` — rejoined on its comma;
 *   * a **map** — `OURO_LOCAL_PROVIDER_URLS` ([#224](https://github.com/NobuData/ouroboros/issues/224))
 *     — rejoined as the `kind=url` pairs it was written as. Without this branch it would
 *     print as `[object Object]`, which is the boot log quietly ceasing to describe the
 *     deployment;
 *   * everything else — a string, a number, an enum member — as itself.
 *
 * @param value - A validated configuration value, already known not to be nullish and not
 *   to be a secret. Typed as the union {@link Configuration} actually holds rather than as
 *   `unknown`, so the last line below is reached with a `string` or a `number` and a field
 *   of some new shape would fail to compile here instead of printing `[object Object]`.
 * @returns Its printable form.
 */
function renderValue(value: NonNullable<Configuration[keyof Configuration]>): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }

  if (typeof value === "object") {
    // Every map this schema produces has string values — `OURO_LOCAL_PROVIDER_URLS` is
    // `kind=url` pairs — so the cast is the shape rather than an assumption about it, and a
    // future map of something else would fail to compile here rather than print `[object
    // Object]` into a boot log.
    return Object.entries(value as Record<string, string>)
      .map(([key, entry]) => `${key}=${entry}`)
      .join(",");
  }

  return String(value);
}

/**
 * The configuration as a block of text for the boot log.
 *
 * Logged before the service listens rather than after, so a process that then fails to
 * bind its port has still said what it was configured with — which is usually the answer.
 *
 * @param configuration - The validated configuration.
 * @returns A heading and one indented `VARIABLE=value` line per variable, redacted by
 *   {@link redactedEnvironment}.
 */
export function describeConfiguration(configuration: Configuration): string {
  const lines = Object.entries(redactedEnvironment(configuration)).map(
    ([variable, value]) => `  ${variable}=${value}`,
  );

  return ["ouroboros-rest: configuration", ...lines].join("\n");
}
