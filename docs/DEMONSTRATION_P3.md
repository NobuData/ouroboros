# Demonstration — P3 · The Application Shell

> A five-minute walkthrough of what phase **P3** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ all 8 issues closed
> ([#643](https://github.com/NobuData/ouroboros/issues/643)–[#650](https://github.com/NobuData/ouroboros/issues/650)).
> The roadmap's progress table still reads *5/8*; GitHub is the authority and it says
> eight.

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P3.md` — a
walkthrough script for phase **P3** of the order-of-execution plan.

Rules:
1. Ground every claim in this repository. Before writing a step, open the file,
   route, endpoint, migration or fixture it names and confirm it exists at HEAD.
2. Confirm what actually shipped:
   `gh issue list --state closed --limit 1000 --json number --jq '.[].number'`
   (plain `gh issue view` fails on this repo — use `--json`). The roadmap's ✅ marks
   can be stale; GitHub wins. Demonstrate only closed issues, and say plainly what
   the phase still owes.
3. No fabricated numbers. Every figure the presenter reads aloud must come from a
   seed file, a fixture under `tests/e2e/support/`, or a live response.
4. The walkthrough must fit in 5 minutes. Give it timed beats summing to ≤ 4:45.
5. Structure: What shipped · Setup · Walkthrough (timed table of navigation +
   narration) · Prove it · Don't claim.
6. Narration is what the presenter says out loud, in full sentences. Navigation is
   what they click or type.
7. Where a later phase moved or replaced something this phase built, say so rather
   than demonstrating the old shape.

Swap the phase token to regenerate any other phase: P0 … P17.
```

## What shipped

| Ref | Issue | What landed |
|-----|:-----:|-------------|
| `CP.1` | [#643](https://github.com/NobuData/ouroboros/issues/643) | Shell layout — fixed header, the grid, and scroll containment |
| `CQ.1` | [#648](https://github.com/NobuData/ouroboros/issues/648) | rem-based token scale and the px lint rule |
| `CP.2` | [#644](https://github.com/NobuData/ouroboros/issues/644) | Sidebar navigation and the module registry |
| `CP.4` | [#646](https://github.com/NobuData/ouroboros/issues/646) | In-pane chrome standards & primitives |
| `CP.5` | [#647](https://github.com/NobuData/ouroboros/issues/647) | Route migration and the shell e2e leg |
| `CQ.2` | [#649](https://github.com/NobuData/ouroboros/issues/649) | Font-size preference, persisted server-side, with a no-flash boot |
| `CP.3` | [#645](https://github.com/NobuData/ouroboros/issues/645) | Profile & session menu |
| `CQ.3` | [#650](https://github.com/NobuData/ouroboros/issues/650) | Readability QA and the visual-regression matrix |

**The point of the phase.** The roadmap calls this the single highest-leverage
ordering decision in the plan. Every one of the twenty screens that follows mounts in
the content pane and registers a sidebar entry. Built now, each screen costs one
registry entry. Built after the screens, it is a twenty-page re-hosting exercise plus
a rem conversion across 172 UI issues.

**The standing rule it creates:** from here on, a screen is not done until it mounts
in the content pane, registers its sidebar entry, and passes at 150% font scale.

## Setup

```bash
cd ouroboros
git switch main && git pull
yarn install && yarn setup
docker compose up -d                 # seeded PostgreSQL
yarn dev
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

Sign in at <http://localhost:3000> as `ken@acme-robotics.dev` /
`ouroboros-dev-password` and choose **Acme Robotics**, so you land on `/dashboard`
with a populated page — the shell's promises are only visible on a page long enough
to scroll.

Open a second tab on <http://localhost:3000/workshop/chrome>; you will use it in
beat 4. Reset the font scale to 100% before you begin (profile menu → **Font size**).

## Walkthrough — 4:45

### Beat 1 · Four regions, one of which scrolls — 0:00 → 1:00

**Navigate**

On `/dashboard`, scroll the page to the bottom and back up. Watch the header and the
sidebar.

**Say**

> Four regions: the header, the sidebar, the content pane, and the pane's own chrome.
> Exactly one of them scrolls. The document itself is locked — the pane is the sole
> scroll container in the product — so the header stays put and the sidebar stays put,
> and neither of them is doing it with a `position: fixed` hack that would fight the
> pane.
>
> That containment is asserted rather than eyeballed. The end-to-end suite measures
> the header's box before and after a deep scroll and requires it not to move, and
> `tests/e2e/scripts/verify-containment.sh` plants a viewport-fixed element and a
> horizontal overflow inside the pane and requires the assertion to go **red** naming
> each. A test that cannot fail is not a test.

### Beat 2 · The sidebar is a registry, and it tells the truth — 1:00 → 2:00

**Navigate**

Point down the sidebar: **Dashboard** and **Models** are links; **Issues**,
**Workflows**, **Build Farm**, **Knowledge**, **Planning**, **Research**,
**Insights**, **Needs You** and **Settings** are labelled rows. Hover one to show its
note. Then click the burger to collapse to the rail and expand again.

**Say**

> Eleven entries, and only the two that are built are links. The other nine are not
> hidden and they are not links to a 404 — they are labelled, non-interactive rows
> carrying the issue or the roadmap that will bring them. That is the design system's
> honesty rule: a surface that is not ready is *labelled*.
>
> Nothing here is hard-coded per screen. A module registers itself in the registry —
> id, label, route, icon, group, sort — and the sidebar draws it, lights the active
> one, and reserves a badge slot. The **Needs You** row has one, waiting for the
> inbox's live count in P14. That is what "each screen costs one registry entry"
> means in practice.

### Beat 3 · The reader's own font size — 2:00 → 3:10

**Navigate**

Open the profile menu. Use **Font size** to step up to **150%**. Let the page reflow.
Scroll it. Then reload the page with the scale still at 150%, watching the first
paint. Step back to 100%.

**Say**

> Five steps — 87.5, 100, 112.5, 125 and 150 percent — and the whole product is drawn
> in rem, so the step scales type, spacing, controls and chrome together instead of
> stretching text inside boxes that stayed put. A stylelint rule enforces it: an
> absolute unit on a property that ought to scale fails `yarn lint`. Pixels are still
> right for a hairline border or a shadow offset, and those are exactly what the rule
> leaves alone.
>
> Watch the reload. There is no flash of the default size before the preference
> arrives, because the choice is persisted server-side against the account and a small
> inline script sets the attribute before first paint. A 150% reader who watched the
> page jump on every navigation would not be being taken seriously.
>
> And 150% is a *bar*, not an aspiration: the readability leg walks the dense pages at
> 100, 125 and 150 percent in both palettes and checks four things a screenshot review
> cannot see — pane-level scroll, clipped labels, chrome overlapping chrome, and AA
> contrast.

### Beat 4 · The chrome contract every later screen builds on — 3:10 → 4:05

**Navigate**

Switch to the `/workshop/chrome` tab. Scroll it slowly so the subnav, the dirty-state
bar and the table header all stick. Click one of the subnav's anchor tabs.

**Say**

> This is the in-pane chrome story — the acceptance criteria of
> [#646](https://github.com/NobuData/ouroboros/issues/646) written as a page you can
> look at. The stacking contract is the point: subnav above dirty-state bar above
> table header, none of them covering another, and all of them stuck against the
> **pane** rather than the viewport.
>
> Watch the anchor link: the target lands *below* the stuck chrome rather than
> underneath it, because the offset is part of the contract. Every roadmap that owns a
> subnav — models, providers, registry, and every screen after them — builds against
> these primitives instead of re-deriving them, which is why the models pages you will
> see in the P5 demo look and behave like this one.

### Beat 5 · Both palettes, and the session that owns the menu — 4:05 → 4:45

**Navigate**

Back on `/dashboard`, use the profile menu's **Theme** row to switch palettes. Then
open the **Keyboard shortcuts** sheet from the same menu.

**Say**

> The theme control lives here now — P1 shipped it as a standalone button in the old
> top bar, and P3's menu is where it belongs, beside the font size, the workspace
> switcher and sign out. One menu, one place a reader configures how the product looks
> and who they are in it.
>
> The shortcuts sheet is the keyboard contract: the sidebar, the account menu and the
> search palette are all arrow-navigable with wrapping, Home and End jump to the ends,
> and Escape closes whatever is open. That is not decoration either — the shell leg
> drives it from the keyboard.

## Prove it

```bash
cd ouroboros-ui && yarn test && yarn lint      # the lint run includes the px rule
cd tests/e2e && scripts/run.sh -- --grep "shell"
cd tests/e2e && scripts/verify-containment.sh  # the falsifier for beat 1
cd tests/e2e && scripts/verify-readability.sh  # the falsifier for beat 3
```

- [`specs/shell-nav.spec.ts`](../tests/e2e/specs/shell-nav.spec.ts) — chrome that
  holds still under a deep pane scroll, containment nothing escapes, the eleven honest
  entries, the rail and the drawer, in both themes, and the font stepper taken to 150%
  and back.
- [`specs/readability.spec.ts`](../tests/e2e/specs/readability.spec.ts) — the
  {100%, 125%, 150%} × both palettes × dense pages matrix, diffed. It runs under its
  own Playwright configuration, not the default one.

## Don't claim

- **The search pill and the ⌘K palette are not P3's.** They are
  [#79](https://github.com/NobuData/ouroboros/issues/79), delivered with the dashboard
  in P4 — demonstrate them there.
- **The tenant chip and the live/needs-you pills are P4's too**
  ([#77](https://github.com/NobuData/ouroboros/issues/77),
  [#78](https://github.com/NobuData/ouroboros/issues/78)).
- **The Needs You badge has no count yet.** P3 reserved the slot; the inbox that
  fills it is P14.
- **Nine of the eleven sidebar entries go nowhere on purpose.** Do not click them
  expecting a screen — say what they are waiting for.
