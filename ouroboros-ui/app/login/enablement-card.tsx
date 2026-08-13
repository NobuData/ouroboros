import { type Membership, mayAdminister } from "@/app/api/membership";
import { Button, Card, Chip, Eyebrow } from "@/app/ui";

import { enterMissionControl, setWorkspaceEnabled } from "./actions";
import { APP_NOTE, STEP_TWO_ID, STEP_TWO_LEDE, STEP_TWO_TITLE } from "./copy";
import { WORKSPACE_FIELD, repoSummary } from "./enablement";
import { EnablementSwitch } from "./enablement-switch";
import { Monogram } from "./monogram";

/**
 * Step 2 in its working form — `docs/mockups/01-login.html`'s second card, row for row.
 *
 * ```
 * [AR] acme-robotics ✓        4 repos enabled · incl. helios-firmware   (on)
 * [AL] acme-labs              0 repos enabled                           (off)
 * [KS] kensuenobu (personal)  2 repos enabled                           (on)
 * "Ouroboros installs as a GitHub App with least-privilege scopes…"
 * [ Enter mission control → ]
 * ```
 *
 * **The rows are workspaces**, not the GitHub organisations inside one, and that is
 * [#719](https://github.com/NobuData/ouroboros/issues/719)'s change of source rather than a
 * change of design: `GET /api/v1/orgs` is "mockup 01 Step 2's row model, in one request"
 * ([#714](https://github.com/NobuData/ouroboros/issues/714)), and every part of the drawing
 * above is a field of it — `monogram`, `slug`, `personal`, `enabled`, `repoCounts` and
 * `featuredRepo`. What this card used to render was one chosen workspace's organisations and
 * their repositories, reached through a separate *pick a workspace* step; the mockup has
 * three workspaces on one card and one button under them, and now so does this.
 *
 * ### Two controls per row, and neither is nested inside the other
 *
 * A row asks two different questions, so it carries two different controls:
 *
 * | Control | Question | Where it goes |
 * |---|---|---|
 * | the radio | *which workspace do I enter?* | the CTA's form, by `form=` |
 * | the switch | *may Ouroboros work in this one?* | its own one-field form |
 *
 * The radio is associated with the **Enter mission control →** form by its `form` attribute
 * rather than by being inside it, and that is a hard requirement rather than a preference: a
 * form may not be nested inside another form, and each switch is already a form of its own.
 * `form=` is how HTML says "this control belongs to that form" for exactly this case, and it
 * keeps the whole card working before hydration and without JavaScript — which for the first
 * screen of the product on an unknown connection is worth more than an optimistic animation.
 *
 * **A person who belongs to one workspace gets a hidden field instead of a radio.** A radio
 * group of one is a control that cannot be changed, and the design system's honesty rule
 * (§ 3.5) is against drawing one; the form still carries the workspace, so the action is
 * unchanged.
 *
 * ### What it is careful about
 *
 * 1. **Who may press a switch.** Administering a workspace is `owner` or `admin`; `member`
 *    and `viewer` may read it. For them the switch renders in the same place, in the same
 *    state, and explains why it cannot move (design system § 3.3, § 3.5) — a list with the
 *    switches hidden would look like a list with no settings. The roles are the
 *    organization plugin's, read per row, because a person may own one workspace and be a
 *    viewer in the next.
 * 2. **What it does not claim.** The count is the service's own `total`, so a page holding
 *    fewer rows than there are workspaces says so rather than presenting a hundred as all of
 *    them.
 */

/** Why a switch will not move, for a role that may only read. Also its `title`. */
const READ_ONLY = "Only an owner or admin can change what Ouroboros may work in.";

/** Why a switch will not move when there is nothing under it to move. */
const NOTHING_TO_ENABLE =
  "No GitHub organisations are recorded in this workspace yet. They arrive with the GitHub " +
  "App installation; until then there is nothing here for the loop to work in.";

/** The id the read-only switches point their description at, once. */
const READ_ONLY_ID = "login-read-only";

/** The id the rows' radios point their `form` attribute at. */
const ENTER_FORM_ID = "login-enter";

/**
 * The step-2 card.
 *
 * @param props.memberships The workspaces to draw, oldest first — the service's own order.
 * @param props.active Which row starts selected. `undefined` only when there is no row.
 * @param props.total How many workspaces exist, which may exceed the number drawn.
 * @returns The card: the rows, the note, and **Enter mission control →**.
 */
export function EnablementCard({
  memberships,
  active,
  total,
}: Readonly<{
  memberships: readonly Membership[];
  active: Membership | undefined;
  total: number;
}>) {
  const readOnlyAnywhere = memberships.some((one) => !mayAdminister(one.roles));

  return (
    <Card as="section" tone="ground" size="lg" aria-labelledby={STEP_TWO_ID}>
      <Eyebrow>After sign-in · Step 2</Eyebrow>
      <h2 className="login-step__title login-step__title--sub" id={STEP_TWO_ID}>
        {STEP_TWO_TITLE}
      </h2>
      <p className="login-step__lede">{STEP_TWO_LEDE}</p>

      {readOnlyAnywhere && (
        <p className="login-note login-note--faint" id={READ_ONLY_ID}>
          {READ_ONLY}
        </p>
      )}

      <ul className="login-rows">
        {memberships.map((membership) => (
          <li key={membership.id}>
            <WorkspaceRow
              membership={membership}
              selected={membership.id === active?.id}
              only={memberships.length === 1}
            />
          </li>
        ))}
      </ul>

      {total > memberships.length && (
        <p className="login-summary">
          Showing {memberships.length} of {total} workspaces.
        </p>
      )}

      <p className="login-note login-note--faint">{APP_NOTE}</p>

      {/*
        The form the radios above belong to. It holds the button and nothing else — every
        value it submits is declared in a row, which is what lets the rows carry two forms'
        worth of controls without one form ever containing another.

        A submit button rather than the link this used to be: the press is what writes the
        session's active organization (`actions.ts`), and the navigation is that action's
        redirect. A link could not have written anything, which is why the workspace had to
        be chosen a step earlier and kept in a cookie until it was needed.
      */}
      <form id={ENTER_FORM_ID} action={enterMissionControl}>
        <Button type="submit" tone="primary" size="lg" block>
          Enter mission control →
        </Button>
      </form>
    </Card>
  );
}

/**
 * One workspace: its monogram, its name, its summary line, and its switch.
 *
 * @param props.membership The workspace, as the service's row model describes it.
 * @param props.selected Whether this is the row **Enter mission control →** would enter.
 * @param props.only Whether it is the only workspace there is — see the card's note on why
 *   that replaces the radio with a hidden field.
 * @returns The row.
 */
function WorkspaceRow({
  membership,
  selected,
  only,
}: Readonly<{ membership: Membership; selected: boolean; only: boolean }>) {
  const administers = mayAdminister(membership.roles);
  const nothingToEnable = membership.githubOrgs.length === 0;

  const reason = nothingToEnable ? NOTHING_TO_ENABLE : administers ? undefined : READ_ONLY;

  const name = (
    <>
      <Monogram letters={membership.monogram} />
      <span className="login-row__meta">
        <span className="login-row__name">
          {membership.slug}
          {/* The mockup's tick, and decoration: the switch beside it already announces the
              state, and a second reading of it would be noise. */}
          {membership.enabled && (
            <span className="login-row__check" aria-hidden>
              ✓
            </span>
          )}
          {membership.personal && <Chip>personal</Chip>}
        </span>
        <span className="login-row__detail">{repoSummary(membership)}</span>
      </span>
    </>
  );

  return (
    <span className="login-row">
      {only ? (
        <>
          <input
            form={ENTER_FORM_ID}
            type="hidden"
            name={WORKSPACE_FIELD}
            value={membership.slug}
          />
          <span className="login-row__choice">{name}</span>
        </>
      ) : (
        // The label wraps the radio and everything that names it, so the monogram and the
        // workspace's name are both part of its hit area and its accessible name. The switch
        // stays outside it: a control inside another control's label is a press that does
        // two things.
        <label className="login-row__choice">
          <input
            className="login-row__radio"
            form={ENTER_FORM_ID}
            type="radio"
            name={WORKSPACE_FIELD}
            value={membership.slug}
            defaultChecked={selected}
          />
          {name}
        </label>
      )}

      <EnablementSwitch
        action={setWorkspaceEnabled}
        fields={{ [WORKSPACE_FIELD]: membership.slug }}
        enabled={membership.enabled}
        label={`${membership.enabled ? "Disable" : "Enable"} Ouroboros in ${membership.slug}`}
        reason={reason}
        describedBy={reason === READ_ONLY ? READ_ONLY_ID : undefined}
      />
    </span>
  );
}
