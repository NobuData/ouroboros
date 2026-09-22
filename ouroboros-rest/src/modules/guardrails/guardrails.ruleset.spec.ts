import {
  ALNUM,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_VALUE,
  DATADOG_VALUE,
  GITHUB_PAT,
  HEX,
  PRIVATE_KEY_HEADER,
  SLACK_BOT_TOKEN,
  STRIPE_SECRET_KEY,
  URLSAFE,
  filler,
} from "./guardrails.fixture";
import {
  SECRETS_RULESET_DISCLOSURE,
  SECRETS_RULESET_VERSION,
  SECRET_RULES,
  isCandidateValue,
} from "./guardrails.ruleset";
import { scanChangeSet } from "./guardrails.secrets";

/**
 * The embedded ruleset (option 3-A) — its shape, its disclosure, and a sample of its formats.
 *
 * The structural assertions hold for every rule, because the failure they prevent is a rule
 * whose id the database would refuse: V048 holds `rule_id` to a lower-case hyphenated grammar,
 * and a refused evidence row is a refused change-set report.
 */

/** Which rules fire on one added line. */
function firing(text: string): string[] {
  return scanChangeSet([
    { path: "a.txt", hunks: [{ newStart: 1, lines: [{ kind: "add", text }] }] },
  ]).findings.map((finding) => finding.ruleId);
}

describe("the ruleset's shape", () => {
  it("is at least the ~150 well-known formats option 3-A budgets", () => {
    expect(SECRET_RULES.length).toBeGreaterThanOrEqual(140);
    expect(SECRET_RULES.length).toBeLessThanOrEqual(220);
  });

  it("names every rule once", () => {
    const ids = SECRET_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SECRET_RULES.map((rule) => [rule.id, rule] as const))(
    "holds %s to V048's rule_id grammar and the evidence token rule",
    (id, rule) => {
      expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).not.toMatch(/[A-Za-z0-9+=]{20,}/);
      expect(rule.pattern.global).toBe(true);
      expect(rule.keywords.length).toBeGreaterThan(0);

      for (const keyword of rule.keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
      }
    },
  );

  it("does not backtrack on a long line with no match", () => {
    // A bounded-quantifier promise, checked the only way it can be: a hostile line — long, and
    // full of every prefix and separator the rules key on, with no complete match — must scan
    // in bounded time.
    const hostile = "postgres://a:b http://x:y sk_live_ ghp_ AKIA password=' ".repeat(300);
    const started = performance.now();

    firing(hostile);

    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("a sample of formats", () => {
  it.each([
    ["aws-access-key-id", `const key = "${AWS_ACCESS_KEY_ID}";`],
    ["github-pat", `token: ${GITHUB_PAT}`],
    ["slack-bot-token", `SLACK=${SLACK_BOT_TOKEN}`],
    ["stripe-secret-key", `Stripe.apiKey = "${STRIPE_SECRET_KEY}";`],
    ["private-key", PRIVATE_KEY_HEADER],
    ["gcp-api-key", `key=${["AI", "za"].join("")}${filler(URLSAFE, 35, 4)}`],
    [
      "npm-access-token",
      `//registry.npmjs.org/:_authToken=${["np", "m_"].join("")}${filler(ALNUM, 36, 8)}`,
    ],
    ["gitlab-pat", `${["glp", "at-"].join("")}${filler(URLSAFE, 20, 6)}`],
    [
      "sendgrid-api-key",
      `${["S", "G."].join("")}${filler(URLSAFE, 22, 1)}.${filler(URLSAFE, 43, 2)}`,
    ],
    ["anthropic-api-key", `${["sk-ant-", "api03-"].join("")}${filler(URLSAFE, 93, 3)}AA`],
    ["digitalocean-pat", `${["dop", "_v1_"].join("")}${filler(HEX, 64, 5)}`],
    ["database-uri-credentials", `DATABASE_URL=postgres://app:${filler(ALNUM, 16, 7)}@db:5432/app`],
    ["generic-password", `db_password = "${filler(ALNUM, 16, 12)}"`],
    ["generic-api-key", `client_secret: '${filler(ALNUM, 24, 14)}'`],
  ])("finds %s", (ruleId, line) => {
    expect(firing(line)).toContain(ruleId);
  });
});

describe("keyword proximity", () => {
  it("fires a signature-less value only when its keyword sits just before it", () => {
    expect(firing(`DATADOG_API_KEY=${DATADOG_VALUE}`)).toContain("datadog-api-key");
    expect(firing(`aws_secret_access_key = ${AWS_SECRET_VALUE}`)).toContain(
      "aws-secret-access-key",
    );
  });

  it("does not fire the same value with no keyword beside it", () => {
    // A 32-hex checksum in a lockfile is the false positive this whole mechanism exists for.
    expect(firing(`"integrity": "${DATADOG_VALUE}"`)).toEqual([]);
  });

  it("does not let a keyword far up the line vouch for a value at its end", () => {
    const far = `datadog ${"x ".repeat(60)}checksum ${DATADOG_VALUE}`;

    expect(firing(far)).not.toContain("datadog-api-key");
  });
});

describe("placeholders", () => {
  it.each([
    ["an interpolation", 'password = "${DB_PASSWORD}"'],
    ["an angle-bracketed hint", 'api_key = "<your-api-key-1>"'],
    ["changeme", 'password = "changeme"'],
    ["a mask", 'token = "xxxxxxxxxxxx"'],
    ["a word with no digit", 'password = "correcthorsebattery"'],
    ["a URI placeholder", "postgres://user:password@localhost:5432/app"],
  ])("does not report %s", (_name, line) => {
    expect(firing(line)).toEqual([]);
  });

  it.each([
    ["changeme", false],
    ["${TOKEN}", false],
    ["{{ secret }}", false],
    ["hunter2hunter2", true],
    ["Zq8vN3kP0wLm", true],
    ["12345678", false],
  ])("judges %s a candidate: %s", (value, candidate) => {
    expect(isCandidateValue(value)).toBe(candidate);
  });
});

describe("the disclosure the card's tooltip renders", () => {
  it("states the version, the count and the recall limit rather than implying certainty", () => {
    expect(SECRETS_RULESET_DISCLOSURE.version).toBe(SECRETS_RULESET_VERSION);
    expect(SECRETS_RULESET_DISCLOSURE.ruleCount).toBe(SECRET_RULES.length);
    expect(SECRETS_RULESET_DISCLOSURE.recallClass).toBe("~70%");
    expect(SECRETS_RULESET_DISCLOSURE.summary).toContain(String(SECRET_RULES.length));
    expect(SECRETS_RULESET_DISCLOSURE.limitation).toMatch(/not that the diff holds no secrets/);
    expect(SECRETS_RULESET_DISCLOSURE.limitation).toMatch(/high-entropy/i);
  });

  it("is v3, the version the card's footer and the seed record", () => {
    expect(SECRETS_RULESET_VERSION).toBe("v3");
  });
});
