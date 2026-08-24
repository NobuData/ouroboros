/**
 * What a request for the credential trail may contain, as a `class-validator` class
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * One class, and every field on it is optional: `GET /api/v1/providers/audit` with no query
 * string is *this workspace's most recent events*, which is what the sheet asks for when
 * somebody presses **Audit log**.
 *
 * ---------------------------------------------------------------------------
 * **The three filters are the three questions a trail is opened with**, and they are worth
 * naming as questions rather than as columns: *what has been done to this key*
 * (`connectionId`), *what has this person done* (`actorId`), and *who has revealed anything*
 * (`action`). AD.4's scope names exactly these three, which is not a coincidence — they are
 * the three an incident starts from.
 *
 * **`action` is validated against the vocabulary rather than against a pattern.** A filter
 * naming an event this service never writes returns an empty page, which is
 * indistinguishable from *nothing has happened yet* and is the wrong answer to a
 * misspelling — `?action=provider.reveal` is a typo, not a finding. `@IsIn` turns it into a
 * `422` naming the field, which is the difference between a client learning it is wrong and a
 * client concluding a workspace is clean.
 *
 * **`connectionId` is a uuid check** for the reason `ConnectionParams.id` is: a value that
 * could not name a row is refused before a statement is issued. `actorId` is **not** — a
 * `"user".id` is text minted by BetterAuth, which preserved uuids at the V006 cut-over but
 * does not promise them, so a uuid rule here would be this module inventing a constraint the
 * library does not make.
 */

import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

import { PageQuery } from "../tenancy/pagination";
import { AUDIT_ACTIONS } from "./audit.events";

/** The longest `"user".id` this filter will carry — generous, and a bound rather than a shape. */
export const MAX_ACTOR_ID_LENGTH = 128;

/** The query string of `GET /api/v1/providers/audit`. */
export class ListAuditQuery extends PageQuery {
  /**
   * One connection — matched against `audit_events.subject_id`.
   *
   * Named `connectionId` rather than `subjectId` because that is what a caller of *this*
   * endpoint has: the trail is served under `/providers`, its subjects are provider
   * connections, and the one event class whose subject is a run (`credential.lease_granted`)
   * is not something a client filters for by id. When #26 opens the general audit surface it
   * will want `subjectType`/`subjectId`, and that endpoint can take them.
   */
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  /** One person — matched against `audit_events.actor_id`. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_ACTOR_ID_LENGTH)
  actorId?: string;

  /** One action — one of `audit.events.ts`'s `AUDIT_ACTIONS`. */
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: string;
}
