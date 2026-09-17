import {
  CONTRACT_BODY_MAX,
  CONTRACT_LABEL_MAX,
  CONTRACT_LABELS_MAX,
  CONTRACT_REPO_MAX,
  CONTRACT_TITLE_MAX,
  ticketIssueContext,
  ticketNumber,
  ticketRepo,
  type EstimableTicketRow,
} from "./estimation.ticket";

/**
 * A canonical ticket as the estimation contract's `issue` (AL.5, #281).
 *
 * Every case is a ticket V030 lets exist, and every assertion is that the request stays inside the
 * engine's `IssueContext` — a derivation that could leave it would fail that ticket's estimate on
 * every night forever.
 */

/** The contract's `repo` pattern, verbatim from `ouroboros-engine/openapi.yaml`. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * A ticket, seeded `#588` unless told otherwise.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
function ticket(overrides: Partial<EstimableTicketRow> = {}): EstimableTicketRow {
  return {
    ticketId: "5eed001d-0000-4000-8000-000000000588",
    organizationId: "org-acme",
    externalKey: "#588",
    title: "Compress telemetry frames with heatshrink",
    body: "Frames are 40% of upload volume.",
    labels: ["telemetry", "enhancement"],
    meta: { github: { owner: "acme-robotics", repo: "helios-telemetry" } },
    sourceKind: "github",
    sourceName: "GitHub · acme-robotics",
    ...overrides,
  };
}

describe("the number a ticket is sized as", () => {
  it.each([
    ["#588", 588],
    ["PROJ-142", 142],
    ["ENG-7", 7],
    ["42", 42],
    ["#12a", 12],
  ])("reads %s as %d", (key, number) => {
    expect(ticketNumber(key)).toBe(number);
  });

  it.each([
    ["a key with no number", "ROADMAP"],
    ["a zero", "#0"],
    ["a number too large to be exact", "#99999999999999999999"],
  ])("falls back to 1 for %s, which the contract's minimum still accepts", (_what, key) => {
    expect(ticketNumber(key)).toBe(1);
  });
});

describe("the repository a ticket is sized as", () => {
  it("is the GitHub ticket's own repository", () => {
    expect(ticketRepo(ticket())).toBe("acme-robotics/helios-telemetry");
  });

  it("names the source for a tracker with no repository", () => {
    const repo = ticketRepo(
      ticket({ meta: { jira: { project: "HEL" } }, sourceKind: "jira", sourceName: "Acme · Jira" }),
    );

    expect(repo).toBe("jira/Acme-Jira");
    expect(repo).toMatch(REPO_PATTERN);
  });

  it.each([
    ["no meta at all", null],
    ["meta that is not an object", "github"],
    ["a GitHub entry missing its repo", { github: { owner: "acme" } }],
    ["a GitHub owner the pattern refuses", { github: { owner: "acme robotics", repo: "x" } }],
    [
      "a GitHub pair too long for the contract",
      { github: { owner: "a".repeat(100), repo: "b".repeat(100) } },
    ],
  ])("falls back to the source for %s", (_what, meta) => {
    const repo = ticketRepo(ticket({ meta }));

    expect(repo).toBe("github/GitHub-acme-robotics");
    expect(repo).toMatch(REPO_PATTERN);
  });

  it("stays inside the pattern and the length for any source name", () => {
    for (const sourceName of ["···", "", "x".repeat(500), "Linear — Platform team ✨"]) {
      const repo = ticketRepo(ticket({ meta: {}, sourceKind: "linear", sourceName }));

      expect(repo).toMatch(REPO_PATTERN);
      expect(repo.length).toBeLessThanOrEqual(CONTRACT_REPO_MAX);
    }
  });
});

describe("a ticket as the contract's issue", () => {
  it("carries the ticket's own words", () => {
    expect(ticketIssueContext(ticket())).toEqual({
      number: 588,
      title: "Compress telemetry frames with heatshrink",
      body: "Frames are 40% of upload volume.",
      labels: ["telemetry", "enhancement"],
      repo: "acme-robotics/helios-telemetry",
    });
  });

  it("keeps a null body null", () => {
    expect(ticketIssueContext(ticket({ body: null })).body).toBeNull();
  });

  it("cuts a title and a body to the contract's bounds rather than refusing them", () => {
    const issue = ticketIssueContext(
      ticket({ title: "t".repeat(512), body: "b".repeat(CONTRACT_BODY_MAX + 10) }),
    );

    expect(issue.title).toHaveLength(CONTRACT_TITLE_MAX);
    expect(issue.body).toHaveLength(CONTRACT_BODY_MAX);
  });

  it("drops labels the contract would refuse, and keeps at most the contract's count", () => {
    const labels = [
      " ",
      "x".repeat(CONTRACT_LABEL_MAX + 1),
      "ok",
      ...Array.from({ length: 150 }, (_, i) => `l${String(i)}`),
    ];
    const issue = ticketIssueContext(ticket({ labels }));

    expect(issue.labels[0]).toBe("ok");
    expect(issue.labels).toHaveLength(CONTRACT_LABELS_MAX);
    expect(issue.labels.every((label) => label.length <= CONTRACT_LABEL_MAX)).toBe(true);
  });
});
