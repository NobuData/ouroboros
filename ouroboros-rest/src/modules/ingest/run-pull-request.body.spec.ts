import {
  NO_BUILD_SENTENCE,
  NO_CRITERIA_SENTENCE,
  PULL_REQUEST_BODY_OPENING,
  composePullRequestBody,
  runConsoleUrl,
  type PullRequestBodyFacts,
  type PullRequestBodyStage,
} from "./run-pull-request.body";

/** The draft PR's description (DI.3, #1311): composed from rows, in a fixed order, honest. */

const RUN = "5eed0051-0000-4000-8000-000000000002";

/** One passed attempt. */
function stage(
  stageKey: string,
  label: string,
  position: number,
  overrides: Partial<PullRequestBodyStage> = {},
): PullRequestBodyStage {
  return {
    stageKey,
    label,
    position,
    attempt: 1,
    status: "succeeded",
    returnedFromStageKey: null,
    returnReason: null,
    ...overrides,
  };
}

const FACTS: PullRequestBodyFacts = {
  uiUrl: "https://ouro.example/",
  run: {
    id: RUN,
    loopSeq: 12,
    workflowTag: "live-slice",
    workflowVersion: 1,
    model: "slice-coder",
  },
  issue: { number: 1, title: "Greet the user by name" },
  stages: [stage("plan", "Plan", 1), stage("code", "Code", 2)],
  claims: ["Says hello to the named user", 'Falls back to "world"'],
  build: null,
  spend: { costCents: "94", unpricedEvents: 0, tokens: 12_400 },
};

/** The body's lines. */
function lines(facts: PullRequestBodyFacts): string[] {
  return composePullRequestBody(facts).split("\n");
}

/** The lines of one `## ` section, without blanks. */
function section(facts: PullRequestBodyFacts, heading: string): string[] {
  const all = lines(facts);
  const start = all.indexOf(`## ${heading}`);
  const end = all.findIndex((line, index) => index > start && line.startsWith("## "));

  expect(start).toBeGreaterThan(-1);

  return all.slice(start + 1, end === -1 ? undefined : end).filter((line) => line !== "");
}

describe("the draft pull request's body", () => {
  it("composes the whole body in the documented order", () => {
    expect(composePullRequestBody(FACTS)).toBe(
      [
        "Opened by an Ouroboros loop under dry-run policy. This is a draft: nothing merges on its own.",
        "",
        `Run: [Loop #12](https://ouro.example/runs/${RUN}) · workflow live-slice@v1 · model alias: slice-coder`,
        "",
        "## Summary",
        "",
        "Greet the user by name",
        "",
        "Stages passed: Plan → Code.",
        "Correction rounds: none.",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] Says hello to the named user — unverified, no evidence yet",
        '- [ ] Falls back to "world" — unverified, no evidence yet',
        "",
        "## Build",
        "",
        "Build: none ran for this run.",
        "",
        `[Run console](https://ouro.example/runs/${RUN})`,
        "",
        "## Cost",
        "",
        "$0.94 · 12,400 tokens",
        "",
        "Refs #1",
      ].join("\n"),
    );
  });

  it("opens with the dry-run sentence and ends with Refs — never a closing keyword", () => {
    const body = lines(FACTS);

    expect(body[0]).toBe(PULL_REQUEST_BODY_OPENING);
    expect(body.at(-1)).toBe("Refs #1");
    expect(composePullRequestBody(FACTS)).not.toMatch(
      /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i,
    );
  });

  it("names the workflow without a version when the run had no pin", () => {
    expect(lines({ ...FACTS, run: { ...FACTS.run, workflowVersion: null } })[2]).toContain(
      "· workflow live-slice ·",
    );
  });

  it("counts attempts above one, and lists only stages that passed, in workflow order", () => {
    const facts = {
      ...FACTS,
      stages: [
        stage("review", "Review", 3),
        stage("code", "Code", 2, { attempt: 1, status: "failed" }),
        stage("plan", "Plan", 1),
        stage("code", "Code", 2, { attempt: 2, status: "failed" }),
        stage("code", "Code", 2, { attempt: 3 }),
        stage("ship", "Ship", 4, { status: "active" }),
      ],
    } satisfies PullRequestBodyFacts;

    expect(section(facts, "Summary")[1]).toBe("Stages passed: Plan → Code (3 attempts) → Review.");
  });

  it("says when no stage has passed", () => {
    expect(section({ ...FACTS, stages: [] }, "Summary")[1]).toBe("Stages passed: none recorded.");
  });

  it("lists every correction round, in order, with its reason", () => {
    const facts = {
      ...FACTS,
      stages: [
        stage("plan", "Plan", 1),
        stage("code", "Code", 2),
        stage("review", "Review", 3, { status: "failed" }),
        stage("code", "Code", 2, {
          attempt: 2,
          returnedFromStageKey: "review",
          returnReason: "failed_review",
        }),
        stage("review", "Review", 3, { attempt: 2, status: "failed" }),
        stage("code", "Code", 2, { attempt: 3, returnedFromStageKey: "gone", returnReason: null }),
        stage("review", "Review", 3, { attempt: 3 }),
      ],
    } satisfies PullRequestBodyFacts;

    expect(section(facts, "Summary")).toEqual([
      "Greet the user by name",
      "Stages passed: Plan → Code (3 attempts) → Review (3 attempts).",
      "Correction rounds: 2 — Review returned to Code (failed review); gone returned to Code.",
    ]);
  });

  it("says no criteria were imported when the plan stated none", () => {
    expect(section({ ...FACTS, claims: [] }, "Acceptance criteria")).toEqual([
      NO_CRITERIA_SENTENCE,
    ]);
  });

  it("keeps each claim on its own line", () => {
    expect(section({ ...FACTS, claims: ["Two\nlines  here"] }, "Acceptance criteria")).toEqual([
      "- [ ] Two lines here — unverified, no evidence yet",
    ]);
  });

  it("prints the latest farm job, and still links the console", () => {
    expect(
      section(
        {
          ...FACTS,
          build: { number: 41, pool: "linux-x64", status: "succeeded", exitCode: 0 },
        },
        "Build",
      ),
    ).toEqual([
      "farm job #41 · linux-x64 · succeeded · exit 0",
      `[Run console](https://ouro.example/runs/${RUN})`,
    ]);
  });

  it("leaves the exit code out while the job has none", () => {
    expect(
      section(
        { ...FACTS, build: { number: 7, pool: "arm64", status: "running", exitCode: null } },
        "Build",
      )[0],
    ).toBe("farm job #7 · arm64 · running");
  });

  it("says no build ran, with the console link, when none did", () => {
    expect(section(FACTS, "Build")).toEqual([
      NO_BUILD_SENTENCE,
      `[Run console](https://ouro.example/runs/${RUN})`,
    ]);
  });

  it.each<[string, PullRequestBodyFacts["spend"], string]>([
    [
      "a priced run",
      { costCents: "1234", unpricedEvents: 0, tokens: 1_000_000 },
      "$12.34 · 1,000,000 tokens",
    ],
    ["a numeric sum", { costCents: 5, unpricedEvents: 0, tokens: 1 }, "$0.05 · 1 token"],
    [
      "an unpriced run",
      { costCents: null, unpricedEvents: 4, tokens: 1_200 },
      "not priced · 1,200 tokens",
    ],
    [
      "a run with no usage",
      { costCents: null, unpricedEvents: 0, tokens: 0 },
      "not priced · 0 tokens",
    ],
    [
      "a partly priced run",
      { costCents: "40", unpricedEvents: 3, tokens: 9_000 },
      "at least $0.40 (3 usage events not priced) · 9,000 tokens",
    ],
    [
      "one unpriced event",
      { costCents: "40", unpricedEvents: 1, tokens: 9_000 },
      "at least $0.40 (1 usage event not priced) · 9,000 tokens",
    ],
  ])("prints the cost of %s honestly — never $0 for unpriced usage", (_name, spend, line) => {
    expect(section({ ...FACTS, spend }, "Cost")[0]).toBe(line);
  });

  it("never prints $0.00 for a run whose usage has no price", () => {
    expect(
      composePullRequestBody({
        ...FACTS,
        spend: { costCents: null, unpricedEvents: 2, tokens: 5 },
      }),
    ).not.toContain("$0");
  });

  it("builds the console link without a doubled slash", () => {
    expect(runConsoleUrl("https://ouro.example///", RUN)).toBe(`https://ouro.example/runs/${RUN}`);
    expect(runConsoleUrl("http://localhost:3000", RUN)).toBe(`http://localhost:3000/runs/${RUN}`);
  });

  it("is pure: the same facts give the same body", () => {
    expect(composePullRequestBody(FACTS)).toBe(composePullRequestBody(structuredClone(FACTS)));
  });
});
