import { Logger } from "@nestjs/common";

import type { DatabaseService } from "../db/db.service";
import type { MergedChange, SweepAnchor } from "./facts.repository";
import { FactsService } from "./facts.service";
import { FactStore } from "./facts.store.fixture";
import {
  anchorSince,
  sameRepository,
  staleFlags,
  staleReason,
  FactSweepService,
} from "./facts.sweep";

/**
 * The staleness sweep (#411, K4): the seeded Zephyr 4.0 → 4.1 story flags the right fact and
 * records which anchor matched, a path glob fires on a matching change and not on another,
 * anchor-less facts are never flagged (and are counted), repository scope and the confirmation
 * window hold, the sync hook stamps nothing, and every pass is idempotent.
 */

const ORG = "acme-robotics";
const HELIOS = "acme-robotics/helios-firmware";

/** The mockup's move, as `diffExcerptOf` samples west.yml. */
const ZEPHYR_BUMP = [
  "--- west.yml",
  "@@ -10,7 +10,7 @@ manifest:",
  "     - name: zephyr",
  "       remote: zephyrproject-rtos",
  "-      revision: v4.0.0",
  "+      revision: v4.1.0",
].join("\n");

describe("the staleness sweep's rules", () => {
  const anchor = (overrides: Partial<SweepAnchor> = {}): SweepAnchor => ({
    organizationId: ORG,
    factId: "fact-1",
    repoRef: null,
    confirmedAt: new Date("2026-09-01T00:00:00Z"),
    anchorId: "anchor-1",
    kind: "path_glob",
    value: "tests/hil/**",
    lastCheckedAt: null,
    ...overrides,
  });
  const change = (overrides: Partial<MergedChange> = {}): MergedChange => ({
    prId: "pr-1",
    number: 531,
    repoRef: HELIOS,
    mergedAt: new Date("2026-09-10T00:00:00Z"),
    paths: ["tests/hil/rig.py"],
    diffExcerpt: null,
    ...overrides,
  });

  it("counts a change from the later of confirmation and last check", () => {
    const confirmedAt = new Date("2026-09-01T00:00:00Z");
    const checked = new Date("2026-09-05T00:00:00Z");

    expect(anchorSince(anchor({ confirmedAt }))).toEqual(confirmedAt);
    expect(anchorSince(anchor({ confirmedAt, lastCheckedAt: checked }))).toEqual(checked);
    // A re-confirmation after the last check moves the window up.
    expect(anchorSince(anchor({ confirmedAt: checked, lastCheckedAt: confirmedAt }))).toEqual(
      checked,
    );
  });

  it("matches a workspace-wide fact anywhere, a repository's fact only in it", () => {
    expect(sameRepository(null, HELIOS)).toBe(true);
    expect(sameRepository(null, null)).toBe(true);
    expect(sameRepository(HELIOS, "Acme-Robotics/Helios-Firmware")).toBe(true);
    expect(sameRepository(HELIOS, "acme-robotics/other")).toBe(false);
    expect(sameRepository(HELIOS, null)).toBe(false);
  });

  it("flags a fact once, by its earliest matching change", () => {
    const flags = staleFlags(
      [anchor(), anchor({ anchorId: "anchor-2", kind: "dependency", value: "west" })],
      [
        change({ prId: "pr-early", number: 1, mergedAt: new Date("2026-09-02T00:00:00Z") }),
        change({ prId: "pr-late", number: 2 }),
      ],
    );

    expect(flags).toEqual([
      expect.objectContaining({ factId: "fact-1", anchorId: "anchor-1", prId: "pr-early" }),
    ]);
  });

  it("ignores a change merged before the fact was confirmed", () => {
    expect(
      staleFlags([anchor()], [change({ mergedAt: new Date("2026-08-01T00:00:00Z") })]),
    ).toEqual([]);
  });

  it("writes which anchor matched what, bounded to V071's reason length", () => {
    const reason = staleReason(
      { kind: "platform_version", value: "zephyr-4.0" },
      { path: "west.yml", evidence: 'removed "revision: v4.0.0" in west.yml' },
      { number: 531 },
    );

    expect(reason).toBe(
      'platform_version anchor zephyr-4.0 matched: removed "revision: v4.0.0" in west.yml (PR #531)',
    );
    expect(
      staleReason(
        { kind: "path_glob", value: "x".repeat(500) },
        { path: "p", evidence: "e" },
        { number: 1 },
      ),
    ).toHaveLength(500);
  });
});

describe("the staleness sweep", () => {
  let store: FactStore;
  let facts: FactsService;
  let sweep: FactSweepService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    store = new FactStore();
    const repo = store.asRepository();
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;
    facts = new FactsService(repo, database);
    sweep = new FactSweepService(repo);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * A confirmed fact with anchors, like the seed's.
   *
   * @param text - The fact.
   * @param repoRef - Its repository, or null.
   * @param anchors - Its anchors.
   * @returns Its id.
   */
  async function confirmedFact(
    text: string,
    repoRef: string | null,
    anchors: { kind: "path_glob" | "dependency" | "platform_version"; value: string }[],
  ): Promise<string> {
    const proposal = await facts.propose(
      ORG,
      { text, repoRef, proposer: "manual", provenance: { line: "seeded", refs: [] }, anchors },
      "user-ken",
    );
    await facts.confirm(ORG, proposal.id, "user-ken");
    return proposal.id;
  }

  /**
   * Record a merged PR.
   *
   * @param overrides - What differs from a helios-firmware merge after everything was confirmed.
   * @returns The change.
   */
  function merged(
    overrides: Partial<MergedChange> & { enabled?: boolean } = {},
  ): MergedChange & { organizationId: string; enabled: boolean } {
    const row = {
      organizationId: ORG,
      enabled: true,
      prId: `pr-${String(store.changes.length + 1)}`,
      number: 531 + store.changes.length,
      repoRef: HELIOS,
      mergedAt: store.tick(),
      paths: [] as string[],
      diffExcerpt: null,
      ...overrides,
    };
    store.changes.push(row);
    return row;
  }

  /** The seed's five-fact card, minus the two proposals, all anchored. */
  async function seedCard(): Promise<{ west: string; hil: string; zephyr: string; bare: string }> {
    return {
      west: await confirmedFact("CI needs `west update` before first build of the day", null, [
        { kind: "dependency", value: "west" },
      ]),
      hil: await confirmedFact("Tests under `tests/hil/` require rig reservation", HELIOS, [
        { kind: "path_glob", value: "tests/hil/**" },
      ]),
      zephyr: await confirmedFact("Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`", HELIOS, [
        { kind: "platform_version", value: "zephyr-4.0" },
      ]),
      bare: await confirmedFact("Anchor-less house rule", null, []),
    };
  }

  it("flags the Zephyr 4.0 fact — and only it — when the platform moves to 4.1", async () => {
    const card = await seedCard();
    const pr = merged({ paths: ["west.yml"], diffExcerpt: ZEPHYR_BUMP });

    await sweep.mergeObserved(ORG, pr.prId);

    expect(store.find(card.zephyr.toString()).status).toBe("stale");
    expect(store.find(card.west).status).toBe("confirmed");
    expect(store.find(card.hil).status).toBe("confirmed");
    expect(store.find(card.bare).status).toBe("confirmed");

    const flagged = await facts.get(ORG, card.zephyr);
    expect(flagged.staleness).toEqual({
      actor: null,
      at: expect.any(String) as string,
      reason: `platform_version anchor zephyr-4.0 matched: removed "revision: v4.0.0" in west.yml (PR #${String(pr.number)})`,
    });
    expect(flagged.history.at(-1)).toMatchObject({ from: "confirmed", to: "stale", actor: null });
    await expect(facts.needsYou(ORG)).resolves.toMatchObject({
      count: 1,
      items: [{ factId: card.zephyr, reason: "stale" }],
    });
  });

  it("flags a path_glob fact on a matching change and not on another", async () => {
    const card = await seedCard();
    const miss = merged({ paths: ["tests/unit/can.c", "docs/hil.md"] });

    await sweep.mergeObserved(ORG, miss.prId);
    expect(store.find(card.hil).status).toBe("confirmed");

    const hit = merged({ paths: ["tests/hil/rig/claim_test.py"] });
    await sweep.mergeObserved(ORG, hit.prId);
    expect(store.find(card.hil).status).toBe("stale");
    expect(store.find(card.hil).status_reason).toBe(
      `path_glob anchor tests/hil/** matched: changed tests/hil/rig/claim_test.py (PR #${String(hit.number)})`,
    );
  });

  it("never flags an anchor-less fact, and says how many it cannot watch", async () => {
    const card = await seedCard();
    merged({ paths: ["west.yml", "tests/hil/a.py", "anything/at/all.c"], diffExcerpt: null });

    const report = await sweep.sweepWorkspace(ORG, store.tick());

    expect(store.find(card.bare).status).toBe("confirmed");
    expect(report.uncovered).toBe(1);
    expect(report.flagged.map((flag) => flag.factId).sort()).toEqual(
      [card.west, card.hil, card.zephyr].sort(),
    );
  });

  it("matches a repository's fact only against its own repository's merges", async () => {
    const card = await seedCard();
    const elsewhere = merged({
      repoRef: "acme-robotics/ground-station",
      paths: ["tests/hil/x.py"],
    });

    await sweep.mergeObserved(ORG, elsewhere.prId);

    expect(store.find(card.hil).status).toBe("confirmed");
  });

  it("does not flag a fact for a change it was confirmed after", async () => {
    const early = merged({ paths: ["tests/hil/x.py"] });
    const card = await seedCard();

    await sweep.mergeObserved(ORG, early.prId);
    await sweep.sweepWorkspace(ORG, store.tick());

    expect(store.find(card.hil).status).toBe("confirmed");
  });

  it("does not flag a re-confirmed fact again for the change that flagged it", async () => {
    const card = await seedCard();
    const pr = merged({ paths: ["tests/hil/x.py"] });
    await sweep.mergeObserved(ORG, pr.prId);
    await facts.reconfirm(ORG, card.hil, "user-maya");

    await sweep.mergeObserved(ORG, pr.prId);
    await sweep.sweepWorkspace(ORG, store.tick());

    expect(store.find(card.hil).status).toBe("confirmed");
  });

  it("is idempotent: a second pass over the same merge flags nothing more", async () => {
    await seedCard();
    const pr = merged({ paths: ["west.yml"], diffExcerpt: ZEPHYR_BUMP });
    await sweep.mergeObserved(ORG, pr.prId);
    const audited = store.transitions.length;

    await sweep.mergeObserved(ORG, pr.prId);
    const report = await sweep.sweepWorkspace(ORG, store.tick());

    expect(report.flagged).toEqual([]);
    expect(store.transitions).toHaveLength(audited);
  });

  it("catches at night a merge the sync hook never saw, and stamps what it checked", async () => {
    const card = await seedCard();
    merged({ paths: ["tests/hil/x.py"] });
    const at = store.tick();

    const report = await sweep.sweepWorkspace(ORG, at);

    expect(report).toMatchObject({ changes: 1, anchors: 3 });
    expect(store.find(card.hil).status).toBe("stale");
    // Every evaluated anchor is stamped — including those whose fact it just flagged.
    expect(
      store.anchors.filter((anchor) => anchor.last_checked_at?.getTime() === at.getTime()),
    ).toHaveLength(3);
  });

  it("stamps nothing from the sync hook, so the night still reads earlier merges", async () => {
    await seedCard();
    const pr = merged({ paths: ["README.md"] });

    await sweep.mergeObserved(ORG, pr.prId);

    expect(store.anchors.every((anchor) => anchor.last_checked_at === null)).toBe(true);
  });

  it("reads only enabled repositories at night", async () => {
    const card = await seedCard();
    merged({ paths: ["tests/hil/x.py"], enabled: false });

    await sweep.sweepWorkspace(ORG, store.tick());

    expect(store.find(card.hil).status).toBe("confirmed");
  });

  it("does not re-read what a night already checked", async () => {
    const card = await seedCard();
    await sweep.sweepWorkspace(ORG, store.tick());
    // A merge stamped before the last check (a late-arriving mirror row) is not re-read.
    store.changes.push({
      organizationId: ORG,
      enabled: true,
      prId: "pr-old",
      number: 1,
      repoRef: HELIOS,
      mergedAt: new Date(store.anchors[0]?.last_checked_at?.getTime() ?? 0),
      paths: ["tests/hil/x.py"],
      diffExcerpt: null,
    });

    await sweep.sweepWorkspace(ORG, store.tick());

    expect(store.find(card.hil).status).toBe("confirmed");
  });

  it("sweeps every workspace with an anchored confirmed fact, surviving one that fails", async () => {
    await seedCard();
    const repo = store.asRepository();
    const failing = new FactSweepService(repo);
    jest.spyOn(repo, "sweepWorkspaces").mockResolvedValue(["broken", ORG]);
    const real = repo.sweepAnchors.bind(repo);
    jest
      .spyOn(repo, "sweepAnchors")
      .mockImplementation((organizationId: string) =>
        organizationId === "broken" ? Promise.reject(new Error("boom")) : real(organizationId),
      );
    merged({ paths: ["tests/hil/x.py"] });

    const reports = await failing.sweepAll(store.tick());

    expect(reports.map((report) => report.organizationId)).toEqual([ORG]);
    expect(reports[0]?.flagged).toHaveLength(1);
  });

  it("reads nothing for a workspace with no anchored confirmed fact", async () => {
    const repo = store.asRepository();
    const reader = jest.spyOn(repo, "mergedChanges");
    const quiet = new FactSweepService(repo);

    await expect(quiet.sweepWorkspace(ORG)).resolves.toEqual({
      organizationId: ORG,
      changes: 0,
      anchors: 0,
      flagged: [],
      uncovered: 0,
    });
    expect(reader).not.toHaveBeenCalled();
  });
});
