import { recordingAudit, type RecordingAudit } from "../audit/audit.fixture";
import { InvalidRequestError } from "../errors/error.envelope";
import { retentionHarness } from "../retention/retention.fixture";
import { csvHeader, csvLine } from "./audit-plane.csv";
import { encodeCursor } from "./audit-plane.cursor";
import { AUDIT_PLANE_ERRORS } from "./audit-plane.errors";
import {
  InMemoryAuditPlaneRepository,
  MOCKUP_ROWS,
  PLANE_ORG,
  asPlaneRepository,
  planeRow,
} from "./audit-plane.fixture";
import type { AuditPlaneQuery } from "./audit-plane.dto";
import type { AuditPlaneEventResource } from "./audit-plane.resources";
import { AUDIT_EXPORT_BATCH, AuditPlaneService } from "./audit-plane.service";

/**
 * The audit plane's service (#486): filters, keyset pages, the today view, and an export that is
 * audited before its first byte and equals the filtered view row for row.
 */
describe("the audit plane", () => {
  const NOW = new Date("2026-10-05T15:00:00.000Z");
  let repository: InMemoryAuditPlaneRepository;
  let audit: RecordingAudit;
  let service: AuditPlaneService;

  beforeEach(() => {
    repository = new InMemoryAuditPlaneRepository(MOCKUP_ROWS);
    audit = recordingAudit();
    service = new AuditPlaneService(
      asPlaneRepository(repository),
      audit.service,
      retentionHarness([{ organizationId: PLANE_ORG, dataClass: "audit", days: 400 }]).service,
    );
    service.now = () => NOW;
  });

  /**
   * Every page of a query, following `nextCursor`.
   *
   * @param query - The query, without a cursor.
   * @returns Every event, in order.
   */
  async function everyPage(query: AuditPlaneQuery): Promise<AuditPlaneEventResource[]> {
    const events: AuditPlaneEventResource[] = [];
    let cursor: string | undefined;

    do {
      const page = await service.list(PLANE_ORG, { ...query, cursor });
      events.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    return events;
  }

  /**
   * Read a stream to its end.
   *
   * @param chunks - The stream.
   * @returns Its text.
   */
  async function drain(chunks: AsyncIterable<string>): Promise<string> {
    let text = "";
    for await (const chunk of chunks) text += chunk;
    return text;
  }

  describe("listing", () => {
    it("pages newest first by cursor, and says when there is no next page", async () => {
      const first = await service.list(PLANE_ORG, { limit: 2 });

      expect(first.items.map((event) => event.event)).toEqual([
        "pushed PR #514 rev 2",
        "rotated Anthropic API key",
      ]);
      expect(first.nextCursor).not.toBeNull();

      const rest = await everyPage({ limit: 2 });
      expect(rest).toHaveLength(5);

      const last = await service.list(PLANE_ORG, { limit: 10 });
      expect(last.nextCursor).toBeNull();
    });

    it("neither repeats nor skips a row when events arrive mid-scroll", async () => {
      const first = await service.list(PLANE_ORG, { limit: 2 });

      // Two new events land between the first page and the second.
      repository.add(planeRow({ id: "b0000000-0000-4000-8000-000000000001", occurred_at: NOW }));
      repository.add(planeRow({ id: "b0000000-0000-4000-8000-000000000002", occurred_at: NOW }));

      const second = await service.list(PLANE_ORG, {
        limit: 10,
        cursor: first.nextCursor ?? undefined,
      });

      expect([...first.items, ...second.items].map((event) => event.id)).toEqual(
        MOCKUP_ROWS.map((row) => row.id),
      );
    });

    it("pages ties in the same microsecond by id, without losing one", async () => {
      const at = new Date("2026-10-05T11:00:00.000Z");
      for (const n of [1, 2, 3]) {
        repository.add(
          planeRow({ id: `c0000000-0000-4000-8000-00000000000${String(n)}`, occurred_at: at }),
        );
      }

      const ids = (await everyPage({ limit: 1, to: "2026-10-05T12:00:00.000Z" })).map((e) => e.id);
      expect(ids).toEqual([
        "c0000000-0000-4000-8000-000000000003",
        "c0000000-0000-4000-8000-000000000002",
        "c0000000-0000-4000-8000-000000000001",
      ]);
    });

    it("turns the query string into one structured filter", () => {
      expect(
        service.filterOf({
          from: "2026-10-05T00:00:00Z",
          to: "2026-10-06T00:00:00Z",
          actorKind: "human",
          actorId: "user-ken",
          actorService: "devops-bot",
          action: "policy.published",
          ref: "pr:509",
        }),
      ).toEqual({
        from: new Date("2026-10-05T00:00:00Z"),
        to: new Date("2026-10-06T00:00:00Z"),
        actorKind: "human",
        actorId: "user-ken",
        actorService: "devops-bot",
        plane: "policy",
        action: "policy.published",
        ref: { kind: "pr", number: 509 },
      });
    });

    it.each([
      [{ actorKind: "bot" as const }, ["pr_revision.pushed"]],
      [{ actorKind: "system" as const }, ["runner.marked_offline"]],
      [{ actorId: "user-maya" }, ["triage.waived"]],
      [{ actorService: "ouroboros-app" }, ["pr_revision.pushed"]],
      [{ action: "policy.*" }, ["policy.published"]],
      [{ action: "provider.rotated" }, ["provider.rotated"]],
      [{ ref: "pr:509" }, ["triage.waived"]],
      [
        { from: "2026-10-05T13:00:00Z", to: "2026-10-05T14:15:00Z" },
        ["provider.rotated", "policy.published", "triage.waived"],
      ],
      [{ actorKind: "human" as const, ref: "pr:514" }, []],
      [
        { actorKind: "human" as const, action: "policy.*", from: "2026-10-05T13:00:00Z" },
        ["policy.published"],
      ],
    ])("filters %p", async (query, actions) => {
      const page = await service.list(PLANE_ORG, query);

      expect(page.items.map((event) => event.action)).toEqual(actions);
    });

    it("never reads another workspace's events", async () => {
      repository.add(planeRow({ id: "d0000000-0000-4000-8000-000000000001" }), "another-org");

      const page = await service.list("another-org", {});

      expect(page.items.map((event) => event.id)).toEqual(["d0000000-0000-4000-8000-000000000001"]);
      expect((await service.list(PLANE_ORG, { limit: 200 })).items).toHaveLength(5);
    });

    it.each([
      [
        { from: "2026-10-05T00:00:00Z", to: "2026-10-05T00:00:00Z" },
        AUDIT_PLANE_ERRORS.rangeInvalid,
      ],
      [
        { from: "2026-10-06T00:00:00Z", to: "2026-10-05T00:00:00Z" },
        AUDIT_PLANE_ERRORS.rangeInvalid,
      ],
      [{ ref: "pr:0" }, AUDIT_PLANE_ERRORS.referenceInvalid],
      [{ cursor: "not-a-cursor" }, AUDIT_PLANE_ERRORS.cursorInvalid],
    ])("refuses %p with a 422", async (query, code) => {
      await expect(service.list(PLANE_ORG, query)).rejects.toMatchObject({ code });
      await expect(service.list(PLANE_ORG, query)).rejects.toBeInstanceOf(InvalidRequestError);
    });

    it("renders composed actor and event beside the trail's own fields", async () => {
      const page = await service.list(PLANE_ORG, { limit: 1 });

      expect(page.items[0]).toMatchObject({
        actorKind: "bot",
        actor: "ouroboros-app[bot]",
        actorService: "ouroboros-app",
        event: "pushed PR #514 rev 2",
        plane: "pr_revision",
        action: "pr_revision.pushed",
      });
    });
  });

  describe("the today view", () => {
    it("answers today's newest five lines, the zone, and the retention footer", async () => {
      repository.add(
        planeRow({
          id: "e0000000-0000-4000-8000-000000000001",
          occurred_at: new Date("2026-10-04T23:00:00Z"),
        }),
      );

      const today = await service.today(PLANE_ORG, {});

      expect(today).toMatchObject({
        timeZone: "UTC",
        since: "2026-10-05T00:00:00.000Z",
        more: false,
        retainedDays: 400,
      });
      expect(today.rows.map((row) => `${row.time} ${row.actor} ${row.event}`)).toEqual([
        "14:31 ouroboros-app[bot] pushed PR #514 rev 2",
        "14:12 Ken rotated Anthropic API key",
        "13:48 Ken enabled auto-merge (policy v7)",
        "13:22 Maya approved waiver on PR #509",
        "12:04 system runner forge-03 marked offline",
      ]);
    });

    it("takes today and each time in the requested zone, and says when more exist", async () => {
      const today = await service.today(PLANE_ORG, { tz: "Asia/Tokyo", limit: 2 });

      // 15:00Z is 00:00 the next day in Tokyo, so Tokyo's today started at 15:00Z — nothing yet.
      expect(today.since).toBe("2026-10-05T15:00:00.000Z");
      expect(today.rows).toEqual([]);

      const newYork = await service.today(PLANE_ORG, { tz: "America/New_York", limit: 2 });
      expect(newYork.since).toBe("2026-10-05T04:00:00.000Z");
      expect(newYork.rows.map((row) => row.time)).toEqual(["10:31", "10:12"]);
      expect(newYork.more).toBe(true);
    });

    it("reads the workspace's default tier when it stored none", async () => {
      const bare = new AuditPlaneService(
        asPlaneRepository(repository),
        audit.service,
        retentionHarness().service,
      );

      expect((await bare.today(PLANE_ORG, {})).retainedDays).toBe(400);
    });
  });

  describe("exporting", () => {
    const RANGE = { from: "2026-10-01T00:00:00Z", to: "2026-10-06T00:00:00Z" };

    it("requires a bounded range", async () => {
      await expect(
        service.exportCsv(PLANE_ORG, { to: RANGE.to }, "user-ken"),
      ).rejects.toMatchObject({
        code: AUDIT_PLANE_ERRORS.exportRangeRequired,
        details: { fields: { from: [expect.any(String)] } },
      });
      await expect(
        service.exportCsv(PLANE_ORG, { from: RANGE.from }, "user-ken"),
      ).rejects.toMatchObject({
        code: AUDIT_PLANE_ERRORS.exportRangeRequired,
        details: { fields: { to: [expect.any(String)] } },
      });
    });

    it("refuses a range longer than 366 days, and accepts exactly 366", async () => {
      await expect(
        service.exportCsv(
          PLANE_ORG,
          { from: "2025-10-03T23:59:59Z", to: "2026-10-05T00:00:00Z" },
          "u",
        ),
      ).rejects.toMatchObject({ code: AUDIT_PLANE_ERRORS.exportRangeTooLong });

      await expect(
        service.exportCsv(
          PLANE_ORG,
          { from: "2025-10-04T00:00:00Z", to: "2026-10-05T00:00:00Z" },
          "u",
        ),
      ).resolves.toMatchObject({ rows: 0 });
    });

    it("records audit.exported — range, filters, row count, actor — before the first byte", async () => {
      const file = await service.exportCsv(PLANE_ORG, { ...RANGE, actorKind: "human" }, "user-ken");

      // Nothing has been read from the stream yet, and the row already exists.
      expect(audit.records).toEqual([
        {
          organizationId: PLANE_ORG,
          actorId: "user-ken",
          action: "audit.exported",
          subjectType: "workspace",
          subjectId: PLANE_ORG,
          at: NOW,
          detail: {
            from: "2026-10-01T00:00:00.000Z",
            // Clamped to the request: nothing after it can be in the export.
            to: NOW.toISOString(),
            actor_kind: "human",
            rows: 3,
          },
        },
      ]);
      expect(file.rows).toBe(3);
      expect(file.filename).toBe("audit-2026-10-01-2026-10-05.csv");
    });

    it("refuses the export when the record cannot be written — no row, no data", async () => {
      audit.failWith(new Error("connection reset"));

      await expect(service.exportCsv(PLANE_ORG, RANGE, "user-ken")).rejects.toThrow(
        "connection reset",
      );
      expect(repository.pages).toEqual([]);
    });

    it("streams content equal to the filtered view, row for row, across batches", async () => {
      // More than one batch, so the export's own keyset paging is exercised.
      for (let n = 0; n < AUDIT_EXPORT_BATCH + 7; n += 1) {
        repository.add(
          planeRow({
            id: `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
            actor_kind: "service",
            actor_service: "devops-bot",
            action: "runner.job_submitted",
            occurred_at: new Date(Date.UTC(2026, 9, 2, 0, 0, n % 60, n)),
          }),
        );
      }
      const query = { ...RANGE, actorKind: "service" as const };

      const file = await service.exportCsv(PLANE_ORG, query, "user-ken");
      const csv = await drain(file.chunks);
      const view = await everyPage({ ...query, to: NOW.toISOString(), limit: 200 });

      expect(view).toHaveLength(AUDIT_EXPORT_BATCH + 7);
      expect(csv).toBe(csvHeader() + view.map(csvLine).join(""));
      expect(file.rows).toBe(view.length);
      expect(repository.pages.filter((call) => call.limit === AUDIT_EXPORT_BATCH)).toHaveLength(2);
    });

    it("streams just the header for an empty range", async () => {
      const file = await service.exportCsv(
        PLANE_ORG,
        { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
        "user-ken",
      );

      expect(await drain(file.chunks)).toBe(csvHeader());
      expect(file.rows).toBe(0);
    });

    it("reads one batch at a time, only as the consumer asks", async () => {
      const file = await service.exportCsv(PLANE_ORG, RANGE, "user-ken");
      const iterator = file.chunks[Symbol.asyncIterator]();

      await iterator.next(); // the header
      expect(repository.pages).toHaveLength(0);

      await iterator.next(); // the first batch
      expect(repository.pages).toHaveLength(1);
    });

    it("hands back a cursor a later page can follow", async () => {
      const token = encodeCursor({ at: MOCKUP_ROWS[0].cursor_at, id: MOCKUP_ROWS[0].id });
      const page = await service.list(PLANE_ORG, { cursor: token, limit: 1 });

      expect(page.items[0].id).toBe(MOCKUP_ROWS[1].id);
    });
  });
});
