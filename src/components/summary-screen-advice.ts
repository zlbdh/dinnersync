import type { CookingSessionState } from "@/modules/cooking-session";
import type { ResourceId } from "@/shared";
import { parseIsoInstant } from "@/shared";

function validInstant(value: unknown): value is string {
  return typeof value === "string" && parseIsoInstant(value).ok;
}

function addPredecessor(
  predecessors: Map<string, Set<string>>,
  taskId: string,
  predecessorId: string,
) {
  const current = predecessors.get(taskId) ?? new Set<string>();
  current.add(predecessorId);
  predecessors.set(taskId, current);
}

type ExplicitDelay = { minutes: number; firstSequence: number };

function explicitDelays(session: CookingSessionState) {
  const delays = new Map<string, ExplicitDelay>();
  for (const event of session.events) {
    if (event.type !== "TASK_DELAYED"
      || !Number.isSafeInteger(event.delayMinutes) || event.delayMinutes <= 0) continue;
    const previous = delays.get(event.taskId);
    const minutes = (previous?.minutes ?? 0) + event.delayMinutes;
    if (!Number.isSafeInteger(minutes)) continue;
    delays.set(event.taskId, {
      minutes,
      firstSequence: Math.min(previous?.firstSequence ?? event.sequence, event.sequence),
    });
  }
  return delays;
}

function finishingPathIds(
  session: CookingSessionState,
  endpoints: readonly string[],
) {
  const definitions = new Map(session.request.tasks.map((task) => [task.id, task]));
  const predecessors = new Map<string, Set<string>>();

  const initialByTask = new Map<string, (typeof session.initialSchedule.tasks)[number]>();
  for (const scheduled of session.initialSchedule.tasks) {
    if (!definitions.has(scheduled.taskId)
      || initialByTask.has(scheduled.taskId)
      || !validInstant(scheduled.plannedStart)
      || !validInstant(scheduled.plannedEnd)) return null;
    initialByTask.set(scheduled.taskId, scheduled);
  }

  type ResourceEntry = {
    scheduled: (typeof session.schedule.tasks)[number];
    effectiveStart: number;
    effectiveEnd: number;
  };
  const currentIds = new Set<string>();
  const currentByTask = new Map<string, ResourceEntry>();
  const byResource = new Map<ResourceId, ResourceEntry[]>();
  for (const scheduled of session.schedule.tasks) {
    if (!definitions.has(scheduled.taskId)
      || currentIds.has(scheduled.taskId)
      || !validInstant(scheduled.plannedStart)
      || !validInstant(scheduled.plannedEnd)) return null;
    currentIds.add(scheduled.taskId);
    const runtime = session.runtime[scheduled.taskId];
    if (runtime?.actualStart !== null && runtime?.actualStart !== undefined
      && !validInstant(runtime.actualStart)) return null;
    if (runtime?.actualEnd !== null && runtime?.actualEnd !== undefined
      && !validInstant(runtime.actualEnd)) return null;
    const entry = {
      scheduled,
      effectiveStart: Date.parse(runtime?.actualStart ?? scheduled.plannedStart),
      effectiveEnd: Date.parse(runtime?.actualEnd ?? scheduled.plannedEnd),
    };
    currentByTask.set(scheduled.taskId, entry);
    for (const resourceId of scheduled.effectiveResources) {
      byResource.set(resourceId, [...(byResource.get(resourceId) ?? []), entry]);
    }
  }

  for (const task of session.request.tasks) {
    const initialCurrent = initialByTask.get(task.id);
    const current = currentByTask.get(task.id);
    if (!initialCurrent || !current) return null;
    for (const dependencyId of task.dependsOn) {
      const initialPrevious = initialByTask.get(dependencyId);
      const previous = currentByTask.get(dependencyId);
      if (!definitions.has(dependencyId) || !initialPrevious || !previous
        || previous.effectiveEnd > current.effectiveStart) return null;
      const originalCurrentStart = Date.parse(initialCurrent.plannedStart);
      const slack = originalCurrentStart - Date.parse(initialPrevious.plannedEnd);
      if (slack < 0) return null;
      const pushedPastSlack = previous.effectiveEnd > originalCurrentStart
        && current.effectiveStart > originalCurrentStart;
      if (slack === 0 || pushedPastSlack) {
        addPredecessor(predecessors, task.id, dependencyId);
      }
    }
  }

  for (const [resourceId, entries] of byResource) {
    const ordered = entries.toSorted((left, right) =>
      left.effectiveStart - right.effectiveStart
      || left.effectiveEnd - right.effectiveEnd
      || left.scheduled.taskId.localeCompare(right.scheduled.taskId));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.effectiveEnd > current.effectiveStart) return null;
      const initialPrevious = initialByTask.get(previous.scheduled.taskId);
      const initialCurrent = initialByTask.get(current.scheduled.taskId);
      if (!initialPrevious || !initialCurrent
        || !initialPrevious.effectiveResources.includes(resourceId)
        || !initialCurrent.effectiveResources.includes(resourceId)) continue;
      const originalCurrentStart = Date.parse(initialCurrent.plannedStart);
      const slack = originalCurrentStart - Date.parse(initialPrevious.plannedEnd);
      if (slack < 0 || previous.effectiveEnd < originalCurrentStart) continue;

      const consumedSlack = slack > 0
        && previous.effectiveEnd > originalCurrentStart
        && current.effectiveStart > originalCurrentStart;
      if (slack === 0 || consumedSlack) {
        addPredecessor(
          predecessors,
          current.scheduled.taskId,
          previous.scheduled.taskId,
        );
      }
    }
  }

  const path = new Set<string>();
  const visiting = new Set<string>();
  let valid = true;
  const visit = (taskId: string) => {
    if (visiting.has(taskId) || !definitions.has(taskId)) {
      valid = false;
      return;
    }
    if (path.has(taskId)) return;
    visiting.add(taskId);
    for (const predecessorId of predecessors.get(taskId) ?? []) visit(predecessorId);
    visiting.delete(taskId);
    path.add(taskId);
  };
  endpoints.forEach(visit);
  return valid ? path : null;
}

export function criticalPathAdvice(
  session: CookingSessionState | null,
  completedAt: string | null,
) {
  if (!session || !completedAt || !validInstant(completedAt)) {
    return "A next-service note needs completed timestamps for every task.";
  }
  const terminals = session.request.tasks.filter((task) => task.isTerminal);
  const terminalEnds = terminals
    .map((task) => ({ taskId: task.id, end: session.runtime[task.id]?.actualEnd }))
    .filter((entry): entry is { taskId: string; end: string } => validInstant(entry.end));
  if (terminals.length === 0 || terminalEnds.length !== terminals.length) {
    return "A next-service note is unavailable because the finishing path could not be verified.";
  }
  const latestEnd = Math.max(...terminalEnds.map((entry) => Date.parse(entry.end)));
  const endpoints = terminalEnds
    .filter((entry) => Date.parse(entry.end) === latestEnd)
    .map((entry) => entry.taskId);
  const delays = explicitDelays(session);
  const pathIds = finishingPathIds(session, endpoints);
  if (!pathIds) {
    return "A next-service note is unavailable because the finishing path could not be verified.";
  }

  const definitions = new Map(session.request.tasks.map((task) => [task.id, task]));
  const recorded = [...delays.entries()]
    .filter(([taskId]) => pathIds.has(taskId))
    .map(([taskId, delay]) => ({ taskId, ...delay }))
    .toSorted((left, right) => right.minutes - left.minutes
      || left.firstSequence - right.firstSequence
      || left.taskId.localeCompare(right.taskId))[0];
  if (!recorded) {
    return "No explicit delay was recorded on the verified finishing path, so this run does not support a step-specific buffer recommendation.";
  }
  const instruction = definitions.get(recorded.taskId)?.instruction;
  if (!instruction) {
    return "A next-service note is unavailable because the finishing path could not be verified.";
  }
  return `The largest explicit delay affecting the finishing dependency path was “${instruction}” at ${recorded.minutes} min. Review this step's timing and allow about that much extra time next time.`;
}
