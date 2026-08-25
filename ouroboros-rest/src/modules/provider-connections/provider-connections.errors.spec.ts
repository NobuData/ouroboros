import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";
import { parse } from "yaml";

import { FAKE_FAILURES } from "../providers/adapters/fake.adapter.fixture";
import {
  PROVIDER_CONNECTION_ERRORS,
  configInvalid,
  configNotStorable,
  connectionChanged,
  connectionNotFound,
  credentialAbsent,
  providerValidationFailed,
  revealRateLimited,
  stepUpRequired,
} from "./provider-connections.errors";
import { STEP_UP_MAX_AGE_SECONDS, STEP_UP_METHODS } from "./step-up";

/**
 * Every code this surface can answer with, and the status each carries.
 *
 * The same suite `pricing.errors.spec.ts` and `registry.errors.spec.ts` are: the codes are
 * only meaningful beside the operations that produce them, `openapi.yaml` is where the two
 * are published together, and this holds the published copy to these constants so the string
 * in the specification and the string in the answer cannot drift apart.
 */

/** The specification, parsed — the published half of the contract. */
const specification = (): string =>
  readFileSync(join(__dirname, "..", "..", "..", "openapi.yaml"), "utf8");

describe("the codes", () => {
  it("are the nine this module can answer with", () => {
    expect(Object.values(PROVIDER_CONNECTION_ERRORS).sort()).toEqual([
      "provider_config_invalid",
      "provider_config_not_storable",
      "provider_connection_changed",
      "provider_connection_not_found",
      "provider_credential_absent",
      "provider_discovery_failed",
      "provider_reveal_rate_limited",
      "provider_validation_failed",
      "step_up_required",
    ]);
  });

  it.each(Object.values(PROVIDER_CONNECTION_ERRORS))(
    "publishes %s in the specification",
    (code) => {
      // A code beside no operation is a code a client cannot look up.
      expect(specification()).toContain(code);
    },
  );

  it("does not re-spell a refusal another module owns", () => {
    // `provider_kind_unsupported` is the registry's and `provider_connection_in_use` is
    // Y.1's, written there *for* this ticket. Two vocabularies for one rule is drift dressed
    // as precision.
    const codes: string[] = Object.values(PROVIDER_CONNECTION_ERRORS);

    expect(codes).not.toContain("provider_kind_unsupported");
    expect(codes).not.toContain("provider_connection_in_use");
  });
});

describe("what each refusal is", () => {
  it("answers 404 for a connection this workspace does not have", () => {
    // Never a `403`, including for a connection another workspace does have: a `403` would
    // confirm that an identifier names something real, which is the whole of what somebody
    // enumerating identifiers is trying to learn.
    const error = connectionNotFound("5eed000c-0000-4000-8000-000000000001");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope()).toEqual({
      code: "provider_connection_not_found",
      message: "This workspace has no provider connection with that id.",
      details: { connectionId: "5eed000c-0000-4000-8000-000000000001" },
    });
  });

  it("answers 422 for a configuration the adapter's schema refuses", () => {
    const error = configInvalid({ baseUrl: ["Base URL is required"] });

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope().code).toBe("provider_config_invalid");
    // The same `{field: [sentences]}` shape the validation pipe produces, so one renderer
    // serves both — and a different code, so a client can still tell which layer refused it.
    expect(error.envelope().details).toEqual({ fields: { baseUrl: ["Base URL is required"] } });
  });

  it("refuses to describe a configuration failure with nothing wrong in it", () => {
    expect(() => configInvalid({})).toThrow(RangeError);
  });

  it("answers 501 for a setting this build has no column for", () => {
    const error = configNotStorable("copilot", ["organization"]);

    expect(error.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    expect(error.envelope().code).toBe("provider_config_not_storable");
    expect(error.envelope().details).toEqual({ kind: "copilot", fields: ["organization"] });
    // The message names the field and says what to do, because *this build cannot* is only
    // useful to somebody who is told which part it cannot do.
    expect(error.envelope().message).toContain("organization");
    expect(error.envelope().message).toContain("copilot");
  });

  it("reads a list of unstorable fields as a sentence", () => {
    expect(
      configNotStorable("copilot", ["organization", "region", "zone"]).envelope().message,
    ).toContain("organization, region and zone");
  });

  it("refuses to name no unstorable field at all", () => {
    expect(() => configNotStorable("copilot", [])).toThrow(RangeError);
  });

  it("answers 422 when the provider itself refused, carrying the taxonomy's own words", () => {
    // `errorClass` and `detail` are exactly what mockup 07's card foot renders, so a form and
    // a card say the same thing about the same failure.
    const error = providerValidationFailed(FAKE_FAILURES.auth);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope()).toEqual({
      code: "provider_validation_failed",
      message: "The provider refused this configuration, so nothing was saved.",
      details: { errorClass: "auth", detail: "key rejected (401)" },
    });
  });

  it("answers 409 for a connection with no credential to open", () => {
    // Not a `404` and not a `422`: the connection exists, nothing about the request is
    // malformed, and it is the *state* that refuses the operation.
    expect(credentialAbsent("id").getStatus()).toBe(HttpStatus.CONFLICT);
    expect(credentialAbsent("id").envelope().code).toBe("provider_credential_absent");
  });

  it("answers 409 when the row moved under a rotation", () => {
    const error = connectionChanged("id");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe("provider_connection_changed");
    expect(error.envelope().message).toContain("retry");
  });

  it("answers 401 with a challenge a client can act on", () => {
    // A `401` rather than a `403`: the caller may reveal, and what is missing is a recent
    // proof that the browser is still the person. The action is *authenticate again*.
    const error = stepUpRequired([...STEP_UP_METHODS], STEP_UP_MAX_AGE_SECONDS);

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.envelope()).toEqual({
      code: "step_up_required",
      message: "Revealing a credential needs a recent re-authentication.",
      details: { methods: ["session", "password"], maxAgeSeconds: 300 },
    });
  });

  it("answers 429 naming which limit filled and for how long", () => {
    const error = revealRateLimited("connection", 42);

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.envelope()).toEqual({
      code: "provider_reveal_rate_limited",
      message: "Too many reveal attempts. Wait before trying again.",
      details: { scope: "connection", retryAfterSeconds: 42 },
    });
  });
});

describe("the specification agrees about the statuses", () => {
  it("documents every status this module answers with, on the operation that answers it", () => {
    const document = parse(specification()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };

    const statusesOf = (path: string, method: string): string[] =>
      Object.keys(document.paths[path][method].responses);

    expect(statusesOf("/api/v1/providers", "post")).toEqual(
      expect.arrayContaining(["201", "403", "422", "501"]),
    );
    expect(statusesOf("/api/v1/providers/{id}/reveal", "post")).toEqual(
      expect.arrayContaining(["200", "401", "403", "404", "409", "429"]),
    );
    expect(statusesOf("/api/v1/providers/{id}/rotate", "post")).toEqual(
      expect.arrayContaining(["200", "409", "422"]),
    );
    expect(statusesOf("/api/v1/providers/{id}", "delete")).toEqual(
      expect.arrayContaining(["204", "409"]),
    );
  });
});
