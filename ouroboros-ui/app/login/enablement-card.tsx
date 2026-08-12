import type { Enablement, OrgEnablement } from "@/app/api/enablement";
import { type Membership, isAdminRole } from "@/app/api/membership";
import { DASHBOARD_PATH } from "@/app/paths";

import { setOrgEnabled, setRepoEnabled } from "./actions";
import { APP_NOTE, STEP_TWO_ID, STEP_TWO_LEDE, STEP_TWO_TITLE } from "./copy";
import { repoSummary } from "./enablement";
import { EnablementSwitch } from "./enablement-switch";
import { Monogram } from "./monogram";

/**
 * Step 2 in its working form: the organisations of the chosen workspace, the repositories
 * under each, and the way out to the dashboard.
 *
 * This is the mockup's second card with one addition the mockup does not have and the issue
 * requires: the repositories themselves, each with its own switch ("toggle a repo" is an
 * acceptance criterion). They are indented under their organisation because that is what
 * they are — a repository is in scope only when its own flag and its organisation's are
 * **both** true, and the summary line says so when they disagree.
 *
 * Two things this card is careful about:
 *
 * 1. **Who may press anything.** Administering a workspace is `owner` or `admin`; `member`
 *    and `viewer` may read it. For them every switch renders in the same place, in the same
 *    state, and explains why it cannot move (design system § 3.3, § 3.5) — a list with the
 *    switches hidden would look like a list with no settings.
 * 2. **What it does not claim.** The counts are the service's own totals, and when a page
 *    holds fewer rows than the total the line says so rather than presenting a hundred as
 *    all of them.
 */

/** Why a switch will not move, for a role that may only read. Also its `title`. */
const READ_ONLY = "Only an owner or admin can change what Ouroboros may work in.";

/** The id the read-only switches point their description at, once. */
const READ_ONLY_ID = "login-read-only";

/**
 * The enablement card.
 *
 * @param props.membership The chosen workspace, whose role decides whether anything moves.
 * @param props.enablement Its organisations and their repositories.
 * @returns The card: the rows, the note, and "Enter mission control".
 */
export function EnablementCard({
  membership,
  enablement,
}: Readonly<{ membership: Membership; enablement: Enablement }>) {
  const mayAdminister = isAdminRole(membership.role);

  return (
    <section className="login-card" aria-labelledby={STEP_TWO_ID}>
      <p className="login-card__eyebrow">Step 2 · {membership.slug}</p>
      <h2 className="login-card__title login-card__title--sub" id={STEP_TWO_ID}>
        {STEP_TWO_TITLE}
      </h2>
      <p className="login-card__lede">{STEP_TWO_LEDE}</p>

      {!mayAdminister && (
        <p className="login-note login-note--faint" id={READ_ONLY_ID}>
          You are a {membership.role} in {membership.displayName}. {READ_ONLY}
        </p>
      )}

      {enablement.orgs.length === 0 ? (
        <p className="login-empty">
          No GitHub organisations are recorded in {membership.displayName} yet. They arrive
          with the GitHub App installation; until then this list is empty and the loop has
          nothing to work in.
        </p>
      ) : (
        <ul className="login-rows">
          {enablement.orgs.map((entry) => (
            <li key={entry.org.id}>
              <OrgRow entry={entry} mayAdminister={mayAdminister} />
            </li>
          ))}
        </ul>
      )}

      {enablement.orgTotal > enablement.orgs.length && (
        <p className="login-summary">
          Showing {enablement.orgs.length} of {enablement.orgTotal} organisations.
        </p>
      )}

      <p className="login-note login-note--faint">{APP_NOTE}</p>

      {/*
        A plain anchor rather than `next/link`, and deliberately: this screen has no client
        component on it anywhere, and a prefetching link would be the first — for one
        navigation, made once, that leaves the sign-in flow behind. A full load also
        guarantees the dashboard is rendered against the workspace cookie as it now stands
        rather than against a router entry seeded before the last toggle.
      */}
      <a className="login-btn login-btn--primary" href={DASHBOARD_PATH}>
        Enter mission control →
      </a>
    </section>
  );
}

/**
 * One organisation: its monogram, its name, its summary line, its switch — and its
 * repositories under it.
 *
 * @param props.entry The organisation and its repositories.
 * @param props.mayAdminister Whether this role may change a flag.
 * @returns The row and the list beneath it.
 */
function OrgRow({
  entry,
  mayAdminister,
}: Readonly<{ entry: OrgEnablement; mayAdminister: boolean }>) {
  const { org } = entry;

  return (
    <>
      <span className="login-row">
        <Monogram name={org.login} />
        <span className="login-row__meta">
          <span className="login-row__name">
            {org.login}
            {org.enabled && <span className="login-pill login-pill--ok">on</span>}
          </span>
          <span className="login-row__detail">{repoSummary(entry)}</span>
        </span>
        <EnablementSwitch
          action={setOrgEnabled}
          fields={{ login: org.login }}
          enabled={org.enabled}
          label={`${org.enabled ? "Disable" : "Enable"} the ${org.login} organisation`}
          reason={mayAdminister ? undefined : READ_ONLY}
          describedBy={mayAdminister ? undefined : READ_ONLY_ID}
        />
      </span>

      {entry.repos.length > 0 && (
        <ul className="login-repos">
          {entry.repos.map((repo) => (
            <li className="login-repo" key={repo.id}>
              <span className="login-repo__name">{repo.name}</span>
              {repo.defaultBranch !== null && (
                <span className="login-repo__branch">{repo.defaultBranch}</span>
              )}
              <EnablementSwitch
                action={setRepoEnabled}
                fields={{ login: org.login, repo: repo.name }}
                enabled={repo.enabled}
                label={`${repo.enabled ? "Disable" : "Enable"} ${org.login}/${repo.name}`}
                reason={mayAdminister ? undefined : READ_ONLY}
                describedBy={mayAdminister ? undefined : READ_ONLY_ID}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
