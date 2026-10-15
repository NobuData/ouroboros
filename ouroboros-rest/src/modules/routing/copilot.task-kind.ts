/**
 * The task kind the Workflow Copilot is routed as — `copilot-workflow`, which V142 gives every
 * workspace (#1748).
 *
 * Here rather than in the copilot module, so the workflow catalog can name it without
 * importing the copilot: it is a `task_kinds` row like any other for routing, and the Copilot's
 * own rather than a workflow stage's, so the stage catalog leaves it out.
 */
export const COPILOT_TASK_KIND = "copilot-workflow";
