import { API_BASE_PATH } from "../../application";
import {
  CREDENTIALS_PATH,
  INTERNAL_INVOKE_PATH,
  INTERNAL_LEASE_PATH,
  INTERNAL_PATH,
  INTERNAL_PATHS,
  INVOKE_ROUTE,
  LEASE_ROUTE,
  LLM_PATH,
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
 */

describe("the two paths", () => {
  it("are the ones #224 specifies", () => {
    expect(INTERNAL_LEASE_PATH).toBe("/internal/credentials/lease");
    expect(INTERNAL_INVOKE_PATH).toBe("/internal/llm/invoke");
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

  it("are both in the list the prefix exclusion reads", () => {
    expect([...INTERNAL_PATHS].toSorted()).toEqual(
      [INTERNAL_LEASE_PATH, INTERNAL_INVOKE_PATH].toSorted(),
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
