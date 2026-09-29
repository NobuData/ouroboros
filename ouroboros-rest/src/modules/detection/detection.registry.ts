/**
 * `RulePackRegistry` — the versioned rule packs a scan runs
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * The same shape as `TicketSourceRegistry`: the set is injected as a list under
 * {@link RULE_PACKS}, and everything wrong with it stops the process at boot — a malformed
 * version, a row key V067 would refuse, two packs claiming one row. Found then rather than at the
 * first scan, when the onboarding card would be the thing that broke.
 */

import { Inject, Injectable } from "@nestjs/common";

import { PACK_KEY, PACK_VERSION, isRowKey, type RulePack } from "./detection.pack";

/** The injection token for the list of packs — `detection.module.ts` provides it. */
export const RULE_PACKS = "RULE_PACKS";

@Injectable()
export class RulePackRegistry {
  /** The packs, in registration order — which is the order their rows are emitted. */
  private readonly packs: readonly RulePack[];

  /**
   * @param packs - Every registered pack.
   * @throws {Error} Listing every violation at once, when the set is not one a scan can run.
   */
  constructor(@Inject(RULE_PACKS) packs: readonly RulePack[]) {
    const violations = rulePackViolations(packs);

    if (violations.length > 0) {
      throw new Error(`The rule packs cannot be registered: ${violations.join("; ")}`);
    }

    this.packs = [...packs];
  }

  /**
   * Every pack.
   *
   * @returns The packs, in registration order.
   */
  all(): readonly RulePack[] {
    return this.packs;
  }

  /**
   * The versions a scan records.
   *
   * @returns `{ pack key: version }`.
   */
  versions(): Record<string, string> {
    return Object.fromEntries(this.packs.map((pack) => [pack.key, pack.version]));
  }
}

/**
 * Everything wrong with a set of packs.
 *
 * @param packs - The packs.
 * @returns The violations; empty when the set is registrable.
 */
export function rulePackViolations(packs: readonly RulePack[]): string[] {
  const violations: string[] = [];
  const keys = new Set<string>();
  const owners = new Map<string, string>();

  for (const pack of packs) {
    if (!PACK_KEY.test(pack.key)) {
      violations.push(`pack key "${pack.key}" is not lower-case letters, digits, _ and -`);
    }

    if (keys.has(pack.key)) {
      violations.push(`two packs are registered as "${pack.key}"`);
    }

    keys.add(pack.key);

    if (!PACK_VERSION.test(pack.version)) {
      violations.push(`pack "${pack.key}" version "${pack.version}" is not major.minor.patch`);
    }

    if (pack.rows.length === 0) {
      violations.push(`pack "${pack.key}" declares no rows`);
    }

    for (const row of pack.rows) {
      if (!isRowKey(row)) {
        violations.push(
          `pack "${pack.key}" declares row "${String(row)}", which is neither core nor custom:<name>`,
        );
      }

      const owner = owners.get(row);

      if (owner !== undefined) {
        violations.push(`row "${row}" is declared by both "${owner}" and "${pack.key}"`);
      }

      owners.set(row, pack.key);
    }
  }

  return violations;
}
