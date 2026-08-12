import Image from "next/image";

/**
 * The 55% half of the mockup: the tagline lockup, the three brand lines, the trust row.
 *
 * Everything here is copy and brand, and all of it is the mockup's own — the three lines
 * verbatim, the SOC 2 / SSO / self-hostable row verbatim. The lockup is the asset pair #14
 * cut from the brand sheet, and it is a **pair** for the reason `docs/BRAND.md` gives: the
 * treatment follows the surface it sits on, so a light ground gets the light lockup and a
 * dark ground the dark one. Which is visible is decided in CSS (`login.css`), not here, so
 * the right one is painted before any JavaScript runs and both are laid out at all times —
 * neither can move the column.
 *
 * `priority` on both images because this is the first screen of the product and the lockup
 * is its largest element: leaving it to lazy loading would put the brand in second place
 * behind a card. Only one of the two carries the alt text — they are one picture drawn
 * twice, and a screen reader that heard the tagline twice would be describing the
 * technique rather than the page.
 */

/** The lockup's intrinsic size (`docs/brand/lockup-tagline-*.png`). */
const LOCKUP = { width: 640, height: 471 } as const;

/** The alt text the whole lockup carries — the mark plus the tagline it sets. */
const LOCKUP_ALT = "Ouroboros — Infinity in Autonomy";

/** The mockup's three lines, in order, dimmest to brightest by CSS. */
const LINES = [
  "Point it at your backlog.",
  "It plans, codes, builds, reviews, and merges.",
  "You watch the loop turn.",
] as const;

/** The mockup's trust row. Claims about the product, not about this build. */
const TRUST = ["SOC 2 Type II", "SSO / SAML", "Self-hostable"] as const;

/**
 * The brand panel.
 *
 * @returns The lockup, the brand lines and the trust row.
 */
export function BrandPanel() {
  return (
    <section className="login-brand" aria-label="Ouroboros">
      <span className="login-brand__lockup">
        <Image
          className="login-brand__mark login-brand__mark--light"
          src="/brand/lockup-tagline-light.png"
          alt={LOCKUP_ALT}
          width={LOCKUP.width}
          height={LOCKUP.height}
          priority
        />
        <Image
          className="login-brand__mark login-brand__mark--dark"
          src="/brand/lockup-tagline-dark.png"
          alt=""
          width={LOCKUP.width}
          height={LOCKUP.height}
          priority
          aria-hidden
        />
      </span>

      <div className="login-brand__lines">
        {LINES.map((line) => (
          <p className="login-brand__line" key={line}>
            {line}
          </p>
        ))}
      </div>

      <ul className="login-brand__trust">
        {TRUST.map((claim) => (
          <li key={claim}>{claim}</li>
        ))}
      </ul>
    </section>
  );
}
