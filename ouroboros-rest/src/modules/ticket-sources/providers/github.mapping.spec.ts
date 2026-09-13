import { TicketSourceError } from "../ticket-source.errors";
import {
  MAX_AUTHOR_LENGTH,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  isPullRequest,
  mapGithubIssue,
  repoOf,
} from "./github.mapping";
import { issuePayload, pullRequestPayload } from "./github.provider.fixture";

/**
 * `mapTicket`'s half of the provider, exercised with no network and no client
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)).
 *
 * This is the suite the SPI put `mapTicket` on the interface *for*: *"it is the half of a
 * provider that a recorded fixture can exercise with no network at all"*, and Q.5's conformance
 * kit ([#142](https://github.com/NobuData/ouroboros/issues/142)) asserts mapping completeness
 * through the same member.
 *
 * The bounds asserted below are **V030's**, not K.4's. `github_issues` bounds a body at
 * GitHub's 64 KiB and holds an author to GitHub's login grammar; `tickets` does neither, on
 * purpose, and a mapper that carried K.4's rules here would refuse rows this table accepts.
 */

/**
 * Map a payload and return the refusal it produced.
 *
 * @param raw - The payload.
 * @returns The error thrown.
 */
function refusal(raw: unknown): TicketSourceError {
  try {
    mapGithubIssue(raw);
  } catch (error) {
    return error as TicketSourceError;
  }

  throw new Error("mapGithubIssue accepted a payload it should have refused");
}

describe("mapping a GitHub issue", () => {
  it("produces the canonical row, field for field", () => {
    expect(mapGithubIssue(issuePayload())).toStrictEqual({
      externalId: "485",
      externalKey: "#485",
      externalUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
      title: "Watchdog timer resets during I2C bus recovery",
      body: "The watchdog fires while the bus is recovered.",
      state: "open",
      labels: ["bug", "i2c"],
      author: "field-support",
      sourceCreatedAt: new Date("2026-09-10T09:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-09-11T09:00:00.000Z"),
      meta: { github: { owner: "acme-robotics", repo: "helios-firmware" } },
    });
  });

  it("keeps identity and display form apart, even where they differ by one character", () => {
    // GitHub is the tracker that *hides* this distinction, which is exactly why it is asserted
    // here: `485` is what the API takes and what the upsert keys on, `#485` is what a cell
    // renders. A single column would have had to be one or the other.
    const ticket = mapGithubIssue(issuePayload({ number: 1042 }));

    expect(ticket.externalId).toBe("1042");
    expect(ticket.externalKey).toBe("#1042");
  });

  it("carries the repository into meta, namespaced by kind", () => {
    // §3 of docs/TICKET_SOURCES.md: nothing enforces the namespace, and it is what keeps a
    // later per-kind filter from colliding with another provider's key of the same name.
    const ticket = mapGithubIssue(issuePayload({ repo: "atlas-scheduler" }));

    expect(ticket.meta).toStrictEqual({
      github: { owner: "acme-robotics", repo: "atlas-scheduler" },
    });
  });

  it("reads the repository out of the payload rather than out of the walk that fetched it", () => {
    // The reason `mapTicket` takes one argument: a recorded fixture has to produce the whole
    // row, `meta` included.
    expect(
      repoOf("https://ghe.acme-robotics.net/acme-robotics/helios-firmware/issues/7"),
    ).toStrictEqual({ owner: "acme-robotics", repo: "helios-firmware" });
  });

  it("maps a closed issue onto the canonical `closed`, which is the same word", () => {
    // The collapse is an identity for GitHub. Providers whose workflow states are richer than
    // two are the ones with a decision to make.
    expect(mapGithubIssue(issuePayload({ state: "closed" })).state).toBe("closed");
  });

  it("renders a missing description as null rather than as an empty string", () => {
    // `null` means *the tracker did not say*. An issue opened with no description and one whose
    // description is the empty string are different facts, and only one of them is possible.
    expect(mapGithubIssue(issuePayload({ body: null })).body).toBeNull();
  });

  it("renders a deleted author as no attribution rather than as a name nobody holds", () => {
    expect(mapGithubIssue(issuePayload({ user: null })).author).toBeNull();
  });

  it("accepts an author GitHub's own login grammar would refuse, because the column does", () => {
    // `tickets_author_present` carries no grammar — deliberately, per V030's column comment.
    // K.4's mirror refuses this login; this mapper must not, or the canonical table silently
    // loses rows to a constraint that is not its own.
    expect(mapGithubIssue(issuePayload({ user: { login: "renovate[bot]" } })).author).toBe(
      "renovate[bot]",
    );
  });

  it("accepts a body longer than github_issues allows, for the same reason", () => {
    // V030: the bound is a storage-sanity number that "must never be the reason a ticket a
    // provider legitimately returned cannot be stored". K.4's is GitHub's 64 KiB.
    const body = "x".repeat(70_000);

    expect(mapGithubIssue(issuePayload({ body }))?.body).toHaveLength(70_000);
  });

  it("accepts labels as bare strings, which is the shape a webhook delivery carries", () => {
    const ticket = mapGithubIssue({ ...issuePayload(), labels: ["bug", "i2c", "watchdog"] });

    expect(ticket.labels).toStrictEqual(["bug", "i2c", "watchdog"]);
  });

  it("trims a title, because a blank one is refused and ' ' is blank", () => {
    expect(mapGithubIssue(issuePayload({ title: "  Watchdog resets  " })).title).toBe(
      "Watchdog resets",
    );
  });

  describe("refuses a payload it cannot represent, as upstream", () => {
    it.each([
      ["a pull request, which is not a ticket", pullRequestPayload()],
      ["not an object", "#485"],
      ["no number", { ...issuePayload(), number: undefined }],
      ["a state GitHub does not have", { ...issuePayload(), state: "merged" }],
      ["a blank title", issuePayload({ title: "   " })],
      ["a title past the column", issuePayload({ title: "x".repeat(MAX_TITLE_LENGTH + 1) })],
      ["a body past the column", issuePayload({ body: "x".repeat(MAX_BODY_LENGTH + 1) })],
      [
        "an author past the column",
        issuePayload({ user: { login: "x".repeat(MAX_AUTHOR_LENGTH + 1) } }),
      ],
      ["a label past the column", issuePayload({ labels: [{ name: "x".repeat(256) }] })],
      ["a timestamp that is not a date", issuePayload({ updated_at: "the other day" })],
      ["an update before the open", issuePayload({ updated_at: "2026-09-09T09:00:00Z" })],
      ["a url that is not https", { ...issuePayload(), html_url: "javascript:alert(1)" }],
      ["a url that is not an issue's", { ...issuePayload(), html_url: "https://github.com/acme/" }],
    ])("%s", (_case, raw) => {
      // `upstream` for every one: the payload came from the tracker, so a payload this mapper
      // cannot read is the tracker answering in a way this build does not understand.
      expect(refusal(raw).errorClass).toBe("upstream");
    });

    it("more labels than the column holds", () => {
      const labels = Array.from({ length: 101 }, (_unused, i) => ({ name: `label-${String(i)}` }));

      expect(refusal(issuePayload({ labels })).errorClass).toBe("upstream");
    });

    it("without putting the issue's own text in the message", () => {
      // A detail reaches a log. An issue body is somebody's text and a log is not where it
      // belongs — and a `detail` that quoted a payload is the shortest path to a log that
      // quotes a request header too.
      const secretish = "please do not copy me into a log line";

      expect(refusal(issuePayload({ title: `  `, body: secretish })).detail).not.toContain(
        secretish,
      );
    });
  });

  describe("telling an issue from a pull request", () => {
    it("says yes to the endpoint's pull requests", () => {
      // The only discriminator GitHub offers: the presence of the key. There is no type field.
      expect(isPullRequest(pullRequestPayload())).toBe(true);
    });

    it("says no to an issue", () => {
      expect(isPullRequest(issuePayload())).toBe(false);
    });

    it("says no to a payload whose pull_request is explicitly absent", () => {
      expect(isPullRequest({ ...issuePayload(), pull_request: undefined })).toBe(false);
    });

    it("says no to something that is not an object", () => {
      expect(isPullRequest(null)).toBe(false);
      expect(isPullRequest("#485")).toBe(false);
    });
  });
});
