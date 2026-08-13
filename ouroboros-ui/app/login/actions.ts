"use server";

/**
 * What the login screen submits: a workspace's switch, the workspace to enter, and the
 * company domain step 1 asks about.
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
 * - **Which workspace** comes from the form — and is immediately resolved against the
 *   memberships the service reported in this same request (`app/api/membership.ts`'s
 *   `activeMembership`). A reference naming a workspace this person does not belong to
 *   resolves to nothing, and the action refuses before it has a workspace to act in.
 * - **Which role** comes from that membership. `ouroboros-rest` is the authority and would
 *   answer `403 insufficient_role` anyway; checking here is what keeps the failure a
 *   *refusal* rather than an unhandled rejection rendered as an error page.
 *
 * **The form carries a workspace now, where it used to carry only what to change inside
 * one.** That is [#719](https://github.com/NobuData/ouroboros/issues/719)'s doing and it is
 * not a loosening: the active workspace used to come from the `ouro_tenant` cookie, which is
 * a value the browser holds and can edit, and the check that made *that* safe is the same
 * check that makes this safe — the reference is matched against the session's own
 * memberships either way. What changed is only which untrusted place the reference arrives
 * from, and the screen it arrives from now lists every workspace at once, so there is no
 * single "current" one for it to be implied by.
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
 * ### Why two of the three return nothing, and the third returns a state
 *
 * The first is a toggle and the second is a departure. The truthful report of a toggle is
 * the switch itself, so {@link setWorkspaceEnabled} mutates and then re-renders — `refresh()`
 * rather than a cache tag, because the data lives behind an uncached `fetch` and it is the
 * *route* that has to be read again. {@link enterMissionControl} returns nothing because it
 * redirects. A failure from the service rejects, and the route's error boundary is what
 * shows it.
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
import { setActiveOrganization } from "@/app/api/auth-server";
import { type Discovery, discover } from "@/app/api/discovery";
import { type Membership, activeMembership, mayAdminister } from "@/app/api/membership";
import { orgs } from "@/app/api/orgs";
import { rememberWorkspace } from "@/app/api/server";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

import { ENABLED_FIELD, WORKSPACE_FIELD } from "./enablement";
import {
  DOMAIN_FIELD,
  DOMAIN_REQUIRED,
  type DiscoveryState,
  refusalMessage,
  ssoDestination,
} from "./sso";

/**
 * What a login form may say. Anything else in the payload is ignored.
 *
 * `enabled` is the *desired* state rather than the current one, so a stale form — a second
 * tab, a back button — asks for something specific instead of inverting whatever the flag
 * has become since it was rendered.
 *
 * All three names are read from the pure modules the components import them from rather than
 * typed out again: a `"use server"` module may export nothing but async functions, so this
 * file cannot be where either side of a form agreement is written down.
 */
const FIELDS = {
  workspace: WORKSPACE_FIELD,
  enabled: ENABLED_FIELD,
  domain: DOMAIN_FIELD,
} as const;

/**
 * Enter the product, in the workspace step 2 was left on.
 *
 * The mockup's **Enter mission control →**, and the one place the active workspace is
 * written: `POST /api/auth/organization/set-active` puts it on the session row, which is
 * what `ouroboros-rest` scopes every later request by
 * ([#713](https://github.com/NobuData/ouroboros/issues/713)). Nothing about the destination
 * is carried in a cookie or a header — the browser is simply sent to the dashboard, and the
 * dashboard reads the session.
 *
 * The `ouro_tenant` hint is written beside it, and it decides one thing only: that this
 * browser has been asked where the loop runs, so the next visit to `/login` goes on through
 * (`app/login/view.ts`). See `app/api/server.ts` for what it stopped being.
 *
 * **The hint carries the id rather than the slug**, and the reason is the order of the two
 * writes. `rememberWorkspace` refuses a reference the contract's header grammar would not
 * accept — letters, digits and hyphens — because writing a cookie is this application's own
 * doing and a bad value there is a bug to surface. A slug is whatever created the workspace
 * chose to call it, and one carrying an underscore would throw *after* `set-active` had
 * already succeeded: an error page over a session that had in fact moved. An id always
 * satisfies the grammar (`openapi.yaml` § `orgId` — a uuid or 32 alphanumerics), and nothing
 * reads the value back, so there is nothing to trade for the safety.
 *
 * @param formData The submitted form. Reads `workspace`: the slug or id to enter.
 * @throws Next.js's redirect signal, always — to the dashboard on success, and back to the
 *   login screen when the reference resolves to nothing.
 * @throws {AuthError} What `set-active` answered — a `403` for a workspace the caller is not
 *   a member of, which the resolution above should already have refused.
 */
export async function enterMissionControl(formData: FormData): Promise<void> {
  const chosen = await chosenWorkspace(formData);

  await setActiveOrganization(chosen.id);
  await rememberWorkspace(chosen.id);

  redirect(DASHBOARD_PATH);
}

/**
 * Turn one workspace's GitHub organisations on or off.
 *
 * **The row's switch is a summary, so setting it is a loop.** `OrgRow.enabled` is "whether
 * any of this workspace's GitHub organisations is switched on" rather than a flag of its own
 * (`openapi.yaml` § `OrgRow`), and there is nothing else for a switch on that row to mean:
 * moving it to `on` turns every organisation under it on, and to `off` turns every one off.
 * A workspace with no organisations recorded has nothing to move, and the card renders its
 * switch read-only rather than sending a request that would change nothing.
 *
 * Turning an organisation off suspends everything under it **without** discarding the
 * per-repository choices underneath — which is why the contract has two flags rather than
 * one, and why this touches only the organisation's.
 *
 * @param formData The submitted form. Reads `workspace` (which workspace) and `enabled` (the
 *   state to move to, `"true"` or `"false"`).
 * @throws {ApiError} What `ouroboros-rest` answered — including `403 insufficient_role` if
 *   the role changed between the render and the press.
 * @throws Next.js's redirect signal, when this request may no longer administer the
 *   workspace it named.
 */
export async function setWorkspaceEnabled(formData: FormData): Promise<void> {
  const chosen = await chosenWorkspace(formData);

  if (!mayAdminister(chosen.roles)) {
    // The card renders this switch read-only, so reaching here means a hand-made request or
    // a role that changed since the render. Both are answered by rendering the screen again,
    // which is where the truth about either is already worked out.
    redirect(LOGIN_PATH);
  }

  const enabled = flag(formData, FIELDS.enabled);

  // Sequentially rather than together: these are writes to one workspace's rows, and a
  // service refusing the third of them should not have been asked for the fourth. The list
  // is one or two logins in practice — a workspace's own organisation, and whatever else has
  // been installed into it.
  for (const githubOrg of chosen.githubOrgs) {
    await orgs.setEnabled(chosen.id, githubOrg.login, enabled);
  }

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
 * The workspace this submission names, resolved against the session — or a redirect.
 *
 * The single seam every write on this screen goes through, and the reason it is one function
 * rather than a line in each: "the form says which workspace" is safe **only** while the
 * saying is checked, and a check written twice is a check that will one day be written once.
 *
 * @param formData The submitted form. Reads `workspace`.
 * @returns The membership it names, straight from the service's own listing.
 * @throws Next.js's redirect signal, when there is no session, or when the reference names
 *   nothing this person belongs to. Both are answered by rendering the login screen again,
 *   which is where the truth about either is already worked out.
 */
async function chosenWorkspace(formData: FormData): Promise<Membership> {
  const { session } = await currentAccess();
  const requested = field(formData, FIELDS.workspace);

  const chosen =
    session === null ? undefined : activeMembership(session.memberships, requested);

  if (chosen === undefined) {
    redirect(LOGIN_PATH);
  }

  return chosen;
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
