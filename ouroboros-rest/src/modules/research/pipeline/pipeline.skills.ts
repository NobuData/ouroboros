/**
 * The two pipeline skills, as they ship (CM.5, [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * `create-roadmap` and `create-issues` are **registry skills** (BE.1, #405), not code: a workspace
 * reads them on the Knowledge page and may publish its own version, and the pipeline runs whatever
 * version is current. These bodies are only what a workspace starts with — written to the registry
 * the first time the pipeline needs a skill the workspace does not have (`origin: generated`), and
 * by the development seed, which holds the same text (`pipeline.skills.spec.ts` compares them).
 *
 * The output's *shape* is not here: the engine appends a fixed rule for it to whatever body runs,
 * so an edited procedure cannot change what is stored.
 */

/** A skill the pipeline runs. */
export type PipelineSkillSlug = "create-roadmap" | "create-issues";

/** What a workspace starts with for one pipeline skill. */
export interface ShippedSkill {
  readonly slug: PipelineSkillSlug;
  /** The one-line description the Knowledge table shows. */
  readonly description: string;
  /** The words that load it — narrow, so it is not injected into ordinary runs. */
  readonly triggers: readonly string[];
  /** The procedure. */
  readonly body: string;
}

/** `create-roadmap` — a brief becomes dated milestones of buildable items. */
export const CREATE_ROADMAP_BODY = `# create-roadmap

Turn a research brief into a roadmap: dated milestones, each a short list of items a loop can build.

## Inputs

- \`brief\` — the brief, exported as Markdown with its numbered sources.
- \`outline\` — the investigation's own roadmap input (themes and proposed milestones), when it produced one.
- \`previous\` — the roadmap this run replaces, when there is one.
- \`suggestions\` — changes people or the product asked for, oldest first.
- \`today\` — the date of the run.

## Procedure

1. Read the brief's findings and group them into themes. Leave open questions out: an item needs a finding behind it.
2. Order the themes by how strongly the sources support them, then by what the earlier ones unblock.
3. Cut milestones: each one is an outcome a customer would notice, two to five items, with a target date after \`today\`. Earlier milestones carry the MVP set.
4. Write each item as one buildable change — a title a ticket could carry. Mark it \`mvp\` when the milestone's outcome fails without it. Guess an effort (\`xs\` to \`xl\`) only when the brief gives grounds for one.
5. When \`previous\` is present, start from it: keep what the brief still supports, and keep the key of every milestone and item that survives.
6. Apply every entry of \`suggestions\`, in order. A suggestion that contradicts the brief still wins — a person asked for it.

## Rules

- Never invent a customer, a number or a date the brief does not support.
- A title names the change, not the problem: "Gust estimator from IMU residuals", not "Docking is unreliable".
- At most 50 milestones and 500 items.
`;

/** `create-issues` — each roadmap item becomes an issue description. */
export const CREATE_ISSUES_BODY = `# create-issues

Write the issue for each roadmap item, so that a loop — or a person — can pick it up without reading the brief.

## Inputs

- \`roadmap\` — the title and the milestones the items belong to.
- \`items\` — the items to describe: \`key\`, \`title\`, \`milestone\`, \`mvp\`, \`effort\`.
- \`brief\` — the brief the roadmap was generated from, with its numbered sources.

## Procedure

For every item, write a description with these sections:

1. **Problem** — what a customer or operator meets today, citing the brief's findings by source number.
2. **Scope** — what changes, and what is deliberately left out.
3. **Acceptance criteria** — a checklist a reviewer can verify.
4. **Dependencies** — other items of this roadmap it needs, by title.

## Rules

- One description per item, and none for anything else.
- Do not write an estimate, a date, an effort or a complexity: the estimator sizes every issue when it is filed.
- Do not restate the title as the first line.
`;

/** The shipped skills, by slug. */
export const SHIPPED_SKILLS: Readonly<Record<PipelineSkillSlug, ShippedSkill>> = Object.freeze({
  "create-roadmap": Object.freeze({
    slug: "create-roadmap",
    description: "Turn a research brief into ROADMAP.md: dated milestones of buildable items",
    triggers: Object.freeze(["create-roadmap"]),
    body: CREATE_ROADMAP_BODY,
  }),
  "create-issues": Object.freeze({
    slug: "create-issues",
    description: "Write the issue for each roadmap item; the estimator sizes it when filed",
    triggers: Object.freeze(["create-issues"]),
    body: CREATE_ISSUES_BODY,
  }),
});

/** The change note of the version the pipeline writes for a workspace that has none. */
export const SHIPPED_CHANGE_NOTE = "Shipped procedure";
