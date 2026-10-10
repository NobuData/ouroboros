import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validateSync } from "class-validator";

import {
  BriefDto,
  CheckpointDto,
  FinishDto,
  MAX_CLAIMS,
  MAX_DURATION_MS,
  MAX_USAGE_ROWS,
  StartDto,
} from "./investigation-loop.dto";

/**
 * The bodies' shapes — what the global pipe refuses with `422 validation_failed` before the
 * service sees them. What only the service can judge is its own suite's.
 */

const SOURCE = "5eed0092-0000-4000-8000-000000000007";

function failures<T extends object>(dto: ClassConstructor<T>, body: unknown): string[] {
  const walk = (errors: ReturnType<typeof validateSync>, prefix: string): string[] =>
    errors.flatMap((error) =>
      error.children !== undefined && error.children.length > 0
        ? walk(error.children, `${prefix}${error.property}.`)
        : [`${prefix}${error.property}`],
    );

  return walk(
    validateSync(plainToInstance(dto, body), { whitelist: true, forbidNonWhitelisted: true }),
    "",
  );
}

const usage = {
  seq: 1,
  stage: "digest",
  alias: "researcher-long-ctx",
  hop: 0,
  connection: "conn-1",
  model: "claude-sonnet-4-6",
  inputTokens: 20_000,
  outputTokens: 1_500,
  costCents: 8.25,
};
const start = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "t",
};
const checkpoint = {
  attempt: 1,
  seq: 1,
  checkpoint: { phase: "plan" },
  durationMs: 0,
  usage: [usage],
};
const claim = { ref: "c1", type: "finding", text: "A claim.", sources: [SOURCE], demoted: false };
const brief = {
  attempt: 1,
  durationMs: 10,
  usage: [],
  body: { paragraphs: [] },
  claims: [claim],
  deliverables: {},
};
const finish = {
  attempt: 1,
  outcome: "failed",
  reason: "budget_breach",
  detail: "The ceiling was reached.",
  durationMs: 10,
  usage: [],
  seq: 2,
  checkpoint: {},
};

describe("the start body", () => {
  it("accepts a start, with or without a resolution ref", () => {
    expect(failures(StartDto, start)).toEqual([]);
    expect(failures(StartDto, { ...start, resolutionRef: null })).toEqual([]);
    expect(failures(StartDto, { loopVersion: "loop-v12", alias: "a", task: "t" })).toEqual([]);
  });

  it.each([
    ["loopVersion", { ...start, loopVersion: "v1" }],
    ["loopVersion", { ...start, loopVersion: "loop-v0" }],
    ["alias", { ...start, alias: "" }],
    ["task", { ...start, task: "x".repeat(201) }],
    ["resolutionRef", { ...start, resolutionRef: 7 }],
    ["organizationId", { ...start, organizationId: "org-elsewhere" }],
  ])("refuses a bad %s", (property, body) => {
    expect(failures(StartDto, body)).toEqual([property]);
  });
});

describe("the checkpoint body", () => {
  it("accepts a checkpoint, with unpriced usage or none", () => {
    expect(failures(CheckpointDto, checkpoint)).toEqual([]);
    expect(
      failures(CheckpointDto, { ...checkpoint, usage: [{ ...usage, costCents: null }] }),
    ).toEqual([]);
    expect(failures(CheckpointDto, { ...checkpoint, usage: [] })).toEqual([]);
  });

  it.each([
    ["attempt", { ...checkpoint, attempt: 0 }],
    ["seq", { ...checkpoint, seq: 1.5 }],
    ["checkpoint", { ...checkpoint, checkpoint: "plan" }],
    ["checkpoint", { ...checkpoint, checkpoint: [1] }],
    ["durationMs", { ...checkpoint, durationMs: -1 }],
    ["durationMs", { ...checkpoint, durationMs: MAX_DURATION_MS + 1 }],
    ["usage", { ...checkpoint, usage: "none" }],
    ["usage", { ...checkpoint, usage: Array.from({ length: MAX_USAGE_ROWS + 1 }, () => usage) }],
    ["usage.0.stage", { ...checkpoint, usage: [{ ...usage, stage: "deliver" }] }],
    ["usage.0.seq", { ...checkpoint, usage: [{ ...usage, seq: 0 }] }],
    ["usage.0.costCents", { ...checkpoint, usage: [{ ...usage, costCents: -1 }] }],
    ["usage.0.costCents", { ...checkpoint, usage: [{ ...usage, costCents: "8.25" }] }],
    ["usage.0.inputTokens", { ...checkpoint, usage: [{ ...usage, inputTokens: 1.5 }] }],
    ["usage.0.secret", { ...checkpoint, usage: [{ ...usage, secret: "sk-live" }] }],
  ])("refuses a bad %s", (property, body) => {
    expect(failures(CheckpointDto, body)).toEqual([property]);
  });
});

describe("the brief body", () => {
  it("accepts a brief, and a claim that does not say whether it was demoted", () => {
    expect(failures(BriefDto, brief)).toEqual([]);
    const { demoted: _demoted, ...undeclared } = claim;
    expect(failures(BriefDto, { ...brief, claims: [undeclared] })).toEqual([]);
  });

  it.each([
    ["body", { ...brief, body: "The gap is control." }],
    ["deliverables", { ...brief, deliverables: [] }],
    ["claims", { ...brief, claims: Array.from({ length: MAX_CLAIMS + 1 }, () => claim) }],
    ["claims.0.ref", { ...brief, claims: [{ ...claim, ref: "C 1" }] }],
    ["claims.0.type", { ...brief, claims: [{ ...claim, type: "fact" }] }],
    ["claims.0.text", { ...brief, claims: [{ ...claim, text: "" }] }],
    ["claims.0.sources", { ...brief, claims: [{ ...claim, sources: ["07"] }] }],
    ["claims.0.sources", { ...brief, claims: [{ ...claim, sources: SOURCE }] }],
    ["claims.0.demoted", { ...brief, claims: [{ ...claim, demoted: "no" }] }],
    ["actuals", { ...brief, actuals: { sourcesUsed: 99 } }],
  ])("refuses a bad %s", (property, body) => {
    expect(failures(BriefDto, body)).toEqual([property]);
  });
});

describe("the finish body", () => {
  it("accepts a failure with its reason, and a cancel without one", () => {
    expect(failures(FinishDto, finish)).toEqual([]);
    const { reason: _reason, detail: _detail, ...cancelled } = finish;
    expect(failures(FinishDto, { ...cancelled, outcome: "cancelled" })).toEqual([]);
  });

  it.each([
    ["outcome", { ...finish, outcome: "brief_ready" }],
    ["reason", { ...finish, reason: "boredom" }],
    ["detail", { ...finish, detail: "x".repeat(501) }],
    ["seq", { ...finish, seq: 0 }],
    ["checkpoint", { ...finish, checkpoint: null }],
    ["status", { ...finish, status: "brief_ready" }],
  ])("refuses a bad %s", (property, body) => {
    expect(failures(FinishDto, body)).toEqual([property]);
  });
});
