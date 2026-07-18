import {
  effectiveResources,
  isKitchenResources,
  isResourceRequirement,
  isTaskMode,
} from "@/shared";
import type { KitchenResources, ResourceId } from "@/shared";

import type { ScheduleIssue, ScheduleIssueCode, ScheduleTask } from "./types";

const ISSUE_ORDER: readonly ScheduleIssueCode[] = [
  "INVALID_TASK",
  "DUPLICATE_TASK_ID",
  "DUPLICATE_DEPENDENCY",
  "INVALID_DURATION",
  "MISSING_DEPENDENCY",
  "DEPENDENCY_CYCLE",
  "INVALID_TERMINAL",
  "INVALID_RESOURCE",
  "OVEN_TRANSITION_REQUIRED",
  "RESOURCE_UNAVAILABLE",
  "RESOURCE_CONFLICT",
  "WINDOW_INFEASIBLE",
];

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasGraphShape(value: unknown): value is ScheduleTask {
  return isObject(value)
    && isNonBlank(value.id)
    && isNonBlank(value.recipeId)
    && Array.isArray(value.dependsOn)
    && value.dependsOn.every(isNonBlank)
    && typeof value.isTerminal === "boolean";
}

function invalidTaskMarker(value: unknown, index: number) {
  return isObject(value) && isNonBlank(value.id) ? value.id : `invalid-task-${index}`;
}

function issue(code: ScheduleIssueCode, taskIds: readonly string[]): ScheduleIssue {
  return { code, taskIds: [...new Set(taskIds)].sort(compareText) };
}

function stableIssues(issues: readonly ScheduleIssue[]) {
  const unique = new Map<string, ScheduleIssue>();
  for (const entry of issues) unique.set(`${entry.code}:${entry.taskIds.join("\0")}`, entry);
  return [...unique.values()].sort((left, right) =>
    ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code)
    || compareText(left.taskIds.join("\0"), right.taskIds.join("\0")));
}

function idCounts(tasks: readonly ScheduleTask[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
  return counts;
}

function uniqueTaskMap(tasks: readonly ScheduleTask[]) {
  const counts = idCounts(tasks);
  return new Map(tasks
    .filter((task) => counts.get(task.id) === 1)
    .map((task) => [task.id, task]));
}

function safeDependencies(task: ScheduleTask) {
  return Array.isArray(task.dependsOn)
    ? task.dependsOn.filter((dependency): dependency is string => typeof dependency === "string")
    : [];
}

export function resolveTaskResourceIds(task: ScheduleTask): ResourceId[] {
  return effectiveResources(task.mode, task.resources).map((entry) => entry.resourceId);
}

function resourceIssue(task: ScheduleTask, kitchen: KitchenResources) {
  if (!isTaskMode(task.mode)
    || !Array.isArray(task.resources)
    || !task.resources.every(isResourceRequirement)) return true;
  const resources = resolveTaskResourceIds(task);
  return kitchen.burners === 1 && resources.includes("burner:2");
}

function validOvenOperation(value: unknown) {
  return value === "preheat" || value === "cook" || value === "temperature-change";
}

function validOvenTemperature(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= -100
    && value <= 1_000;
}

function hasRawOven(task: ScheduleTask) {
  return Array.isArray(task.resources)
    && task.resources.some((entry) => isResourceRequirement(entry)
      && entry.resourceId === "oven:1");
}

function ovenFieldsInvalid(task: ScheduleTask) {
  const hasOven = hasRawOven(task);
  const hasValidFields = validOvenOperation(task.ovenOperation)
    && validOvenTemperature(task.ovenTemperatureC);
  return hasOven ? !hasValidFields : task.ovenOperation !== null || task.ovenTemperatureC !== null;
}

function hasRequiredTransition(task: ScheduleTask, tasks: ReadonlyMap<string, ScheduleTask>) {
  if (task.ovenOperation !== "cook" || !validOvenTemperature(task.ovenTemperatureC)) return true;
  const pending = safeDependencies(task).sort(compareText);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependency = tasks.get(id);
    if (!dependency) continue;
    if (hasRawOven(dependency)) {
      if (!validOvenOperation(dependency.ovenOperation)
        || !validOvenTemperature(dependency.ovenTemperatureC)
        || dependency.ovenTemperatureC !== task.ovenTemperatureC) continue;
      if (dependency.ovenOperation === "preheat"
        || dependency.ovenOperation === "temperature-change") return true;
    }
    pending.push(...safeDependencies(dependency)
      .filter((entry) => !visited.has(entry)).sort(compareText));
  }
  return false;
}

function cycleIssues(tasks: ReadonlyMap<string, ScheduleTask>) {
  let cursor = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const issues: ScheduleIssue[] = [];

  const visit = (id: string) => {
    indices.set(id, cursor);
    lowLinks.set(id, cursor++);
    stack.push(id);
    onStack.add(id);
    const current = tasks.get(id);
    const dependencies = current ? safeDependencies(current) : [];
    const knownDependencies = dependencies
      .filter((dependency) => tasks.has(dependency))
      .toSorted(compareText);
    for (const dependency of knownDependencies) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(dependency)!));
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member = "";
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    const selfCycle = component.length === 1
      && (current ? safeDependencies(current) : []).includes(id);
    if (component.length > 1 || selfCycle) issues.push(issue("DEPENDENCY_CYCLE", component));
  };

  [...tasks.keys()].sort(compareText).forEach((id) => {
    if (!indices.has(id)) visit(id);
  });
  return issues;
}

export function topologicallySortTasks(tasks: readonly ScheduleTask[]): ScheduleTask[] {
  if (!Array.isArray(tasks) || !(tasks as readonly unknown[]).every(hasGraphShape)) return [];
  const graphTasks = tasks as readonly ScheduleTask[];
  const map = uniqueTaskMap(graphTasks);
  if (map.size !== graphTasks.length) return [];
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const task of graphTasks) {
    if (!Array.isArray(task.dependsOn)
      || task.dependsOn.some((dependency) => !map.has(dependency))) return [];
    indegree.set(task.id, new Set(task.dependsOn).size);
    for (const dependency of new Set(task.dependsOn)) {
      children.set(dependency, [...(children.get(dependency) ?? []), task.id]);
    }
  }
  const ready = [...map.keys()].filter((id) => indegree.get(id) === 0).sort(compareText);
  const ordered: ScheduleTask[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(map.get(id)!);
    for (const child of (children.get(id) ?? []).sort(compareText)) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) ready.push(child);
    }
    ready.sort(compareText);
  }
  return ordered.length === graphTasks.length ? ordered : [];
}

export function validateTaskGraph(
  tasks: readonly ScheduleTask[],
  kitchen: KitchenResources,
): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  if (!Array.isArray(tasks)) return [issue("INVALID_TASK", ["tasks"])];
  const graphTasks: ScheduleTask[] = [];
  (tasks as readonly unknown[]).forEach((value, index) => {
    if (hasGraphShape(value)) {
      graphTasks.push(value);
      return;
    }
    const marker = invalidTaskMarker(value, index);
    issues.push(issue("INVALID_TASK", [marker]));
    if (isObject(value) && !Array.isArray(value.dependsOn)) {
      issues.push(issue("MISSING_DEPENDENCY", [marker]));
    }
  });
  const counts = idCounts(graphTasks);
  for (const [id, count] of counts) {
    if (count > 1) issues.push(issue("DUPLICATE_TASK_ID", [id]));
  }
  const knownIds = new Set(counts.keys());
  for (const task of graphTasks) {
    if (!Number.isSafeInteger(task.durationMinutes) || task.durationMinutes <= 0) {
      issues.push(issue("INVALID_DURATION", [task.id]));
    }
    const dependencies = safeDependencies(task);
    if (!Array.isArray(task.dependsOn)) {
      issues.push(issue("MISSING_DEPENDENCY", [task.id]));
    }
    if (new Set(dependencies).size !== dependencies.length) {
      issues.push(issue("DUPLICATE_DEPENDENCY", [task.id]));
    }
    for (const dependency of new Set(dependencies)) {
      if (typeof dependency !== "string" || !knownIds.has(dependency)) {
        issues.push(issue("MISSING_DEPENDENCY", [task.id, String(dependency)]));
      }
    }
  }
  const uniqueTasks = uniqueTaskMap(graphTasks);
  issues.push(...cycleIssues(uniqueTasks));

  const recipeTasks = new Map<string, ScheduleTask[]>();
  for (const task of graphTasks) {
    recipeTasks.set(task.recipeId, [...(recipeTasks.get(task.recipeId) ?? []), task]);
  }
  for (const grouped of recipeTasks.values()) {
    const terminals = grouped.filter((task) => task.isTerminal === true);
    if (terminals.length !== 1) {
      issues.push(issue(
        "INVALID_TERMINAL",
        terminals.length > 1 ? terminals.map((task) => task.id) : grouped.map((task) => task.id),
      ));
    }
  }

  const validKitchen = isKitchenResources(kitchen);
  for (const task of graphTasks) {
    if (!validKitchen || resourceIssue(task, kitchen)) {
      issues.push(issue("INVALID_RESOURCE", [task.id]));
    }
    if (ovenFieldsInvalid(task) || !hasRequiredTransition(task, uniqueTasks)) {
      issues.push(issue("OVEN_TRANSITION_REQUIRED", [task.id]));
    }
  }
  return stableIssues(issues);
}
