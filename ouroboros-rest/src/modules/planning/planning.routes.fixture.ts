/**
 * Every planning route, read off the controllers' own metadata (AL.6,
 * [#282](https://github.com/NobuData/ouroboros/issues/282)).
 *
 * The role matrix and the isolation suite have to cover **every** planning route, not a sample —
 * and a hand-written list is a sample the day somebody adds a route without adding a row. So the
 * suites read the inventory from what Nest routes by (`PATH_METADATA`, `METHOD_METADATA`) and what
 * the global `RolesGuard` reads (`REQUIRED_ROLES`), and fail when a route has no case.
 *
 * ```
 * BatchesController  ─┐
 *                     ├─▶ planningRoutes() ─▶ [{ method, path, key, roles, mutating }]
 * PlanningController ─┘
 * ```
 */

import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { API_BASE_PATH } from "../../application";
import type { OrganizationRole } from "../db/schema";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { BatchesController } from "./batches.controller";
import { PlanningController } from "./planning.controller";

/** The HTTP verbs a planning route answers, in Supertest's spelling. */
export type RouteMethod = "get" | "post" | "put" | "patch" | "delete";

/** One planning route. */
export interface PlanningRoute {
  /** The verb. */
  readonly method: RouteMethod;
  /** The full path a client sends, parameters left as `:name` — `/api/v1/planning/epics/:epic`. */
  readonly path: string;
  /** `POST /api/v1/planning/epics/:epic` — what a case table is keyed by. */
  readonly key: string;
  /** The roles `@Roles(…)` requires, or null when every member may call it. */
  readonly roles: readonly OrganizationRole[] | null;
  /** Whether the route writes — anything but `GET`. */
  readonly mutating: boolean;
}

/** The controllers that make up the planning API. A new one belongs here. */
export const PLANNING_CONTROLLERS: readonly (abstract new (...args: never[]) => object)[] = [
  BatchesController,
  PlanningController,
];

/**
 * Join a controller's path and a handler's path the way Nest's router does.
 *
 * @param controllerPath - `planning/batches`.
 * @param handlerPath - `:batch/push`, or `/` for the controller's root.
 * @returns `/api/v1/planning/batches/:batch/push`.
 */
export function joinRoute(controllerPath: string, handlerPath: string): string {
  const segments = [controllerPath, handlerPath]
    .flatMap((part) => part.split("/"))
    .filter((segment) => segment !== "");

  return `${API_BASE_PATH}/${segments.join("/")}`;
}

/**
 * Every route the planning controllers declare, in declaration order.
 *
 * @param controllers - The controllers to read. Defaults to {@link PLANNING_CONTROLLERS}.
 * @returns The routes.
 * @throws {Error} When a controller carries no path, or a handler's verb is not one Supertest
 *   sends — either would mean the inventory is silently short.
 */
export function planningRoutes(
  controllers: readonly (abstract new (...args: never[]) => object)[] = PLANNING_CONTROLLERS,
): PlanningRoute[] {
  const routes: PlanningRoute[] = [];

  for (const controller of controllers) {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as unknown;

    if (typeof controllerPath !== "string") {
      throw new Error(`${controller.name} is not a routed controller`);
    }

    const prototype = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];

      if (name === "constructor" || typeof handler !== "function") {
        continue;
      }

      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as unknown;

      if (typeof handlerPath !== "string") {
        continue;
      }

      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const method = verb.toLowerCase() as RouteMethod;

      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        throw new Error(`${controller.name}.${name} answers ${verb}, which no case table covers`);
      }

      const path = joinRoute(controllerPath, handlerPath);
      const roles = Reflect.getMetadata(REQUIRED_ROLES, handler) as
        readonly OrganizationRole[] | undefined;

      routes.push({
        method,
        path,
        key: `${verb} ${path}`,
        roles: roles === undefined || roles.length === 0 ? null : roles,
        mutating: method !== "get",
      });
    }
  }

  return routes;
}

/**
 * Fill a route's `:name` parameters.
 *
 * @param path - `/api/v1/planning/batches/:batch/drafts/:key`.
 * @param values - `{ batch: "…", key: "OTA-1" }`.
 * @returns The path a client sends.
 * @throws {Error} When a parameter has no value — a case that would otherwise hit a `404` for the
 *   wrong reason.
 */
export function fillRoute(path: string, values: Readonly<Record<string, string>>): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = values[name];

    if (value === undefined) {
      throw new Error(`no value for :${name} in ${path}`);
    }

    return encodeURIComponent(value);
  });
}
