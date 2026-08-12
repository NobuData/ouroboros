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
      // No field is nullable today — the last one went with #705's removal of the
      // development bypass — so this branch is unreachable from `loadConfiguration`'s
      // output. It is kept because {@link redactedEnvironment} takes a `Configuration` from
      // any caller, and the day an optional variable comes back the safe rendering should
      // already be here rather than be remembered.
      redacted[variable] = "";
    } else if (SECRET_VARIABLES.has(variable)) {
      redacted[variable] = REDACTED;
    } else if (variable === VARIABLES.databaseUrl) {
      redacted[variable] = redactDatabaseUrl(String(value));
    } else {
      redacted[variable] = Array.isArray(value) ? value.join(",") : String(value);
    }
  }

  return redacted;
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
