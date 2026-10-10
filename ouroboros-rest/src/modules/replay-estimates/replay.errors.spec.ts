import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  REPLAY_ERRORS,
  commandRequired,
  dryRunNotFound,
  poolNotFound,
  poolRequired,
  repositoryUnresolved,
} from "./replay.errors";

/** The engine-facing document these codes are answered under. */
const SPECIFICATION = readFileSync(
  join(__dirname, "..", "..", "..", "openapi.internal.yaml"),
  "utf8",
);

const DRY_RUN = "5eed008b-0000-4000-8000-000000000001";

describe("the replay estimators' refusals", () => {
  it.each([
    [
      dryRunNotFound(DRY_RUN),
      HttpStatus.NOT_FOUND,
      REPLAY_ERRORS.dryRunNotFound,
      { dryRun: DRY_RUN },
    ],
    [
      repositoryUnresolved(DRY_RUN),
      HttpStatus.UNPROCESSABLE_ENTITY,
      REPLAY_ERRORS.repositoryUnresolved,
      { dryRun: DRY_RUN },
    ],
    [poolRequired(), HttpStatus.UNPROCESSABLE_ENTITY, REPLAY_ERRORS.poolRequired, {}],
    [
      poolNotFound("pool-z"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      REPLAY_ERRORS.poolNotFound,
      { runnerPool: "pool-z" },
    ],
    [
      commandRequired("pool-b"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      REPLAY_ERRORS.commandRequired,
      { runnerPool: "pool-b" },
    ],
  ])("%#: answers its status, code and details", (error, status, code, details) => {
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
    expect(error.details).toEqual(details);
    expect(error.envelope().message).not.toBe("");
  });

  it("uses distinct codes", () => {
    const codes = Object.values(REPLAY_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has no code for too little history — that is an answer, not a refusal", () => {
    for (const code of Object.values(REPLAY_ERRORS))
      expect(code).not.toMatch(/insufficient|history/);
  });

  it.each(Object.values(REPLAY_ERRORS))("documents %s in openapi.internal.yaml", (code) => {
    expect(SPECIFICATION).toContain(`\`${code}\``);
  });
});
