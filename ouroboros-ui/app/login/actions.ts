"use server";

/**
 * What the login screen submits: the chosen workspace, an organisation's flag, a
 * repository's, and the company domain step 1 asks about.
 *
 * ### Every action here re-derives its own authority
 *
 * A Server Action is a POST endpoint against the page that renders it, reachable by anyone
 * who can send the same request — "render-time gating is not a security boundary", in the
 * framework's own words
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` § Security). So none of
 * these trust the form for anything but *what the person wants changed*:
 *
 * - **Who** comes from the session cookie, read through `currentAccess()`.
 * - **Which workspace** comes from the `ouro_tenant` cookie, matched against the
 *   memberships the service reported in this same request. The form never carries a tenant
 *   id — if it did, a hand-made POST could name somebody else's workspace and the only
 *   thing standing in the way would be the service's own check.
 * - **Which role** comes from that membership. `ouroboros-rest` is the authority and would
 *   answer `403 insufficient_role` anyway; checking here is what keeps the failure a
 *   *refusal* rather than an unhandled rejection rendered as an error page.
 *
 * The form therefore carries the smallest possible reference — an organisation login, a
 * repository name, and the state to move to — and every one of those is validated before it
 * is used.
 *
 * **{@link discoverDomain} is the exception to all of the above, and deliberately so.** It
 * takes no authority, checks none, and is the only action here that can be called by somebody
 * with no session — because the endpoint behind it is public
 * ([#712](https://github.com/NobuData/ouroboros/issues/712)) and its caller is a visitor who
 * has not signed in yet. What keeps *that* safe is not a check here but the contract: the
 * service answers the same body, in the same time, for a domain a workspace holds and one
 * nothing does, so there is nothing this endpoint can tell a stranger that it does not tell
 * everybody. `app/api/discovery.ts` is where that is written down.
 *
 * ### Why three of the four return nothing, and the fourth returns a state
 *
 * The first three are toggles and a choice. The truthful report of a toggle is the switch
 * itself, so each mutates and then re-renders: `refresh()` for the enablement flags, because
 * the data lives behind an uncached `fetch` rather than in the Data Cache and it is the
 * *route* that has to be read again; nothing at all for the workspace choice, because writing
 * a cookie re-renders the current page by itself and this one redirects on top of that. A
 * failure from the service rejects, and the route's error boundary is what shows it.
 *
 * {@link discoverDomain} is a **read** whose whole purpose is the sentence it comes back
 * with, and there is nowhere on the page for a re-render to put it. So it returns a
 * {@link DiscoveryState} for `useActionState` to render, and its failures are values rather
 * than throws: a domain typed wrong is a person's mistake to correct in place, not an error
 * boundary replacing the screen they are signing in on.
 */

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { currentAccess } from "@/app/api/access";
import { type Discovery, discover } from "@/app/api/discovery";
import { activeMembership, isAdminRole } from "@/app/api/membership";
import { orgs } from "@/app/api/orgs";
import { repos } from "@/app/api/repos";
import { setActiveTenant } from "@/app/api/server";
import { LOGIN_PATH } from "@/app/paths";

import {
  DOMAIN_FIELD,
  DOMAIN_REQUIRED,
  type DiscoveryState,
  refusalMessage,
  ssoDestination,
} from "./sso";
import { enablementPath } from "./view";

/**
 * What a login form may say. Anything else in the payload is ignored.
 *
 * `enabled` is the *desired* state rather than the current one, so a stale form — a second
 * tab, a back button — asks for something specific instead of inverting whatever the flag
 * has become since it was rendered.
 */
const FIELDS = {
  workspace: "workspace",
  login: "login",
  repo: "repo",
  enabled: "enabled",
  // Read from `sso.ts` rather than typed out again: the form that submits it is a Client
  // Component, so this name is the only thing the two sides share.
  domain: DOMAIN_FIELD,
} as const;

/**
 * Remember which workspace the loop runs in, and move on to enabling organisations in it.
 *
 * The slug in the form is checked against this person's memberships before it is written,
 * so the cookie can only ever name a live workspace they belong to. A slug that names
 * anything else — a workspace they have left, a suspended one, or one they were never in —
 * sends them back to the choice rather than being written and rejected later.
 *
 * @param formData The submitted form. Reads `workspace`: the slug to make active.
 * @throws Next.js's redirect signal, always — to the enablement step on success, and back
 *   to the login screen when the slug resolves to nothing.
 */
export async function chooseWorkspace(formData: FormData): Promise<void> {
  const { session } = await currentAccess();
  const requested = field(formData, FIELDS.workspace);

  const chosen =
    session === null ? undefined : activeMembership(session.memberships, requested);

  if (chosen === undefined) {
    // No session, or a slug that resolves to nothing. Both are answered by rendering the
    // login screen again, which is where the truth about either is already worked out.
    redirect(LOGIN_PATH);
  }

  await setActiveTenant(chosen.slug);
  redirect(enablementPath(chosen.slug));
}

/**
 * Turn one GitHub organisation on or off in the active workspace.
 *
 * @param formData The submitted form. Reads `login` (the organisation) and `enabled` (the
 *   state to move to, `"true"` or `"false"`).
 * @throws {ApiError} What `ouroboros-rest` answered — including `403 insufficient_role` if
 *   the role changed between the render and the press.
 * @throws Next.js's redirect signal, when this request may no longer administer anything.
 */
export async function setOrgEnabled(formData: FormData): Promise<void> {
  const { membership } = await administerable();

  await orgs.setEnabled(
    membership.tenantId,
    reference(formData, FIELDS.login),
    flag(formData, FIELDS.enabled),
  );

  refresh();
}

/**
 * Turn one repository on or off in the active workspace.
 *
 * A repository is in scope only when its own flag **and** its organisation's are both true;
 * this sets only its own, which is what the contract's two flags are for. The screen says so
 * beside the switches.
 *
 * @param formData The submitted form. Reads `login` (the organisation), `repo` (the
 *   repository, without the owner prefix) and `enabled`.
 * @throws {ApiError} What `ouroboros-rest` answered.
 * @throws Next.js's redirect signal, when this request may no longer administer anything.
 */
export async function setRepoEnabled(formData: FormData): Promise<void> {
  const { membership } = await administerable();

  await repos.setEnabled(
    membership.tenantId,
    reference(formData, FIELDS.login),
    reference(formData, FIELDS.repo),
    flag(formData, FIELDS.enabled),
  );

  refresh();
}

/**
 * Ask what a company domain signs in with, and say what to render.
 *
 * The one action here that reads rather than writes, and the one that returns a value: see
 * the note at the top of this file for both. It takes no authority and checks none, because
 * the endpoint is public and built not to be a tenant-enumeration oracle.
 *
 * Everything it decides is `app/login/sso.ts`, which is framework-free, so what is left here
 * is the two things only a Server Action can do — call a `server-only` client, and redirect.
 *
 * @param _previous What the last submission produced. Unread: each submission is a fresh
 *   question about whatever domain is in the field now, so nothing carries forward. The
 *   parameter exists because `useActionState` passes it.
 * @param formData The submitted form. Reads `domain`: the company domain, as typed. It is
 *   **not** normalised here — the service trims, lower-cases and strips the scheme and path
 *   before it validates, and a second normaliser in this application would be a second set of
 *   rules to keep in step with the one that decides.
 * @returns The state to render — the service's answer, or the reason there is not one.
 * @throws Next.js's redirect signal, when the domain signs in through an identity provider
 *   and the service named somewhere to send the browser. Never in this release: #722 is what
 *   starts answering `ssoAvailable: true`.
 */
export async function discoverDomain(
  _previous: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const domain = (field(formData, FIELDS.domain) ?? "").trim();

  if (domain === "") {
    return { status: "refused", message: DOMAIN_REQUIRED };
  }

  let answer: Discovery;
  try {
    answer = await discover(domain);
  } catch (error) {
    return { status: "refused", message: refusalMessage(error) };
  }

  // Outside the `try`, deliberately: `redirect()` signals by throwing, and a `catch` around
  // it would read the framework's own control flow as a discovery that failed — leaving a
  // person on the card being told the service could not be reached, having reached it.
  const destination = ssoDestination(answer);
  if (destination !== undefined) {
    redirect(destination);
  }

  return { status: "answered", ssoAvailable: answer.ssoAvailable, message: answer.message };
}

/**
 * The workspace this request may *change*, or a redirect to the login screen.
 *
 * Stricter than `requireWorkspace()` by one condition — the role — and separate from it
 * because reading a workspace and administering one are different permissions in the
 * contract, and this is the only place in the UI that needs the second.
 *
 * @returns The active membership, whose role is `owner` or `admin`.
 * @throws Next.js's redirect signal, when there is no session, no active workspace, or the
 *   role may only read it.
 */
async function administerable() {
  const { session, membership } = await currentAccess();

  if (session === null || membership === undefined || !isAdminRole(membership.role)) {
    redirect(LOGIN_PATH);
  }

  return { session, membership };
}

/**
 * Read one field as a string.
 *
 * `FormData.get` returns `File | string | null`, and every one of those is possible in a
 * request somebody composed by hand. Anything that is not a string is `undefined` here,
 * which each caller then refuses in its own way.
 *
 * @param formData The submitted form.
 * @param name The field to read.
 * @returns Its value, or `undefined` when it is absent or not a string.
 */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * What a GitHub login or repository name may contain.
 *
 * The contract's own patterns are narrower per field (`openapi.yaml` §
 * `components.parameters.OrgLogin` and `RepoName`); this is the shape both share, and it is
 * here as a **safety property** rather than as validation: these values are interpolated
 * into a request path, so a value carrying a slash, a `..` or a control character is a
 * path-traversal attempt and must not reach the client that would send it. The service
 * refuses anything else it does not like.
 */
const REFERENCE_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Read one field as a GitHub login or repository name.
 *
 * @param formData The submitted form.
 * @param name The field to read.
 * @returns Its value, unchanged.
 * @throws {Error} When the field is absent or is not a name a path may carry. The message
 *   quotes the field rather than the value: this runs on rejected input, and a rejected
 *   value is the last thing to interpolate into a string that may reach a log.
 */
function reference(formData: FormData, name: string): string {
  const value = field(formData, name);

  if (value === undefined || !REFERENCE_PATTERN.test(value)) {
    throw new Error(
      `The ${name} field must be a GitHub login or repository name — letters, digits, ` +
        `dot, underscore and hyphen, 1 to 100 characters.`,
    );
  }

  return value;
}

/**
 * Read one field as the boolean a checkbox-shaped form cannot carry.
 *
 * @param formData The submitted form.
 * @param name The field to read.
 * @returns `true` for exactly `"true"`, `false` for exactly `"false"`.
 * @throws {Error} For anything else, including absence. There is no default: a toggle whose
 *   direction was guessed is a toggle that sometimes does the opposite of what was pressed.
 */
function flag(formData: FormData, name: string): boolean {
  const value = field(formData, name);

  if (value !== "true" && value !== "false") {
    throw new Error(`The ${name} field must be exactly "true" or "false".`);
  }

  return value === "true";
}
