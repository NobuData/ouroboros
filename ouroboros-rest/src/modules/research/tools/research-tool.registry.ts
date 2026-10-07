/**
 * The research tool registry — one lookup by slug, and the refusals it is allowed to make.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), decision **V2**. Core code —
 * the internal tool surface, the tools card, the enable flow — asks *this* for a tool and never
 * imports one; `.dependency-cruiser.cjs` makes that a build failure. `research-tools.module.ts`
 * is the single registration point, under {@link RESEARCH_TOOL_ADAPTERS}.
 *
 * It ships with **no** adapter registered: CL.2–CL.6 (#615–#619) each add one. Until they do,
 * the internal surface answers `501 research_tool_not_registered` for every slug — the model
 * provider registry's honest answer for a kind it cannot reach yet.
 *
 * Two misuses are refused at construction, so they stop the process at boot rather than fail in
 * front of a running investigation: two adapters claiming one slug, and an adapter whose
 * capability flags disagree with its operation members.
 */

import { Inject, Injectable } from "@nestjs/common";

import {
  TOOL_OPERATIONS,
  declaredOperations,
  operationMemberOf,
  type ResearchToolAdapter,
} from "./research-tool.adapter";
import { toolNotRegistered } from "./research-tool.errors";

/** The DI token the registered adapters are injected under — bound in one module only. */
export const RESEARCH_TOOL_ADAPTERS = Symbol("RESEARCH_TOOL_ADAPTERS");

/** A slug: lowercase, `[a-z0-9_-]`, as `research_tools.slug` is spelled. */
export const TOOL_SLUG = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Everything wrong with an adapter's registration — empty when it may be registered.
 *
 * Shared by the registry's constructor and the conformance kit, so a tool that would not boot
 * fails its kit with the same sentence.
 *
 * @param adapter - The adapter.
 * @returns The violations.
 */
export function registrationViolations(adapter: ResearchToolAdapter): string[] {
  const violations: string[] = [];

  if (typeof adapter.slug !== "string" || !TOOL_SLUG.test(adapter.slug)) {
    violations.push(`slug "${String(adapter.slug)}" is not a research tool slug`);
  }

  const flags = adapter.capabilities();

  for (const operation of TOOL_OPERATIONS) {
    const present = typeof operationMemberOf(adapter, operation) === "function";

    if (flags[operation] !== present) {
      violations.push(
        `declares ${operation}: ${String(flags[operation])} but its ${operation} member says otherwise`,
      );
    }
  }

  if (declaredOperations(adapter).length === 0 && !flags.watch) {
    violations.push("declares no capability at all — a tool must search, fetch, query or watch");
  }

  return violations;
}

@Injectable()
export class ResearchToolRegistry {
  /** The adapters, by slug. Built once and never added to. */
  private readonly bySlug: ReadonlyMap<string, ResearchToolAdapter>;

  /**
   * @param adapters - Every registered adapter, from {@link RESEARCH_TOOL_ADAPTERS}.
   * @throws {Error} When two adapters claim one slug, or one fails
   *   {@link registrationViolations}. Both are programming errors.
   */
  constructor(@Inject(RESEARCH_TOOL_ADAPTERS) adapters: readonly ResearchToolAdapter[]) {
    const bySlug = new Map<string, ResearchToolAdapter>();

    for (const adapter of adapters) {
      if (bySlug.has(adapter.slug)) {
        throw new Error(`Two research tools are registered for slug "${adapter.slug}"`);
      }

      const violations = registrationViolations(adapter);

      if (violations.length > 0) {
        throw new Error(`Research tool "${adapter.slug}": ${violations.join("; ")}`);
      }

      bySlug.set(adapter.slug, adapter);
    }

    this.bySlug = bySlug;
  }

  /** @returns The registered slugs, sorted — stable between builds. */
  slugs(): string[] {
    return [...this.bySlug.keys()].toSorted();
  }

  /**
   * @param slug - A tool slug.
   * @returns The adapter, or `undefined` when this build has none.
   */
  find(slug: string): ResearchToolAdapter | undefined {
    return this.bySlug.get(slug);
  }

  /**
   * @param slug - A tool slug.
   * @returns The adapter.
   * @throws {NotImplementedError} `501 research_tool_not_registered` when there is none.
   */
  get(slug: string): ResearchToolAdapter {
    const adapter = this.bySlug.get(slug);

    if (adapter === undefined) {
      throw toolNotRegistered(slug, this.slugs());
    }

    return adapter;
  }
}
