/**
 * A brief, read — and a matrix, built — on the real schema (V106, V108, V112, V120) — #621.
 *
 * What is proven here and nowhere else is the SQL: the matrix written in one transaction under
 * V112's deferred triggers, the rival registry found-or-added, the brief's joins, and the three
 * routes answering from what the investigation loop's delivery left behind. The engine is the
 * stand-in, as in `investigation-loop.integration-spec.ts`: it starts a run and delivers a brief
 * with a matrix input over HTTP, with the internal key.
 */

import request from "supertest";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { RESEARCH_ERRORS } from "../research.errors";
import { readBriefExport } from "./brief.export";
import type { BriefLedgerResource, BriefResource } from "./brief.resources";
import { BRIEF_ERRORS } from "./briefs.errors";
import { MatrixBuilderService } from "./matrix-builder.service";

const START = {
  loopVersion: "loop-v1",
  alias: "researcher-long-ctx",
  resolutionRef: "r1",
  task: "investigate:fixture",
};

describe("briefs and matrices, on the database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** One of the loop's writes, made the way the engine makes it. */
  function write(investigation: string, route: string, body: object) {
    return request(api.baseUrl)
      .post(`/internal/research/investigations/${investigation}/${route}`)
      .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
      .send(body);
  }

  /** A read of the brief surface, as a member's browser makes it. */
  function read(person: Person, workspace: Workspace, investigation: string, route: string) {
    return api
      .as(person)("get", `/api/v1/research/investigations/${investigation}/${route}`)
      .set(TENANT_HEADER, workspace.slug);
  }

  /** The brief, as the route answers it. */
  async function briefOf(
    person: Person,
    workspace: Workspace,
    investigation: string,
  ): Promise<BriefResource> {
    return (await read(person, workspace, investigation, "brief").expect(200))
      .body as BriefResource;
  }

  /** The ledger, as the route answers it. */
  async function ledgerOf(
    person: Person,
    workspace: Workspace,
    investigation: string,
  ): Promise<BriefLedgerResource> {
    return (await read(person, workspace, investigation, "sources").expect(200))
      .body as BriefLedgerResource;
  }

  /** The refusal code of a read that is expected to fail. */
  async function refusal(
    person: Person,
    workspace: Workspace,
    investigation: string,
    route: string,
    status: number,
  ): Promise<string> {
    return (
      (await read(person, workspace, investigation, route).expect(status)).body as { code: string }
    ).code;
  }

  /** A queued gap analysis in a fresh workspace, with `sources` records archived. */
  async function investigation(sources: number): Promise<{
    id: string;
    owner: Person;
    workspace: Workspace;
    ledger: string[];
  }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.investigations (organization_id, kind_id, question, depth, tools_enabled)
       select $1, k.id, 'Why do rivals dock in wind and we do not?', 'quick', '["web", "code"]'
         from ouroboros.investigation_kinds k
        where k.organization_id = $1 and k.slug = 'gap_analysis'
       returning id`,
      [workspace.id],
    );

    const ledger: string[] = [];
    for (let n = 1; n <= sources; n += 1) {
      const archived = await api.sql.query<{ id: string }>(
        `insert into ouroboros.source_records
           (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt)
         values ($1, 'web', 'web', $2, $3, '2026-10-07T12:00:00Z'::timestamptz + make_interval(mins => $4),
                 'sha256:' || repeat($5, 64), $6)
         returning id`,
        [
          rows[0].id,
          `Source ${n.toString()}`,
          `https://example.com/${n.toString()}`,
          n,
          n.toString(16),
          `What source ${n.toString()} said.`,
        ],
      );
      ledger.push(archived.rows[0].id);
    }
    return { id: rows[0].id, owner, workspace, ledger };
  }

  /** The `[git]` source: a code record with a symbolic key. */
  async function archiveCode(investigationId: string): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.source_records
         (investigation_id, tool_slug, kind, title, locator, retrieved_at, content_hash, excerpt, cite_key)
       values ($1, 'code', 'code', 'dock_ctrl.c blame',
               'git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214', '2026-10-07T12:30:00Z',
               'sha256:' || repeat('c', 64), 'static const float kp = 1.8f;', 'git')
       returning id`,
      [investigationId],
    );
    return rows[0].id;
  }

  /** A two-row matrix input over the ledger, with a proposal. */
  function matrixInput(ledger: string[]) {
    return {
      title: "Docking vs. the field",
      us: "Helios",
      rivals: ["Skylink", "Novum"],
      rows: [
        {
          capability: "Docking in gusts",
          gap: "high",
          cells: [
            { subject: "Helios", status: "partial", sources: [ledger[0], ledger[1]] },
            { subject: "Skylink", status: "shipping", sources: [ledger[2]] },
            { subject: "Novum", status: "beta", sources: [ledger[3]] },
          ],
        },
        {
          capability: "Recovery beacon",
          gap: "lead",
          cells: [
            { subject: "Helios", status: "shipping", sources: [ledger[0]] },
            { subject: "Skylink", status: "unknown", sources: [] },
            { subject: "Novum", status: "none", sources: [ledger[3]] },
          ],
        },
      ],
      epic: "Docking parity",
      tickets: [
        {
          key: "DOCK-1",
          title: "wind-feedforward MPC",
          effort: "m",
          capability: "Docking in gusts",
          sources: [ledger[2]],
        },
        { key: "DOCK-2", title: "beacon range", effort: "s", capability: "Recovery beacon" },
      ],
    };
  }

  /** A brief citing the ledger's first source and the code source. */
  function brief(ledger: string[], code: string, matrix: object) {
    return {
      attempt: 1,
      durationMs: 61_000,
      usage: [],
      body: {
        paragraphs: [
          {
            spans: [
              { text: "The gap is control, not sensors.", claim: "c1" },
              { text: " Ours is PID with fixed gains (dock_ctrl.c:214).", claim: "c2" },
            ],
          },
          { spans: [{ text: "Does Novum use a beacon?", claim: "q1" }] },
        ],
      },
      claims: [
        {
          ref: "c1",
          type: "finding",
          text: "The gap is control.",
          sources: [ledger[0]],
          demoted: false,
        },
        { ref: "c2", type: "finding", text: "Fixed gains.", sources: [code], demoted: false },
        { ref: "q1", type: "open_question", text: "A beacon?", sources: [], demoted: true },
      ],
      deliverables: { matrix },
    };
  }

  /** Start a run and deliver its brief. */
  async function delivered(matrix?: (ledger: string[]) => object) {
    const made = await investigation(4);
    const code = await archiveCode(made.id);
    await write(made.id, "start", START).expect(200);
    await write(
      made.id,
      "brief",
      brief(made.ledger, code, (matrix ?? matrixInput)(made.ledger)),
    ).expect(200);
    return { ...made, code };
  }

  async function count(table: string, investigationId: string): Promise<number> {
    const { rows } = await api.sql.query<{ n: number }>(
      `select count(*)::int as n from ouroboros.${table} where investigation_id = $1`,
      [investigationId],
    );
    return rows[0].n;
  }

  it("builds the matrix when a gap analysis delivers, and reads the brief back whole", async () => {
    const { id, owner, workspace, ledger, code } = await delivered();

    const body = await briefOf(owner, workspace, id);

    expect(body.investigation).toMatchObject({
      id,
      kind: "gap_analysis",
      kindLabel: "Gap analysis",
      depth: "quick",
      status: "brief_ready",
    });
    expect(body.brief.version).toBe(1);
    expect(body.provenance).toEqual({ researcher: "loop-v1", alias: "researcher-long-ctx" });

    // The body: claim spans typed, cited by the ledger's stored numbers, the code ref mono.
    const [findings, questions] = body.brief.paragraphs;
    expect(findings.kind).toBe("findings");
    expect(findings.spans[0].cites).toEqual([
      { label: "[01]", citeNo: 1, citeKey: null, sourceId: ledger[0] },
    ]);
    expect(findings.spans[1].cites).toEqual([
      { label: "[git]", citeNo: 5, citeKey: "git", sourceId: code },
    ]);
    expect(findings.spans[1].segments[1]).toEqual({
      kind: "code",
      text: "dock_ctrl.c:214",
      // The workspace has mirrored no repository, so the reference is mono and unlinked.
      href: null,
    });
    expect(questions.kind).toBe("open_questions");
    expect(questions.spans[0].claim).toEqual({ ref: "q1", type: "open_question", demoted: true });

    // The panel: what the brief's claims cite, of a five-record ledger.
    expect(body.sources.cited).toBe(5);
    expect(body.sources.panel.map((row) => row.label)).toEqual(["[01]", "[git]"]);

    // The matrix: built by the delivery, severities derived.
    expect(body.matrix?.columns.map((column) => column.label)).toEqual([
      "Helios",
      "Skylink",
      "Novum",
    ]);
    expect(
      body.matrix?.rows.map((row) => [
        row.capability,
        ...row.cells.map((cell) => cell.label),
        row.gap.label,
      ]),
    ).toEqual([
      ["Docking in gusts", "partial", "shipping", "beta", "HIGH"],
      ["Recovery beacon", "shipping", "unknown", "none", "LEAD"],
    ]);
    expect(body.matrix?.rows[0].cells[0].cites.map((cite) => cite.label)).toEqual(["[01]", "[02]"]);
    expect(body.matrix?.rows[1].cells[1].cites).toEqual([]);
    expect(body.matrix?.rows[0].gap.derivation).toBe(
      "Helios: partial · best rival: shipping (Skylink) · rivals: 1 shipping, 1 partial · " +
        "proposed: high · one step behind the best rival, proposed high → high",
    );

    // Proposed from gaps: only the HIGH row's stub — the LEAD row's is dropped.
    expect(body.proposed?.epic.label).toBe("EPIC · Docking parity");
    expect(body.proposed?.tickets.map((ticket) => ticket.key)).toEqual(["DOCK-1"]);
    expect(body.proposed?.effort).toBe("m");
  });

  it("stores the matrix as V112 rows: one matrix, cells per subject, links per citation", async () => {
    const { id, workspace } = await delivered();

    expect(await count("capability_matrices", id)).toBe(1);
    expect(await count("matrix_cells", id)).toBe(6);
    expect(await count("matrix_cell_sources", id)).toBe(6);

    const { rows } = await api.sql.query(
      `select r.capability, r.gap_severity, c.status, c.note, co.name
         from ouroboros.matrix_rows r
         join ouroboros.matrix_cells c on c.row_id = r.id
         left join ouroboros.competitors co on co.id = c.competitor_id
        where c.investigation_id = $1 and r.sort_order = 0
        order by co.name nulls first`,
      [id],
    );
    expect(rows).toEqual([
      {
        capability: "Docking in gusts",
        gap_severity: "high",
        status: "partial",
        note: null,
        name: null,
      },
      {
        capability: "Docking in gusts",
        gap_severity: "high",
        status: "partial",
        note: "beta",
        name: "Novum",
      },
      {
        capability: "Docking in gusts",
        gap_severity: "high",
        status: "shipping",
        note: null,
        name: "Skylink",
      },
    ]);

    // The rivals it named are now in the workspace's registry, once each.
    const registry = await api.sql.query<{ name: string }>(
      `select name from ouroboros.competitors where organization_id = $1 order by name`,
      [workspace.id],
    );
    expect(registry.rows.map((row) => row.name)).toEqual(["Novum", "Skylink"]);
  });

  it("reuses a rival the registry already has, by name or alias, in any case", async () => {
    const made = await investigation(4);
    const code = await archiveCode(made.id);
    await api.sql.query(
      `insert into ouroboros.competitors (organization_id, name, meta)
       values ($1, 'SKYLINK', '{}'), ($1, 'Novum Robotics', '{"aliases": ["novum"]}')`,
      [made.workspace.id],
    );

    await write(made.id, "start", START).expect(200);
    await write(made.id, "brief", brief(made.ledger, code, matrixInput(made.ledger))).expect(200);

    const registry = await api.sql.query<{ name: string }>(
      `select name from ouroboros.competitors where organization_id = $1 order by name`,
      [made.workspace.id],
    );
    expect(registry.rows.map((row) => row.name)).toEqual(["Novum Robotics", "SKYLINK"]);

    const body = await briefOf(made.owner, made.workspace, made.id);
    expect(body.matrix?.columns.map((column) => column.label)).toEqual([
      "Helios",
      "SKYLINK",
      "Novum Robotics",
    ]);
  });

  it("delivers the brief and stores no matrix when a cell is uncited", async () => {
    const { id, owner, workspace } = await delivered((ledger) => {
      const input = matrixInput(ledger);
      // The engine's gate turns an uncited cell `unknown`; this is what happens if it ever stops.
      input.rows[0].cells[1] = { subject: "Skylink", status: "shipping", sources: [] };
      return input;
    });

    expect(await count("capability_matrices", id)).toBe(0);
    const body = await briefOf(owner, workspace, id);
    expect(body.matrix).toBeNull();
    expect(body.proposed).toBeNull();

    // Asked directly, the builder says why.
    await expect(api.nest.get(MatrixBuilderService).build(workspace.id, id)).rejects.toMatchObject({
      code: BRIEF_ERRORS.matrixCellUncited,
    });
  });

  it("builds once: a second build answers with the matrix already there", async () => {
    const { id, workspace } = await delivered();
    const builder = api.nest.get(MatrixBuilderService);

    const again = await builder.build(workspace.id, id);

    expect(again.outcome).toBe("exists");
    expect(await count("capability_matrices", id)).toBe(1);
    expect(await count("matrix_cells", id)).toBe(6);
  });

  it("returns the whole ledger with excerpts and retrieval times, in cite order", async () => {
    const { id, owner, workspace, ledger } = await delivered();

    const body = await ledgerOf(owner, workspace, id);

    expect(body.total).toBe(5);
    expect(body.items.map((item) => item.label)).toEqual(["[01]", "[02]", "[03]", "[04]", "[git]"]);
    expect(body.items[1]).toMatchObject({
      sourceId: ledger[1],
      title: "Source 2",
      locator: "https://example.com/2",
      locatorLabel: "example.com/2",
      href: "https://example.com/2",
      excerpt: "What source 2 said.",
      retrievedAt: "2026-10-07T12:02:00.000Z",
    });
  });

  it("serves the ledger before the brief exists, and no brief until it does", async () => {
    const { id, owner, workspace } = await investigation(2);

    expect((await ledgerOf(owner, workspace, id)).total).toBe(2);
    expect(await refusal(owner, workspace, id, "brief", 404)).toBe(BRIEF_ERRORS.briefNotFound);
    expect(await refusal(owner, workspace, id, "brief/export", 404)).toBe(
      BRIEF_ERRORS.briefNotFound,
    );
  });

  it("exports Markdown whose citations are the brief's, as an attachment", async () => {
    const { id, owner, workspace } = await delivered();

    const exported = await read(owner, workspace, id, "brief/export").expect(200);
    const again = await read(owner, workspace, id, "brief/export").expect(200);
    const json = await ledgerOf(owner, workspace, id);

    expect(exported.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(exported.headers["content-disposition"]).toMatch(
      /^attachment; filename="RS-\d+-brief\.md"$/,
    );
    expect(exported.text).toBe(again.text);
    expect(exported.text).toContain("The gap is control, not sensors.[01]");
    expect(exported.text).toContain("(`dock_ctrl.c:214`).[git]");
    expect(exported.text).toContain("### Open questions\n\n- Does Novum use a beacon?");
    expect(exported.text).toContain(
      "| Docking in gusts | ◐ partial [01][02] | ● shipping [03] | ◐ beta [04] | HIGH |",
    );
    expect(exported.text).toContain("researcher loop-v1 · alias researcher-long-ctx · brief v1");

    const { markers, sources } = readBriefExport(exported.text);
    const labels = new Set(sources.map((source) => source.label));
    for (const marker of markers) expect(labels.has(marker)).toBe(true);
    expect(sources.map((source) => [source.label, source.locator, source.retrievedAt])).toEqual(
      json.items.map((item) => [item.label, item.locator, item.retrievedAt]),
    );
  });

  it("links a code source to its repository once the workspace has it", async () => {
    const { id, owner, workspace } = await delivered();
    await api.sql.query(
      `with org as (
         insert into ouroboros.github_orgs (organization_id, login)
         values ($1, 'acme-robotics') returning id)
       insert into ouroboros.github_repos (org_id, name)
       select org.id, 'helios-firmware' from org`,
      [workspace.id],
    );

    const body = await briefOf(owner, workspace, id);

    expect(body.sources.panel[1]).toMatchObject({
      label: "[git]",
      locatorLabel: "helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c",
      href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
    });
    expect(body.brief.paragraphs[0].spans[1].segments[1].href).toBe(
      "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
    );
  });

  it("answers 404 to another workspace, and to a member of none", async () => {
    const { id } = await delivered();
    const stranger = await api.signIn();
    const elsewhere = await api.workspace(stranger);

    for (const route of ["brief", "sources", "brief/export"]) {
      expect(await refusal(stranger, elsewhere, id, route, 404)).toBe(
        RESEARCH_ERRORS.investigationNotFound,
      );
    }
    await expect(api.nest.get(MatrixBuilderService).build(elsewhere.id, id)).rejects.toMatchObject({
      code: RESEARCH_ERRORS.investigationNotFound,
    });
  });

  it("refuses an id that is not one, and a request with no session", async () => {
    const { owner, workspace, id } = await delivered();

    await read(owner, workspace, "RS-127", "brief").expect(422);
    await request(api.baseUrl).get(`/api/v1/research/investigations/${id}/brief`).expect(401);
  });
});
