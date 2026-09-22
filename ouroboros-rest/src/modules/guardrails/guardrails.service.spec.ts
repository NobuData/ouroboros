import { Logger } from "@nestjs/common";

import { recordingDatabase } from "../db/database.fixture";
import type { GuardrailRequest } from "../ingest/ingest.guardrails";
import { readFixture } from "../workflows/dsl.golden.fixture";
import type { GuardrailVerdictRow } from "./guardrails.checks";
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
    appendVerdicts: jest.fn(
      (
        _writer: unknown,
        _run: string,
        policyRef: number | null,
        verdicts: readonly GuardrailVerdictRow[],
      ) => {
        appended.push({ policyRef, verdicts });

        return Promise.resolve();
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
