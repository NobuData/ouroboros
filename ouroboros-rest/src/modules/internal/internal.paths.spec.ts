import { API_BASE_PATH } from "../../application";
import {
  COMMITS_ROUTE,
  CONTROL_ACK_ROUTE,
  CONTROLS_FETCH_ROUTE,
  CREDENTIALS_PATH,
  EVENTS_ROUTE,
  FILES_ROUTE,
  INTERNAL_INVOKE_PATH,
  INTERNAL_LEASE_PATH,
  INTERNAL_PATH,
  INTERNAL_PATHS,
  INTERNAL_RUNS_PATH,
  INTERNAL_RUN_COMMITS_PATH,
  INTERNAL_RUN_CONTROL_ACK_PATH,
  INTERNAL_RUN_CONTROLS_FETCH_PATH,
  INTERNAL_RUN_EVENTS_PATH,
  INTERNAL_RUN_FILES_PATH,
  INTERNAL_RUN_RESOURCES_PATH,
  INTERNAL_RUN_STAGE_TRANSITIONS_PATH,
  INVOKE_ROUTE,
  LEASE_ROUTE,
  LLM_PATH,
  RESOURCES_ROUTE,
  RUNS_PATH,
  STAGE_TRANSITIONS_ROUTE,
  isInternalPath,
} from "./internal.paths";

/**
 * The paths, and the two properties everything else depends on.
 *
 * `health.paths.spec.ts` makes the same argument for the probes: these constants are read by
 * the controllers, by the prefix exclusion, by the internal specification, by the route-table
 * fixture and by `ouroboros-engine`'s client, so what is asserted is that they compose into
 * the strings the issue names — `/internal/credentials/lease` and `/internal/llm/invoke` —
 * and that nothing has quietly moved them under `/api/v1`.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) added six more, and the
 * same three properties are asserted of them: the composed string, the segments the
 * controller declares, and membership of the list the prefix exclusion reads.
 */

describe("the internal paths", () => {
  it("are the ones #224 specifies", () => {
    expect(INTERNAL_LEASE_PATH).toBe("/internal/credentials/lease");
    expect(INTERNAL_INVOKE_PATH).toBe("/internal/llm/invoke");
  });

  it("are the six #303 specifies", () => {
    expect(INTERNAL_RUNS_PATH).toBe("/internal/runs");
    expect(INTERNAL_RUN_STAGE_TRANSITIONS_PATH).toBe("/internal/runs/:id/stage-transitions");
    expect(INTERNAL_RUN_EVENTS_PATH).toBe("/internal/runs/:id/events");
    expect(INTERNAL_RUN_FILES_PATH).toBe("/internal/runs/:id/files");
    expect(INTERNAL_RUN_COMMITS_PATH).toBe("/internal/runs/:id/commits");
    expect(INTERNAL_RUN_RESOURCES_PATH).toBe("/internal/runs/:id/resources");
  });

  it("are the two #306 specifies, composed from the segments the control controller declares", () => {
    expect(INTERNAL_RUN_CONTROLS_FETCH_PATH).toBe("/internal/runs/:id/controls/fetch");
    expect(INTERNAL_RUN_CONTROL_ACK_PATH).toBe("/internal/runs/:id/controls/:controlId/ack");
    expect(`/${RUNS_PATH}/${CONTROLS_FETCH_ROUTE}`).toBe(INTERNAL_RUN_CONTROLS_FETCH_PATH);
    expect(`/${RUNS_PATH}/${CONTROL_ACK_ROUTE}`).toBe(INTERNAL_RUN_CONTROL_ACK_PATH);
  });

  it("compose the ingestion routes from the segments its controller declares", () => {
    // The ingestion controller takes `RUNS_PATH` and the five route segments, so a change to
    // one has to reach the composed constant or the router and the exclusion disagree.
    expect(`/${RUNS_PATH}`).toBe(INTERNAL_RUNS_PATH);
    expect(`/${RUNS_PATH}/${STAGE_TRANSITIONS_ROUTE}`).toBe(INTERNAL_RUN_STAGE_TRANSITIONS_PATH);
    expect(`/${RUNS_PATH}/${EVENTS_ROUTE}`).toBe(INTERNAL_RUN_EVENTS_PATH);
    expect(`/${RUNS_PATH}/${FILES_ROUTE}`).toBe(INTERNAL_RUN_FILES_PATH);
    expect(`/${RUNS_PATH}/${COMMITS_ROUTE}`).toBe(INTERNAL_RUN_COMMITS_PATH);
    expect(`/${RUNS_PATH}/${RESOURCES_ROUTE}`).toBe(INTERNAL_RUN_RESOURCES_PATH);
  });

  it("compose from the segments the controllers declare", () => {
    // The controllers take `CREDENTIALS_PATH`/`LLM_PATH` and `LEASE_ROUTE`/`INVOKE_ROUTE`,
    // so a change to a segment has to reach the composed constant or the two disagree.
    expect(`/${CREDENTIALS_PATH}/${LEASE_ROUTE}`).toBe(INTERNAL_LEASE_PATH);
    expect(`/${LLM_PATH}/${INVOKE_ROUTE}`).toBe(INTERNAL_INVOKE_PATH);
  });

  it("sit outside the versioned surface", () => {
    // The decision `internal.paths.ts` argues: `/api` is the browser's boundary. A path that
    // drifted under it would be published in the client `ouroboros-ui` generates.
    for (const path of INTERNAL_PATHS) {
      expect(path.startsWith(API_BASE_PATH)).toBe(false);
      expect(path.startsWith(`/${INTERNAL_PATH}/`)).toBe(true);
    }
  });

  it("are all in the list the prefix exclusion reads", () => {
    // Named rather than counted: a path missing here is a route that answers under
    // `/api/v1/internal/...` — reachable, wrongly prefixed, and green in every other suite.
    expect([...INTERNAL_PATHS].toSorted()).toEqual(
      [
        INTERNAL_LEASE_PATH,
        INTERNAL_INVOKE_PATH,
        INTERNAL_RUNS_PATH,
        INTERNAL_RUN_STAGE_TRANSITIONS_PATH,
        INTERNAL_RUN_EVENTS_PATH,
        INTERNAL_RUN_FILES_PATH,
        INTERNAL_RUN_COMMITS_PATH,
        INTERNAL_RUN_RESOURCES_PATH,
        INTERNAL_RUN_CONTROLS_FETCH_PATH,
        INTERNAL_RUN_CONTROL_ACK_PATH,
      ].toSorted(),
    );
  });
});

describe("recognising the surface", () => {
  it.each([
    ["a path", INTERNAL_LEASE_PATH],
    ["a controller base", CREDENTIALS_PATH],
    ["an operation key", `POST ${INTERNAL_INVOKE_PATH}`],
  ])("recognises %s", (_description, candidate) => {
    // Three callers ask it of three different shapes — the route table asks about a base
    // segment, the specification suite about an operation key — which is why it is a prefix
    // test rather than a lookup in `INTERNAL_PATHS`.
    expect(isInternalPath(candidate)).toBe(true);
  });

  it.each([
    ["the heartbeat", API_BASE_PATH],
    ["a probe", "/health/live"],
    ["a browser operation", `GET ${API_BASE_PATH}/orgs`],
    ["an auth route", "/api/auth/get-session"],
  ])("does not recognise %s", (_description, candidate) => {
    expect(isInternalPath(candidate)).toBe(false);
  });
});
