import "server-only";

/**
 * What the waiting page needs to know (account approval): is anybody signed in, and is their
 * account still on hold?
 *
 * One read, `GET /api/v1/account/status`, which the service leaves open to held accounts. It
 * goes through `anonymousApi()`, for the recovery screen's reason: the wired client turns a held
 * account's `403` into a redirect **to this page**, and a `401` into a redirect the page would
 * rather decide itself.
 */

import { type AccountStatus, accountStatus } from "@/app/api/accounts";
import { isApiError } from "@/app/api/errors";
import { anonymousApi } from "@/app/api/server";

import type { HeldStatus } from "./pending";

/** Where the reader stands, as far as the waiting page is concerned. */
export type AccountStanding =
  | { readonly state: "signed-out" }
  | { readonly state: "approved" }
  | { readonly state: "held"; readonly status: HeldStatus; readonly email: string };

/**
 * Read the reader's standing.
 *
 * @param read The status read. Defaults to the service's, through `anonymousApi()`.
 * @returns `signed-out` for a `401`, `approved` for an approved account (an application
 *   administrator always is), and `held` with the status and email otherwise.
 * @throws {ApiError} Any other failure — an outage is not a signed-out visitor.
 */
export async function readAccountStanding(
  read: () => Promise<AccountStatus> = () => accountStatus.read(anonymousApi()),
): Promise<AccountStanding> {
  let answer: AccountStatus;
  try {
    answer = await read();
  } catch (error) {
    if (isApiError(error) && error.isUnauthenticated) return { state: "signed-out" };
    throw error;
  }

  if (answer.status === "approved") return { state: "approved" };

  return { state: "held", status: answer.status, email: answer.email };
}
