"use client";

import { useRouter } from "next/navigation";

import type { NotificationRoute, NotificationRoutes } from "@/app/api/settings-integrations";
import { SAVING_LABEL } from "@/app/settings/save-model";
import { useSettingsAccess, useSettingsSection } from "@/app/settings/save-provider";
import { SectionMarks } from "@/app/settings/settings-seat";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Card, CardHead, TextField, Toggle, cx } from "@/app/ui";
import { isPlainClick } from "@/app/workflows/mode-switch";

import {
  DAILY_DIGEST,
  LOCKED_WORD,
  OFF_WORD,
  ON_WORD,
  RECIPIENTS_FIELD,
  RECIPIENTS_HINT,
  RECIPIENTS_LABEL,
  type RouteValues,
  SAVED_ON_CANNOT_FIRE,
  TIME_FIELD,
  TIME_HINT,
  TIME_LABEL,
  WEEKLY_INSIGHTS,
  enabledField,
  mayToggle,
  parseRecipients,
  routeLabels,
  routeName,
  routePatches,
  routeTitle,
  routeWhy,
  routesBaseline,
  unlockLink,
  validateRoutes,
} from "./routes";
import { saveRoutes } from "./routes-actions";

import "./notifications.css";

/**
 * The Notifications card — mockup 17's `c-5` card of org-level routes
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * One row per route, in the service's order. The rules are `app/integrations/routes.ts`'s; this
 * draws them.
 *
 * ### A route that cannot fire cannot be armed
 *
 * A route whose channel has no connection in this build is **locked**: the row draws a lock, the
 * service's reason (*connect PagerDuty first*) and a link to the integration that would unlock
 * it — and no switch. An administrator who could switch *Loop failures → PagerDuty* on would
 * believe failures now page someone. (A locked route that is somehow saved *on* keeps a switch,
 * to be switched off, and says it cannot fire.) The service enforces the same rule on the write.
 *
 * ### Saving
 *
 * Every switch, the digest's time and the weekly recipients join the page's dirty state and are
 * committed by **Save changes** as one section — `saveRoutes`, one request per changed route.
 *
 * ### A viewer reads the same rows
 *
 * Without controls: each route's position in words, the digest's time in its title, the weekly
 * recipients in its line. Nothing is drawn switched off.
 *
 * @param props.routes The routes as read.
 * @returns The card.
 */
export function NotificationsCard({ routes }: Readonly<{ routes: NotificationRoutes }>) {
  const section = settingsSection("notifications");
  const titleId = sectionTitleId(section.id);
  const access = useSettingsAccess();

  const baseline = routesBaseline(routes);
  const fields = useSettingsSection<RouteValues>({
    baseline,
    labels: routeLabels(routes),
    validate: (draft) => validateRoutes(draft),
    commit: (_changes, draft) => saveRoutes(routePatches(draft, baseline, routes)),
  });
  const { values } = fields;

  const time = String(values[TIME_FIELD] ?? "");
  const recipients = String(values[RECIPIENTS_FIELD] ?? "");

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead beside={<SectionMarks />} title={section.title} titleId={titleId} />

      <ul className="org-routes">
        {routes.items.map((route) => {
          const field = enabledField(route.kind);
          const enabled = values[field] === true;

          return (
            <li
              className={cx("org-routes__row", route.locked && "org-routes__row--locked")}
              key={route.kind}
            >
              <RouteControl
                enabled={enabled}
                mayEdit={access.mayEdit}
                onToggle={() => {
                  fields.set(field, !enabled);
                }}
                route={route}
                saving={access.mayEdit && !fields.editable}
              />

              <div className="org-routes__body">
                <p className="org-routes__what">{routeTitle(route, time)}</p>
                <RouteWhy recipients={recipients} route={route} />
                {route.locked && <Lock route={route} />}

                {access.mayEdit && route.kind === DAILY_DIGEST && (
                  <TextField
                    className="org-routes__editor"
                    error={fields.error(TIME_FIELD)}
                    hint={TIME_HINT}
                    id={fields.id(TIME_FIELD)}
                    label={TIME_LABEL}
                    mono
                    onChange={(event) => {
                      fields.set(TIME_FIELD, event.target.value);
                    }}
                    readOnly={!fields.editable}
                    type="time"
                    value={time}
                  />
                )}

                {access.mayEdit && route.kind === WEEKLY_INSIGHTS && (
                  <TextField
                    autoComplete="off"
                    className="org-routes__editor"
                    error={fields.error(RECIPIENTS_FIELD)}
                    hint={RECIPIENTS_HINT}
                    id={fields.id(RECIPIENTS_FIELD)}
                    label={RECIPIENTS_LABEL}
                    onChange={(event) => {
                      fields.set(RECIPIENTS_FIELD, event.target.value);
                    }}
                    readOnly={!fields.editable}
                    value={recipients}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {fields.refusal !== null && (
        <p className="org-routes__refusal" role="note">
          {fields.refusal}
        </p>
      )}
    </Card>
  );
}

/**
 * What stands where the mockup's switch is: the switch, the lock, or — for a reader with nothing
 * to operate — the route's position as a word.
 *
 * @param props.route The route.
 * @param props.enabled Its position as it stands on the card.
 * @param props.mayEdit Whether the reader may change settings.
 * @param props.saving Whether a save is in flight, which holds the switch still.
 * @param props.onToggle Flip the route's switch.
 * @returns The control.
 */
function RouteControl({
  route,
  enabled,
  mayEdit,
  saving,
  onToggle,
}: Readonly<{
  route: NotificationRoute;
  enabled: boolean;
  mayEdit: boolean;
  saving: boolean;
  onToggle: () => void;
}>) {
  if (mayEdit && mayToggle(route, enabled)) {
    return (
      <Toggle
        checked={enabled}
        className="org-routes__switch"
        label={routeName(route)}
        onClick={onToggle}
        reason={saving ? SAVING_LABEL : undefined}
      />
    );
  }

  if (route.locked) {
    return (
      <span aria-hidden className="org-routes__glyph">
        🔒
      </span>
    );
  }

  return <span className="org-routes__state">{enabled ? ON_WORD : OFF_WORD}</span>;
}

/**
 * The line under a route's title.
 *
 * @param props.route The route.
 * @param props.recipients The weekly recipients field as it stands.
 * @returns The line, or nothing for a route that has none.
 */
function RouteWhy({
  route,
  recipients,
}: Readonly<{ route: NotificationRoute; recipients: string }>) {
  const why = routeWhy(
    route,
    route.kind === WEEKLY_INSIGHTS ? parseRecipients(recipients) : undefined,
  );

  return why === null ? null : <p className="org-routes__why">{why}</p>;
}

/**
 * A locked row's explanation: the word, the service's reason, and the way to the integration that
 * would unlock it.
 *
 * The link is a real one, to the section's own address; a plain press is handed to the router,
 * for the tab row's reason — a native fragment jump leaves a history entry the router cannot
 * return to.
 *
 * @param props.route The locked route.
 * @returns The explanation.
 */
function Lock({ route }: Readonly<{ route: NotificationRoute }>) {
  const router = useRouter();
  const link = unlockLink(route.channel);

  return (
    <p className="org-routes__lock">
      <span className="org-routes__locked">{LOCKED_WORD}</span>
      {route.lockedReason !== null && route.lockedReason !== "" && <> — {route.lockedReason}</>}
      {route.enabled && <> · {SAVED_ON_CANNOT_FIRE}</>}{" "}
      <a
        className="org-routes__link"
        href={link.href}
        onClick={(event) => {
          // A modified press opens the section in another tab, as any link would.
          if (!isPlainClick(event)) return;

          event.preventDefault();
          router.push(link.href);
        }}
      >
        {link.text}
      </a>
    </p>
  );
}
