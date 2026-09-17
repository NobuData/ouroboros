import { HttpStatus } from "@nestjs/common";

import {
  PLANNING_ERRORS,
  batchNotEditable,
  draftNotFound,
  draftPushed,
  epicNotFound,
  monthRangeInvalid,
  plannerUnversioned,
  planningTargetReadOnly,
  reorderIncomplete,
  selfDependency,
  sourceNotFound,
  ticketsNotFound,
  unknownDependency,
} from "./planning.errors";

/** Every refusal the planning API adds — its status, its code, and what its details name. */
describe("planning errors", () => {
  it.each([
    [draftNotFound("b", "OTA-9"), HttpStatus.NOT_FOUND, PLANNING_ERRORS.draftNotFound],
    [epicNotFound("e"), HttpStatus.NOT_FOUND, PLANNING_ERRORS.epicNotFound],
    [sourceNotFound("s"), HttpStatus.NOT_FOUND, PLANNING_ERRORS.sourceNotFound],
    [ticketsNotFound(["t"]), HttpStatus.NOT_FOUND, PLANNING_ERRORS.ticketsNotFound],
    [
      unknownDependency("OTA-3", ["OTA-9"]),
      HttpStatus.UNPROCESSABLE_ENTITY,
      PLANNING_ERRORS.unknownDependency,
    ],
    [selfDependency("OTA-3"), HttpStatus.UNPROCESSABLE_ENTITY, PLANNING_ERRORS.selfDependency],
    [batchNotEditable("b", "pushed"), HttpStatus.CONFLICT, PLANNING_ERRORS.batchNotEditable],
    [draftPushed("b", "OTA-1"), HttpStatus.CONFLICT, PLANNING_ERRORS.draftPushed],
    [planningTargetReadOnly("s"), HttpStatus.CONFLICT, PLANNING_ERRORS.targetReadOnly],
    [plannerUnversioned("Outline"), HttpStatus.BAD_GATEWAY, PLANNING_ERRORS.plannerUnversioned],
    [reorderIncomplete(), HttpStatus.UNPROCESSABLE_ENTITY, PLANNING_ERRORS.reorderIncomplete],
    [monthRangeInvalid("paired"), HttpStatus.UNPROCESSABLE_ENTITY, PLANNING_ERRORS.monthRange],
  ])("%#: answers its status and code", (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(error.envelope().code).toBe(code);
    expect(error.envelope().message).not.toBe("");
  });

  it("names every unknown key", () => {
    expect(unknownDependency("OTA-3", ["OTA-8", "OTA-9"]).envelope()).toMatchObject({
      message: "OTA-3 names dependencies this batch does not hold: OTA-8, OTA-9.",
      details: { localKey: "OTA-3", unknown: ["OTA-8", "OTA-9"] },
    });
  });

  it.each([
    ["pushing", "being pushed"],
    ["pushed", "has been pushed"],
    ["abandoned", "abandoned"],
  ])("says why a %s batch cannot change", (status, phrase) => {
    expect(batchNotEditable("b", status).envelope().message).toContain(phrase);
  });

  it("tells the two month-range rules apart", () => {
    expect(monthRangeInvalid("paired").envelope().details).toEqual({ reason: "paired" });
    expect(monthRangeInvalid("ordered").envelope().message).toContain("end before it starts");
  });
});
