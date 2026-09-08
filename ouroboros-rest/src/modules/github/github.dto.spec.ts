import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { FIXTURE_FINE_GRAINED, FIXTURE_LEGACY_TOKEN, FIXTURE_TOKEN } from "./github.fixture";
import { PutGithubTokenDto, TOKEN_PATTERN } from "./github.dto";
import { MAX_TOKEN_LENGTH } from "./github.token";

/**
 * The body's grammar, and one property that is not about grammar at all: **a refusal names
 * the field and never the value.**
 *
 * A validation message normally echoes what was rejected, which is helpful everywhere else in
 * this service and exactly wrong here — the rejected value is a credential, possibly a real
 * one pasted into the wrong workspace, and echoing it would put it in the response body, the
 * browser's console and whatever collects client errors. That is asserted over the messages
 * rather than assumed from the decorators.
 */

/** Validate a body as the pipe would, and answer the fields that were refused. */
async function refusalsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(PutGithubTokenDto, body));

  return errors.map((error) => error.property);
}

/** Every message the validator produced, flattened. */
async function messagesFor(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(PutGithubTokenDto, body));

  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe("the GitHub token body", () => {
  it.each([
    ["a classic token", FIXTURE_TOKEN],
    ["a fine-grained token", FIXTURE_FINE_GRAINED],
    ["a pre-2021 legacy token", FIXTURE_LEGACY_TOKEN],
  ])("accepts %s", async (_case, token) => {
    await expect(refusalsOf({ token })).resolves.toEqual([]);
  });

  it("trims the newline a terminal copy leaves on the end", async () => {
    // Refusing this would be refusing a correct paste for a reason the person cannot see.
    const body = plainToInstance(PutGithubTokenDto, { token: `  ${FIXTURE_TOKEN}\n` });

    await expect(validate(body)).resolves.toEqual([]);
    expect(body.token).toBe(FIXTURE_TOKEN);
  });

  it.each([
    ["absence — PUT means *this is the value now*", {}],
    ["an empty string", { token: "" }],
    ["a repository URL", { token: "https://github.com/nobudata/ouroboros" }],
    ["a prefix on its own", { token: "ghp_" }],
    ["whitespace inside the value", { token: "ghp_abcd efghijklmnopqrstuvwxyz01234" }],
    [
      "something longer than the column will take",
      { token: `ghp_${"a".repeat(MAX_TOKEN_LENGTH)}` },
    ],
    ["a number", { token: 1234567890 }],
    ["null", { token: null }],
  ])("refuses %s, naming the field", async (_case, body) => {
    await expect(refusalsOf(body)).resolves.toEqual(["token"]);
  });

  it("never repeats the rejected value back to the client", async () => {
    const wrong = "ghp_notlongenough";

    const messages = await messagesFor({ token: wrong });

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toContain(wrong);
    }
  });

  it("never repeats a *valid-looking* token back either, when something else is wrong", async () => {
    // The dangerous case: a real token pasted into a body that also carries a typo somewhere,
    // where a message that echoed the field would echo a working credential.
    const messages = await messagesFor({ token: `${FIXTURE_TOKEN}!` });

    for (const message of messages) {
      expect(message).not.toContain(FIXTURE_TOKEN);
    }
  });

  it("builds its pattern from the prefix list rather than restating it", () => {
    // A prefix added to `github.token.ts` is accepted here with no second edit — which is
    // what keeps the two from disagreeing about what a token is.
    expect(TOKEN_PATTERN.test(FIXTURE_FINE_GRAINED)).toBe(true);
    expect(TOKEN_PATTERN.test("ghx_0123456789abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
});
