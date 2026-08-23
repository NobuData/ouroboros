import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { LeaseRequestDto } from "./lease.dto";
import { CLOUD_PROVIDER_KINDS, LOCAL_PROVIDER_KINDS, PROVIDER_KINDS } from "./providers";

/**
 * The request grammar, and the one thing it deliberately does **not** enforce.
 *
 * A cloud kind is a valid *request* and an invalid *grant*. That separation is the second
 * acceptance criterion of [#224](https://github.com/NobuData/ouroboros/issues/224) — a lease
 * for a cloud provider returns **403 by policy** — and a validator that rejected those kinds
 * would satisfy nothing while looking like it had: the answer would be `422 validation_failed`
 * from the pipe, which says *there is no such provider* about a provider the product
 * supports, and the policy would never run.
 */

/** Validate a body the way the pipe would, and report which fields were refused. */
async function refusalsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(LeaseRequestDto, body));

  return errors.map((error) => error.property).sort();
}

/** A well-formed request, which the cases below vary one field of. */
const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

describe("the provider", () => {
  it.each([...PROVIDER_KINDS])(
    "accepts %s, whatever the policy will say about it",
    async (provider) => {
      await expect(refusalsOf({ provider, run: RUN })).resolves.toEqual([]);
    },
  );

  it.each([...CLOUD_PROVIDER_KINDS])(
    "lets %s through to the policy rather than refusing it here",
    async (provider) => {
      // The load-bearing case. `lease.spec.ts` is where the same kind is refused with a
      // `403`, and the two suites together are what make "403 by policy" a property of the
      // system rather than of whichever layer happened to answer first.
      await expect(refusalsOf({ provider, run: RUN })).resolves.toEqual([]);
    },
  );

  it.each([["ollama-2"], ["OLLAMA"], ["openai-compatible"], [""], ["anthropic "]])(
    "refuses %s, which is not a provider kind",
    async (provider) => {
      // `openai-compatible` with a hyphen is in this list on purpose: the registry's spelling
      // is `openai_compatible`, and a near miss accepted here would be a lease for a
      // provider the price catalog and the adapters have never heard of.
      await expect(refusalsOf({ provider, run: RUN })).resolves.toEqual(["provider"]);
    },
  );

  it("is required", async () => {
    await expect(refusalsOf({ run: RUN })).resolves.toEqual(["provider"]);
  });
});

describe("the run", () => {
  it.each([...LOCAL_PROVIDER_KINDS])("accepts a uuid beside %s", async (provider) => {
    await expect(refusalsOf({ provider, run: RUN })).resolves.toEqual([]);
  });

  it.each([["not-a-uuid"], [""], ["4d2a8b31"], [42]])("refuses %s", async (run) => {
    // A malformed run is a `422` naming the field, from the pipe, before a connection is
    // taken from the pool — the same line `runs.dto.ts` draws between "you asked wrongly"
    // and "there is no such thing".
    await expect(refusalsOf({ provider: "ollama", run })).resolves.toEqual(["run"]);
  });

  it("is required", async () => {
    await expect(refusalsOf({ provider: "ollama" })).resolves.toEqual(["run"]);
  });
});

describe("the body as a whole", () => {
  it("reports both fields when both are wrong", async () => {
    await expect(refusalsOf({})).resolves.toEqual(["provider", "run"]);
  });

  it("declares exactly two fields, so the pipe's whitelist refuses anything else", () => {
    // The pipe is what actually refuses an extra property (`src/application.ts`), and what
    // this asserts is the input to that: a DTO that grew a third field would be a surface
    // accepting something nobody documented. It matters more here than on a browser route —
    // a worker sending an unknown field is a worker built against a different contract.
    const declared = Object.keys(
      plainToInstance(LeaseRequestDto, { provider: "ollama", run: RUN }),
    );

    expect(declared.toSorted()).toEqual(["provider", "run"]);
  });
});
