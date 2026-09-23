import { describe, expect, it } from "vitest";

import {
  CHECK_TEXT,
  FARM_DOT,
  FARM_STATE,
  MARK,
  MERGE_TAG,
  MINUS,
  UNKNOWN,
  changesView,
  commitSource,
  commitUrl,
  costRow,
  evidenceLines,
  farmRow,
  guardrailPill,
  guardrailsView,
  lowerBoundNote,
  resourcesView,
  secretsDisclosure,
  tokenFigure,
  tokensRow,
} from "@/app/runs/cards";

import { SEEDED_SECRETS, guardrailCheck, runConsole, seededChecks, seededCommits } from "../helpers/runs";

/**
 * The right column's rules (#313), without rendering: the seeded cards against the mockup, and
 * every honesty rule the issue names — unpriced is never `$0`, no budget is no meter, no
 * reservation is no row, the pill is computed, and a commit links only where its source can.
 */

/** The seeded payloads. */
const SEED = runConsole();

describe("changes so far", () => {
  it("matches the mockup: three files with their counts, two commits, the squash tag", () => {
    const view = changesView(SEED.changes, commitSource(SEED.head.repository));

    expect(view.countLabel).toBe("3 files");
    expect(view.files.map((file) => [file.path, file.additions, file.deletions])).toEqual([
      ["drivers/can/telemetry_buf.c", "+38", `${MINUS}12`],
      ["drivers/can/isr_fastpath.c", "+9", `${MINUS}3`],
      ["tests/telemetry/test_frame_order.c", "+21", `${MINUS}0`],
    ]);
    expect(view.commits.map((commit) => [commit.shortSha, commit.subject])).toEqual([
      ["a41c9e2", "can: replace telemetry k_fifo with k_msgq + frame seq"],
      ["7f03b8d", "can: assign frame seq in ISR before enqueue"],
    ]);
    expect(view.mergeTag).toBe("will squash on merge");
  });

  it("prints a real minus, not a hyphen", () => {
    expect(MINUS).toBe("−");
  });

  it("sums the totals from the rows drawn, never from the stored aggregate", () => {
    const view = changesView(
      { ...SEED.changes, totals: { files: 99, additions: 9999, deletions: 9999 } },
      null,
    );

    expect(view.countLabel).toBe("3 files");
    expect(view.totalsLabel).toBe(`+68 ${MINUS}15 across 3 files`);
  });

  it("says one file, not one files", () => {
    const view = changesView({ ...SEED.changes, files: SEED.changes.files.slice(0, 1) }, null);

    expect(view.countLabel).toBe("1 file");
  });

  it("names each row for a screen reader, since the counts are drawn apart from the path", () => {
    const view = changesView(SEED.changes, null);

    expect(view.files[0]!.accessibleName).toBe("drivers/can/telemetry_buf.c, 38 added, 12 removed");
  });

  it("has a tag for every merge strategy, and none when the terminal opens no pull request", () => {
    expect(changesView({ ...SEED.changes, mergeStrategy: "rebase" }, null).mergeTag).toBe(MERGE_TAG.rebase);
    expect(changesView({ ...SEED.changes, mergeStrategy: "merge" }, null).mergeTag).toBe(MERGE_TAG.merge);
    expect(changesView({ ...SEED.changes, mergeStrategy: null }, null).mergeTag).toBeNull();
  });

  it("keys two rows that repeat a path apart", () => {
    const [first] = SEED.changes.files;
    const view = changesView({ ...SEED.changes, files: [first!, first!] }, null);

    expect(new Set(view.files.map((file) => file.key)).size).toBe(2);
  });

  it("keys two commits that share an abbreviation apart", () => {
    const [first] = seededCommits();
    const view = changesView({ ...SEED.changes, commits: [first!, first!] }, null);

    expect(new Set(view.commits.map((commit) => commit.key)).size).toBe(2);
  });
});

describe("commit links", () => {
  const SHA = "a41c9e2f0b7d3c5e8a1f6b2d4c9e7a3f5b8d1c0e";

  it("link a GitHub repository's commit by its full sha", () => {
    expect(commitUrl(commitSource({ owner: "acme", name: "helios-firmware" }), SHA)).toBe(
      `https://github.com/acme/helios-firmware/commit/${SHA}`,
    );
  });

  it("link a GitLab project, subgroups included, on gitlab.com", () => {
    expect(commitUrl({ kind: "gitlab", path: "acme/firmware/helios" }, SHA)).toBe(
      `https://gitlab.com/acme/firmware/helios/-/commit/${SHA}`,
    );
  });

  it("link a self-managed GitLab instance, with no doubled slash", () => {
    expect(commitUrl({ kind: "gitlab", path: "acme/helios", baseUrl: "https://git.acme.dev/" }, SHA)).toBe(
      `https://git.acme.dev/acme/helios/-/commit/${SHA}`,
    );
  });

  it("link a Bitbucket repository", () => {
    expect(commitUrl({ kind: "bitbucket", workspace: "acme", name: "helios" }, SHA)).toBe(
      `https://bitbucket.org/acme/helios/commits/${SHA}`,
    );
  });

  it("encode every segment", () => {
    expect(commitUrl({ kind: "github", owner: "a b", name: "c?d" }, SHA)).toBe(
      `https://github.com/a%20b/c%3Fd/commit/${SHA}`,
    );
    expect(commitUrl({ kind: "gitlab", path: "a b/c#d" }, SHA)).toBe(
      `https://gitlab.com/a%20b/c%23d/-/commit/${SHA}`,
    );
  });

  it("are unlinked when there is no source to build one from", () => {
    expect(commitSource(undefined)).toBeNull();
    expect(commitUrl(null, SHA)).toBeNull();
    expect(changesView(SEED.changes, null).commits.every((commit) => commit.href === null)).toBe(true);
  });

  it("are unlinked for a sha that is not a commit's name", () => {
    const source = commitSource({ owner: "acme", name: "helios" });

    expect(commitUrl(source, "../../settings")).toBeNull();
    expect(commitUrl(source, "abc12")).toBeNull();
    expect(commitUrl(source, "")).toBeNull();
    expect(commitUrl(source, "a".repeat(65))).toBeNull();
  });

  it("are unlinked for a source whose parts make no path", () => {
    expect(commitUrl({ kind: "github", owner: "", name: "x" }, SHA)).toBeNull();
    expect(commitUrl({ kind: "bitbucket", workspace: "acme", name: "" }, SHA)).toBeNull();
    expect(commitUrl({ kind: "gitlab", path: "acme/../admin" }, SHA)).toBeNull();
    expect(commitUrl({ kind: "gitlab", path: "acme//helios" }, SHA)).toBeNull();
  });

  it("refuse a base that is not a web address — never a javascript: link", () => {
    expect(commitUrl({ kind: "gitlab", path: "a/b", baseUrl: "javascript:alert(1)//" }, SHA)).toBeNull();
    expect(commitUrl({ kind: "gitlab", path: "a/b", baseUrl: "not a url" }, SHA)).toBeNull();
  });
});

describe("resources", () => {
  it("matches the mockup: both meters at its fills, forge-02 reserved", () => {
    const view = resourcesView(SEED.resources);

    expect(view.tokens).toEqual({ figure: "212k / 400k budget", note: null, fraction: 0.53, tone: "accent" });
    expect(view.cost).toEqual({ figure: "$1.14 / $2.50 cap", note: null, fraction: 0.456, tone: "accent" });
    expect(view.farm).toEqual({ figure: "forge-02 reserved", dot: "idle" });
  });

  it("drops only a whole .0 from a token figure", () => {
    expect(tokenFigure(212_000)).toBe("212k");
    expect(tokenFigure(212_345)).toBe("212.3k");
    expect(tokenFigure(1_000_000)).toBe("1M");
    expect(tokenFigure(850)).toBe("850");
  });

  describe("tokens", () => {
    it("are a count with no meter when no budget is pinned", () => {
      expect(tokensRow({ ...SEED.resources.tokens, budget: null })).toEqual({
        figure: "212k tokens",
        note: null,
        fraction: null,
        tone: "accent",
      });
    });

    it("warn near the budget, and fill — never overflow — past it", () => {
      expect(tokensRow({ ...SEED.resources.tokens, used: 360_000 }).tone).toBe("warn");

      const over = tokensRow({ ...SEED.resources.tokens, used: 500_000 });
      expect(over.fraction).toBe(1);
      expect(over.tone).toBe("err");
    });

    it("read a zero budget as full once anything is used", () => {
      expect(tokensRow({ ...SEED.resources.tokens, budget: 0 }).fraction).toBe(1);
      expect(tokensRow({ ...SEED.resources.tokens, used: 0, budget: 0 }).fraction).toBe(0);
    });
  });

  describe("cost", () => {
    it("is never $0 for missing rates: an em-dash and the token count", () => {
      const row = costRow({ ...SEED.resources.cost, costCents: null, unpricedEvents: 7 }, SEED.resources.tokens);

      expect(row).toEqual({ figure: `${UNKNOWN} · 212k tokens`, note: null, fraction: null, tone: "accent" });
      expect(row.figure).not.toMatch(/\$/);
    });

    it("is unpriced, not zero, for a cost string that is not a number", () => {
      expect(costRow({ ...SEED.resources.cost, costCents: "n/a" }, SEED.resources.tokens).figure).toBe(
        `${UNKNOWN} · 212k tokens`,
      );
    });

    it("prints a real zero as money — a priced call that cost nothing is free", () => {
      expect(costRow({ ...SEED.resources.cost, costCents: "0.0000" }, SEED.resources.tokens).figure).toBe(
        "$0.00 / $2.50 cap",
      );
    });

    it("is money alone, with no meter, when no cap applies", () => {
      expect(costRow({ ...SEED.resources.cost, capCents: null }, SEED.resources.tokens)).toEqual({
        figure: "$1.14",
        note: null,
        fraction: null,
        tone: "accent",
      });
    });

    it("says it is a lower bound when some calls were not priced", () => {
      const row = costRow({ ...SEED.resources.cost, unpricedEvents: 3 }, SEED.resources.tokens);

      expect(row.note).toBe("lower bound — 3 calls unpriced");
      expect(lowerBoundNote(1)).toBe("lower bound — 1 call unpriced");
    });

    it("turns err at the cap", () => {
      expect(costRow({ ...SEED.resources.cost, costCents: "260" }, SEED.resources.tokens).tone).toBe("err");
    });
  });

  describe("the farm row", () => {
    it("is omitted entirely when the run holds no reservation", () => {
      expect(farmRow(undefined)).toBeNull();
      expect(resourcesView({ ...SEED.resources, farm: undefined }).farm).toBeNull();
    });

    it("names the job while no runner has taken it — never a runner nobody held", () => {
      expect(farmRow({ ...SEED.resources.farm!, runnerName: null })).toEqual({ figure: "job #12 reserved", dot: "idle" });
    });

    it("has a word and a dot for every job state, lit only while building", () => {
      for (const status of Object.keys(FARM_STATE) as (keyof typeof FARM_STATE)[]) {
        expect(farmRow({ ...SEED.resources.farm!, jobStatus: status })).toEqual({
          figure: `forge-02 ${FARM_STATE[status]}`,
          dot: FARM_DOT[status],
        });
      }
      expect(FARM_DOT.running).toBe("live");
      expect(FARM_DOT.queued).toBe("idle");
    });
  });
});

describe("guardrails", () => {
  it("matches the mockup: three ticks, a ○ with its caption, the clean pill, the footer", () => {
    const view = guardrailsView(SEED.guardrails);

    expect(view.pill).toEqual({ label: "clean", tone: "ok", dot: "filled" });
    expect(view.rows.map((row) => [row.glyph, row.tone, row.text, row.caption])).toEqual([
      ["✓", "ok", "Diff confined to allowed paths", null],
      ["✓", "ok", "No CI config touched", null],
      ["✓", "ok", "Secrets scan clean", null],
      ["○", "idle", "Human review not required", "(auto-merge eligible)"],
    ]);
    expect(view.policy).toBe("Policy: standard-fix v14 · tenant acme-robotics");
  });

  describe("the pill is computed from the verdicts", () => {
    it("ignores the payload's status — no static clean", () => {
      const view = guardrailsView({
        ...SEED.guardrails,
        status: "clean",
        checks: [guardrailCheck("secrets", "fail")],
      });

      expect(view.pill.label).toBe("violations");
    });

    it("is violations on any fail, whatever else is pending", () => {
      expect(
        guardrailPill([guardrailCheck("allowed_paths", "pending"), guardrailCheck("secrets", "fail")]),
      ).toEqual({ label: "violations", tone: "err", dot: "filled" });
    });

    it("is pending while any check has not answered", () => {
      expect(guardrailPill([guardrailCheck("allowed_paths", "pass"), guardrailCheck("secrets", "pending")]).label).toBe(
        "pending",
      );
    });

    it("is not evaluated — not clean — with no verdicts at all", () => {
      expect(guardrailPill([])).toEqual({ label: "not evaluated", tone: "neutral", dot: "ring" });
    });

    it("is clean when every check passed or did not apply", () => {
      expect(guardrailPill(seededChecks()).label).toBe("clean");
    });
  });

  it("opens a failure's evidence: path and line, rule id — and nothing else", () => {
    const view = guardrailsView({
      ...SEED.guardrails,
      checks: [
        guardrailCheck("secrets", "fail", {
          path: "drivers/can/config.c",
          line: 42,
          rule_id: "aws-access-key-id",
          detail: "1 finding in 1 file.",
        }),
      ],
    });
    const [row] = view.rows;

    expect(row!.glyph).toBe("✗");
    expect(row!.tone).toBe("err");
    expect(row!.expanded).toBe(true);
    expect(row!.evidence).toEqual([
      { term: "Path", value: "drivers/can/config.c:42", mono: true },
      { term: "Rule", value: "aws-access-key-id", mono: true },
      { term: "Detail", value: "1 finding in 1 file.", mono: false },
    ]);
  });

  it("keeps the evidence of a verdict that did not fail closed", () => {
    const view = guardrailsView({
      ...SEED.guardrails,
      checks: [guardrailCheck("secrets", "not_applicable", { detail: "No diff hunks were reported." })],
    });

    expect(view.rows[0]!.expanded).toBe(false);
    expect(view.rows[0]!.evidence).toHaveLength(1);
  });

  it("orders evidence where, which rule, which scope, why — and a path with no line alone", () => {
    expect(evidenceLines({ detail: "d", glob: "drivers/can/**", path: "a.c" })).toEqual([
      { term: "Path", value: "a.c", mono: true },
      { term: "Glob", value: "drivers/can/**", mono: true },
      { term: "Detail", value: "d", mono: false },
    ]);
    expect(evidenceLines(undefined)).toEqual([]);
  });

  it("puts the ruleset's recall limitation on the secrets row, and only there", () => {
    const view = guardrailsView(SEED.guardrails);
    const secrets = view.rows.find((row) => row.key === "secrets")!;

    expect(secrets.disclosure).toContain("not that the diff holds no secrets");
    expect(secrets.disclosure).toContain("not detected");
    expect(view.rows.filter((row) => row.disclosure !== null)).toHaveLength(1);
  });

  it("draws no disclosure the service did not state", () => {
    expect(secretsDisclosure({ ...SEEDED_SECRETS, summary: " ", limitation: "" })).toBeNull();
  });

  it("has a sentence for every check under every verdict, and a ○ never reads as a pass", () => {
    for (const check of Object.keys(CHECK_TEXT) as (keyof typeof CHECK_TEXT)[]) {
      for (const verdict of Object.keys(MARK) as (keyof typeof MARK)[]) {
        expect(CHECK_TEXT[check][verdict].text.length).toBeGreaterThan(0);
      }
      expect(CHECK_TEXT[check].not_applicable.text).not.toBe(CHECK_TEXT[check].pass.text);
    }
    expect(MARK.not_applicable.glyph).toBe("○");
  });

  it("names each row with its verdict for a screen reader", () => {
    expect(guardrailsView(SEED.guardrails).rows[3]!.accessibleName).toBe(
      "Human review not required: not applicable",
    );
  });

  it("says the policy's workflow without a version when nothing was pinned", () => {
    const view = guardrailsView({
      ...SEED.guardrails,
      policy: { workflowTag: "standard-fix", workflowVersion: null, tenant: "acme" },
    });

    expect(view.policy).toBe("Policy: standard-fix · tenant acme");
  });
});
