/**
 * A run's tag row — the refs every run-scoped card carries, composed once.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). The protected-path, plan
 * sign-off and needs-human cards each start with `loop #1851` and, where the run is known to work a
 * canonical ticket, `issue #479`. A run names its ticket only through the PR it opened
 * (`pull_requests.run_id` → `ticket_id`), so the ticket ref appears once that PR exists and is
 * simply absent before — `ticket` is optional on every run-scoped kind, so the card is honest
 * either way rather than guessing a ticket from an issue number.
 */

import type { Kysely } from "kysely";

import type { Database } from "../db/schema";
import type { DecisionRef } from "./decision.types";

/**
 * A fact cut to a kind's `maxLength`, on a code-point boundary, with an ellipsis when cut — so a
 * long ticket title never fails a payload schema.
 *
 * @param text - The fact.
 * @param max - The kind's `maxLength` for it.
 * @returns The text, at most `max` code points.
 */
export function clipFact(text: string, max: number): string {
  const points = [...text.trim()];

  return points.length <= max ? points.join("") : `${points.slice(0, max - 1).join("")}…`;
}

/** A run's facts every run-scoped card reads. */
export interface RunCardFacts {
  readonly runId: string;
  readonly organizationId: string;
  /** The run's ticket title — the card's `subject`. */
  readonly subject: string;
  /** The stage it is on, as its workflow labels it. */
  readonly stageLabel: string;
  /** `run` then, when known, `ticket`. */
  readonly refs: readonly DecisionRef[];
}

/**
 * Read a run's subject, stage and tag row.
 *
 * @param db - The query builder.
 * @param runId - The run.
 * @returns The facts, or undefined when there is no such run.
 */
export async function runCardFacts(
  db: Kysely<Database>,
  runId: string,
): Promise<RunCardFacts | undefined> {
  const run = await db
    .selectFrom("runs")
    .select(["id", "organization_id", "loop_seq", "issue_title", "stage_label"])
    .where("id", "=", runId)
    .executeTakeFirst();

  if (run === undefined) {
    return undefined;
  }

  const ticket = await db
    .selectFrom("pull_requests")
    .innerJoin("tickets", "tickets.id", "pull_requests.ticket_id")
    .select(["tickets.id", "tickets.external_key"])
    .where("pull_requests.run_id", "=", runId)
    .where("pull_requests.organization_id", "=", run.organization_id)
    .orderBy("pull_requests.created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const refs: DecisionRef[] = [{ type: "run", id: run.id, label: `loop #${String(run.loop_seq)}` }];

  if (ticket !== undefined) {
    refs.push({ type: "ticket", id: ticket.id, label: `issue ${ticket.external_key}` });
  }

  return {
    runId: run.id,
    organizationId: run.organization_id,
    subject: run.issue_title,
    stageLabel: run.stage_label,
    refs,
  };
}
