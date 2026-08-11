import { API_BASE_PATH, API_PREFIX } from "../../application";
import {
  HEALTH_LIVE_PATH,
  HEALTH_PATH,
  HEALTH_READY_PATH,
  LIVE_ROUTE,
  PROBE_PATHS,
  READY_ROUTE,
} from "./health.paths";

/**
 * The probe paths as literal strings.
 *
 * Worth asserting on their own, because they are the one part of this service's surface that
 * something *outside the repository's build* depends on: a `HEALTHCHECK` line in an image
 * ([#36](https://github.com/NobuData/ouroboros/issues/36)), a compose healthcheck
 * ([#55](https://github.com/NobuData/ouroboros/issues/55)), an orchestrator's probe. A
 * refactor that changed `/health/live` to `/healthz` would leave every test in this module
 * passing and every container unhealthy.
 */

describe("the probe paths", () => {
  it("are composed from the segments the controller declares", () => {
    expect(HEALTH_PATH).toBe("health");
    expect(LIVE_ROUTE).toBe("live");
    expect(READY_ROUTE).toBe("ready");
  });

  it("are the two paths the rest of the repository is written against", () => {
    expect(HEALTH_LIVE_PATH).toBe("/health/live");
    expect(HEALTH_READY_PATH).toBe("/health/ready");
  });

  it("are enumerated in one place, which is what the prefix exclusion reads", () => {
    expect(PROBE_PATHS).toEqual([HEALTH_LIVE_PATH, HEALTH_READY_PATH]);
  });

  it("sit outside the versioned surface, and outside the prefix entirely", () => {
    for (const path of PROBE_PATHS) {
      expect(path.startsWith(API_BASE_PATH)).toBe(false);
      expect(path.startsWith(`/${API_PREFIX}`)).toBe(false);
    }
  });
});
