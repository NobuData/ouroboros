import { document, internalDocument } from "../../openapi/specification";
import {
  CONTROLS_ERRORS,
  abortConfirmationInvalid,
  controlKeyReused,
  controlNotDelivered,
  controlNotFound,
  controlPayloadInvalid,
} from "./controls.errors";

/**
 * The refusals (#306): each code is its own word with the status a caller acts on, and each
 * appears in the specification that publishes the operation which can answer with it.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const CONTROL = "c0000000-0000-4000-8000-000000000001";

const REFUSALS = [
  ["abort_confirmation_invalid", 422, () => abortConfirmationInvalid()],
  ["control_payload_invalid", 422, () => controlPayloadInvalid("steer", "payload", "Say how.")],
  ["control_key_reused", 409, () => controlKeyReused("k-1")],
  ["control_not_found", 404, () => controlNotFound(RUN, CONTROL)],
  ["control_not_delivered", 409, () => controlNotDelivered(CONTROL, "expired")],
] as const;

describe("the codes", () => {
  it.each(REFUSALS)("%s carries the status a caller can act on", (code, status, build) => {
    const error = build();

    expect(error.envelope().code).toBe(code);
    expect(error.getStatus()).toBe(status);
  });

  it("covers every code the module declares, once", () => {
    expect(REFUSALS.map(([code]) => code).sort()).toEqual(Object.values(CONTROLS_ERRORS).sort());
  });

  it("does not echo the loop number an abort expected", () => {
    expect(JSON.stringify(abortConfirmationInvalid().envelope())).not.toMatch(/\d{2,}/);
  });

  it("echoes the state a control is in, which is what an executor decides on", () => {
    expect(controlNotDelivered(CONTROL, "acked").envelope().details).toEqual({
      controlId: CONTROL,
      state: "acked",
    });
  });
});

describe("the specifications", () => {
  it("publish the submission's refusals beside the public operation", () => {
    const text = JSON.stringify(document());

    for (const code of [
      "abort_confirmation_invalid",
      "control_payload_invalid",
      "control_key_reused",
    ]) {
      expect(text).toContain(code);
    }
  });

  it("publish the acknowledgment's refusals beside the internal operation", () => {
    const text = JSON.stringify(internalDocument());

    for (const code of ["control_not_found", "control_not_delivered"]) {
      expect(text).toContain(code);
    }
  });
});
