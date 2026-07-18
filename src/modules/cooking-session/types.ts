import type {
  Schedule,
  ScheduleRequest,
  ScheduleResult,
} from "@/modules/scheduling";
import type { IsoInstant } from "@/shared";

export type TaskStatus = "scheduled" | "ready" | "running" | "due" | "completed";

export type TaskRuntimeState = {
  taskId: string;
  status: TaskStatus;
  plannedStart: IsoInstant;
  plannedEnd: IsoInstant;
  actualStart: IsoInstant | null;
  actualEnd: IsoInstant | null;
  expectedEnd: IsoInstant | null;
};

export type SessionEvent =
  | { sequence: number; type: "TASK_STARTED"; taskId: string; at: IsoInstant }
  | {
    sequence: number;
    type: "TASK_DELAYED";
    taskId: string;
    at: IsoInstant;
    delayMinutes: number;
  }
  | { sequence: number; type: "TASK_DUE"; taskId: string; at: IsoInstant }
  | { sequence: number; type: "TASK_COMPLETED"; taskId: string; at: IsoInstant };

export type SessionCommand =
  | { type: "START"; taskId: string; at: IsoInstant }
  | { type: "DELAY"; taskId: string; at: IsoInstant; delayMinutes: number }
  | { type: "COMPLETE"; taskId: string; at: IsoInstant };

export type SessionWarning = {
  code: "SCHEDULE_INFEASIBLE" | "STORAGE_UNAVAILABLE" | "SNAPSHOT_RECOVERED";
  message: string;
};

export type SessionCommandIssue = {
  code: "INVALID_DELAY" | "INVALID_START" | "RESOURCE_LOCKED";
  taskId: string;
};

export type CookingSessionState = {
  request: ScheduleRequest;
  initialSchedule: Schedule;
  schedule: Schedule;
  runtime: Record<string, TaskRuntimeState>;
  events: SessionEvent[];
  lastReplan: ScheduleResult | null;
  lastCommandIssue: SessionCommandIssue | null;
  warnings: SessionWarning[];
};

export type SessionSnapshotV1 = {
  version: 1;
  request: ScheduleRequest;
  initialSchedule: Schedule;
  events: SessionEvent[];
};
