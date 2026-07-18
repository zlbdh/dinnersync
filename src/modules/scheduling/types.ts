import type { CookingStep } from "@/modules/recipe-import";
import type { IsoInstant, KitchenResources, ResourceId } from "@/shared";

export type ScheduleTask = CookingStep & { recipeId: string };

export type ScheduleRequest = {
  tasks: ScheduleTask[];
  kitchen: KitchenResources;
  availableFrom: IsoInstant;
  serveAt: IsoInstant;
  serveToleranceMinutes: 5;
};

export type ScheduledTask = {
  taskId: string;
  plannedStart: IsoInstant;
  plannedEnd: IsoInstant;
  effectiveResources: ResourceId[];
};

export type ScheduleIssueCode =
  | "INVALID_TASK"
  | "INVALID_DURATION"
  | "MISSING_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "INVALID_TERMINAL"
  | "INVALID_RESOURCE"
  | "OVEN_TRANSITION_REQUIRED"
  | "DUPLICATE_TASK_ID"
  | "DUPLICATE_DEPENDENCY"
  | "RESOURCE_UNAVAILABLE"
  | "RESOURCE_CONFLICT"
  | "WINDOW_INFEASIBLE";

export type ScheduleIssue = {
  code: ScheduleIssueCode;
  taskIds: string[];
};

export type Schedule = {
  feasible: true;
  tasks: ScheduledTask[];
  serveAt: IsoInstant;
};

export type InfeasibleSchedule = {
  feasible: false;
  issues: ScheduleIssue[];
  earliestFeasible: { tasks: ScheduledTask[]; serveAt: IsoInstant } | null;
};

export type ScheduleResult = Schedule | InfeasibleSchedule;

export type ReplanRequest = {
  request: ScheduleRequest;
  previous: Schedule;
  now: IsoInstant;
  completedTaskIds: string[];
  activeTasks: Array<{
    taskId: string;
    status: "running" | "due";
    actualStart: IsoInstant;
    expectedEnd: IsoInstant;
    lockUntil: IsoInstant | null;
    effectiveResources: ResourceId[];
  }>;
};
