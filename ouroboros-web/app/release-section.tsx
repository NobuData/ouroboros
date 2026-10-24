import { RELEASE, RELEASE_FEATURES, RELEASE_LIMITS, RELEASE_NOTES_URL, RELEASE_STATE } from "./release";

/**
 * The hero's release marker: which release the page describes, linked to what is new in it.
 *
 * @returns The pill above the hero's eyebrow.
 */
export function ReleasePill() {
  return (
    <a className="release-pill rise d1" href="#rc1">
      <span className="release-pill__name">{RELEASE}</span>
      {RELEASE_STATE} — the loop runs for real
    </a>
  );
}

/**
 * The "New in RC1" section: the release's features, each linked to its documentation, what it
 * does not do yet, and the full list on the docs site.
 *
 * @returns The section.
 */
export default function ReleaseSection() {
  return (
    <section className="section" id="rc1">
      <div className="wrap">
        <div className="section-head center">
          <span className="eyebrow">New in {RELEASE} · {RELEASE_STATE}</span>
          <h2>The first release where the loop runs for real.</h2>
          <p>
            An issue goes in, a workflow executes, a model is called through your registry, your
            runner builds the change and a draft pull request comes out.
          </p>
        </div>
        <div className="bento">
          {RELEASE_FEATURES.map((f) => (
            <a key={f.title} className="tile half reveal" href={f.href}>
              <h3>{f.title}</h3>
              <p>{f.copy}</p>
              <span className="go">Read the docs →</span>
            </a>
          ))}
        </div>
        <p className="release-limits">{RELEASE_LIMITS}</p>
        <p className="release-more">
          <a className="btn ghost" href={RELEASE_NOTES_URL}>
            Everything in {RELEASE} →
          </a>
        </p>
      </div>
    </section>
  );
}
