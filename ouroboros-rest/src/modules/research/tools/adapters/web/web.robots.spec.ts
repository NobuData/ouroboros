import { ALLOW_ALL, DISALLOW_ALL, parseRobots, robotsAllows } from "./web.robots";

describe("robots.txt", () => {
  it("reads the reader's own group over *, case-insensitively, merging repeated groups", () => {
    const policy = parseRobots(`
User-agent: *
Disallow: /

User-agent: ouroborosresearch
Disallow: /private/
Crawl-delay: 3

User-agent: OuroborosResearch
Allow: /private/press/
`);

    expect(policy.crawlDelaySeconds).toBe(3);
    expect(robotsAllows(policy, "/articles/a")).toEqual({ allowed: true, rule: null });
    expect(robotsAllows(policy, "/private/pricing")).toEqual({
      allowed: false,
      rule: "Disallow: /private/",
    });
    expect(robotsAllows(policy, "/private/press/kit")).toEqual({
      allowed: true,
      rule: "Allow: /private/press/",
    });
  });

  it("falls back to *, and allows everything when no group applies", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /tmp\n"), "/tmp/x").allowed).toBe(
      false,
    );
    expect(parseRobots("User-agent: googlebot\nDisallow: /\n")).toEqual(ALLOW_ALL);
    expect(parseRobots("")).toEqual(ALLOW_ALL);
  });

  it("lets the longest match win, and allow win a tie", () => {
    const policy = parseRobots(
      "User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /c\nAllow: /c\n",
    );

    expect(robotsAllows(policy, "/a/b/c").allowed).toBe(true);
    expect(robotsAllows(policy, "/a/x").allowed).toBe(false);
    expect(robotsAllows(policy, "/c").allowed).toBe(true);
  });

  it("matches * and an anchoring $, and percent-encodings case-insensitively", () => {
    const policy = parseRobots(
      "User-agent: *\nDisallow: /*.json$\nDisallow: /search?*q=\nDisallow: /caf%c3%a9\n",
    );

    expect(robotsAllows(policy, "/data/x.json").allowed).toBe(false);
    expect(robotsAllows(policy, "/data/x.json?y=1").allowed).toBe(true);
    expect(robotsAllows(policy, "/search?lang=en&q=dock").allowed).toBe(false);
    expect(robotsAllows(policy, "/caf%C3%A9/menu").allowed).toBe(false);
  });

  it("ignores comments, an empty disallow and lines before any group", () => {
    const policy = parseRobots(
      "Disallow: /early\n# a comment\nUser-agent: * # everyone\nDisallow:\n",
    );

    expect(policy.rules).toEqual([]);
    expect(robotsAllows(policy, "/early").allowed).toBe(true);
  });

  it("disallows everything under DISALLOW_ALL", () => {
    expect(robotsAllows(DISALLOW_ALL, "/").allowed).toBe(false);
    expect(robotsAllows(DISALLOW_ALL, "/anything").allowed).toBe(false);
  });
});
