/**
 * Every decision the enroll card and the token list make, and every sentence they say
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * Mockup 08's ENROLL A RUNNER card prints a command with a masked token. Rendered as static text
 * it would look right and enrol nothing, so the card mints a real scoped token (AH.2, #250)
 * through AH.6's enroll-command read (#254) — which makes it a credential surface, and this
 * module is where that discipline is written down as values a suite can hold still.
 *
 * **Framework-free and pure**, the way `app/farm/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The mint and the revoke are `app/farm/enroll-actions.ts`'s,
 * the clipboard is `app/farm/clipboard.ts`'s, and the drawing is `app/farm/enroll-card.tsx`'s and
 * `app/farm/token-list.tsx`'s.
 *
 * ### The token's value has one destination
 *
 * The full `orb_enroll_…` value exists in the clipboard payload and nowhere else: it is never put
 * in React state, never rendered and never logged. {@link maskedCommand} is the seam — it turns
 * the command as minted into the command as *shown*, on the server, so what reaches a component's
 * state is already masked — and it **fails closed**: a command it cannot mask with certainty is a
 * command it does not show at all.
 *
 * ### The mint is the copy
 *
 * The enroll-command read mints on every call and is the only thing that knows this deployment's
 * origin and its pinned agent version. So nothing is minted to draw the card: at rest it shows
 * the command's *shape* ({@link restingCommand}) and claims no host, and **Copy command** is the
 * moment a token is minted, handed to the clipboard and forgotten. What the card shows afterwards
 * is that command, masked, with the origin and version the service answered.
 */

import type { EnrollmentToken, RunnerPool } from "@/app/api/farm";
import type { Role } from "@/app/api/membership";
import { ageOfSeconds, article } from "@/app/format";

/* ------------------------------------------------------------------ the card's words */

/** The card's title, verbatim from the mockup (the design system draws it in capitals). */
export const ENROLL_TITLE = "Enroll a runner";

/** The mTLS note under the command, **verbatim** from the mockup — an acceptance criterion. */
export const MTLS_NOTE = "The agent connects outbound over mTLS and registers itself.";

/** The copy action, verbatim from the mockup. */
export const COPY_COMMAND = "Copy command";

/** The same control while a mint is in flight. */
export const COPYING_COMMAND = "Copying…";

/** The link to the token list. */
export const MANAGE_TOKENS = "Manage tokens →";

/** The pool selector's label. */
export const POOL_LABEL = "Pool";

/** The command block's accessible name. */
export const COMMAND_LABEL = "Enroll command";

/** What dismisses the toast. */
export const DISMISS_TOAST = "Dismiss";

/**
 * The copy toast.
 *
 * It says the reader now holds a secret, and it **claims nothing about the clipboard** — not
 * that it will be cleared, not for how long it holds. The UI cannot keep either promise.
 */
export const COPIED_TOAST = "Copied — treat this as a secret.";

/** What the explainer names before a mint has answered with the deployment's own address. */
export const THIS_DEPLOYMENT = "this deployment";

/** The mask the resting command carries where a token will go — the mockup's own. */
export const RESTING_TOKEN = "orb_enroll_••••";

/** Why an administrator of a workspace with no pools cannot copy a command. */
export const NO_POOLS_REASON = "Create a pool first — a token always names the pool a runner joins.";

/** Why nobody can copy a command while the farm page could not be read. */
export const POOLS_UNREAD_REASON = "The pools could not be read, so there is no pool to enrol into.";

/** What a reader who may not mint is told, in place of the controls. */
export const MEMBER_NOTE =
  "An owner or an admin mints the enrollment token this command carries, so they are the ones " +
  "who can copy it.";

/** Why the head's **+ Enroll runner** is inert for a reader who may not mint. */
export const ENROLL_MEMBER_REASON = "Enrolling a runner needs an owner or an admin.";

/** The id of the pool selector — what the head's **+ Enroll runner** moves focus to. */
export const ENROLL_POOL_FIELD_ID = "enroll-runner-pool";

/** The id of the copy control — where that focus goes instead when there is no pool to select. */
export const ENROLL_COPY_ID = "enroll-runner-copy";

/**
 * What stands where the command would be when {@link maskedCommand} refused: the copy took, and
 * the card will not draw a string it could not mask with certainty.
 */
export const COMMAND_WITHHELD =
  "The command is on your clipboard. It is not repeated here because its token could not be " +
  "masked with certainty.";

/**
 * Where a withheld command installs from, so the origin and the pinned version are still said.
 *
 * @param origin The https origin the service answered.
 * @param version The agent release the command pins.
 * @returns The sentence.
 */
export function installsFrom(origin: string, version: string): string {
  return `It installs agent ${version} from ${origin}.`;
}

/**
 * What a revoke says out loud — with the number the service calls the one an incident turns on.
 *
 * @param token The token as the revoke answered it.
 * @returns `Revoked orb_enroll_••••a4b7. It had enrolled 0 machines.`
 */
export function revokedNote(token: EnrollmentToken): string {
  return `Revoked ${token.masked}. It had enrolled ${token.uses} ${token.uses === 1 ? "machine" : "machines"}.`;
}

/**
 * The explainer's sentence, in the three parts a component draws around a `mono` span.
 *
 * @param host The deployment's address as {@link hostOf} spells it, or `null` before a mint has
 *   answered — in which case the sentence names no host rather than guessing one.
 * @returns What comes before the host, the host, and what comes after.
 */
export function explainer(host: string | null): {
  readonly before: string;
  readonly host: string;
  readonly mono: boolean;
  readonly after: string;
} {
  return {
    before: "Run this on any machine that can reach ",
    host: host ?? THIS_DEPLOYMENT,
    // A placeholder is prose, not an address, and is not drawn as one.
    mono: host !== null,
    after: " — no inbound ports needed.",
  };
}

/** The port an `https:` origin is reached on when it names none. */
const HTTPS_PORT = "443";

/**
 * An origin as the explainer names it — the mockup's `ouroboros.acme.dev:443`.
 *
 * The port is always said, because *which port has to be reachable* is the whole of what the
 * sentence is for, and a default one is still one a firewall has to allow.
 *
 * @param origin The https origin the service answered.
 * @returns `host:port`, or `null` for something that is not a URL — the explainer then keeps
 *   its placeholder rather than printing a string nobody can reach.
 */
export function hostOf(origin: string): string | null {
  try {
    const url = new URL(origin);

    return `${url.hostname}:${url.port === "" ? HTTPS_PORT : url.port}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the command, as shown */

/** The flag whose value is the secret. The space is part of it: `--token-ttl` is another flag. */
const TOKEN_FLAG = "--token ";

/** How every live token's value begins — what {@link maskedCommand} refuses to let through. */
const TOKEN_PREFIX = "orb_enroll_";

/** The line continuation the service wraps the command on. */
const CONTINUE = " \\\n  ";

/**
 * The command's shape, before anything has been minted.
 *
 * It claims only what the page already knows — the workspace and the pool chosen — and says
 * `<this deployment>` where the origin will be, because the origin and the pinned version are the
 * service's to answer and a guess from `window.location` would be the UI's address, not the one
 * runner machines reach. **It enrols nothing and cannot be copied**: there is no token in it.
 *
 * @param tenant The workspace's slug — the command's `--tenant`.
 * @param pool The pool chosen, or `null` when there is none to choose.
 * @returns The shape, wrapped as the minted command is.
 */
export function restingCommand(tenant: string, pool: string | null): string {
  return [
    "curl -fsSL <this deployment>/install.sh | sh -s --",
    `--tenant ${tenant}`,
    `--pool ${pool ?? "<pool>"}`,
    `${TOKEN_FLAG}${RESTING_TOKEN}`,
  ].join(CONTINUE);
}

/**
 * The command as minted, with its token masked — the only form a component may hold.
 *
 * `--token` is the command's last argument, so everything from the flag to the end is dropped
 * and the mask is written in its place: nothing that followed the flag can survive, whatever it
 * was. It **fails closed** twice over — a command with no `--token` flag, or one that still
 * carries a token-shaped value *before* the flag, is `null`, and the card then shows the origin
 * and the token's line without a command rather than risk the value on screen.
 *
 * @param command The command as `GET /api/v1/farm/enroll-command` answered it. **Secret.**
 * @param masked The token's public mask — `orb_enroll_••••a4b7`.
 * @returns The command with the mask in the token's place, or `null` when it cannot be sure.
 */
export function maskedCommand(command: string, masked: string): string | null {
  const at = command.lastIndexOf(TOKEN_FLAG);
  if (at === -1) return null;

  const head = command.slice(0, at);
  if (head.includes(TOKEN_PREFIX)) return null;

  return `${head}${TOKEN_FLAG}'${masked}'`;
}

/**
 * A command split around its mask, so the block can draw the mask as the mockup does — in its
 * own ink — without parsing a shell line.
 *
 * @param command A command as *shown*: {@link restingCommand}'s or {@link maskedCommand}'s.
 * @param mask The mask it carries.
 * @returns What comes before the mask, the mask, and what comes after. A command that does not
 *   carry the mask is all *before*.
 */
export function commandParts(
  command: string,
  mask: string,
): { readonly before: string; readonly mask: string; readonly after: string } {
  const at = command.lastIndexOf(mask);
  if (at === -1) return { before: command, mask: "", after: "" };

  return { before: command.slice(0, at), mask, after: command.slice(at + mask.length) };
}

/* ------------------------------------------------------------------ what a mint produced */

/**
 * What one press of **Copy command** produced, as the Server Action answers it.
 *
 * `command` is the one secret field in this module: it goes to the clipboard and is dropped.
 * Everything else is safe to hold and draw — see {@link MintedView}, which is this without it.
 */
export type MintOutcome =
  | ({ readonly ok: true; readonly command: string } & MintedView)
  | { readonly ok: false; readonly reason: string };

/** What the card keeps of a mint: everything but the value. */
export interface MintedView {
  /** The command with its token masked, or `null` when {@link maskedCommand} refused. */
  readonly shown: string | null;
  /** The https origin the command installs from. */
  readonly origin: string;
  /** The agent release it pins. */
  readonly version: string;
  /** The token, masked. */
  readonly token: EnrollmentToken;
}

/** What a revoke produced. */
export type RevokeOutcome =
  | { readonly ok: true; readonly token: EnrollmentToken }
  | { readonly ok: false; readonly reason: string };

/** The mint was refused for a reason the service did not put into words a person can use. */
export const MINT_FAILED = "The command could not be minted. Nothing was created — try again.";

/** The mint was refused because the reader's role changed since the page rendered. */
export const MINT_FORBIDDEN = "Minting an enrollment token needs an owner or an admin.";

/** The pool was deleted since the page rendered. */
export const MINT_POOL_GONE = "That pool no longer exists. Nothing was minted.";

/** This deployment cannot serve an installer, so a command would download nothing. */
export const MINT_UNAVAILABLE =
  "This deployment does not know the https address runner machines reach it at, or serves no " +
  "runner release, so a command would install nothing. Nothing was minted.";

/**
 * The browser refused the clipboard after a token had been minted, and the token was revoked.
 *
 * Said in full because the alternative is the failure the issue names: a live credential nobody
 * remembers creating, with its value lost.
 */
export const COPY_BLOCKED_REVOKED =
  "Your browser blocked the copy, so the token that was just minted has been revoked. Nothing " +
  "was left live.";

/** The same, when the revoke failed too — the one case that needs the reader to act. */
export const COPY_BLOCKED_LIVE =
  "Your browser blocked the copy and the token that was just minted could not be revoked. " +
  "Revoke it from Manage tokens.";

/** The revoke was refused. */
export const REVOKE_FAILED = "The token could not be revoked. Try again.";

/** The revoke was refused because the reader's role changed since the list was drawn. */
export const REVOKE_FORBIDDEN = "Revoking an enrollment token needs an owner or an admin.";

/** The token is no longer in this workspace's list. */
export const REVOKE_GONE = "That token no longer exists.";

/** The service's code for a pool this workspace does not have. */
export const POOL_NOT_FOUND_CODE = "farm_pool_not_found";

/** The service's code for a deployment that cannot serve an installer. */
export const ENROLL_UNAVAILABLE_CODE = "farm_enroll_command_unavailable";

/** The service's code for a token this workspace does not have. */
export const TOKEN_NOT_FOUND_CODE = "farm_enrollment_token_not_found";

/** The service's code for a role that may not. */
export const FORBIDDEN_CODE = "forbidden";

/**
 * The sentence for a refused mint.
 *
 * @param code The service's error code.
 * @returns What the card says. Every one of them ends by saying nothing was minted, because
 *   that is the question a refusal on a credential surface leaves open.
 */
export function mintRefusal(code: string): string {
  if (code === FORBIDDEN_CODE) return MINT_FORBIDDEN;
  if (code === POOL_NOT_FOUND_CODE) return MINT_POOL_GONE;
  if (code === ENROLL_UNAVAILABLE_CODE) return MINT_UNAVAILABLE;

  return MINT_FAILED;
}

/**
 * The sentence for a refused revoke.
 *
 * @param code The service's error code.
 * @returns What the list says.
 */
export function revokeRefusal(code: string): string {
  if (code === FORBIDDEN_CODE) return REVOKE_FORBIDDEN;
  if (code === TOKEN_NOT_FOUND_CODE) return REVOKE_GONE;

  return REVOKE_FAILED;
}

/* ------------------------------------------------------------------ a token's state */

/** Milliseconds in a second. */
const SECOND_MS = 1000;

/** Seconds in an hour and in a day, for {@link timeLeft}. */
const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

/**
 * How long is left, in the coarsest unit that is still honest — `ageOfSeconds`, with one
 * difference: the second day is still said in hours.
 *
 * The default token lives a day, and `ageOfSeconds` would call its first second `1d` and its
 * next `23h` — a figure that gets *more* precise as it shrinks. Hours up to `47h` keep a fresh
 * token reading the `24h` it was minted with.
 *
 * @param seconds How many seconds are left.
 * @returns `40s`, `3m`, `24h` or `30d`.
 */
function timeLeft(seconds: number): string {
  if (seconds >= DAY_S && seconds < 2 * DAY_S) return `${Math.floor(seconds / HOUR_S)}h`;

  return ageOfSeconds(seconds);
}

/** Where a token stands. Exactly one, in this precedence — see {@link tokenState}. */
export type TokenState = "revoked" | "expired" | "spent" | "live";

/**
 * Where a token stands.
 *
 * *Revoked* wins over everything because it is the one state a person chose; *expired* wins over
 * *spent* because a token past its window admits nobody however many uses it has left.
 *
 * @param token The token.
 * @param nowMs The instant to judge it at, in epoch milliseconds.
 * @returns Its state.
 */
export function tokenState(token: EnrollmentToken, nowMs: number): TokenState {
  if (token.revoked) return "revoked";

  const expiresAt = Date.parse(token.expiresAt);
  // An expiry that cannot be parsed is not a window anybody can vouch for.
  if (Number.isNaN(expiresAt) || expiresAt <= nowMs) return "expired";
  if (token.uses >= token.maxUses) return "spent";

  return "live";
}

/**
 * A token's window, as the card and the list say it — `expires in 24h`, `expired`, `revoked`.
 *
 * @param token The token.
 * @param nowMs The instant to measure from.
 * @returns The phrase.
 */
export function tokenWindow(token: EnrollmentToken, nowMs: number): string {
  const state = tokenState(token, nowMs);

  if (state === "revoked") return "revoked";
  if (state === "expired") return "expired";

  // Rounded **up** to the whole second before it is coarsened: a token minted this instant with
  // a day to live reads `24h`, not the `23h` a few elapsed milliseconds would floor it to.
  const seconds = Math.ceil((Date.parse(token.expiresAt) - nowMs) / SECOND_MS);

  return `expires in ${timeLeft(seconds)}`;
}

/**
 * How many machines a token can still admit — never negative, whatever the counters say.
 *
 * @param token The token.
 * @returns `maxUses - uses`, floored at zero.
 */
export function usesLeft(token: EnrollmentToken): number {
  return Math.max(0, token.maxUses - token.uses);
}

/**
 * The line under the card's actions — the diagram's `Token: expires in 24h · 4 of 5 uses left`.
 *
 * TTL and remaining uses are an acceptance criterion *at mint time*: the reader who has just put
 * a credential on their clipboard is told how long it is dangerous for and how many machines it
 * admits.
 *
 * @param token The token just minted.
 * @param nowMs The instant to measure from.
 * @returns The line.
 */
export function tokenLine(token: EnrollmentToken, nowMs: number): string {
  return `Token ${token.masked}: ${tokenWindow(token, nowMs)} · ${usesPhrase(token)}`;
}

/**
 * A token's remaining uses, in words — `4 of 5 uses left`.
 *
 * One phrase for the card's line and the list's rows. The issue's diagram abbreviates the list's
 * to `4/5 uses`, which reads as *four used* as easily as *four left* — and on a list whose job
 * is answering how many machines a token can still admit, that is the one ambiguity to refuse.
 *
 * @param token The token.
 * @returns The phrase.
 */
export function usesPhrase(token: EnrollmentToken): string {
  return `${usesLeft(token)} of ${token.maxUses} ${token.maxUses === 1 ? "use" : "uses"} left`;
}

/* ------------------------------------------------------------------ the token list */

/** The sheet's name and the settings tab's title. */
export const TOKENS_TITLE = "Enrollment tokens";

/** The sheet's eyebrow. */
export const TOKENS_EYEBROW = "Build Farm";

/** The settings tab's label — the amendment on #258 names it. */
export const TOKENS_TAB = "Farm tokens";

/** The settings page's subline. */
export const TOKENS_SUBLINE =
  "Every token minted to enrol a runner — which pool it admits into, how long it stays good, " +
  "how many machines it has let in, and who minted it. Values are never shown again.";

/** The settings page's head action — minting stays where the command is. */
export const OPEN_BUILD_FARM = "Open Build Farm →";

/** The list's own name. */
export const TOKENS_CAPTION = "Enrollment tokens, newest first";

/** What closes the sheet. */
export const TOKENS_CLOSE = "Close";

/** The list while its first read is in flight. */
export const TOKENS_LOADING = "Reading the tokens…";

/** The list over a workspace that has minted nothing. */
export const NO_TOKENS_TITLE = "No enrollment tokens yet.";

/** And the line under it. */
export const NO_TOKENS_NOTE = "A token is minted each time an owner or an admin copies the enroll command.";

/** The list could not be read. */
export const TOKENS_UNREAD_TITLE = "The tokens could not be read.";

/** The read was refused because the reader may not. */
export const TOKENS_FORBIDDEN = "Enrollment tokens are listed for an owner or an admin.";

/**
 * The first half of the settings page's read-only note — the role, named.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns `Viewing farm tokens as a member.`
 */
export function tokensReadOnlyHead(role: Role): string {
  return `Viewing farm tokens as ${article(role)} ${role}.`;
}

/** The read failed for any other reason. */
export const TOKENS_UNAVAILABLE = "The enrollment tokens could not be read. Try again.";

/** The revoke action. */
export const REVOKE = "Revoke";

/** The same control while the revoke is in flight. */
export const REVOKING = "Revoking…";

/**
 * What revoking does and does not do, said once under the list — the second half is the
 * service's own caveat, and the one an incident turns on.
 */
export const REVOKE_NOTE =
  "Revoking a token stops it enrolling anything further, at once. Machines it already enrolled " +
  "keep their certificates — retire those from the runners table.";

/** Whoever minted a token has since been deleted, or has left the workspace. */
export const CREATED_BY_DELETED = "a former member";

/**
 * A pool's name that could not be read — the pools' listing failed. An em dash rather than
 * {@link POOL_DELETED}: *could not be read* is not *is gone*.
 */
export const NAME_UNREAD = "—";

/** A pool that has since been deleted. */
export const POOL_DELETED = "deleted pool";

/** One read of the token list, as the Server Action and the settings route both answer it. */
export type TokenListing =
  | {
      readonly ok: true;
      /** The tokens, newest first, as served. */
      readonly tokens: readonly EnrollmentToken[];
      /** Pool names by pool id, or `null` when the pools could not be read. */
      readonly pools: Readonly<Record<string, string>> | null;
      /** Display names by user id, or `null` when the members could not be read. */
      readonly people: Readonly<Record<string, string>> | null;
      /** When the read was made, in epoch milliseconds — what every window is measured from. */
      readonly readAt: number;
    }
  | { readonly ok: false; readonly reason: string };

/** One row of the list, flat and already worded. */
export interface TokenRow {
  /** The token's id, and the React key. */
  readonly id: string;
  /** `orb_enroll_••••a4b7`. */
  readonly masked: string;
  /** The pool's name, or {@link POOL_DELETED}. */
  readonly pool: string;
  /** `expires in 24h`, `expired` or `revoked`. */
  readonly window: string;
  /** `4 of 5 uses left` — {@link usesPhrase}. */
  readonly uses: string;
  /**
   * `minted by Ken`, or `null` when the members could not be read — a row then says nothing
   * about who, rather than claiming a former member over a listing that merely failed.
   */
  readonly createdBy: string | null;
  /** Where it stands. */
  readonly state: TokenState;
  /** Whether a revoke would change anything — see {@link tokenRows}. */
  readonly revocable: boolean;
}

/**
 * The list's rows.
 *
 * **Every token is listed, and only a live one can be revoked.** The service keeps expired and
 * revoked rows because *this token let four machines in before it was killed* is the question an
 * incident asks, so they are drawn, dimmed, with their state in words. A revoke is offered where
 * it changes something: a revoked, expired or spent token admits nobody already.
 *
 * @param listing A listing that was read.
 * @param nowMs The instant to judge every window at.
 * @returns The rows, in the order served.
 */
export function tokenRows(
  listing: Extract<TokenListing, { ok: true }>,
  nowMs: number,
): readonly TokenRow[] {
  return listing.tokens.map((token) => {
    const state = tokenState(token, nowMs);

    return {
      id: token.id,
      masked: token.masked,
      pool: listing.pools === null ? NAME_UNREAD : (listing.pools[token.poolId] ?? POOL_DELETED),
      window: tokenWindow(token, nowMs),
      uses: usesPhrase(token),
      createdBy: mintedBy(token.createdBy, listing.people),
      state,
      revocable: state === "live",
    };
  });
}

/**
 * Who minted a token, as the list says it.
 *
 * @param createdBy The person's id, or `null` when the service says they have been deleted.
 * @param people Display names by id, or `null` when the members could not be read.
 * @returns `minted by <name>`, with {@link CREATED_BY_DELETED} for somebody no longer here — or
 *   `null` when there was no listing to look them up in.
 */
function mintedBy(
  createdBy: string | null,
  people: Readonly<Record<string, string>> | null,
): string | null {
  if (createdBy === null) return `minted by ${CREATED_BY_DELETED}`;
  if (people === null) return null;

  return `minted by ${people[createdBy] ?? CREATED_BY_DELETED}`;
}

/**
 * What a revoke button is called, so two of them in one list are two names.
 *
 * @param masked The token's mask.
 * @returns `Revoke orb_enroll_••••a4b7`.
 */
export function revokeLabel(masked: string): string {
  return `${REVOKE} ${masked}`;
}

/**
 * Pool names by id, from the pools a page already holds.
 *
 * @param pools The pools.
 * @returns The lookup {@link TokenListing} carries.
 */
export function poolNames(pools: readonly RunnerPool[]): Record<string, string> {
  return Object.fromEntries(pools.map((pool) => [pool.id, pool.name]));
}

/**
 * A listing with one token replaced — how a revoke's answer lands in the list without a second
 * read.
 *
 * @param listing The listing on screen.
 * @param token The token as it now stands.
 * @returns The listing with that row replaced, or unchanged when it does not hold the token.
 */
export function withToken(listing: TokenListing, token: EnrollmentToken): TokenListing {
  if (!listing.ok) return listing;

  return {
    ...listing,
    tokens: listing.tokens.map((held) => (held.id === token.id ? token : held)),
  };
}
