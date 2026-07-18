import type { ScheduleIssue, ScheduleRequest, ScheduleTask } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(code: ScheduleIssue["code"], taskIds: string[]): ScheduleIssue {
  return { code, taskIds: [...new Set(taskIds)].sort(compareText) };
}

export function isScheduleRequestContainer(value: unknown): value is ScheduleRequest {
  return isObject(value) && Array.isArray(value.tasks) && value.tasks.length > 0;
}

export function invalidRequestIssues(): ScheduleIssue[] {
  return [issue("INVALID_TASK", ["request.tasks"])];
}

export function terminalSemanticsIssues(tasks: readonly ScheduleTask[]) {
  const byRecipe = new Map<string, ScheduleTask[]>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    byRecipe.set(task.recipeId, [...(byRecipe.get(task.recipeId) ?? []), task]);
  }
  const issues: ScheduleIssue[] = [];
  for (const recipeTasks of byRecipe.values()) {
    const terminal = recipeTasks.find((task) => task.isTerminal);
    if (!terminal) continue;
    const reachable = new Set<string>([terminal.id]);
    const pending = [...terminal.dependsOn];
    while (pending.length > 0) {
      const id = pending.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const dependency = byId.get(id);
      if (dependency) pending.push(...dependency.dependsOn);
    }
    const unfinished = recipeTasks
      .filter((task) => !reachable.has(task.id))
      .map((task) => task.id);
    const globalChildren = tasks
      .filter((task) => task.dependsOn.includes(terminal.id))
      .map((task) => task.id);
    if (unfinished.length > 0 || globalChildren.length > 0) {
      issues.push(issue(
        "INVALID_TERMINAL",
        [terminal.id, ...unfinished, ...globalChildren],
      ));
    }
  }
  return issues.sort((left, right) =>
    compareText(left.taskIds.join("\0"), right.taskIds.join("\0")));
}
