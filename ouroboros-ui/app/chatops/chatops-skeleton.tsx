import { Card, Eyebrow, cx } from "@/app/ui";

import { CHATOPS_EYEBROW, CHATOPS_HEADLINE, CHATOPS_SUBLINE, LOADING_LABEL } from "./view";

import "./chatops.css";

/** How many rows the body's skeleton reserves — the three purposes. */
const SKELETON_ROWS = 3;

/**
 * What the reader sees while Chat Ops' reads are in flight (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)).
 *
 * `app/(app)/chatops/loading.tsx` returns this, and Next.js wraps the page in a Suspense boundary
 * with it as the fallback, so the shell paints at once and only the page waits.
 *
 * **The head is the real head** — its copy depends on no read. Its two actions are not drawn at
 * all, not even as bars: each is there only when the connection says so, and the skeleton cannot
 * know. Under it, a bar where the health strip sits and a card of three rows — the shape of both
 * the post-install step and a workspace's bound channels.
 *
 * **It says one thing to a screen reader.** The bars carry no text and are `aria-hidden`; the
 * `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide.
 *
 * @returns The page's frame, with bars where the reads' regions will be.
 */
export function ChatOpsSkeleton() {
  return (
    <main aria-busy="true" aria-label={LOADING_LABEL} className="chatops">
      <div className="chatops__head">
        <div className="chatops__headings">
          <Eyebrow>{CHATOPS_EYEBROW}</Eyebrow>
          <h1 className="chatops__title">{CHATOPS_HEADLINE}</h1>
          <p className="chatops__sub">{CHATOPS_SUBLINE}</p>
        </div>
      </div>
      <div aria-hidden="true" className="chatops__body">
        <span className="chatops__sk-bar chatops__sk-bar--strip" />
        <Card>
          <div className="chatops__sk-stack">
            <span className="chatops__sk-bar chatops__sk-bar--title" />
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <span className={cx("chatops__sk-bar", "chatops__sk-bar--row")} key={index} />
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
