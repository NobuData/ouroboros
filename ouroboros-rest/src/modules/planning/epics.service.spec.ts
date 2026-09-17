import { DomainError } from "../errors/error.envelope";
import { EpicsService, TICKET_SEARCH_LIMIT, checkedFields } from "./epics.service";
import { PLANNING_ERRORS } from "./planning.errors";
import { OTHER_ORG, PlanningStore, STORE_ORG, STORE_SOURCE } from "./planning.store.fixture";

/**
 * The Roadmap card's lanes (AL.4, #280). The criterion: *epic CRUD round-trips ranges, tint, status
 * and order; the roadmap payload's chips are computed.*
 */

/**
 * The envelope a call refused with.
 *
 * @param run - The call.
 * @returns Its status, code and details.
 */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return { status: error.getStatus(), ...error.envelope() };
    }

    throw error;
  }

  throw new Error("expected a refusal");
}

/** @returns A service over a fresh store. */
function build() {
  const store = new PlanningStore();

  return { store, service: new EpicsService(store.asRepository()) };
}

describe("EpicsService", () => {
  it("round-trips a lane's range, tint, status and roadmap head", async () => {
    const { service } = build();

    const created = await service.create(STORE_ORG, {
      name: "OTA hardening",
      tint: "accent",
      status: "active",
      startMonth: "2026-07",
      endMonth: "2026-09",
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
    });

    expect(created).toEqual({
      id: created.id,
      name: "OTA hardening",
      tint: "accent",
      status: "active",
      startMonth: "2026-07",
      endMonth: "2026-09",
      sortOrder: 1,
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
      chips: { issues: 0, done: 0 },
    });
    await expect(service.read(STORE_ORG, created.id)).resolves.toEqual(created);
  });

  it("defaults a lane to neutral and active, and appends it at the bottom", async () => {
    const { service } = build();

    await service.create(STORE_ORG, { name: "First" });

    const second = await service.create(STORE_ORG, { name: "Zephyr 4.2 migration" });

    expect(second).toMatchObject({
      tint: "neutral",
      status: "active",
      startMonth: null,
      endMonth: null,
      sortOrder: 2,
    });
  });

  it("edits only what is sent, and clears a range with nulls", async () => {
    const { service } = build();
    const lane = await service.create(STORE_ORG, {
      name: "Zephyr 4.2 migration",
      startMonth: "2026-10",
      endMonth: "2026-12",
    });

    const unscoped = await service.update(STORE_ORG, lane.id, {
      status: "unscoped",
      startMonth: null,
      endMonth: null,
    });

    expect(unscoped).toMatchObject({
      name: "Zephyr 4.2 migration",
      status: "unscoped",
      startMonth: null,
      endMonth: null,
    });
  });

  it("refuses half a range and a backwards one", async () => {
    const { service } = build();
    const lane = await service.create(STORE_ORG, {
      name: "Lane",
      startMonth: "2026-07",
      endMonth: "2026-09",
    });

    await expect(
      refusal(async () => service.update(STORE_ORG, lane.id, { endMonth: null })),
    ).resolves.toMatchObject({
      status: 422,
      code: PLANNING_ERRORS.monthRange,
      details: { reason: "paired" },
    });
    await expect(
      refusal(async () =>
        service.create(STORE_ORG, { name: "Back", startMonth: "2026-09", endMonth: "2026-07" }),
      ),
    ).resolves.toMatchObject({ status: 422, details: { reason: "ordered" } });
  });

  it("reorders when every lane is named once, and refuses anything else", async () => {
    const { service } = build();
    const first = await service.create(STORE_ORG, { name: "First" });
    const second = await service.create(STORE_ORG, { name: "Second" });

    const reordered = await service.reorder(STORE_ORG, [second.id, first.id]);

    expect(reordered.map((lane) => [lane.name, lane.sortOrder])).toEqual([
      ["Second", 1],
      ["First", 2],
    ]);
    await expect(
      refusal(async () => service.reorder(STORE_ORG, [first.id])),
    ).resolves.toMatchObject({
      status: 422,
      code: PLANNING_ERRORS.reorderIncomplete,
    });
    await expect(
      refusal(async () => service.reorder(STORE_ORG, [first.id, first.id])),
    ).resolves.toMatchObject({ code: PLANNING_ERRORS.reorderIncomplete });
  });

  it("computes chips from linked tickets' states — and moves them when a state moves", async () => {
    const { service, store } = build();
    const lane = await service.create(STORE_ORG, { name: "OTA hardening" });

    store.tickets.set("t1", { organizationId: STORE_ORG, state: "closed" });
    store.tickets.set("t2", { organizationId: STORE_ORG, state: "open" });

    const linked = await service.link(STORE_ORG, lane.id, ["t1", "t2"]);

    expect(linked.chips).toEqual({ issues: 2, done: 1 });

    store.tickets.set("t2", { organizationId: STORE_ORG, state: "closed" });

    const roadmap = await service.roadmap(STORE_ORG);

    expect(roadmap.lanes[0].chips).toEqual({ issues: 2, done: 2 });

    const unlinked = await service.unlink(STORE_ORG, lane.id, ["t1", "never-linked"]);

    expect(unlinked.chips).toEqual({ issues: 1, done: 1 });
  });

  it("refuses to link a ticket of another workspace, naming it", async () => {
    const { service, store } = build();
    const lane = await service.create(STORE_ORG, { name: "Lane" });

    store.tickets.set("theirs", { organizationId: OTHER_ORG, state: "open" });

    await expect(
      refusal(async () => service.link(STORE_ORG, lane.id, ["theirs"])),
    ).resolves.toMatchObject({
      status: 404,
      code: PLANNING_ERRORS.ticketsNotFound,
      details: { ticketIds: ["theirs"] },
    });
  });

  it("lists a lane's linked tickets open first, with its mirrors", async () => {
    const { service, store } = build();
    const lane = await service.create(STORE_ORG, { name: "OTA hardening" });

    store.tickets.set("t1", { organizationId: STORE_ORG, state: "closed", externalKey: "#540" });
    store.tickets.set("t2", { organizationId: STORE_ORG, state: "open", externalKey: "#551" });
    store.tickets.set("t3", { organizationId: STORE_ORG, state: "open", externalKey: "#548" });
    await service.link(STORE_ORG, lane.id, ["t1", "t2", "t3"]);
    store.mirrors.set(lane.id, [
      {
        organizationId: STORE_ORG,
        sourceId: STORE_SOURCE.sourceId,
        sourceName: STORE_SOURCE.displayName,
        kind: "parent_issue",
        externalRef: "#612",
      },
    ]);

    const links = await service.links(STORE_ORG, lane.id);

    expect(links.epicId).toBe(lane.id);
    expect(links.tickets.map((ticket) => [ticket.externalKey, ticket.state])).toEqual([
      ["#548", "open"],
      ["#551", "open"],
      ["#540", "closed"],
    ]);
    expect(links.mirrors).toEqual([
      {
        sourceId: STORE_SOURCE.sourceId,
        sourceName: STORE_SOURCE.displayName,
        kind: "parent_issue",
        externalRef: "#612",
      },
    ]);

    // The list and the chip read the same links, so a synced state change moves both.
    store.tickets.set("t2", { organizationId: STORE_ORG, state: "closed", externalKey: "#551" });

    const moved = await service.links(STORE_ORG, lane.id);

    expect(moved.tickets.filter((ticket) => ticket.state === "closed")).toHaveLength(2);
    await expect(service.read(STORE_ORG, lane.id)).resolves.toMatchObject({
      chips: { issues: 3, done: 2 },
    });
  });

  it("answers a lane with nothing linked and nothing mirrored as two empty lists", async () => {
    const { service } = build();
    const lane = await service.create(STORE_ORG, { name: "Zephyr 4.2 migration" });

    await expect(service.links(STORE_ORG, lane.id)).resolves.toEqual({
      epicId: lane.id,
      tickets: [],
      mirrors: [],
    });
  });

  it("searches the workspace's tickets by title or key, escaped and bounded", async () => {
    const { service, store } = build();

    store.tickets.set("ota", {
      organizationId: STORE_ORG,
      state: "open",
      externalKey: "#548",
      title: "OTA: checksum before swap",
      sourceUpdatedAt: 2,
    });
    store.tickets.set("ble", {
      organizationId: STORE_ORG,
      state: "open",
      externalKey: "#552",
      title: "BLE provisioning 100% retries",
      sourceUpdatedAt: 1,
    });
    store.tickets.set("theirs", {
      organizationId: OTHER_ORG,
      state: "open",
      externalKey: "#548",
      title: "OTA elsewhere",
    });

    const byTitle = await service.searchTickets(STORE_ORG, "  ota ");
    const byKey = await service.searchTickets(STORE_ORG, "#552");
    const literal = await service.searchTickets(STORE_ORG, "100%");
    const everything = await service.searchTickets(STORE_ORG, undefined);

    expect(byTitle.items.map((ticket) => ticket.id)).toEqual(["ota"]);
    expect(byKey.items.map((ticket) => ticket.id)).toEqual(["ble"]);
    expect(literal.items.map((ticket) => ticket.id)).toEqual(["ble"]);
    expect(everything.items.map((ticket) => ticket.id)).toEqual(["ota", "ble"]);
  });

  it("bounds a search to a picker's page", async () => {
    const { service, store } = build();

    for (let index = 0; index < TICKET_SEARCH_LIMIT + 5; index += 1) {
      store.tickets.set(`t${String(index)}`, { organizationId: STORE_ORG, state: "open" });
    }

    expect((await service.searchTickets(STORE_ORG, "")).items).toHaveLength(TICKET_SEARCH_LIMIT);
  });

  it("names the roadmap from its first lane with a head", async () => {
    const { service } = build();

    await service.create(STORE_ORG, { name: "Headless" });
    await service.create(STORE_ORG, {
      name: "OTA",
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
    });

    await expect(service.roadmap(STORE_ORG)).resolves.toMatchObject({
      name: "Helios 2.1",
      window: "Q3–Q4 2026",
    });
    await expect(build().service.roadmap(STORE_ORG)).resolves.toEqual({
      name: null,
      window: null,
      lanes: [],
    });
  });

  it("holds every lane to its workspace", async () => {
    const { service } = build();
    const lane = await service.create(STORE_ORG, { name: "Ours" });

    for (const run of [
      async () => service.read(OTHER_ORG, lane.id),
      async () => service.update(OTHER_ORG, lane.id, { name: "Stolen" }),
      async () => service.remove(OTHER_ORG, lane.id),
      async () => service.link(OTHER_ORG, lane.id, ["t1"]),
      async () => service.unlink(OTHER_ORG, lane.id, ["t1"]),
      async () => service.links(OTHER_ORG, lane.id),
    ]) {
      await expect(refusal(run)).resolves.toMatchObject({
        status: 404,
        code: PLANNING_ERRORS.epicNotFound,
      });
    }

    await expect(service.list(OTHER_ORG)).resolves.toEqual([]);
    await expect(service.read(STORE_ORG, lane.id)).resolves.toMatchObject({ name: "Ours" });
  });

  it("deletes a lane", async () => {
    const { service } = build();
    const lane = await service.create(STORE_ORG, { name: "Gone" });

    await service.remove(STORE_ORG, lane.id);

    await expect(service.list(STORE_ORG)).resolves.toEqual([]);
  });
});

describe("checkedFields", () => {
  const base = {
    name: "Lane",
    tint: "ok" as const,
    status: "active" as const,
    roadmapName: null,
    roadmapWindow: null,
  };

  it("accepts a same-month range and an empty one", () => {
    expect(() =>
      checkedFields({ ...base, startMonth: "2026-07", endMonth: "2026-07" }),
    ).not.toThrow();
    expect(() => checkedFields({ ...base, startMonth: null, endMonth: null })).not.toThrow();
  });

  it("orders across a year boundary", () => {
    expect(() =>
      checkedFields({ ...base, startMonth: "2026-12", endMonth: "2027-01" }),
    ).not.toThrow();
  });
});
