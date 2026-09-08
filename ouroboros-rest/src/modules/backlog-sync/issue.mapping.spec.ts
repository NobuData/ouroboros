import { issuePayload, pullRequestPayload } from "./backlog-sync.fixture";
import {
  MAX_BODY_LENGTH,
  MAX_LABELS,
  MAX_TITLE_LENGTH,
  cursorInstant,
  cursorOf,
  readPayload,
} from "./issue.mapping";

/**
 * What may become a row, and what may not.
 *
 * Two acceptance criteria live in this file. **Pull requests are excluded** — the first one,
 * and the reason it is first is that a PR in the backlog table is a bug a user sees before
 * anything else. And *"cold import lands **all** open issues"*, which is the same rule read
 * from the other side: everything that is not a pull request and *can* be represented must
 * become a row, so every rejection below is a payload the database would have refused anyway.
 *
 * The rejections are asserted as reasons rather than as throws. A poll walks a page of these
 * and one unusable payload must cost one issue, not the repository's whole cycle.
 */

describe("reading GitHub's issue payload", () => {
  it("maps an issue onto the columns the mirror holds", () => {
    const read = readPayload(issuePayload());

    expect(read).toEqual({
      kind: "issue",
      issue: {
        number: 485,
        title: "Watchdog reset on I²C bus lockup",
        body: "Unit 07 in the Fremont pilot rebooted 14 times.",
        state: "open",
        labels: ["bug", "i2c", "watchdog"],
        authorLogin: "field-support",
        ghCreatedAt: new Date("2026-09-06T10:00:00Z"),
        ghUpdatedAt: new Date("2026-09-08T07:00:00Z"),
        ghUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
      },
    });
  });

  it("ignores fields GitHub adds, rather than refusing the payload", () => {
    // `/issues` grows fields routinely — reactions, timeline urls, sub-issue counts. A mirror
    // that rejected one would turn a GitHub release into an outage here.
    const read = readPayload({
      ...issuePayload(),
      reactions: { "+1": 3 },
      state_reason: "reopened",
      sub_issues_summary: { total: 2 },
    });

    expect(read.kind).toBe("issue");
  });

  it("accepts a bare string label beside GitHub's label objects", () => {
    const read = readPayload(issuePayload({ labels: ["bug", { name: "i2c" }] }));

    expect(read).toMatchObject({ issue: { labels: ["bug", "i2c"] } });
  });

  it("keeps the label order, because the tags render in it", () => {
    const read = readPayload(issuePayload({ labels: [{ name: "z" }, { name: "a" }] }));

    expect(read).toMatchObject({ issue: { labels: ["z", "a"] } });
  });

  it("keeps the author's case — a mirror does not fold", () => {
    const read = readPayload(issuePayload({ login: "Field-Support" }));

    expect(read).toMatchObject({ issue: { authorLogin: "Field-Support" } });
  });

  it("stores a GitHub App's [bot] login rather than dropping the issue", () => {
    // V028's reason: Renovate's dependency dashboard and everything a workflow files are
    // issues a backlog must hold, and V014's original rule — GitHub's *organisation* login
    // rule — refused every one of them.
    const read = readPayload(issuePayload({ login: "dependabot[bot]" }));

    expect(read).toMatchObject({ issue: { authorLogin: "dependabot[bot]" } });
  });

  it("reads a deleted author as no attribution, which is GitHub's own null", () => {
    const read = readPayload(issuePayload({ login: null }));

    expect(read).toMatchObject({ issue: { authorLogin: null } });
  });

  it("keeps an empty body distinct from a missing one", () => {
    // GitHub draws the distinction, so the mirror does: `""` is a description somebody
    // cleared, `null` is an issue opened without one.
    expect(readPayload(issuePayload({ body: "" }))).toMatchObject({ issue: { body: "" } });
    expect(readPayload(issuePayload({ body: null }))).toMatchObject({ issue: { body: null } });
  });

  it("reads a closed issue, because a poll is how a close arrives", () => {
    const read = readPayload(issuePayload({ state: "closed" }));

    expect(read).toMatchObject({ issue: { state: "closed" } });
  });
});

describe("pull requests", () => {
  it("are dropped, whatever the pull_request key holds", () => {
    expect(readPayload(pullRequestPayload()).kind).toBe("pull_request");
    expect(readPayload(issuePayload({ pullRequest: {} })).kind).toBe("pull_request");
    expect(readPayload(issuePayload({ pullRequest: null })).kind).toBe("pull_request");
  });

  it("are recognised before any other rule can reject them for the wrong reason", () => {
    // A PR whose payload is *also* unusable must still read as a pull request: `unusable` is
    // logged and counted as a problem, and a pull request is neither.
    const read = readPayload(pullRequestPayload({ title: "   " }));

    expect(read.kind).toBe("pull_request");
  });
});

describe("payloads that cannot become a row", () => {
  /**
   * The reason a payload was refused.
   *
   * @param payload - What to read.
   * @returns The reason, or `undefined` when the payload was usable — which fails the
   *   assertion that called this, and says so.
   */
  function reason(payload: unknown): string | undefined {
    const read = readPayload(payload);

    return read.kind === "unusable" ? read.reason : undefined;
  }

  it("refuses something that is not an issue at all", () => {
    // A proxy's error page, an older build, an empty body. The contract is parsed rather than
    // asserted precisely so this is a counted skip and not an `undefined` three layers on.
    expect(reason({ message: "Bad gateway" })).toContain("does not match the issues contract");
    expect(reason(null)).toContain("does not match the issues contract");
    expect(reason("nope")).toContain("does not match the issues contract");
  });

  it("refuses a blank title, which the column refuses too", () => {
    expect(reason(issuePayload({ title: "   " }))).toContain("blank title");
  });

  it("refuses a title past the column's bound", () => {
    expect(reason(issuePayload({ title: "x".repeat(MAX_TITLE_LENGTH + 1) }))).toContain(
      "title past",
    );
  });

  it("refuses a body past GitHub's own limit", () => {
    expect(reason(issuePayload({ body: "x".repeat(MAX_BODY_LENGTH + 1) }))).toContain("body past");
  });

  it("refuses more labels than GitHub permits on one issue", () => {
    const labels = Array.from({ length: MAX_LABELS + 1 }, (_, index) => ({
      name: `label-${String(index)}`,
    }));

    expect(reason(issuePayload({ labels }))).toContain("label this mirror cannot store");
  });

  it("refuses a nameless label rather than quietly dropping it", () => {
    // Dropping it would change which chips an issue renders, and the chip-set is a filter
    // people trust to be complete.
    expect(reason(issuePayload({ labels: [{ name: "bug" }, {}] }))).toContain(
      "label this mirror cannot store",
    );
    expect(reason(issuePayload({ labels: [{ name: "" }] }))).toContain(
      "label this mirror cannot store",
    );
  });

  it("refuses an author login the column could not hold, rather than storing null", () => {
    // Null means *GitHub returned no user*. Writing it for an author who is right there would
    // make the mirror say something false — decision K3 forbids exactly that.
    expect(reason(issuePayload({ login: "field support" }))).toContain("author login");
    expect(reason(issuePayload({ login: "-leading-hyphen" }))).toContain("author login");
    expect(reason(issuePayload({ login: "a".repeat(45) }))).toContain("author login");
  });

  it("refuses a URL that is not an https link", () => {
    // The safety rule: this value becomes an href, and an href is a place a scheme executes.
    expect(reason(issuePayload({ url: "javascript:alert(1)" }))).toContain("https link");
    expect(reason(issuePayload({ url: "http://github.com/a/b/issues/1" }))).toContain("https link");
    expect(reason(issuePayload({ url: " https://github.com/a/b/issues/1" }))).toContain(
      "https link",
    );
  });

  it("refuses a userinfo trick, because the host class cannot reach the @", () => {
    expect(reason(issuePayload({ url: "https://github.com@evil.example/a/b/issues/1" }))).toContain(
      "https link",
    );
  });

  it("accepts a GitHub Enterprise Server URL, which is why the rule is about the scheme", () => {
    const read = readPayload(
      issuePayload({ url: "https://git.internal.example:8443/eng/helios/issues/485" }),
    );

    expect(read.kind).toBe("issue");
  });

  it("refuses a timestamp that is not a date", () => {
    expect(reason(issuePayload({ updatedAt: "not a date" }))).toContain("not a date");
  });

  it("refuses an issue updated before it was opened", () => {
    // GitHub never produces this pair; a mapping that swapped the two fields does, and it
    // would poison the watermark drawn from the second.
    expect(
      reason(
        issuePayload({ createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" }),
      ),
    ).toContain("updated before it was opened");
  });

  it("names the issue number, so a log line points somewhere", () => {
    expect(reason(issuePayload({ number: 491, title: "" }))).toContain("#491");
  });

  it("quotes no content, because an issue body is somebody's text", () => {
    const secret = "Unit 07 in the Fremont pilot";
    const refused = reason(issuePayload({ body: secret, title: "" }));

    expect(refused).not.toContain(secret);
  });
});

describe("the cursor", () => {
  it("round-trips an instant through the format GitHub's `since` documents", () => {
    const at = new Date("2026-09-08T07:00:00.000Z");

    expect(cursorOf(at)).toBe("2026-09-08T07:00:00.000Z");
    expect(cursorInstant(cursorOf(at))?.getTime()).toBe(at.getTime());
  });

  it("reads a stored value that is not a timestamp as absent", () => {
    // A corrupted column is not a reason to send GitHub something it will refuse — the poll
    // falls back to an initial import, which is correct and merely more expensive.
    expect(cursorInstant("not a cursor")).toBeUndefined();
    expect(cursorInstant("")).toBeUndefined();
  });
});
