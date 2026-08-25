import { Button, Card, Tag } from "@/app/ui";

import {
  SECURITY_MODEL_LINK,
  SECURITY_MODEL_URL,
  SECURITY_SHIELD,
  SECURITY_STRIP_COPY,
  SECURITY_STRIP_EMPHASIS,
  SECURITY_STRIP_LABEL,
  SECURITY_STRIP_TAGS,
  emphasised,
} from "./view";

import "./providers.css";

/**
 * Mockup 07's `c-12` security strip (AE.6,
 * [#232](https://github.com/NobuData/ouroboros/issues/232)): the shield, one sentence, one
 * tag, and the link to the document that backs the sentence.
 *
 * **Nothing here is this file's to say.** The copy is `docs/SECURITY_MODEL.md` § 7.1,
 * rendered verbatim from `app/providers/view.ts`'s constants, and the mockup's two
 * compliance badges are absent because § 7.3 withdrew them: `SOC 2 Type II` and `ISO 27001`
 * are certifications the product has not undergone, and displaying one is a false compliance
 * claim rather than an optimistic label. The tag slot holds exactly what the document lists
 * — one word — and renders nothing more until a certification exists, carries its date, and
 * can come down when it lapses. `__tests__/providers/security-strip.test.tsx` is the review
 * the roadmap asks for: it reads the document, compares, and looks for stowaway badges.
 *
 * An `aside` named for what it is, because it is beside the page's content rather than part
 * of it — a claim about the deployment, true whether the grid above holds five cards or none.
 * A Server Component with nothing to decide.
 */

/**
 * The strip.
 *
 * @returns The `aside`.
 */
export function SecurityStrip() {
  const parts = emphasised(SECURITY_STRIP_COPY, SECURITY_STRIP_EMPHASIS);

  return (
    <Card aria-label={SECURITY_STRIP_LABEL} as="aside" className="providers-security">
      <span aria-hidden="true" className="providers-security__shield">
        {SECURITY_SHIELD}
      </span>
      <p className="providers-security__copy">
        {parts === null ? (
          SECURITY_STRIP_COPY
        ) : (
          <>
            {parts[0]}
            <strong>{parts[1]}</strong>
            {parts[2]}
          </>
        )}
      </p>
      {/* The badge slot — § 7.3's rule is that it holds what is earned, and nothing else. */}
      {SECURITY_STRIP_TAGS.length > 0 && (
        <span className="providers-security__tags">
          {SECURITY_STRIP_TAGS.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </span>
      )}
      <Button href={SECURITY_MODEL_URL} rel="noreferrer" target="_blank" tone="ghost">
        {SECURITY_MODEL_LINK}
      </Button>
    </Card>
  );
}
