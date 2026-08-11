import { Injectable } from "@nestjs/common";

import { SERVICE_NAME, serviceVersion } from "../../version";

/**
 * The body of a heartbeat response.
 *
 * Deliberately the same three questions `ouroboros-engine`'s `/v0/status` answers, in
 * the same order — *what is this*, *which build*, *how long has it been up* — so someone
 * looking at both services is reading one shape rather than two.
 */
export interface Heartbeat {
  /** This service's name, constant across deployments. */
  service: string;
  /** The running build, from this module's manifest. */
  version: string;
  /** Always `ok`: reaching this handler at all is what the field reports. */
  status: "ok";
  /**
   * Seconds since the service was constructed. Small and shrinking across polls means
   * something is restarting the process — which is the one thing a heartbeat can tell
   * you that a plain `200` cannot.
   */
  uptimeSeconds: number;
}

/**
 * The heartbeat itself.
 *
 * The first provider in the module tree, and for now the only one. Everything that makes
 * this service interesting — configuration (#28), health probes with real dependency
 * checks (#29), the database (#30) — is a module beside this one rather than an addition
 * to it, so this stays what it is: proof that the application is wired together and
 * answering on the path it promises.
 */
@Injectable()
export class AppService {
  /**
   * When this provider was constructed, which Nest does once while building the module
   * tree — so it is within milliseconds of process start and well before the first
   * request can arrive.
   */
  private readonly startedAt = Date.now();

  /**
   * Report that the service is up, and which build is up.
   *
   * @returns A {@link Heartbeat}. `uptimeSeconds` is derived from a millisecond clock,
   *   so it carries three decimal places and no false precision beyond them.
   */
  heartbeat(): Heartbeat {
    return {
      service: SERVICE_NAME,
      version: serviceVersion(),
      status: "ok",
      uptimeSeconds: (Date.now() - this.startedAt) / 1000,
    };
  }
}
