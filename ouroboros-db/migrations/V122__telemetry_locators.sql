-- V122__telemetry_locators.sql — a telemetry citation may name a stored baseline, compare two
-- windows, and carry the rest of its query (#619, CL.6).
--
-- V108 gave a `telemetry` source one shape: `telemetry://<metric>[/<metric>…]/<window>`, the
-- window `<n>h|d|w` or a date range. The build & test telemetry tool (#619) cites three things
-- that shape cannot say:
--
--   * **a comparison** — `compare(metric, window_a, window_b)` is one result and one citation:
--     `telemetry://…/<window-a>-vs-<window-b>`;
--   * **a stored baseline** — the regression watch's `nightly vs. v2.0.4 baseline` reads a
--     release's captured window (V115), so a window may be `baseline:<release tag>`;
--   * **the rest of the query** — a repository, a dimension or a suite's name narrows a window, and
--     a citation that leaves them out cannot be re-run. They ride as a query string,
--     percent-encoded: `?repo=acme-robotics%2Fhelios-firmware`.
--
-- Everything V108 and V118 accepted is still accepted. The tool itself always writes **absolute**
-- windows (a date range, never `30d`), because "the last thirty days" names a different window
-- tomorrow and a cited number must be re-runnable; the relative form stays legal for the rows
-- already stored.
--
-- A baseline's tag is `[A-Za-z0-9._~%+-]`, at most 160 characters — anything else in a release
-- tag is percent-encoded by the writer. `-vs-` is the separator, so the writer refuses to cite a
-- tag that contains it rather than write a locator that splits in the wrong place.
--
-- The TypeScript mirror is `ouroboros-rest/src/modules/research/tools/research-tool.citations.ts`.
--
-- To undo (forward only — for a rehearsal against a copy): `create or replace` the function with
-- V118's body. Rows citing the widened forms would then fail a re-validation, so remove them first.

-- source_locator_valid(kind, locator) — whether a locator is well-formed for its record kind.
--   kind    — web | competitor_diff | code | ticket | telemetry | doc
--   locator — the URL or internal URI
--   returns true when the locator matches the kind's pattern:
--     web, competitor_diff, doc  https?://host/…
--     ticket                     issue-index://<index>/<key>[/…], or an https?:// URL
--     code                       git://<repo>[/<repo>]@<sha, 7–40 hex>[/<path>][#L<n>[-L<m>]], or
--                                bisect://<owner>/<name>@<culprit, 40 hex>?jobs=<uuid>[,<uuid>…] (≤ 32)
--     telemetry                  telemetry://<segment>[/<segment>…]/<window>[-vs-<window>][?<query>],
--                                a window <n>h|d|w, <date>[T<time>Z]..<date>[T<time>Z] or
--                                baseline:<tag>; the query percent-encoded key=value pairs
create or replace function ouroboros.source_locator_valid(kind text, locator text)
returns boolean language sql immutable as $$
  select coalesce(length(locator) <= 2048 and locator !~ '\s' and case kind
    when 'web'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'competitor_diff' then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'doc'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'ticket'          then locator ~ '^issue-index://[a-z0-9][a-z0-9_-]*(/[A-Za-z0-9._#-]+)+$'
                             or locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'code'            then (locator ~ '^git://[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?@[0-9a-f]{7,40}(/[A-Za-z0-9._-]+)*(#L[1-9][0-9]*(-L[1-9][0-9]*)?)?$'
                                 and locator !~ '/\.\.?(/|#|$)')
                             or (locator ~ '^bisect://[A-Za-z0-9._-]+/[A-Za-z0-9._-]+@[0-9a-f]{40}\?jobs=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,31}$'
                                 and locator !~ '/\.\.?@')
    when 'telemetry'       then locator ~ '^telemetry://[a-z0-9][a-z0-9_.-]*(/[a-z0-9][a-z0-9_.-]*)*/([1-9][0-9]*[hdw]|[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?|baseline:[A-Za-z0-9._~%+-]{1,160})(-vs-([1-9][0-9]*[hdw]|[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?|baseline:[A-Za-z0-9._~%+-]{1,160}))?(\?[A-Za-z0-9._~%=&+-]+)?$'
    else false
  end, false);
$$;

comment on function ouroboros.source_locator_valid(text, text) is
  'True when a source locator is well-formed for its kind (#609, widened by #617 and #619): web/competitor_diff/doc an http(s) URL; ticket issue-index://<index>/<key> or an http(s) URL; code git://<repo>@<sha>[/<path>][#L<n>[-L<m>]] or bisect://<owner>/<name>@<culprit sha>?jobs=<uuid>[,…] (at most 32 jobs); telemetry telemetry://<segment>[/…]/<window>[-vs-<window>][?<query>] with a window of <n>h|d|w, <date>..<date> or baseline:<tag>. At most 2048 characters, no whitespace.';
