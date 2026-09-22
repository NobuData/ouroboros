import { internalDocument } from "../../openapi/specification";
import {
  INGEST_ERRORS,
  attemptLimitExceeded,
  buildJobNotFound,
  eventsOutOfOrder,
  idempotencyKeyReused,
  repositoryNotFound,
  runNotFound,
  stageNotInPin,
  stageReturnNotARetry,
  stageTransitionInvalid,
  ticketAmbiguous,
  ticketNotFound,
  ticketNotNumbered,
  workflowPinNotFound,
  workflowPinUnreadable,
} from "./ingest.errors";

/**
 * The refusals, and the one criterion that is about them:
 *
 * > An invalid stage transition is rejected **with a machine-readable reason**, not a generic
 * > 400.
 *
 * Two things are asserted, and the second is the one that keeps the first honest. **Every
 * code is its own word** with the status a caller can act on — `404` is *stop*, `409` is *fix
 * and resend* — and **every code appears in `openapi.internal.yaml`**, because a refusal the
 * document does not describe is a refusal an executor was never written against. The document
 * is read from the committed rendering, so the assertion is about what ships rather than
 * about a value composed in a test.
 */

/** Every constructor, with the code and status it must produce. */
const REFUSALS = [
  ["run_not_found", 404, () => runNotFound("5eed0009-0000-4000-8000-000000000999")],
  ["ticket_not_found", 404, () => ticketNotFound("source", "#482")],
  ["ticket_ambiguous", 409, () => ticketAmbiguous("source", "#482")],
  ["ticket_not_numbered", 409, () => ticketNotNumbered("PROJ-142")],
  ["repository_not_found", 404, () => repositoryNotFound("repo")],
  ["workflow_pin_not_found", 404, () => workflowPinNotFound("standard-fix", 14)],
  ["workflow_pin_unreadable", 409, () => workflowPinUnreadable("standard-fix", 14)],
  ["stage_not_in_pin", 409, () => stageNotInPin("implement", "standard-fix", 14)],
  [
    "stage_transition_invalid",
    409,
    () => stageTransitionInvalid("implement", 1, "pending", "succeeded"),
  ],
  ["attempt_limit_exceeded", 409, () => attemptLimitExceeded("implement", 4, 3)],
  ["stage_return_not_a_retry", 409, () => stageReturnNotARetry("implement", 1)],
  ["events_out_of_order", 409, () => eventsOutOfOrder(22, 20)],
  ["build_job_not_found", 404, () => buildJobNotFound("job")],
  ["idempotency_key_reused", 409, () => idempotencyKeyReused("run.files", "k")],
] as const;

describe("the codes", () => {
  it.each(REFUSALS)("%s carries the status a caller can act on", (code, status, build) => {
    const error = build();

    expect(error.envelope().code).toBe(code);
    expect(error.getStatus()).toBe(status);
  });

  it("has no duplicates, so two faults cannot look like one", () => {
    const codes = Object.values(INGEST_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("names exactly the codes the constructors produce", () => {
    // The `it.each` above iterates the list, so it cannot notice a code *leaving* it. This
    // names the set instead, which is what makes a constructor added without a code — or a
    // code added without a constructor — a failing test rather than a quieter suite.
    expect(Object.values(INGEST_ERRORS).toSorted()).toEqual(
      REFUSALS.map(([code]) => code).toSorted(),
    );
  });
});

describe("the details each refusal carries", () => {
  it("tells an executor which stage, which attempt, and which move was refused", () => {
    // The criterion's substance. Together these are the whole of what an executor needs to
    // tell *"I lost a response"* — its own state is behind — from *"I have a bug"* — its own
    // state is impossible.
    expect(
      stageTransitionInvalid("implement", 2, "succeeded", "active").envelope().details,
    ).toEqual({ stageKey: "implement", attempt: 2, from: "succeeded", to: "active" });
  });

  it("says a stage cannot *begin* in a status, when there is no row to move", () => {
    const message = stageTransitionInvalid("implement", 1, null, "succeeded").envelope().message;

    expect(message).toBe("A stage attempt cannot begin in succeeded.");
    expect(
      stageTransitionInvalid("implement", 1, null, "succeeded").envelope().details.from,
    ).toBeNull();
  });

  it("gives both ordering numbers, which are different bugs", () => {
    // Re-sending something already accepted and holding a batch from the future are different
    // mistakes with different fixes, and only the pair distinguishes them.
    expect(eventsOutOfOrder(22, 20).envelope().details).toEqual({ accepted: 22, offered: 20 });
  });

  it("names the pin as well as the stage, because a republish is the likely cause", () => {
    expect(stageNotInPin("implement", "standard-fix", 14).envelope().details).toEqual({
      stageKey: "implement",
      workflowTag: "standard-fix",
      version: 14,
    });
  });

  it("never returns the stored response when a key was reused", () => {
    // It belongs to whatever request first used the key, and may describe rows this caller
    // has not been shown.
    const details = idempotencyKeyReused("run.files", "sim-482-changeset-3").envelope().details;

    expect(details).toEqual({ operation: "run.files", idempotencyKey: "sim-482-changeset-3" });
    expect(JSON.stringify(details)).not.toContain("changeSetSeq");
  });
});

describe("the published contract", () => {
  /** Every string that appears anywhere under the six ingestion paths. */
  function ingestionProse(): string {
    const document = internalDocument();
    const ingestion = Object.entries(document.paths).filter(([path]) =>
      path.startsWith("/internal/runs"),
    );

    expect(ingestion).toHaveLength(6);

    return JSON.stringify(ingestion);
  }

  it.each(REFUSALS)("publishes %s", (code) => {
    // A document is a contract only where its strings are the service's strings. A code the
    // service can answer with and the document does not name is a refusal nobody built an
    // executor against.
    expect(ingestionProse()).toContain(code);
  });

  // A status can carry one example, and several codes share a status — so the document shows
  // the most instructive one per operation and names the rest in its description. These are
  // the six it shows, and their *messages* are held to the constructors word for word, which
  // is what stops the document from describing a refusal in words the service does not use.
  it.each([
    ["ticket_not_found", () => ticketNotFound("source", "#482")],
    ["idempotency_key_reused", () => idempotencyKeyReused("run.create", "k")],
    ["run_not_found", () => runNotFound("run")],
    [
      "stage_transition_invalid",
      () => stageTransitionInvalid("implement", 1, "pending", "succeeded"),
    ],
    ["events_out_of_order", () => eventsOutOfOrder(22, 20)],
    ["build_job_not_found", () => buildJobNotFound("job")],
  ] as const)("publishes the message a caller receives for %s", (_code, build) => {
    expect(ingestionProse()).toContain(JSON.stringify(build().envelope().message).slice(1, -1));
  });
});
