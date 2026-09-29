import { cx } from "@/app/ui";

import {
  type BannerLink,
  STATE_BANNER_LABEL,
  type StateBannerTone,
  type StateBannerView,
} from "./states";

/** The class each tone's banner takes. */
const TONE_CLASS: Record<StateBannerTone, string> = {
  ok: "prv-state--ok",
  err: "prv-state--err",
  neutral: "prv-state--neutral",
};

/** What the skipped actions' list is named. */
export const SKIPPED_LABEL = "Switched on, and did not run";

/**
 * One of the banner's links.
 *
 * @param props.link The link, from `states.ts`.
 * @returns A link that leaves the application in a new tab, or one that stays on this page.
 */
function StateLink({ link }: Readonly<{ link: BannerLink }>) {
  return link.external ? (
    <a className="prv-state__link" href={link.href} rel="noopener noreferrer" target="_blank">
      {`${link.label} ↗`}
    </a>
  ) : (
    <a className="prv-state__link" href={link.href}>
      {`${link.label} →`}
    </a>
  );
}

/**
 * The PR page's state banner ([#370](https://github.com/NobuData/ouroboros/issues/370)) — what a
 * reader is told first on a PR that has merged, closed, or been disarmed by a re-check.
 *
 * The page's cards are long, and the Merge plan card that holds the receipt and the disarm reason
 * is near its foot. A reader who opens a merged PR should not have to scroll to learn that it
 * merged, as whom and at which sha; one who armed a merge and came back should be told **which**
 * re-check refused it before anything else. So the state is said once, above the head.
 *
 * Every sentence is `states.ts`'s; this file only draws. It is a `status`, in the polite queue:
 * a merge landing while the page is open is announced without cutting across what a screen
 * reader was saying. The hue is never the only signal — the headline says the state in words.
 *
 * @param props.view The banner, from `stateBanner`.
 * @returns The banner.
 */
export function PrStateBanner({ view }: Readonly<{ view: StateBannerView }>) {
  return (
    <div
      aria-label={STATE_BANNER_LABEL}
      className={cx("prv-state", TONE_CLASS[view.tone])}
      role="status"
    >
      <p className="prv-state__headline">
        <span>{view.headline}</span>
        {view.moment !== null && (
          <>
            <span>{" · "}</span>
            <time className="prv-state__moment" dateTime={view.moment.at}>
              {view.moment.text}
            </time>
          </>
        )}
      </p>

      {view.lines.map((line) => (
        <p className="prv-state__line" key={line}>
          {line}
        </p>
      ))}

      {view.skipped.length > 0 && (
        <ul aria-label={SKIPPED_LABEL} className="prv-state__skipped">
          {view.skipped.map((skipped) => (
            <li className="prv-state__skipped-row" key={skipped.action}>
              {`Did not run: ${skipped.label}`}
              {skipped.detail !== null && ` — ${skipped.detail}`}
            </li>
          ))}
        </ul>
      )}

      {view.links.length > 0 && (
        <p className="prv-state__links">
          {view.links.map((link) => (
            <StateLink key={link.href} link={link} />
          ))}
        </p>
      )}
    </div>
  );
}
