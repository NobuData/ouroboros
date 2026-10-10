/**
 * The churn-interview file CL.5's suites import ([#618](https://github.com/NobuData/ouroboros/issues/618))
 * — mockup 22's `[19]`, as the CSV an owner would upload: fourteen exit interviews, nine of which
 * name docking reliability. `R__dev_seed_workspace_research.sql` seeds the same set.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

/** Where the set goes — `issue-index://support/churn-2026-q2`. */
export const CHURN_SET = {
  collection: "support",
  name: "churn-2026-q2",
  title: "Support churn interviews Q2",
  description:
    'Exit interviews with the 14 accounts that churned in Q2 2026. 9 of 14 cite docking reliability; several said the drone "gives up" after one abort.',
} as const;

/** The set's locator. */
export const CHURN_LOCATOR = "issue-index://support/churn-2026-q2";

/** How many interviews the file holds, and how many of them are labelled `docking`. */
export const CHURN_DOCUMENTS = 14;
export const CHURN_DOCKING = 9;

/** `churn-2026-q2.csv`. */
export const CHURN_CSV = `key,title,date,labels,account,seats,text
acct-01,Churn interview — Northwind Survey,2026-04-08,docking,Northwind Survey,12,"Docking reliability was the reason. In anything above a light breeze the drone aborts the approach and gives up — it sits at loiter until someone flies it in by hand."
acct-02,Churn interview — Harbor Inspection,2026-04-14,docking;recovery,Harbor Inspection,30,"Coastal sites are windy every afternoon. The drone gives up after one docking abort, and nobody on site knew the recovery procedure."
acct-03,Churn interview — Cascade Timber,2026-04-21,battery,Cascade Timber,6,Battery estimates were wrong on cold mornings; two missions ended early and we lost trust in the remaining-flight number.
acct-04,Churn interview — Meridian Rail,2026-04-29,docking,Meridian Rail,18,Docking aborts in gusts along the embankments. A competitor retries the approach; ours does not.
acct-05,Churn interview — Polar Logistics,2026-05-04,docking;battery,Polar Logistics,9,"Docking reliability first, cold-weather battery second. An aborted docking in the cold usually meant a dead unit by the time we reached it."
acct-06,Churn interview — Vantage Agritech,2026-05-11,telemetry,Vantage Agritech,22,Telemetry gaps of several minutes made the fleet dashboard useless for our compliance reports.
acct-07,Churn interview — Ridgeline Utilities,2026-05-15,docking;gusts,Ridgeline Utilities,40,Docking reliability on ridge sites. The approach is unstable in gusts and the drone gives up rather than re-plan.
acct-08,Churn interview — Bluewater Ports,2026-05-20,docking,Bluewater Ports,15,We need unattended docking. One abort and it waits at loiter until the battery forces a landing.
acct-09,Churn interview — Summit Mapping,2026-05-27,pricing,Summit Mapping,4,Budget. The product worked for us; the seat price did not survive our renewal review.
acct-10,Churn interview — Ironbridge Works,2026-06-02,docking;recovery,Ironbridge Works,11,"Docking reliability, and no clear recovery procedure after an abort — operators improvised every time."
acct-11,Churn interview — Tidewater Energy,2026-06-09,docking,Tidewater Energy,27,Offshore wind is constant. Docking aborts were daily and the unit never retried on its own.
acct-12,Churn interview — Greenfield Co-op,2026-06-12,ota,Greenfield Co-op,5,An interrupted update left two units needing manual recovery in the middle of harvest.
acct-13,Churn interview — Kestrel Security,2026-06-18,docking;pairing,Kestrel Security,14,"Docking reliability at night patrol sites, and the console lost pairing whenever a unit slept."
acct-14,Churn interview — Lakeshore Transit,2026-06-24,pairing,Lakeshore Transit,8,Console pairing dropped several times a week; we moved to a vendor with a wired dock.
`;

/** The same kind of set as Markdown — two interviews, with front lines. */
export const CHURN_MARKDOWN = `# Support churn interviews Q2

Exit interviews with accounts that churned in Q2 2026.

## Northwind Survey

Key: acct-01
Date: 2026-04-08
Labels: docking
Seats: 12

Docking reliability was the reason. In anything above a light breeze the drone aborts the
approach and gives up.

## Cascade Timber

Battery estimates were wrong on cold mornings.
`;
