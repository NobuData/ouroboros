import { Logger } from "@nestjs/common";

import { recordingDatabase } from "../db/database.fixture";
import type { GuardrailRequest } from "../ingest/ingest.guardrails";
import { readFixture } from "../workflows/dsl.golden.fixture";
import type { GuardrailExceptionGrant, GuardrailVerdictRow } from "./guardrails.checks";
import { AWS_ACCESS_KEY_ID } from "./guardrails.fixture";
import type { GuardrailsRepository, RunPolicyRow, TicketFacts } from "./guardrails.repository";
import { SECRETS_RULESET_DISCLOSURE } from "./guardrails.ruleset";
import { GuardrailService } from "./guardrails.service";

/**
 * The service: what it reads, what it hands the checks, what it appends and what it answers —
 * over a stubbed repository, so each input can be varied alone.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const POLICY: RunPolicyRow = {
  organizationId: "org-acme",
  githubRepoId: "repo-1",
  issueNumber: 482,
  workflowTag: "standard-fix",
  workflowVersionPin: 14,
};

/** A repository whose answers a test sets, and which remembers what was appended. */
function stubRepository(
  overrides: {
    policy?: RunPolicyRow | undefined;
    definition?: unknown;
    stages?: string[];
    ticket?: TicketFacts;
    rules?: Awaited<ReturnType<GuardrailsRepository["enabledRules"]>>;
    protectedPaths?: string[];
    exceptions?: GuardrailExceptionGrant[];
    consumes?: boolean;
    recorded?: { changeSetSeq: number; paths: string[] } | undefined;
  } = {},
) {
  const appended: { policyRef: number | null; verdicts: readonly GuardrailVerdictRow[] }[] = [];
  const repository = {
    runPolicy: jest.fn(() => Promise.resolve("policy" in overrides ? overrides.policy : POLICY)),
    pinnedDefinition: jest.fn(() =>
      Promise.resolve(
        "definition" in overrides && overrides.definition === undefined
          ? undefined
          : { definition: overrides.definition ?? readFixture("valid/standard-fix.json") },
      ),
    ),
    reportedStages: jest.fn(() => Promise.resolve(overrides.stages ?? ["implement"])),
    ticketFacts: jest.fn(() =>
      Promise.resolve(
        overrides.ticket ?? { labels: [], planFiles: ["drivers/can/a.c"], effort: "m" },
      ),
    ),
    enabledRules: jest.fn(() => Promise.resolve(overrides.rules ?? [])),
    protectedPaths: jest.fn((_writer: unknown, _run: RunPolicyRow) =>
      Promise.resolve(overrides.protectedPaths ?? []),
    ),
    liveExceptions: jest.fn(() => Promise.resolve(overrides.exceptions ?? [])),
    recordedChangeSet: jest.fn(() =>
      Promise.resolve(
        "recorded" in overrides
          ? overrides.recorded
          : { changeSetSeq: 3, paths: ["boot/rollback_flag.c"] },
      ),
    ),
    consumeException: jest.fn(() => Promise.resolve(overrides.consumes ?? true)),
    appendVerdicts: jest.fn(
      (
        _writer: unknown,
        _run: string,
        policyRef: number | null,
        verdicts: readonly GuardrailVerdictRow[],
      ) => {
        appended.push({ policyRef, verdicts });

        return Promise.resolve(
          new Map(verdicts.map((row) => [row.check, `evaluation-${row.check}`])),
        );
      },
    ),
  };

  return { repository: repository as unknown as GuardrailsRepository, spy: repository, appended };
}

/** A report of the given files. */
function request(changeSet: GuardrailRequest["changeSet"]): GuardrailRequest {
  return { runId: RUN, changeSetSeq: 2, files: changeSet.length, changeSet };
}

const CLEAN = request([
  { path: "drivers/can/a.c", hunks: [{ newStart: 1, lines: [{ kind: "add", text: "int x;" }] }] },
]);

describe("GuardrailService", () => {
  const writer = recordingDatabase().service.db;
  let quiet: jest.SpyInstance;

  // The evaluation's summary line is debug output; silenced here so the suite prints nothing,
  // and captured explicitly by the one test that is about what gets logged.
  beforeEach(() => {
    quiet = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => quiet.mockRestore());

  it("judges a clean change-set as the mockup's card, pinned to the run's version", async () => {
    const { repository, appended } = stubRepository();

    const outcome = await new GuardrailService(repository).evaluate(writer, CLEAN);

    expect(outcome).toEqual({ checks: 4, failures: [] });
    expect(appended[0].policyRef).toBe(14);
    expect(appended[0].verdicts.map((row) => row.verdict)).toEqual([
      "pass",
      "pass",
      "pass",
      "not_applicable",
    ]);
  });

  it("goes through the writer it was given for every statement", async () => {
    const { repository, spy } = stubRepository();

    await new GuardrailService(repository).evaluate(writer, CLEAN);

    for (const method of [
      spy.runPolicy,
      spy.pinnedDefinition,
      spy.reportedStages,
      spy.protectedPaths,
      spy.appendVerdicts,
    ]) {
      expect(method.mock.calls[0][0]).toBe(writer);
    }
  });

  it("fails secrets for a planted key and keeps the key out of the rows, the answer and the log", async () => {
    const { repository, appended } = stubRepository();
    const logged: string[] = [];
    const spies = (["log", "debug", "warn", "error", "verbose"] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const outcome = await new GuardrailService(repository).evaluate(
      writer,
      request([
        {
          path: "drivers/can/keys.h",
          hunks: [
            { newStart: 41, lines: [{ kind: "add", text: `#define K "${AWS_ACCESS_KEY_ID}"` }] },
          ],
        },
      ]),
    );

    spies.forEach((spy) => spy.mockRestore());

    expect(outcome.failures).toEqual(["secrets"]);
    expect(appended[0].verdicts[2].evidence).toEqual({
      path: "drivers/can/keys.h",
      line: 41,
      rule_id: "aws-access-key-id",
      detail: "1 finding in 1 file.",
    });
    expect(logged.length).toBeGreaterThan(0);

    for (const trace of [JSON.stringify(appended), JSON.stringify(outcome), logged.join("\n")]) {
      expect(trace).not.toContain(AWS_ACCESS_KEY_ID);
    }
  });

  it("fails review_required when a vote rule applies to the ticket and the pin auto-merges", async () => {
    const { repository } = stubRepository({
      ticket: { labels: ["security"] },
      rules: [
        {
          when: { label: "security" },
          then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
        },
      ],
    });

    const outcome = await new GuardrailService(repository).evaluate(writer, CLEAN);

    expect(outcome.failures).toEqual(["review_required"]);
  });

  it("fails allowed_paths when the change touches the repository's protected path (#380)", async () => {
    const { repository, appended, spy } = stubRepository({
      ticket: { labels: [], planFiles: ["keys/signing.pem"], effort: "s" },
      protectedPaths: ["boot/**", "keys/**"],
    });

    const outcome = await new GuardrailService(repository).evaluate(
      writer,
      request([{ path: "keys/signing.pem" }]),
    );

    expect(spy.protectedPaths.mock.calls[0][1]).toBe(POLICY);
    expect(outcome.failures).toEqual(["allowed_paths"]);
    expect(appended[0].verdicts[0].evidence).toEqual({
      path: "keys/signing.pem",
      glob: "keys/**",
      detail: "1 path inside a protected path.",
    });
  });

  describe("allow-once grants (#459)", () => {
    const GRANT: GuardrailExceptionGrant = { id: "grant-1851", pathGlob: "keys/signing.pem" };

    it("passes allowed_paths on a live grant and consumes it against that verdict's row", async () => {
      const { repository, appended, spy } = stubRepository({
        ticket: { labels: [], planFiles: ["keys/signing.pem"], effort: "s" },
        protectedPaths: ["keys/**"],
        exceptions: [GRANT],
      });

      const outcome = await new GuardrailService(repository).evaluate(
        writer,
        request([{ path: "keys/signing.pem" }]),
      );

      expect(spy.liveExceptions.mock.calls[0].slice(1)).toEqual([POLICY, RUN]);
      expect(outcome.failures).not.toContain("allowed_paths");
      expect(appended[0].verdicts[0]).toMatchObject({
        check: "allowed_paths",
        verdict: "pass",
        evidence: { detail: "1 protected path allowed once by exception." },
      });
      expect(spy.consumeException.mock.calls).toEqual([
        [writer, "grant-1851", "evaluation-allowed_paths"],
      ]);
    });

    it("consumes nothing when the verdict fails anyway, so the grant survives for the retry", async () => {
      const { repository, spy } = stubRepository({
        ticket: { labels: [], planFiles: ["keys/signing.pem"], effort: "s" },
        protectedPaths: ["keys/**"],
        exceptions: [GRANT],
      });

      const outcome = await new GuardrailService(repository).evaluate(
        writer,
        request([{ path: "keys/signing.pem" }, { path: "drivers/spi/bus.c" }]),
      );

      expect(outcome.failures).toContain("allowed_paths");
      expect(spy.consumeException).not.toHaveBeenCalled();
    });

    it("fails the report rather than keep a pass when the grant cannot be consumed", async () => {
      const { repository } = stubRepository({
        ticket: { labels: [], planFiles: ["keys/signing.pem"], effort: "s" },
        protectedPaths: ["keys/**"],
        exceptions: [GRANT],
        consumes: false,
      });

      await expect(
        new GuardrailService(repository).evaluate(writer, request([{ path: "keys/signing.pem" }])),
      ).rejects.toThrow("allow-once grant grant-1851 could not be consumed");
    });
  });

  it("answers honestly when the pin cannot be found", async () => {
    const { repository, appended } = stubRepository({ definition: undefined });

    const outcome = await new GuardrailService(repository).evaluate(writer, CLEAN);

    expect(appended[0].verdicts.map((row) => [row.check, row.verdict])).toEqual([
      ["allowed_paths", "pass"],
      ["ci_config", "not_applicable"],
      ["secrets", "pass"],
      ["review_required", "fail"],
    ]);
    expect(outcome.failures).toEqual(["review_required"]);
  });

  it("does not look a pin up for a run that has none", async () => {
    const { repository, spy } = stubRepository({ policy: { ...POLICY, workflowVersionPin: null } });

    await new GuardrailService(repository).evaluate(writer, CLEAN);

    expect(spy.pinnedDefinition).not.toHaveBeenCalled();
  });

  it("writes nothing for a run that does not exist", async () => {
    const { repository, spy } = stubRepository({ policy: undefined });

    expect(await new GuardrailService(repository).evaluate(writer, CLEAN)).toEqual({
      checks: 0,
      failures: [],
    });
    expect(spy.appendVerdicts).not.toHaveBeenCalled();
  });

  it("exposes the secrets ruleset's disclosure for the card's tooltip", () => {
    expect(new GuardrailService(stubRepository().repository).disclosure()).toBe(
      SECRETS_RULESET_DISCLOSURE,
    );
  });
});

describe("GuardrailService.reevaluatePaths (BN.2, #462)", () => {
  const writer = recordingDatabase().service.db;
  const PROTECTED = {
    protectedPaths: ["boot/**"],
    ticket: { labels: [], planFiles: ["boot/rollback_flag.c"], effort: "m" },
  };

  it("answers nothing for a run that is gone or has reported no change-set", async () => {
    const gone = stubRepository({ policy: undefined });
    const unreported = stubRepository({ recorded: undefined });

    await expect(
      new GuardrailService(gone.repository).reevaluatePaths(writer, RUN),
    ).resolves.toBeUndefined();
    await expect(
      new GuardrailService(unreported.repository).reevaluatePaths(writer, RUN),
    ).resolves.toBeUndefined();
    expect(unreported.appended).toHaveLength(0);
  });

  it("re-judges allowed_paths alone, over the recorded change-set, at its number", async () => {
    const { repository, appended, spy } = stubRepository(PROTECTED);

    const outcome = await new GuardrailService(repository).reevaluatePaths(writer, RUN);

    expect(outcome).toEqual({
      evaluationId: "evaluation-allowed_paths",
      verdict: "fail",
      changeSetSeq: 3,
      grantsSpent: [],
    });
    // One row, never the secrets check: its hunks were never stored, and a not_applicable written
    // now would hide a real failure behind a later row.
    expect(appended).toHaveLength(1);
    expect(appended[0].verdicts.map((row) => [row.check, row.changeSetSeq])).toEqual([
      ["allowed_paths", 3],
    ]);
    expect(spy.recordedChangeSet).toHaveBeenCalledWith(writer, RUN);
  });

  it("passes with a grant that covers the protected path, and consumes it", async () => {
    const { repository, spy } = stubRepository({
      ...PROTECTED,
      exceptions: [{ id: "grant-1", pathGlob: "boot/rollback_flag.c" }],
    });

    const outcome = await new GuardrailService(repository).reevaluatePaths(writer, RUN);

    expect(outcome?.verdict).toBe("pass");
    expect(outcome?.grantsSpent).toEqual(["grant-1"]);
    expect(spy.consumeException).toHaveBeenCalledWith(
      writer,
      "grant-1",
      "evaluation-allowed_paths",
    );
  });

  it("fails rather than keep a pass nothing paid for", async () => {
    const { repository } = stubRepository({
      ...PROTECTED,
      exceptions: [{ id: "grant-1", pathGlob: "boot/rollback_flag.c" }],
      consumes: false,
    });

    await expect(new GuardrailService(repository).reevaluatePaths(writer, RUN)).rejects.toThrow(
      "allow-once grant grant-1 could not be consumed",
    );
  });
});
