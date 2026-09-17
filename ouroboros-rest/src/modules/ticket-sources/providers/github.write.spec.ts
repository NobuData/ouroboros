import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { budgetHeaders, httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { TicketSourceError } from "../ticket-source.errors";
import { dependencyMarkersIn, type TicketDraftInput } from "../ticket-source.write";
import { ISSUES_ROUTE } from "./github.mapping";
import { GithubTicketSourceProvider, asTicketSourceWriteError } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  SOURCE_WORKSPACE,
  recordingFactory,
  syncContext,
} from "./github.provider.fixture";
import {
  ADD_BLOCKED_BY_ROUTE,
  CREATE_ISSUE_ROUTE,
  MILESTONES_ROUTE,
  PROVENANCE_FOOTER,
  SEARCH_ISSUES_ROUTE,
  UPDATE_ISSUE_ROUTE,
  composeBody,
  epicMarker,
  hasMarkerLine,
  issueNumberOf,
  pushKeyMarker,
  pushTarget,
  refOf,
  searchQuery,
} from "./github.write";
import { writeRecording, type WriteRecordingOptions } from "./github.write-recordings.fixture";

/**
 * The GitHub provider's writes, case by case (AL.3, [#279](https://github.com/NobuData/ouroboros/issues/279)).
 *
 * `github.write-conformance.spec.ts` holds the provider to the SPI's contract; this suite pins the
 * GitHub-specific decisions behind it — the marker grammar, the footer, the two-question probe, the
 * capability probe that picks the fallback, and the write-side reading of K.3's failures.
 */

/** A draft keyed the way the push service keys one. */
function draft(overrides: Partial<TicketDraftInput> = {}): TicketDraftInput {
  return {
    idempotencyKey: "b0000000-0000-4000-8000-000000000279:d0000000-0000-4000-8000-000000000001",
    title: "Journal writes before the OTA image is swapped",
    body: "0 of 1,284 builds set this option.",
    labels: [],
    milestone: null,
    ...overrides,
  };
}

/**
 * A provider over a fresh recording.
 *
 * @param options - The recording's setup.
 * @returns Both.
 */
function build(options: WriteRecordingOptions = {}) {
  const github = writeRecording(options);
  const provider = new GithubTicketSourceProvider(
    recordingFactory(github.octokit).factory,
    new GithubRateLimiter(),
  );

  return { github, provider, context: syncContext() };
}

describe("the GitHub write grammar", () => {
  it("writes the push key and the epic id as whole-line HTML comments", () => {
    expect(pushKeyMarker("batch-1:draft-1")).toBe("<!-- ouroboros:push-key batch-1:draft-1 -->");
    expect(epicMarker("e0270000-0000-4000-8000-000000000279")).toBe(
      "<!-- ouroboros:epic e0270000-0000-4000-8000-000000000279 -->",
    );
  });

  it.each([
    ["a blank key", ""],
    ["whitespace, which would split the marker line", "batch 1"],
    ["a double hyphen, which closes the comment", "batch--1"],
    ["a closing bracket", "batch>1"],
    ["a quote, which would break out of the search phrase", 'batch"1'],
    ["a key past the SPI's bound", "k".repeat(129)],
  ])("refuses %s as validation", (_case, key) => {
    expect(() => pushKeyMarker(key)).toThrow(
      expect.objectContaining({ errorClass: "validation" }) as Error,
    );
  });

  it("matches a marker only as a whole line, never quoted mid-sentence", () => {
    const line = pushKeyMarker("batch-1:draft-1");

    expect(hasMarkerLine(`text\n  ${line}  \nmore`, line)).toBe(true);
    expect(hasMarkerLine(`somebody pasted ${line} into a comment`, line)).toBe(false);
    expect(hasMarkerLine(null, line)).toBe(false);
  });

  it("keeps the body verbatim above a rule, the footer and the marker", () => {
    const line = pushKeyMarker("k-1");

    expect(composeBody("0 of 1,284 builds set this option.", line)).toBe(
      `0 of 1,284 builds set this option.\n\n---\n${PROVENANCE_FOOTER}\n\n${line}`,
    );
    expect(composeBody(null, line)).toBe(`---\n${PROVENANCE_FOOTER}\n\n${line}`);
    expect(composeBody("   ", line)).toBe(`---\n${PROVENANCE_FOOTER}\n\n${line}`);
  });

  it("refuses a body that would exceed GitHub's storage with its footer", () => {
    expect(() => composeBody("x".repeat(262_144), pushKeyMarker("k-1"))).toThrow(TicketSourceError);
  });

  it("reads issue numbers strictly", () => {
    expect(issueNumberOf("612", "ref")).toBe(612);

    for (const bad of ["0", "-1", "#612", "612a", "", "01"]) {
      expect(() => issueNumberOf(bad, "ref")).toThrow(TicketSourceError);
    }
  });

  it("answers the identity a sync maps the same issue to", () => {
    expect(
      refOf({ id: 1, number: 612, html_url: "https://github.com/acme-robotics/x/issues/612" }),
    ).toStrictEqual({
      externalId: "612",
      externalKey: "#612",
      url: "https://github.com/acme-robotics/x/issues/612",
    });
    expect(() =>
      refOf({ id: 1, number: 612, html_url: "http://github.com/a/b/issues/612" }),
    ).toThrow(GithubApiError);
  });

  it("pushes into the first enabled repository", () => {
    expect(pushTarget({ login: SOURCE_LOGIN, repos: ["first", "second"] })).toStrictEqual({
      owner: SOURCE_LOGIN,
      repo: "first",
    });
  });

  it("searches for the marker's words, scoped to the repository", () => {
    expect(searchQuery({ owner: "acme", repo: "helios" }, pushKeyMarker("k-1"))).toBe(
      'repo:acme/helios is:issue in:body "ouroboros:push-key k-1"',
    );
  });
});

describe("GithubTicketSourceProvider writes", () => {
  describe("createTicket", () => {
    it("creates an issue with the title, labels, milestone, footer and marker", async () => {
      const { github, provider, context } = build();
      const milestone = await provider.ensureMilestone(context, "Helios 2.1");
      const ref = await provider.createTicket(context, draft({ labels: ["ota"], milestone }));

      expect(ref).toStrictEqual({
        externalId: "1",
        externalKey: "#1",
        url: `https://github.com/${SOURCE_LOGIN}/${SOURCE_REPO}/issues/1`,
      });
      expect(github.issues[0]).toMatchObject({
        title: "Journal writes before the OTA image is swapped",
        labels: ["ota"],
        milestone: 1,
      });
      expect(github.issues[0]?.body).toBe(
        composeBody("0 of 1,284 builds set this option.", pushKeyMarker(draft().idempotencyKey)),
      );
    });

    it("probes before it creates, and answers the existing issue on a retry", async () => {
      const { github, provider, context } = build();

      const first = await provider.createTicket(context, draft());
      const second = await provider.createTicket(context, draft());

      expect(second).toStrictEqual(first);
      expect(github.issues).toHaveLength(1);
      expect(github.calls.filter((call) => call.route === CREATE_ISSUE_ROUTE)).toHaveLength(1);
      // The second call found it among the newest issues and never needed search.
      expect(github.calls.map((call) => call.route).slice(-1)).toStrictEqual([ISSUES_ROUTE]);
    });

    it("reaches for search when the issue has scrolled off the newest page", async () => {
      // A busy repository: the listing answers nothing the probe is looking for.
      const { github, provider, context } = build({ recentPageSize: 0 });

      await provider.createTicket(context, draft());
      await provider.createTicket(context, draft());

      expect(github.issues).toHaveLength(1);
      expect(github.calls.filter((call) => call.route === SEARCH_ISSUES_ROUTE)).toHaveLength(2);
    });

    it("does not mistake an issue quoting the marker for the one carrying it", async () => {
      const { github, provider, context } = build();
      const line = pushKeyMarker(draft().idempotencyKey);

      await provider.createTicket(
        context,
        draft({
          idempotencyKey: "other-key",
          body: `Retrying printed ${line} in the log`,
        }),
      );
      await provider.createTicket(context, draft());

      expect(github.issues).toHaveLength(2);
    });

    it("refuses a blank title and a milestone reference it could not have produced, sending nothing", async () => {
      const { github, provider, context } = build();

      await expect(provider.createTicket(context, draft({ title: "  " }))).rejects.toMatchObject({
        errorClass: "validation",
      });
      await expect(
        provider.createTicket(context, draft({ milestone: { externalRef: "M-1", name: "x" } })),
      ).rejects.toMatchObject({ errorClass: "validation" });
      expect(github.calls).toHaveLength(0);
    });
  });

  describe("linkDependency", () => {
    it("records a native blocked_by relation by the blocker's database id, once", async () => {
      const { github, provider, context } = build();
      const blocker = await provider.createTicket(context, draft({ idempotencyKey: "k-1" }));
      const blocked = await provider.createTicket(context, draft({ idempotencyKey: "k-2" }));

      await expect(provider.linkDependency(context, blocker, blocked)).resolves.toStrictEqual({
        mode: "native",
      });
      await expect(provider.linkDependency(context, blocker, blocked)).resolves.toStrictEqual({
        mode: "native",
      });

      const posts = github.calls.filter((call) => call.route === ADD_BLOCKED_BY_ROUTE);

      expect(posts).toHaveLength(1);
      expect(posts[0]?.params).toMatchObject({ issue_number: 2, issue_id: github.issues[0]?.id });
      expect(github.relations).toStrictEqual([[1, 2]]);
    });

    it("falls back to one body marker when this GitHub has no dependency API, and says so", async () => {
      const { github, provider, context } = build({ nativeDependencies: false });
      const blocker = await provider.createTicket(context, draft({ idempotencyKey: "k-1" }));
      const blocked = await provider.createTicket(context, draft({ idempotencyKey: "k-2" }));

      await expect(provider.linkDependency(context, blocker, blocked)).resolves.toStrictEqual({
        mode: "fallback",
      });
      await expect(provider.linkDependency(context, blocker, blocked)).resolves.toStrictEqual({
        mode: "fallback",
      });

      expect(github.calls.filter((call) => call.route === UPDATE_ISSUE_ROUTE)).toHaveLength(1);
      expect(dependencyMarkersIn(github.issues[1]?.body ?? null)).toStrictEqual(["1"]);
      // The person's words and the footer are still there, above the marker.
      expect(github.issues[1]?.body).toContain("0 of 1,284 builds set this option.");
    });

    it("reads a missing issue as not_found rather than as a missing API", async () => {
      const { provider, context } = build();
      const blocker = await provider.createTicket(context, draft({ idempotencyKey: "k-1" }));
      const ghost = { ...blocker, externalId: "99", externalKey: "#99" };

      await expect(provider.linkDependency(context, blocker, ghost)).rejects.toMatchObject({
        errorClass: "not_found",
      });
    });
  });

  describe("epics and milestones", () => {
    it("finds an existing parent tracking issue rather than creating a second one", async () => {
      const { github, provider, context } = build();
      const epic = {
        epicId: "e0270000-0000-4000-8000-000000000279",
        title: "OTA power-loss safety",
        description: null,
      };

      const first = await provider.ensureEpicContainer(context, epic);

      // A second process, a renamed epic: the id is the key.
      const second = await provider.ensureEpicContainer(context, { ...epic, title: "Renamed" });

      expect(second).toStrictEqual(first);
      expect(first).toStrictEqual({ mapping: "parent_issue", externalRef: "1" });
      expect(github.issues).toHaveLength(1);
    });

    it("links a sub-issue once, and refuses a mirror GitHub could not have produced", async () => {
      const { github, provider, context } = build();
      const mirror = await provider.ensureEpicContainer(context, {
        epicId: "e-1",
        title: "Epic",
        description: null,
      });
      const ticket = await provider.createTicket(context, draft());

      if (mirror === null) {
        throw new Error("GitHub maps epics to parent issues");
      }

      await provider.attachToEpic(context, ticket, mirror);
      await provider.attachToEpic(context, ticket, mirror);

      expect(github.subIssues).toStrictEqual([[1, 2]]);
      await expect(
        provider.attachToEpic(context, ticket, { mapping: "epic", externalRef: "1" }),
      ).rejects.toMatchObject({ errorClass: "validation" });
      await expect(
        provider.attachToEpic(context, ticket, { mapping: "parent_issue", externalRef: "2" }),
      ).rejects.toMatchObject({ errorClass: "validation" });
    });

    it("lists the push target's open milestones, numbered as ensureMilestone answers them", async () => {
      const { github, provider, context } = build();

      await expect(provider.listMilestones(context)).resolves.toStrictEqual([]);

      const ensured = await provider.ensureMilestone(context, "Helios 2.1");

      await expect(provider.listMilestones(context)).resolves.toStrictEqual([ensured]);
      expect(github.calls.some((call) => call.route === MILESTONES_ROUTE)).toBe(true);
    });

    it("names the push target as owner/name — the first enabled repository", () => {
      const { provider, context } = build();

      expect(provider.pushTargetName(context.config)).toMatch(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/);
      expect(() => provider.pushTargetName({ login: "" })).toThrow(TicketSourceError);

      try {
        provider.pushTargetName({ login: "" });
      } catch (error) {
        expect((error as TicketSourceError).errorClass).toBe("not_found");
      }
    });

    it("finds a milestone by title before creating one", async () => {
      const { github, provider, context } = build();

      const first = await provider.ensureMilestone(context, "Helios 2.1");
      const second = await provider.ensureMilestone(context, " Helios 2.1 ");

      expect(second).toStrictEqual(first);
      expect(github.milestones).toStrictEqual([{ number: 1, title: "Helios 2.1" }]);
      await expect(provider.ensureMilestone(context, " ")).rejects.toMatchObject({
        errorClass: "validation",
      });
    });
  });

  describe("failures", () => {
    it("stands the guard down on a rate limit, so the next write is refused before it is sent", async () => {
      const { github, provider, context } = build();

      github.refuse(httpError(403, { ...budgetHeaders({ remaining: 0 }), "retry-after": "900" }));

      await expect(provider.createTicket(context, draft())).rejects.toMatchObject({
        errorClass: "rate_limit",
      });

      github.recover();

      const sent = github.calls.length;

      await expect(provider.createTicket(context, draft())).rejects.toMatchObject({
        errorClass: "rate_limit",
      });
      expect(github.calls).toHaveLength(sent);
    });

    it("refuses a source with no token as auth, sending nothing", async () => {
      const { github, provider } = build();

      await expect(
        provider.createTicket(syncContext({ credentials: null }), draft()),
      ).rejects.toMatchObject({ errorClass: "auth" });
      expect(github.calls).toHaveLength(0);
    });
  });
});

describe("asTicketSourceWriteError", () => {
  const now = new Date("2026-09-16T14:00:00.000Z");

  it.each([
    [401, GITHUB_FAILURES.unauthorized, "auth"],
    [403, GITHUB_FAILURES.unauthorized, "permission"],
    [404, GITHUB_FAILURES.notFound, "not_found"],
    [409, GITHUB_FAILURES.upstreamError, "validation"],
    [422, GITHUB_FAILURES.upstreamError, "validation"],
    [503, GITHUB_FAILURES.upstreamError, "upstream"],
  ] as const)("reads a %s as %s → %s, carrying the status", (status, failure, errorClass) => {
    const error = asTicketSourceWriteError(
      new GithubApiError(failure, "x", undefined, status),
      now,
    );

    expect(error).toMatchObject({ errorClass, httpStatus: status });
  });

  it("reads a rate limit with its resume time and its status", () => {
    const error = asTicketSourceWriteError(
      new GithubApiError(GITHUB_FAILURES.rateLimited, "spent", 1200, 403),
      now,
    );

    expect(error).toMatchObject({
      errorClass: "rate_limit",
      retryAt: new Date("2026-09-16T14:20:00.000Z"),
      httpStatus: 403,
    });
  });

  it("reads the guard's own refusal and a socket failure the read-side way", () => {
    expect(
      asTicketSourceWriteError(new GithubApiError(GITHUB_FAILURES.rateLimited, "guard", 60), now),
    ).toMatchObject({ errorClass: "rate_limit", httpStatus: null });
    expect(asTicketSourceWriteError(new Error("ECONNRESET"), now)).toMatchObject({
      errorClass: "upstream",
    });
  });

  it("passes a TicketSourceError through and redacts a token from GitHub's words", () => {
    const refused = new TicketSourceError("validation", "blank title");

    expect(asTicketSourceWriteError(refused, now)).toBe(refused);
    expect(
      asTicketSourceWriteError(
        new GithubApiError(GITHUB_FAILURES.upstreamError, `echoed ${SOURCE_TOKEN}`, undefined, 422),
        now,
      ).detail,
    ).not.toContain(SOURCE_TOKEN);
  });

  it("keeps the credential out of every refusal a write makes", async () => {
    const { github, provider, context } = build();

    for (const status of [401, 403, 404, 422, 503]) {
      github.refuse(httpError(status, budgetHeaders({ remaining: 4999 })));

      const settled = await provider
        .createTicket(context, draft())
        .catch((error: unknown) => error);

      expect(TicketSourceError.is(settled) && settled.detail.includes(SOURCE_TOKEN)).toBe(false);
    }

    expect(SOURCE_WORKSPACE).toBe(context.organizationId);
  });
});
