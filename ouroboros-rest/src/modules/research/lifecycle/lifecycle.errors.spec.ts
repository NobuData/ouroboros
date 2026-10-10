import { INVESTIGATION_LOOP_ERRORS } from "../loop/investigation-loop.errors";
import { LIFECYCLE_ERRORS, cancelForbidden, researcherUnrouted } from "./lifecycle.errors";

describe("the lifecycle's refusals", () => {
  it("refuses a cancel by somebody who neither started it nor administers, as 403", () => {
    const error = cancelForbidden("RS-127");

    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe("investigation_cancel_forbidden");
    expect(error.details).toEqual({
      investigation: "RS-127",
      required: ["starter", "owner", "admin"],
    });
  });

  it("refuses a start with no researcher as 409, under the loop's own code", () => {
    const error = researcherUnrouted("gap_analysis");

    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe(INVESTIGATION_LOOP_ERRORS.researcherUnavailable);
    expect(error.details).toEqual({ kind: "gap_analysis" });
  });

  it("keeps its codes stable", () => {
    expect(LIFECYCLE_ERRORS).toEqual({
      cancelForbidden: "investigation_cancel_forbidden",
      researcherUnrouted: "investigation_researcher_unavailable",
    });
  });
});
