import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { DOMAIN_MAX_LENGTH, DiscoverBody, normaliseDomain } from "./discovery.dto";

/**
 * The company-domain field: what it folds, what it refuses, and the order of the two.
 *
 * This is the only DTO in the service that normalises rather than rejects, so the assertions
 * here are in two halves that have to hold together:
 *
 *   * **The folding is what a person's browser did to the value**, and no more than that —
 *     a scheme, a path, the case and the whitespace. Nothing is guessed.
 *   * **Normalisation happens before validation**, which is what makes the first half safe:
 *     if the decorators judged the raw value, every fold below would be a `422` instead.
 *
 * The pipe is exercised the way Nest exercises it — `plainToInstance` then `validateSync` —
 * rather than by calling {@link normaliseDomain} and trusting that the decorator runs. The
 * ordering *is* the behaviour, and it is a property of `class-transformer`, not of this file.
 */

/** What the pipe does to a body, in the order `ValidationPipe` does it. */
function through(body: unknown): { value: DiscoverBody; messages: string[] } {
  const value = plainToInstance(DiscoverBody, body);
  const messages = validateSync(value, { whitelist: true, forbidNonWhitelisted: true }).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );

  return { value, messages };
}

/** Whether a body survives the pipe. */
function accepts(body: unknown): boolean {
  return through(body).messages.length === 0;
}

describe("normalising a typed domain", () => {
  it.each([
    ["the mockup's own placeholder, already clean", "acme.ouroboros.dev", "acme.ouroboros.dev"],
    ["surrounding whitespace, from a paste", "  acme.ouroboros.dev  ", "acme.ouroboros.dev"],
    ["upper case, because the column is lower", "Acme.Ouroboros.DEV", "acme.ouroboros.dev"],
    [
      "https, which is what an address bar adds",
      "https://acme.ouroboros.dev",
      "acme.ouroboros.dev",
    ],
    ["http, for the same reason", "http://acme.ouroboros.dev", "acme.ouroboros.dev"],
    ["a scheme nobody expected", "ftp://acme.ouroboros.dev", "acme.ouroboros.dev"],
    ["the trailing slash a browser shows", "https://acme.ouroboros.dev/", "acme.ouroboros.dev"],
    ["a whole pasted URL", "https://acme.ouroboros.dev/login?next=/", "acme.ouroboros.dev"],
    ["a fragment", "acme.ouroboros.dev#top", "acme.ouroboros.dev"],
    ["the fully-qualified trailing dot", "acme.ouroboros.dev.", "acme.ouroboros.dev"],
    ["all of it at once", "  HTTPS://Acme.Ouroboros.dev./login  ", "acme.ouroboros.dev"],
  ])("folds %s", (_description, typed, expected) => {
    expect(normaliseDomain(typed)).toBe(expected);
  });

  it("strips the path as well as the scheme, not one of the two", () => {
    // Removing `https://` and stopping would leave `acme.ouroboros.dev/login`, which no row
    // can match and no error message can usefully explain.
    expect(normaliseDomain("https://acme.ouroboros.dev/login")).not.toContain("/");
  });

  it("leaves a value that was already the stored form alone", () => {
    // Idempotence, because the same string reaches this function whether a person typed it
    // or a client re-sent what the field held.
    const once = normaliseDomain("https://Acme.Ouroboros.dev/");

    expect(normaliseDomain(once)).toBe(once);
  });
});

describe("the discovery body", () => {
  it("hands the handler the normalised value, not the typed one", () => {
    // The property the whole endpoint rests on: what reaches the lookup is what the column
    // would hold, so a person pasting their address bar finds their own workspace.
    expect(through({ domain: "  HTTPS://Acme.Ouroboros.dev/  " }).value.domain).toBe(
      "acme.ouroboros.dev",
    );
  });

  it("accepts what it just normalised, rather than judging the raw value", () => {
    // The ordering, as an assertion. If the decorators ran first, every fold above would be
    // a 422 — `HTTPS://Acme…` matches no domain pattern.
    expect(accepts({ domain: "HTTPS://Acme.Ouroboros.dev/login" })).toBe(true);
  });

  it.each([
    ["a bare hostname with no dot", "localhost"],
    ["an email address, which is not a domain", "ken@acme.ouroboros.dev"],
    ["a host and port, because a company domain has none", "acme.ouroboros.dev:8443"],
    ["a space in the middle", "acme ouroboros.dev"],
    ["an underscore, which no hostname label may hold", "acme_corp.dev"],
    ["a leading hyphen", "-acme.dev"],
    ["nothing at all", ""],
    ["only whitespace", "   "],
    ["only a scheme", "https://"],
  ])("refuses %s", (_description, typed) => {
    expect(accepts({ domain: typed })).toBe(false);
  });

  it("tells a person what a company domain looks like", () => {
    // The message is what a form renders beside the input, so it names an example rather
    // than a regular expression.
    expect(through({ domain: "not a domain" }).messages).toContainEqual(
      expect.stringContaining("acme.ouroboros.dev"),
    );
  });

  it("refuses a domain longer than the column holds", () => {
    const label = "a".repeat(63);
    const tooLong = `${label}.${label}.${label}.${label}.dev`;

    expect(tooLong.length).toBeGreaterThan(DOMAIN_MAX_LENGTH);
    expect(accepts({ domain: tooLong })).toBe(false);
  });

  it("measures that length after normalising, not before", () => {
    // A scheme and a path are the browser's, not the domain's, so they must not consume the
    // budget — `https://` alone is eight of the 253.
    const domain = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.dev`;

    expect(domain.length).toBeLessThanOrEqual(DOMAIN_MAX_LENGTH);
    expect(accepts({ domain: `https://${domain}/some/rather/long/path` })).toBe(true);
  });

  it.each([
    ["a number", 42],
    ["null", null],
    ["an object", { host: "acme.ouroboros.dev" }],
    ["an array", ["acme.ouroboros.dev"]],
  ])("reports %s as the wrong type rather than failing inside the transformer", (_case, domain) => {
    // The transformer leaves a non-string alone deliberately: `.trim()` on a number is a
    // 500 for a request whose only fault is a 422.
    expect(() => through({ domain })).not.toThrow();
    expect(accepts({ domain })).toBe(false);
  });

  it("refuses a body with no domain at all", () => {
    expect(accepts({})).toBe(false);
  });

  it("refuses a property the contract does not declare", () => {
    // `forbidNonWhitelisted` is the pipe's, and this is what it means here: an anonymous
    // caller cannot widen the request by adding a field.
    expect(accepts({ domain: "acme.ouroboros.dev", tenantId: "…" })).toBe(false);
  });
});
