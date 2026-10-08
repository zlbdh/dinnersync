import { useId } from "react";

import type { DinnerPlan } from "@/modules/dinner-planner";
import type { Recipe } from "@/modules/recipe-import";
import type { ScheduledTask, ScheduleTask } from "@/modules/scheduling";
import type { ResourceId } from "@/shared";

export type ServiceTimelineProps = {
  plan: DinnerPlan;
};

type TimelineEntry = {
  scheduled: ScheduledTask;
  task: ScheduleTask;
  recipe: Recipe;
};

const CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const RESOURCE_LABELS: Record<ResourceId, string> = {
  "cook:1": "Cook 1",
  "oven:1": "Oven 1",
  "burner:1": "Burner 1",
  "burner:2": "Burner 2",
};

function formatClock(instant: string) {
  return CLOCK.format(new Date(instant));
}

function compareEntries(left: TimelineEntry, right: TimelineEntry) {
  return Date.parse(left.scheduled.plannedStart)
    - Date.parse(right.scheduled.plannedStart)
    || left.scheduled.taskId.localeCompare(right.scheduled.taskId);
}

function TaskTicket({
  entry,
  view,
}: {
  entry: TimelineEntry;
  view: "track" | "compact";
}) {
  const resources = entry.scheduled.effectiveResources.map(
    (resource) => RESOURCE_LABELS[resource],
  );
  return (
    <li
      className={`service-task service-task--${view}`}
      data-task-id={entry.scheduled.taskId}
      data-view={view}
    >
      {view === "compact" && (
        <p className="service-task__dish">Dish · {entry.recipe.name}</p>
      )}
      <p className="service-task__instruction">{entry.task.instruction}</p>
      <div className="service-task__tags" aria-label="Mode and resources">
        <span className={`service-task__mode service-task__mode--${entry.task.mode}`}>
          {entry.task.mode === "active" ? "Active" : "Passive"}
        </span>
        {(resources.length > 0 ? resources : ["No exclusive resource"]).map(
          (resource) => <span key={resource}>{resource}</span>,
        )}
      </div>
      <p className="service-task__time">
        <span>
          Start <time dateTime={entry.scheduled.plannedStart}>
            {formatClock(entry.scheduled.plannedStart)}
          </time>
        </span>
        <span>
          End <time dateTime={entry.scheduled.plannedEnd}>
            {formatClock(entry.scheduled.plannedEnd)}
          </time>
        </span>
      </p>
    </li>
  );
}

function timelineEntries(plan: DinnerPlan) {
  const schedule = plan.schedule.feasible
    ? plan.schedule
    : plan.schedule.earliestFeasible;
  if (!schedule) return null;
  const taskById = new Map(plan.scheduleRequest.tasks.map((task) => [task.id, task]));
  const recipeById = new Map(plan.recipes.map((recipe) => [recipe.id, recipe]));
  const entries = schedule.tasks.flatMap((scheduled): TimelineEntry[] => {
    const task = taskById.get(scheduled.taskId);
    const recipe = task ? recipeById.get(task.recipeId) : undefined;
    return task && recipe ? [{ scheduled, task, recipe }] : [];
  }).sort(compareEntries);
  return { entries, serveAt: schedule.serveAt };
}

export function ServiceTimeline({ plan }: ServiceTimelineProps) {
  const titleId = useId();
  const markerId = useId();
  const timeline = timelineEntries(plan);

  return (
    <section className="service-timeline" aria-labelledby={titleId}>
      <header className="service-timeline__header">
        <div>
          <p className="eyebrow">Resource-aware run of show</p>
          <h3 id={titleId}>Three dishes, one finish line.</h3>
        </div>
        <span className="status-chip status-chip--time">
          {plan.scheduleRequest.serveToleranceMinutes} minute landing window
        </span>
      </header>

      {!timeline ? (
        <p className="service-timeline__empty" role="status">
          No safe timeline can be drawn until the schedule issues are resolved.
        </p>
      ) : (
        <div className="service-timeline__plot">
          <ol className="service-timeline__tracks" aria-label="Dish service tracks">
            {plan.recipes.map((recipe) => {
              const recipeEntries = timeline.entries.filter(
                (entry) => entry.recipe.id === recipe.id,
              );
              return (
                <li
                  className="service-timeline__track"
                  key={recipe.id}
                  aria-describedby={markerId}
                >
                  <h4>{recipe.name}</h4>
                  {recipeEntries.length > 0 ? (
                    <ol aria-label={`Scheduled steps for ${recipe.name}`}>
                      {recipeEntries.map((entry) => (
                        <TaskTicket key={entry.scheduled.taskId} entry={entry} view="track" />
                      ))}
                    </ol>
                  ) : (
                    <p>No scheduled steps.</p>
                  )}
                  <span className="service-timeline__join" aria-hidden="true" />
                </li>
              );
            })}
          </ol>

          <ol
            className="service-timeline__compact"
            aria-label="Tasks ordered by start time on compact screens"
          >
            {timeline.entries.map((entry) => (
              <TaskTicket key={entry.scheduled.taskId} entry={entry} view="compact" />
            ))}
          </ol>

          <div id={markerId} className="service-timeline__marker" data-serve-marker>
            <span>{plan.schedule.feasible ? "Dinner lands" : "Earliest landing"}</span>
            <time dateTime={timeline.serveAt}>{formatClock(timeline.serveAt)}</time>
          </div>
        </div>
      )}
    </section>
  );
}
