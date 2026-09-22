import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate, type ValidationError } from "class-validator";

import {
  IngestEventsDto,
  MAX_HUNKS_PER_FILE,
  MAX_HUNK_LINE_LENGTH,
  MAX_LINES_PER_HUNK,
  OpenRunDto,
  ReportCommitsDto,
  ReportFilesDto,
  ReportResourcesDto,
  RunIdParams,
  StageTransitionDto,
} from "./ingest.dto";

/**
 * The six request shapes, validated the way the pipe validates them.
 *
 * Through `class-transformer`, so what the decorators judge is what a JSON body actually
 * carries. The interesting assertions are not *"a good body passes"* — they are the four
 * **absences** `ingest.dto.ts` argues for, because an absence is invisible in a type and a
 * field quietly added later would be a field the contract silently accepts:
 *
 *   * no `note` on a stage transition — V045 generates it;
 *   * no `simulated` anywhere — it follows the principal;
 *   * no `seq` on an event — the store allocates it;
 *   * no `organizationId` anywhere — the workspace is resolved.
 *
 * The pipe's `forbidNonWhitelisted` is what turns each of those into a `422`, and
 * `whitelist: true, forbidNonWhitelisted: true` is passed here so these run under the
 * application's own settings rather than under the library's defaults.
 */

/** Validate as the global pipe does, returning the failing property names. */
async function violations(
  type: ClassConstructor<object>,
  body: Record<string, unknown>,
): Promise<string[]> {
  const failures = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return failures.map((failure: ValidationError) => failure.property);
}

/** A well-formed body for each operation — the baseline every negative case perturbs. */
const GOOD = {
  open: {
    idempotencyKey: "sim-482-open",
    ticket: { source: "8f14e45f-ceea-467a-9f0a-4a1c7c3b2d55", externalKey: "#482" },
    repository: "5eed0003-0000-4000-8000-000000000001",
    workflow: { tag: "standard-fix", version: 14 },
    model: "claude-fable-5",
    branchName: "loop/482-canbus-flake",
    mergeStrategy: "squash",
  },
  transition: {
    idempotencyKey: "sim-482-implement-2",
    stageKey: "implement",
    status: "active",
    attempt: 2,
    at: "2026-09-22T14:32:56.000Z",
    returnedFrom: { stageKey: "checks-green", kind: "gate", reason: "failed_tests" },
  },
  events: {
    idempotencyKey: "sim-482-batch-7",
    events: [{ hint: 21, actor: "gate", body: "2 of 3 required checks failed" }],
  },
  files: {
    idempotencyKey: "sim-482-changeset-3",
    files: [{ path: "drivers/can/telemetry_buf.c", status: "modified", additions: 38 }],
  },
  commits: {
    idempotencyKey: "sim-482-commits-2",
    commits: [
      { sha: "a41c9e2", message: "can: use k_msgq", committedAt: "2026-09-22T14:30:12.000Z" },
    ],
  },
  resources: {
    idempotencyKey: "sim-482-spend-5",
    spend: { provider: "anthropic", model: "claude-fable-5", tokensIn: 48120, tokensOut: 9044 },
    reservedBuildJob: "5eed0008-0000-4000-8000-000000000483",
  },
} as const;

describe("every body", () => {
  const SHAPES: readonly [string, ClassConstructor<object>, Record<string, unknown>][] = [
    ["open a run", OpenRunDto, GOOD.open],
    ["a stage transition", StageTransitionDto, GOOD.transition],
    ["an event batch", IngestEventsDto, GOOD.events],
    ["a change-set report", ReportFilesDto, GOOD.files],
    ["a commit report", ReportCommitsDto, GOOD.commits],
    ["a resource report", ReportResourcesDto, GOOD.resources],
  ];

  it.each(SHAPES)("admits a well-formed %s", async (_name, type, body) => {
    expect(await violations(type, { ...body })).toEqual([]);
  });

  it.each(SHAPES)("requires an idempotency key on %s", async (_name, type, body) => {
    // *Every write on this surface is idempotency-keyed* — a structural fact about the
    // contract rather than six decisions that happen to agree, which is why it is a base
    // class and why this iterates the shapes.
    const { idempotencyKey: _dropped, ...without } = body;

    expect(await violations(type, without)).toEqual(["idempotencyKey"]);
  });

  it.each(SHAPES)("refuses a claimed workspace on %s", async (_name, type, body) => {
    // The workspace is resolved from the ticket or from the run, never taken from a field.
    // A body that carried one would be a worker choosing whose ledger to write into.
    expect(await violations(type, { ...body, organizationId: "acme-robotics-id" })).toEqual([
      "organizationId",
    ]);
  });

  it.each(SHAPES)("refuses a claimed watermark on %s", async (_name, type, body) => {
    // Decision R4: `simulated` follows the principal. A field would make it a claim, however
    // carefully the service then ignored it.
    expect(await violations(type, { ...body, simulated: false })).toEqual(["simulated"]);
  });

  it.each([
    ["empty", ""],
    ["padded", " sim-482 "],
    ["longer than the column", "x".repeat(129)],
  ])("refuses an idempotency key that is %s", async (_name, idempotencyKey) => {
    // The database says the same thing (`run_ingest_receipts_idempotency_key_shape`); saying
    // it here is what makes the answer a `422` naming the field rather than a `500` naming a
    // constraint.
    expect(await violations(OpenRunDto, { ...GOOD.open, idempotencyKey })).toEqual([
      "idempotencyKey",
    ]);
  });
});

describe("opening a run", () => {
  it("requires the ticket, the repository, the pin and the model", async () => {
    expect((await violations(OpenRunDto, { idempotencyKey: "k" })).toSorted()).toEqual([
      "model",
      "repository",
      "ticket",
      "workflow",
    ]);
  });

  it("requires a version on the pin", async () => {
    // Every stage fact the contract later derives comes from the pinned document. A run with
    // no pin could not answer *"what did it actually run under?"*.
    expect(
      await violations(OpenRunDto, { ...GOOD.open, workflow: { tag: "standard-fix" } }),
    ).toEqual(["workflow"]);
  });

  it("allows a run with no branch and no merge strategy", async () => {
    // A run may open before it has a branch, and a pinned terminal that opens no pull request
    // has no strategy to name.
    const { branchName: _b, mergeStrategy: _m, ...bare } = GOOD.open;

    expect(await violations(OpenRunDto, bare)).toEqual([]);
  });
});

describe("a stage transition", () => {
  it("refuses a note, because the database composes one", async () => {
    // The criterion: *a gate-return transition composes the note rather than accepting note
    // text*. Declaring the field would publish a contract PostgreSQL refuses.
    expect(
      await violations(StageTransitionDto, { ...GOOD.transition, note: "attempt 1 failed" }),
    ).toEqual(["note"]);
  });

  it("refuses a status outside the five", async () => {
    expect(await violations(StageTransitionDto, { ...GOOD.transition, status: "done" })).toEqual([
      "status",
    ]);
  });

  it("refuses a stage key that is not a DSL node id", async () => {
    expect(
      await violations(StageTransitionDto, { ...GOOD.transition, stageKey: "Implement" }),
    ).toEqual(["stageKey"]);
  });

  it("requires all three halves of a return, or none", async () => {
    // `run_stages_return_complete`: all three or none. One object rather than three optional
    // fields is what stops *two of the three* being a shape the contract publishes.
    expect(
      await violations(StageTransitionDto, {
        ...GOOD.transition,
        returnedFrom: { stageKey: "checks-green" },
      }),
    ).toEqual(["returnedFrom"]);

    const { returnedFrom: _dropped, ...without } = GOOD.transition;
    expect(await violations(StageTransitionDto, without)).toEqual([]);
  });

  it("refuses a return reason outside V045's closed set", async () => {
    // Closed because the generated note maps each word to a phrase, and a word with no phrase
    // would compose a sentence with a hole in it.
    expect(
      await violations(StageTransitionDto, {
        ...GOOD.transition,
        returnedFrom: { stageKey: "checks-green", kind: "gate", reason: "vibes" },
      }),
    ).toEqual(["returnedFrom"]);
  });
});

describe("an event batch", () => {
  it("refuses a caller-chosen sequence number", async () => {
    // The store allocates `seq` densely, which is what the console's `?after=` pages by. A
    // caller-chosen one would have gaps wherever a cap refused an entry.
    expect(
      await violations(IngestEventsDto, {
        idempotencyKey: "k",
        events: [{ hint: 1, actor: "system", seq: 4, body: "x" }],
      }),
    ).toEqual(["events"]);
  });

  it("requires a hint on every entry", async () => {
    expect(
      await violations(IngestEventsDto, {
        idempotencyKey: "k",
        events: [{ actor: "system", body: "x" }],
      }),
    ).toEqual(["events"]);
  });

  it("refuses an empty batch", async () => {
    // A request nobody meant to send. Answering it `200` would let a broken client believe it
    // had reported something.
    expect(await violations(IngestEventsDto, { idempotencyKey: "k", events: [] })).toEqual([
      "events",
    ]);
  });

  it("refuses a batch larger than one transaction should hold", async () => {
    const events = Array.from({ length: 501 }, (_unused, index) => ({
      hint: index + 1,
      actor: "system",
      body: "x",
    }));

    expect(await violations(IngestEventsDto, { idempotencyKey: "k", events })).toEqual(["events"]);
  });

  it("leaves the payload open, because the store is what types it", async () => {
    // V046 requires an object and types a `hunks` key; restating that here would be a second
    // definition of a rule the store already enforces, and the two would drift.
    expect(
      await violations(IngestEventsDto, {
        idempotencyKey: "k",
        events: [
          { hint: 1, actor: "tool", toolTag: "pytest", payload: { progress: { done: 47 } } },
        ],
      }),
    ).toEqual([]);
  });
});

describe("a change-set report", () => {
  it("allows an empty change-set, which means the run has changed nothing", async () => {
    // The acceptance criterion's other half: a report with no files triggers no guardrail
    // evaluation, because there is no change-set to judge.
    expect(await violations(ReportFilesDto, { idempotencyKey: "k", files: [] })).toEqual([]);
  });

  it.each([
    ["absolute", "/etc/passwd"],
    ["climbing out of the tree", "src/../../secrets.env"],
    ["opening with a climb", "../outside.c"],
  ])("refuses a path that is %s", async (_name, path) => {
    // `run_files_path_is_relative`, and the reason: AO.4's allowed-paths guardrail matches
    // globs against this value, and a path that could climb out of the tree is one a glob
    // cannot reason about.
    expect(
      await violations(ReportFilesDto, {
        idempotencyKey: "k",
        files: [{ path, status: "modified" }],
      }),
    ).toEqual(["files"]);
  });

  it("allows a dotfile and a path with a dot segment that is not a climb", async () => {
    expect(
      await violations(ReportFilesDto, {
        idempotencyKey: "k",
        files: [
          { path: ".github/workflows/ci.yml", status: "modified" },
          { path: "src/v1.2/parser.c", status: "added" },
        ],
      }),
    ).toEqual([]);
  });

  it("refuses a status outside git's four words", async () => {
    expect(
      await violations(ReportFilesDto, {
        idempotencyKey: "k",
        files: [{ path: "a.c", status: "changed" }],
      }),
    ).toEqual(["files"]);
  });

  describe("diff hunks, for the secrets guardrail", () => {
    /** A report carrying one file with the given hunks. */
    const withHunks = (hunks: unknown): Record<string, unknown> => ({
      idempotencyKey: "k",
      files: [{ path: "a.c", status: "modified", additions: 1, hunks }],
    });

    it("accepts hunks in the transcript's three kinds, blank lines included", async () => {
      expect(
        await violations(
          ReportFilesDto,
          withHunks([
            {
              newStart: 12,
              lines: [
                { kind: "ctx", text: "int main(void) {" },
                { kind: "del", text: "  return 1;" },
                { kind: "add", text: "" },
                { kind: "add", text: "  return 0;" },
              ],
            },
          ]),
        ),
      ).toEqual([]);
    });

    it("accepts newStart 0, which is git's own value for a deleted file's hunk", async () => {
      expect(
        await violations(
          ReportFilesDto,
          withHunks([{ newStart: 0, lines: [{ kind: "del", text: "gone" }] }]),
        ),
      ).toEqual([]);
    });

    it.each([
      ["a fourth line kind", [{ newStart: 1, lines: [{ kind: "mod", text: "x" }] }]],
      ["a negative start", [{ newStart: -1, lines: [] }]],
      ["a fractional start", [{ newStart: 1.5, lines: [] }]],
      ["a line with no text", [{ newStart: 1, lines: [{ kind: "add" }] }]],
      ["a line that is not a string", [{ newStart: 1, lines: [{ kind: "add", text: 42 }] }]],
      ["hunks that are not a list", { newStart: 1, lines: [] }],
      [
        "a line longer than the bound",
        [{ newStart: 1, lines: [{ kind: "add", text: "x".repeat(MAX_HUNK_LINE_LENGTH + 1) }] }],
      ],
      [
        "more lines than a hunk may carry",
        [
          {
            newStart: 1,
            lines: Array.from({ length: MAX_LINES_PER_HUNK + 1 }, () => ({
              kind: "ctx",
              text: "",
            })),
          },
        ],
      ],
      [
        "more hunks than a file may carry",
        Array.from({ length: MAX_HUNKS_PER_FILE + 1 }, () => ({ newStart: 1, lines: [] })),
      ],
    ])("refuses %s", async (_name, hunks) => {
      expect(await violations(ReportFilesDto, withHunks(hunks))).toEqual(["files"]);
    });

    it("refuses a field a hunk does not define — a matched value has nowhere to ride", async () => {
      expect(
        await violations(
          ReportFilesDto,
          withHunks([{ newStart: 1, lines: [{ kind: "add", text: "x", secret: "y" }] }]),
        ),
      ).toEqual(["files"]);
    });
  });
});

describe("a commit report", () => {
  it.each([
    ["too short", "a41c9e"],
    ["too long", "a".repeat(41)],
    ["upper-case", "A41C9E2"],
    ["not hex", "zzzzzzz"],
  ])("refuses a sha that is %s", async (_name, sha) => {
    expect(
      await violations(ReportCommitsDto, {
        idempotencyKey: "k",
        commits: [{ sha, message: "m", committedAt: "2026-09-22T14:30:12.000Z" }],
      }),
    ).toEqual(["commits"]);
  });

  it("requires the commit's own clock", async () => {
    // Deliberately not defaulted to the report's arrival: V047 keeps `committed_at` and
    // `reported_at` apart so the gap between them is legible as ingestion lag.
    expect(
      await violations(ReportCommitsDto, {
        idempotencyKey: "k",
        commits: [{ sha: "a41c9e2", message: "m" }],
      }),
    ).toEqual(["commits"]);
  });
});

describe("a resource report", () => {
  it("allows a report that is only a reservation", async () => {
    // A run holds a build job before it has spent anything on one; requiring a zero-token row
    // to say so would put a row in the ledger that never happened.
    expect(
      await violations(ReportResourcesDto, {
        idempotencyKey: "k",
        reservedBuildJob: "5eed0008-0000-4000-8000-000000000483",
      }),
    ).toEqual([]);
  });

  it("allows a null reservation, which is how a run releases one", async () => {
    // Three states rather than two: a uuid takes, `null` releases, absent says nothing.
    expect(
      await violations(ReportResourcesDto, { idempotencyKey: "k", reservedBuildJob: null }),
    ).toEqual([]);
  });

  it.each([
    ["negative", "-1"],
    ["too precise", "1.00001"],
    ["not a number", "$1.14"],
  ])("refuses a cost that is %s", async (_name, costCents) => {
    expect(
      await violations(ReportResourcesDto, {
        idempotencyKey: "k",
        spend: { provider: "anthropic", model: "m", tokensIn: 1, tokensOut: 1, costCents },
      }),
    ).toEqual(["spend"]);
  });

  it("allows an absent cost, which is the unpriced case", async () => {
    // Decisions M7 and N10: a model with no price in the catalog yields a count and no money.
    expect(
      await violations(ReportResourcesDto, {
        idempotencyKey: "k",
        spend: { provider: "ollama", model: "qwen3-coder:32b", tokensIn: 10, tokensOut: 2 },
      }),
    ).toEqual([]);
  });
});

describe("the run in the path", () => {
  it("admits a uuid and refuses anything else, naming the field", async () => {
    // A validated class rather than `ParseUUIDPipe`, so a malformed id is the same `422` as
    // every other wrong-shaped request on this surface rather than a `400`.
    expect(await violations(RunIdParams, { id: "5eed0009-0000-4000-8000-000000000482" })).toEqual(
      [],
    );
    expect(await violations(RunIdParams, { id: "482" })).toEqual(["id"]);
  });
});
