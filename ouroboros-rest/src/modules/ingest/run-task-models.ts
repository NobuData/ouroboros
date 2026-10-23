/**
 * The alias each inheriting model stage asks for (DI.6, [#1321](https://github.com/NobuData/ouroboros/issues/1321)).
 *
 * A workflow's `llm` stage either pins a model (`routing.pinned_model`) or inherits a task's route
 * (`routing.inherit_task`). The engine's harness asks the facade for one alias per stage, and the
 * facade plans that alias along the stage's route; an alias the route does not carry falls back to
 * calling that alias alone. So a stage inheriting `implement` must ask with the `implement`
 * route's own alias — not the run's, which is whatever the run was opened with — or it is served
 * by another task's model. The run-start answer therefore names, per inherited task kind, the
 * alias its route starts on: the first hop routing kept with a provider, the same hop the facade
 * would call first.
 *
 * A task with no route, or whose route keeps nothing, is left out: the engine then falls back to
 * the run's model, as it did before, and the facade answers that alias as it always has.
 */

import type { Resolution } from "../routing/resolution";

/** A pinned workflow document, as far as this reads it. */
interface DocumentNode {
  readonly type?: unknown;
  readonly config?: { readonly routing?: { readonly inherit_task?: unknown } };
}

/**
 * The task kinds a pinned workflow's model stages inherit, each once.
 *
 * @param document - The pinned version's `definition` — anything; a document with no `nodes`
 *   array inherits nothing.
 * @returns The task kinds, in the order the stages name them.
 */
export function inheritedTasks(document: unknown): string[] {
  const raw =
    typeof document === "object" && document !== null
      ? (document as { readonly nodes?: unknown }).nodes
      : undefined;
  const nodes = Array.isArray(raw) ? (raw as DocumentNode[]) : [];
  const tasks: string[] = [];

  for (const node of nodes) {
    const task = node.config?.routing?.inherit_task;

    if (node.type === "llm" && typeof task === "string" && task !== "" && !tasks.includes(task)) {
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * The alias a resolved route starts on: its first hop routing kept, with a provider to call.
 *
 * @param resolution - The task kind's resolution.
 * @returns The alias, or `null` when routing refused the run or kept no callable hop.
 */
export function routeAlias(resolution: Resolution): string | null {
  if (resolution.outcome === "fail_run") {
    return null;
  }

  const first = resolution.chain.find((hop) => hop.decision === "kept" && hop.provider !== null);

  return first?.alias ?? null;
}

/**
 * Each inherited task kind's alias, for the run-start answer's `task_models`.
 *
 * @param document - The pinned version's `definition`.
 * @param resolve - Routing's resolution of one task kind in the run's workspace, or `null` when
 *   the workspace has no route for it.
 * @returns Task kind → alias; tasks with no callable route are omitted.
 */
export async function taskModels(
  document: unknown,
  resolve: (taskKind: string) => Promise<Resolution | null>,
): Promise<Record<string, string>> {
  const models: Record<string, string> = {};

  for (const task of inheritedTasks(document)) {
    const resolution = await resolve(task);
    const alias = resolution === null ? null : routeAlias(resolution);

    if (alias !== null) {
      models[task] = alias;
    }
  }

  return models;
}
