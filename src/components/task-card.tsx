"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

import type { TaskRuntimeState } from "@/modules/cooking-session";
import type { ScheduleTask } from "@/modules/scheduling";
import { parseIsoInstant, toEpochMs } from "@/shared";
import type { IsoInstant, ResourceId } from "@/shared";

import { Button } from "./ui/button";

const RESOURCE_LABELS: Record<ResourceId, string> = {
  "cook:1": "Cook 1",
  "oven:1": "Oven 1",
  "burner:1": "Burner 1",
  "burner:2": "Burner 2",
};

const subscribeToHydration = () => () => undefined;
const browserClockSnapshot = () => true;
const serverClockSnapshot = () => false;

export type TaskCardProps = {
  task: ScheduleTask;
  runtime: TaskRuntimeState;
  plannedStart: IsoInstant;
  plannedEnd: IsoInstant;
  resources: readonly ResourceId[];
  now: IsoInstant;
  movedMinutes: number | null;
  movedBoundary: "start" | "finish" | null;
  pending: boolean;
  controlsDisabled?: boolean;
  focusRequested?: "start" | "complete" | null;
  onStart: () => void;
  onDelay: () => void;
  onComplete: () => void;
};

function clockLabel(instant: string, browserClock: boolean) {
  if (!browserClock) return "--:--";
  return parseIsoInstant(instant).ok
    ? new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(instant))
    : "Time unavailable";
}

function durationLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const short = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${short}` : short;
}

function timerLabel(runtime: TaskRuntimeState, now: string) {
  const parsedNow = parseIsoInstant(now);
  if (!parsedNow.ok) return "Time unavailable";
  const nowMs = toEpochMs(parsedNow.value);
  if (runtime.status === "completed") return "Completed";
  if (runtime.status === "ready") return "Ready now";
  if (runtime.status === "scheduled") {
    const parsedStart = parseIsoInstant(runtime.plannedStart);
    if (!parsedStart.ok) return "Time unavailable";
    const remaining = toEpochMs(parsedStart.value) - nowMs;
    return remaining > 0
      ? `Starts in ${durationLabel(remaining)}`
      : "Waiting on dependencies or resources";
  }
  if (runtime.expectedEnd === null) return "Time unavailable";
  const parsedEnd = parseIsoInstant(runtime.expectedEnd);
  if (!parsedEnd.ok) return "Time unavailable";
  const remaining = toEpochMs(parsedEnd.value) - nowMs;
  if (runtime.status === "due") {
    return remaining < 0 ? `${durationLabel(-remaining)} overdue` : "Due now";
  }
  return remaining > 0 ? `${durationLabel(remaining)} remaining` : "Due now";
}

function moveLabel(minutes: number, boundary: TaskCardProps["movedBoundary"]) {
  const sign = minutes > 0 ? "+" : "−";
  const subject = boundary === "finish" ? "finish moved" : "moved";
  return `Replanned · ${subject} ${sign}${Math.abs(minutes)} min`;
}

export function TaskCard(props: TaskCardProps) {
  const titleId = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef<HTMLButtonElement>(null);
  const browserClock = useSyncExternalStore(
    subscribeToHydration,
    browserClockSnapshot,
    serverClockSnapshot,
  );
  const { controlsDisabled, focusRequested, pending, runtime } = props;
  const isActive = props.runtime.status === "running" || props.runtime.status === "due";
  const status = props.runtime.status === "due"
    ? "Due · resource held"
    : props.runtime.status[0].toUpperCase() + props.runtime.status.slice(1);

  useEffect(() => {
    const target = focusRequested === "start" ? startRef.current
      : focusRequested === "complete" ? completeRef.current : null;
    if (!target || target.disabled) return;
    target.focus();
  }, [controlsDisabled, focusRequested, pending, runtime.status]);

  return (
    <article className={`task-card task-card--${props.runtime.status}`} aria-labelledby={titleId}>
      <div className="task-card__topline">
        <span className="task-card__status">{status}</span>
        <span>{props.task.mode === "active" ? "Active work" : "Hands-off time"}</span>
      </div>
      <h3 id={titleId}>{props.task.instruction}</h3>
      <p className="task-card__timer">
        {timerLabel(props.runtime, props.now)}
      </p>
      <p className="task-card__window">
        <time
          dateTime={props.plannedStart}
          aria-label={browserClock ? undefined : "Local time loading"}
        >
          {clockLabel(props.plannedStart, browserClock)}
        </time>
        <span aria-hidden="true">→</span>
        <time
          dateTime={props.plannedEnd}
          aria-label={browserClock ? undefined : "Local time loading"}
        >
          {clockLabel(props.plannedEnd, browserClock)}
        </time>
      </p>
      {props.movedMinutes !== null && props.movedMinutes !== 0 && (
        <p className="task-card__replan">
          {moveLabel(props.movedMinutes, props.movedBoundary)}
        </p>
      )}
      {props.resources.length > 0 && (
        <ul className="task-card__resources" aria-label={`Resources for ${props.task.instruction}`}>
          {props.resources.map((resource) => (
            <li key={resource}>
              {RESOURCE_LABELS[resource]}{isActive ? " occupied" : ""}
            </li>
          ))}
        </ul>
      )}
      {props.runtime.status === "due" && (
        <p className="task-card__lock">Resource lock held until Complete.</p>
      )}
      <div className="task-card__actions">
        {props.runtime.status === "ready" && (
          <Button
            ref={startRef}
            disabled={props.pending || props.controlsDisabled}
            aria-label={`Start ${props.task.instruction}`}
            onClick={props.onStart}
          >
            {props.pending ? "Starting…" : "Start"}
          </Button>
        )}
        {(props.runtime.status === "running" || props.runtime.status === "due") && (
          <>
            <Button
              variant="secondary"
              disabled={props.pending || props.controlsDisabled}
              aria-label={`Delay ${props.task.instruction} by 4 minutes`}
              onClick={props.onDelay}
            >
              +4 min
            </Button>
            <Button
              ref={completeRef}
              disabled={props.pending || props.controlsDisabled}
              aria-label={`Complete ${props.task.instruction}`}
              onClick={props.onComplete}
            >
              {props.pending ? "Saving…" : "Complete"}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
