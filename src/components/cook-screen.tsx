"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CookingSessionState,
  SessionCommand,
  TaskRuntimeState,
} from "@/modules/cooking-session";
import type { DinnerPlannerWarning } from "@/modules/dinner-planner";
import type { ScheduledTask, ScheduleTask } from "@/modules/scheduling";
import { parseIsoInstant, toEpochMs } from "@/shared";

import { TaskCard } from "./task-card";
import { Button } from "./ui/button";

export type CookCommandDispatcher = (
  command: SessionCommand,
) => void | Promise<void>;

export type CookScreenProps = {
  session: CookingSessionState;
  now: string;
  onDispatch: CookCommandDispatcher;
  onAccelerate?: (
    dispatch: CookCommandDispatcher,
  ) => void | Promise<void>;
  playbackRate?: number;
  restoredFromStorage?: boolean;
  plannerWarnings?: readonly DinnerPlannerWarning[];
};

type TaskView = {
  definition: ScheduleTask;
  runtime: TaskRuntimeState;
  scheduled: ScheduledTask;
  movedMinutes: number | null;
  movedBoundary: "start" | "finish" | null;
};

type FocusIntent = Extract<SessionCommand, { type: "START" | "COMPLETE" }>;
type FocusRequest = { taskId: string; action: "start" | "complete" };

function requestedFocus(intent: FocusIntent | null, views: readonly TaskView[]) {
  if (!intent) return null;
  const actedOn = views.find((view) => view.runtime.taskId === intent.taskId);
  if (!actedOn) return null;
  if (intent.type === "START"
    && (actedOn.runtime.status === "running" || actedOn.runtime.status === "due")) {
    return { taskId: intent.taskId, action: "complete" } satisfies FocusRequest;
  }
  if (intent.type !== "COMPLETE" || actedOn.runtime.status !== "completed") return null;
  const target = views.find((view) =>
    view.runtime.status === "running" || view.runtime.status === "due")
    ?? views.find((view) => view.runtime.status === "ready");
  if (!target) return "current" as const;
  return {
    taskId: target.runtime.taskId,
    action: target.runtime.status === "ready" ? "start" : "complete",
  } satisfies FocusRequest;
}

function epoch(instant: string) {
  const parsed = parseIsoInstant(instant);
  return parsed.ok ? toEpochMs(parsed.value) : Number.POSITIVE_INFINITY;
}

function taskViews(session: CookingSessionState) {
  const definitions = new Map(session.request.tasks.map((task) => [task.id, task]));
  const initial = new Map(session.initialSchedule.tasks.map((task) => [task.taskId, task]));
  return session.schedule.tasks.flatMap((scheduled): TaskView[] => {
    const definition = definitions.get(scheduled.taskId);
    const runtime = session.runtime[scheduled.taskId];
    if (!definition || !runtime) return [];
    const original = initial.get(scheduled.taskId);
    const startShift = original
      ? Math.round((epoch(scheduled.plannedStart) - epoch(original.plannedStart)) / 60_000)
      : null;
    const finishShift = original
      ? Math.round((epoch(scheduled.plannedEnd) - epoch(original.plannedEnd)) / 60_000)
      : null;
    const movedMinutes = startShift !== null && startShift !== 0 ? startShift : finishShift;
    const movedBoundary = startShift !== null && startShift !== 0
      ? "start" as const
      : finishShift !== null && finishShift !== 0 ? "finish" as const : null;
    return [{ definition, runtime, scheduled, movedMinutes, movedBoundary }];
  }).sort((left, right) =>
    epoch(left.scheduled.plannedStart) - epoch(right.scheduled.plannedStart)
      || left.runtime.taskId.localeCompare(right.runtime.taskId));
}

function issueCopy(session: CookingSessionState) {
  const issue = session.lastCommandIssue;
  if (!issue) return null;
  const task = session.request.tasks.find((entry) => entry.id === issue.taskId);
  const name = task?.instruction ?? issue.taskId;
  if (issue.code === "RESOURCE_LOCKED") {
    return `Could not start ${name}. A required resource is occupied; due tasks keep their resources until Complete.`;
  }
  if (issue.code === "INVALID_DELAY") {
    return `Could not delay ${name}. Keep the session clock open and try again.`;
  }
  return `Could not start ${name}. The command time is outside the supported range.`;
}

export function CookScreen(props: CookScreenProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const currentTitleRef = useRef<HTMLHeadingElement>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [replayPending, setReplayPending] = useState(false);
  const [focusIntent, setFocusIntent] = useState<FocusIntent | null>(null);
  const views = useMemo(() => taskViews(props.session), [props.session]);
  const focusRequest = useMemo(() => requestedFocus(focusIntent, views), [focusIntent, views]);
  const active = views.filter((view) =>
    view.runtime.status === "running" || view.runtime.status === "due");
  const ready = views.filter((view) => view.runtime.status === "ready");
  const current = active.length > 0 ? active : ready.slice(0, 1);
  const currentIds = new Set(current.map((view) => view.runtime.taskId));
  const next = views.find((view) => !currentIds.has(view.runtime.taskId)
    && view.runtime.status !== "completed");
  const completed = views.filter((view) => view.runtime.status === "completed").length;
  const issue = issueCopy(props.session);
  const parsedNow = parseIsoInstant(props.now);
  const warnings = [...(props.plannerWarnings ?? []), ...props.session.warnings]
    .filter((warning, index, all) => all.findIndex((candidate) =>
      candidate.code === warning.code && candidate.message === warning.message) === index);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusRequest === "current") currentTitleRef.current?.focus();
  }, [focusRequest]);

  const send = async (command: SessionCommand) => {
    if (pendingTaskId !== null) return;
    setPendingTaskId(command.taskId);
    try {
      await props.onDispatch(command);
    } finally {
      setPendingTaskId(null);
    }
  };

  const renderTask = (view: TaskView) => (
    <TaskCard
      key={view.runtime.taskId}
      task={view.definition}
      runtime={{
        ...view.runtime,
        plannedStart: view.scheduled.plannedStart,
        plannedEnd: view.scheduled.plannedEnd,
      }}
      plannedStart={view.scheduled.plannedStart}
      plannedEnd={view.scheduled.plannedEnd}
      resources={view.scheduled.effectiveResources}
      now={props.now}
      movedMinutes={view.movedMinutes}
      movedBoundary={view.movedBoundary}
      pending={pendingTaskId === view.runtime.taskId}
      controlsDisabled={replayPending}
      focusRequested={focusRequest !== "current" && focusRequest?.taskId === view.runtime.taskId
        ? focusRequest.action
        : null}
      onStart={() => {
        if (!parsedNow.ok) return;
        const command = { type: "START", taskId: view.runtime.taskId, at: parsedNow.value } as const;
        setFocusIntent(command);
        void send(command);
      }}
      onDelay={() => {
        if (parsedNow.ok) void send({
          type: "DELAY", taskId: view.runtime.taskId, at: parsedNow.value, delayMinutes: 4,
        });
      }}
      onComplete={() => {
        if (!parsedNow.ok) return;
        const command = { type: "COMPLETE", taskId: view.runtime.taskId, at: parsedNow.value } as const;
        setFocusIntent(command);
        void send(command);
      }}
    />
  );

  const runReplay = async () => {
    if (!props.onAccelerate || replayPending) return;
    setReplayPending(true);
    try {
      await props.onAccelerate(props.onDispatch);
    } finally {
      setReplayPending(false);
    }
  };

  return (
    <section
      className="cook-screen"
      aria-labelledby="cook-title"
    >
      <header className="cook-header">
        <div>
          <p className="eyebrow">04 · Cook to one finish line</p>
          <h2 ref={titleRef} id="cook-title" tabIndex={-1}>Run the kitchen from what is true now.</h2>
          <p>Timers are derived from recorded timestamps. Due work stays locked until you complete it.</p>
        </div>
        <p className="cook-progress" aria-label={`${completed} of ${views.length} tasks completed`}>
          <strong>{completed}/{views.length}</strong>
          <span>tasks landed</span>
        </p>
      </header>

      {(props.restoredFromStorage || warnings.length > 0) && (
        <aside className="cook-warnings" role="status" aria-live="polite" aria-label="Cooking session warnings">
          <strong>Session notice</strong>
          <ul>
            {props.restoredFromStorage && (
              <li>Restored the saved cooking session after refresh.</li>
            )}
            {warnings.map((warning) => (
              <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        </aside>
      )}
      {issue && <p className="cook-command-error" role="alert">{issue}</p>}

      {props.onAccelerate && (
        <div className="cook-replay">
          <div>
            <strong>Demo clock</strong>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label="Replay status"
            >
              {replayPending
                ? `Replay running at ${props.playbackRate ?? 60}× speed; task actions are temporarily locked.`
                : "Replay ready. Playback changes speed only; every event uses the normal dispatcher."}
            </span>
          </div>
          <Button
            variant="secondary"
            disabled={replayPending}
            aria-label={replayPending
              ? `Cooking replay running at ${props.playbackRate ?? 60} times speed`
              : `Run cooking replay at ${props.playbackRate ?? 60} times speed`}
            onClick={() => void runReplay()}
          >
            {replayPending ? "Replay running…" : `${props.playbackRate ?? 60}× replay`}
          </Button>
        </div>
      )}

      <div className="cook-board" aria-busy={replayPending}>
        <section className="cook-lane cook-lane--current" aria-labelledby="current-action-title">
          <div className="cook-lane__heading">
            <p>On the pass</p>
            <h2 ref={currentTitleRef} id="current-action-title" tabIndex={-1}>Current action</h2>
          </div>
          {current.length > 0
            ? current.map(renderTask)
            : <p className="cook-empty">No task is ready yet. Keep this screen open.</p>}
        </section>

        <section className="cook-lane cook-lane--next" aria-labelledby="next-action-title">
          <div className="cook-lane__heading">
            <p>Set up before the call</p>
            <h2 id="next-action-title">Up next</h2>
          </div>
          {next ? renderTask(next) : (
            <p className="cook-empty">
              {completed === views.length ? "Every task is complete." : "No later task is scheduled."}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
