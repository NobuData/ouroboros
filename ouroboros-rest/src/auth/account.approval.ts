/**
 * Account approval: who is let in at their first sign-in, and who waits for an administrator.
 *
 * A user request with no issue number (branch `account-approval`). Until it, anybody with a
 * GitHub account could sign in and was handed a personal workspace on the spot. Now a **new**
 * account is decided at the moment BetterAuth creates its `"user"` row, by rule 2 of the
 * request, in this order:
 *
 *   1. an **application administrator** — an address in `OURO_APP_ADMIN_EMAILS` — is approved
 *      (`app_admin`);
 *   2. an address with a **pending, unexpired workspace invitation** is approved (`invited`);
 *   3. an address an administrator **pre-approved** is approved (`preapproved`);
 *   4. everybody else is **held** as `pending` (`held`), the held event is written and every
 *      administrator is emailed.
 *
 * Accounts that existed when V149 shipped are `approved` (`existing`) by the migration, and an
 * application administrator is treated as approved **whatever their stored status says**, which
 * is {@link effectiveAccountStatus}'s rule and the one the guard and the session hook share.
 *
 * ## Why `user.create.before`
 *
 * BetterAuth runs `databaseHooks.user.create.before` for **every** path that creates a user:
 * the GitHub callback, the development password sign-up, and an account link that has to make
 * a person first (`better-auth/dist/db/with-hooks.mjs` — `createWithHooks` is the only way the
 * internal adapter writes a `"user"` row). Deciding there means no path can create an
 * undecided account, and the decision is part of the `insert` rather than an `update` after it.
 * The side effects — the event row and the emails — go in `user.create.after`, which the
 * library queues until the surrounding transaction commits (`queueAfterTransactionHook`), so an
 * administrator is never emailed about a row that rolled back.
 *
 * ## The fields
 *
 * The status is registered as BetterAuth `user.additionalFields` ({@link ACCOUNT_USER_FIELDS}),
 * mapped to V149's snake_case columns, so `session.user.accountStatus` reaches the guard from
 * the session lookup with no extra query, and so the admin routes write the row through the
 * library's adapter — `"user"` is one of `LIBRARY_OWNED_TABLES`, which no statement in this
 * service writes. Every status field is `input: false`: no sign-up body, provider profile or
 * `update-user` call can choose its own status.
 *
 * Like `auth.options.ts`, this module imports nothing from NestJS and no value from
 * `better-auth`, so `@better-auth/cli` can load it and a CommonJS test runner can exercise it.
 * Its collaborators — the lookups and the notifier — are interfaces, built over the shared
 * connection pool by {@link poolLookups} and {@link holdNotifier}.
 *
 * @see ../../../ouroboros-db/migrations/V149__account_approval.sql — the columns and tables.
 * @see session-or-service.guard.ts — where a held account is refused.
 * @see active.organization.ts — which gives a held account no personal workspace.
 */

import type { BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";

import type { Configuration } from "../modules/config/configuration";
import type { AccountStatus, AccountStatusReason } from "../modules/db/schema";
import { describeForLog } from "../modules/errors/failure";
import type { Mailer } from "../modules/mail/mailer";
import { heldMail, mailEnabled } from "./account.mail";

/** Every account status, in the order the admin page reads them. */
export const ACCOUNT_STATUSES = [
  "approved",
  "pending",
  "denied",
] as const satisfies readonly AccountStatus[];

/** BetterAuth's `user.additionalFields` option, as the library declares it. */
type AdditionalUserFields = NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

/**
 * The BetterAuth user fields account approval adds, mapped onto V149's columns.
 *
 *   * **`accountStatus`** → `account_status`. Returned, so it rides in the session lookup and
 *     the cookie snapshot — that is what lets the guard decide without a query.
 *   * **`accountStatusChangedAt`**, **`accountStatusChangedBy`**, **`accountStatusReason`** →
 *     their columns, **not returned**: only the admin routes read them (with their own
 *     `select`), so they stay out of every session payload.
 *   * **`githubLogin`** → `github_login`, filled from the GitHub profile at creation
 *     (`github.provider.ts`). It is the one field with `input` left on, because BetterAuth
 *     drops provider-profile fields marked `input: false`
 *     (`parseAdditionalUserInputFromProviderProfile`); {@link keepGithubLoginFixed} stops an
 *     `update-user` call from changing it afterwards.
 *
 * None is `required`, and none has a BetterAuth `defaultValue`: the database default
 * (`approved`) is for rows that predate the hook, and the hook sets every status field on a
 * new row itself.
 */
export const ACCOUNT_USER_FIELDS = {
  accountStatus: {
    type: "string",
    required: false,
    input: false,
    fieldName: "account_status",
  },
  accountStatusChangedAt: {
    type: "date",
    required: false,
    input: false,
    returned: false,
    fieldName: "account_status_changed_at",
  },
  accountStatusChangedBy: {
    type: "string",
    required: false,
    input: false,
    returned: false,
    fieldName: "account_status_changed_by",
  },
  accountStatusReason: {
    type: "string",
    required: false,
    input: false,
    returned: false,
    fieldName: "account_status_reason",
  },
  githubLogin: {
    type: "string",
    required: false,
    fieldName: "github_login",
  },
} as const satisfies AdditionalUserFields;

/**
 * Is this address an application administrator's?
 *
 * @param email - The address, in any case.
 * @param appAdminEmails - `OURO_APP_ADMIN_EMAILS`, already lower-cased by the configuration.
 * @returns `true` when it is listed.
 */
export function isAppAdmin(
  email: string | null | undefined,
  appAdminEmails: readonly string[],
): boolean {
  return email !== null && email !== undefined && appAdminEmails.includes(email.toLowerCase());
}

/** As much of a person as deciding their effective status needs. */
export interface AccountHolder {
  /** Their address. */
  readonly email: string;
  /** The stored status — absent from a session snapshot minted before V149. */
  readonly accountStatus?: string | null;
}

/**
 * What a person's account status *is*, for every decision that admits or refuses them.
 *
 * An application administrator is `approved` whatever is stored (decision 1). Otherwise the
 * stored value — or `unknown` when there is none to read, which only a cookie snapshot written
 * before V149 can produce. Callers treat `unknown` as "ask the database", never as approved.
 *
 * @param holder - The person.
 * @param appAdminEmails - `OURO_APP_ADMIN_EMAILS`.
 * @returns The effective status, or `unknown`.
 */
export function effectiveAccountStatus(
  holder: AccountHolder,
  appAdminEmails: readonly string[],
): AccountStatus | "unknown" {
  if (isAppAdmin(holder.email, appAdminEmails)) return "approved";

  const stored = holder.accountStatus;

  return ACCOUNT_STATUSES.includes(stored as AccountStatus) ? (stored as AccountStatus) : "unknown";
}

/**
 * Whether a person may use the product: effectively `approved`.
 *
 * @param holder - The person.
 * @param appAdminEmails - `OURO_APP_ADMIN_EMAILS`.
 * @returns `true` for an approved account or an application administrator.
 */
export function isEffectivelyApproved(
  holder: AccountHolder,
  appAdminEmails: readonly string[],
): boolean {
  return effectiveAccountStatus(holder, appAdminEmails) === "approved";
}

/** The facts rule 2 decides a new account on. */
export interface AccountDecisionFacts {
  /** The address is in `OURO_APP_ADMIN_EMAILS`. */
  readonly appAdmin: boolean;
  /** The address has a pending, unexpired workspace invitation. */
  readonly invited: boolean;
  /** An administrator pre-approved the address. */
  readonly preapproved: boolean;
}

/** A new account's status and the reason recorded beside it. */
export interface AccountDecision {
  readonly status: AccountStatus;
  readonly reason: AccountStatusReason;
}

/**
 * Decide a new account, by rule 2: administrator, then invitation, then pre-approval, else held.
 *
 * @param facts - What is known about the address.
 * @returns The status and the reason. Only the last branch is `pending`.
 */
export function decideAccountStatus(facts: AccountDecisionFacts): AccountDecision {
  if (facts.appAdmin) return { status: "approved", reason: "app_admin" };
  if (facts.invited) return { status: "approved", reason: "invited" };
  if (facts.preapproved) return { status: "approved", reason: "preapproved" };

  return { status: "pending", reason: "held" };
}

/** The two reads behind rule 2's exemptions. */
export interface AccountApprovalLookups {
  /**
   * @param email - A lower-cased address.
   * @returns `true` when a workspace invitation to it is `pending` and not yet expired.
   */
  hasPendingInvitation(email: string): Promise<boolean>;
  /**
   * @param email - A lower-cased address.
   * @returns `true` when an administrator pre-approved it.
   */
  isPreapproved(email: string): Promise<boolean>;
}

/** The slice of `pg.Pool` this module issues statements through. */
export type QueryPool = Pick<Pool, "query">;

/**
 * The lookups, over the shared pool.
 *
 * Unqualified table names, as BetterAuth's own statements are: the pool connects with
 * `search_path=ouroboros,public` (`modules/db/pool.ts`). Reads only — `invitation` is a
 * library-owned table this service may read and never write.
 *
 * @param pool - The service's pool.
 * @returns The lookups.
 */
export function poolLookups(pool: QueryPool): AccountApprovalLookups {
  return {
    async hasPendingInvitation(email) {
      const { rowCount } = await pool.query(
        `select 1 from invitation
          where lower("email") = $1 and "status" = 'pending' and "expiresAt" > now()
          limit 1`,
        [email],
      );

      return (rowCount ?? 0) > 0;
    },
    async isPreapproved(email) {
      const { rowCount } = await pool.query(
        "select 1 from app_preapproved_emails where email = $1",
        [email],
      );

      return (rowCount ?? 0) > 0;
    },
  };
}

/** Where a failure that must not fail a sign-in is reported. */
export interface ApprovalLogger {
  warn(message: string): void;
}

/** The person a hold is about, as the created `"user"` row carries them. */
export interface HeldAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly githubLogin?: string | null;
}

/** What happens once a held account's row has committed. */
export interface AccountHoldNotifier {
  /**
   * Record the hold and tell the administrators. Never throws: each failure is logged.
   *
   * @param account - The person held.
   */
  held(account: HeldAccount): Promise<void>;
}

/** What {@link holdNotifier} needs. */
export interface HoldNotifierDependencies {
  /** The service's pool, for the event row. */
  readonly pool: QueryPool;
  /** The mailer; `undefined` or an unconfigured one sends nothing. */
  readonly mailer?: Mailer;
  /** The administrators to email, and the UI base URL for the link. */
  readonly configuration: Pick<Configuration, "appAdminEmails" | "uiUrl">;
  /** Where failures go. */
  readonly logger: ApprovalLogger;
}

/**
 * The notifier: an `app_account_events` `held` row, then one email per administrator.
 *
 * Each step is caught on its own, so a failed insert still emails and one refused address does
 * not stop the next. Nothing here can fail the sign-in that caused it — the person is already
 * held, and the admin page lists them whether or not anybody was told.
 *
 * @param dependencies - See {@link HoldNotifierDependencies}.
 * @returns The notifier.
 */
export function holdNotifier({
  pool,
  mailer,
  configuration,
  logger,
}: HoldNotifierDependencies): AccountHoldNotifier {
  return {
    async held(account) {
      try {
        await pool.query(
          `insert into app_account_events (action, subject_user_id, subject_email, detail)
           values ('held', $1, $2, $3)`,
          [account.id, account.email.toLowerCase(), JSON.stringify({ reason: "held" })],
        );
      } catch (error) {
        logger.warn(`Could not record that ${account.id} was held: ${describeForLog(error)}`);
      }

      if (!mailEnabled(mailer)) return;

      for (const admin of configuration.appAdminEmails) {
        try {
          await mailer.send(heldMail(admin, account, configuration.uiUrl));
        } catch (error) {
          logger.warn(
            `Could not email ${admin} that ${account.id} is held: ${describeForLog(error)}`,
          );
        }
      }
    },
  };
}

/** BetterAuth's `databaseHooks.user`, as the library declares it. */
type UserHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>;

/** What {@link accountApprovalHooks} needs. */
export interface AccountApprovalDependencies {
  /** `OURO_APP_ADMIN_EMAILS`. */
  readonly configuration: Pick<Configuration, "appAdminEmails">;
  /** The exemption reads. */
  readonly lookups: AccountApprovalLookups;
  /** What runs after a held account commits. */
  readonly notifier: AccountHoldNotifier;
  /** Where a failed lookup is reported before the account is held anyway. */
  readonly logger: ApprovalLogger;
}

/**
 * Decide a new account's status from the address alone.
 *
 * The reads short-circuit in rule order — an administrator costs no query, an invited address
 * one. A lookup that fails is logged and treated as *no exemption*: the account is held rather
 * than the sign-in failing, which is the closed direction to fail in and one an administrator
 * can undo with one press.
 *
 * @param email - The new account's address.
 * @param dependencies - The configuration, the lookups and the logger.
 * @returns The decision.
 */
export async function decideNewAccount(
  email: string,
  { configuration, lookups, logger }: Omit<AccountApprovalDependencies, "notifier">,
): Promise<AccountDecision> {
  const address = email.toLowerCase();
  const appAdmin = isAppAdmin(address, configuration.appAdminEmails);

  if (appAdmin) return decideAccountStatus({ appAdmin, invited: false, preapproved: false });

  try {
    const invited = await lookups.hasPendingInvitation(address);
    const preapproved = invited ? false : await lookups.isPreapproved(address);

    return decideAccountStatus({ appAdmin, invited, preapproved });
  } catch (error) {
    logger.warn(
      `Could not check ${address} for an exemption; holding it: ${describeForLog(error)}`,
    );

    return decideAccountStatus({ appAdmin, invited: false, preapproved: false });
  }
}

/**
 * Stop an update from changing the GitHub login after creation.
 *
 * `githubLogin` keeps `input` on so the provider profile can fill it ({@link ACCOUNT_USER_FIELDS}),
 * which would also let `POST /api/auth/update-user` rewrite it — and the admin page shows it as
 * who a stranger is. BetterAuth merges a `before` hook's answer over the update rather than
 * replacing it, so the field is set to `undefined`, which the adapter skips.
 *
 * @param update - The update the library is about to write.
 * @returns The update without the login, or nothing when it never named one.
 */
export const keepGithubLoginFixed: NonNullable<NonNullable<UserHooks["update"]>["before"]> = (
  update,
) =>
  Promise.resolve(
    update.githubLogin === undefined ? undefined : { data: { ...update, githubLogin: undefined } },
  );

/**
 * The `user` half of BetterAuth's `databaseHooks`: decide at creation, notify after commit, and
 * keep the login fixed.
 *
 * @param dependencies - See {@link AccountApprovalDependencies}.
 * @returns The hooks, a fresh object each call.
 */
export function accountApprovalHooks(dependencies: AccountApprovalDependencies): UserHooks {
  return {
    create: {
      async before(user) {
        const decision = await decideNewAccount(user.email, dependencies);

        return {
          data: {
            ...user,
            accountStatus: decision.status,
            accountStatusReason: decision.reason,
            accountStatusChangedAt: new Date(),
            accountStatusChangedBy: null,
          },
        };
      },
      async after(user) {
        if (user.accountStatus !== "pending") return;

        await dependencies.notifier.held({
          id: user.id,
          name: user.name,
          email: user.email,
          githubLogin: typeof user.githubLogin === "string" ? user.githubLogin : null,
        });
      },
    },
    update: { before: keepGithubLoginFixed },
  };
}
