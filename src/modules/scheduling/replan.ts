import { fromEpochMs } from "@/shared";

import { forwardEarliest, previousTarget, reverseTarget } from "./replan-algorithms";
import {
  compareText,
  failed,
  issue,
  prepareReplan,
} from "./replan-context";
import type { ReplanRequest, ReplanResult } from "./types";
import { scheduleDinner } from "./schedule";

export function replanRemainingTasks(input: ReplanRequest): ReplanResult {
  const prepared = prepareReplan(input);
  if (!("input" in prepared)) return prepared;
  if (prepared.completed.size === 0 && prepared.active.size === 0) {
    return scheduleDinner({
      ...input.request,
      availableFrom: fromEpochMs(Math.max(prepared.availableMs, prepared.nowMs)),
    });
  }
  const dueIds = input.activeTasks.filter((entry) => entry.status === "due")
    .map((entry) => entry.taskId).sort(compareText);
  if (dueIds.length > 0) {
    return failed([
      issue("RESOURCE_UNAVAILABLE", dueIds),
      issue("WINDOW_INFEASIBLE", dueIds),
    ]);
  }
  const previous = previousTarget(prepared);
  if (previous) return previous;
  const target = reverseTarget(prepared);
  if (target) return target;
  const earliest = forwardEarliest(prepared);
  return {
    feasible: false,
    issues: [issue("WINDOW_INFEASIBLE", prepared.remaining.map((task) => task.id))],
    earliestFeasible: earliest
      ? { tasks: earliest.tasks, serveAt: earliest.serveAt }
      : null,
  };
}
