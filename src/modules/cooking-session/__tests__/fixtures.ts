import type { Schedule, ScheduleRequest, ScheduleTask } from "@/modules/scheduling";

export const AT = {
  before: "2026-07-18T17:59:00Z",
  start: "2026-07-18T18:00:00Z",
  due: "2026-07-18T18:05:00Z",
  completed: "2026-07-18T18:06:00Z",
  serve: "2026-07-18T18:11:00Z",
} as const;

function task(id: string, overrides: Partial<ScheduleTask>): ScheduleTask {
  return {
    id,
    recipeId: id.split("-")[0],
    sourceText: `${id} source`,
    instruction: id,
    durationMinutes: 1,
    mode: "passive",
    dependsOn: [],
    resources: [],
    ovenOperation: null,
    ovenTemperatureC: null,
    isTerminal: true,
    ...overrides,
  };
}

export function sessionFixture(): {
  request: ScheduleRequest;
  schedule: Schedule;
} {
  const tasks = [
    task("a-work", { durationMinutes: 5, mode: "active", isTerminal: false }),
    task("a-serve", { dependsOn: ["a-work"] }),
    task("b-work", { durationMinutes: 5, mode: "active", isTerminal: false }),
    task("b-serve", { dependsOn: ["b-work"] }),
  ];
  return {
    request: {
      tasks,
      kitchen: { cooks: 1, ovens: 1, burners: 2 },
      availableFrom: AT.start,
      serveAt: AT.serve,
      serveToleranceMinutes: 5,
    },
    schedule: {
      feasible: true,
      serveAt: AT.serve,
      tasks: [
        {
          taskId: "a-work",
          plannedStart: AT.start,
          plannedEnd: AT.due,
          effectiveResources: ["cook:1"],
        },
        {
          taskId: "b-work",
          plannedStart: AT.due,
          plannedEnd: "2026-07-18T18:10:00Z",
          effectiveResources: ["cook:1"],
        },
        {
          taskId: "a-serve",
          plannedStart: "2026-07-18T18:10:00Z",
          plannedEnd: AT.serve,
          effectiveResources: [],
        },
        {
          taskId: "b-serve",
          plannedStart: "2026-07-18T18:10:00Z",
          plannedEnd: AT.serve,
          effectiveResources: [],
        },
      ],
    },
  };
}

export function parallelSessionFixture(): {
  request: ScheduleRequest;
  schedule: Schedule;
} {
  const source = sessionFixture();
  const tasks = source.request.tasks
    .filter((entry) => entry.id.endsWith("-work"))
    .map((entry) => ({
      ...entry,
      mode: "passive" as const,
      resources: [],
      isTerminal: true,
    }));
  return {
    request: { ...source.request, tasks, serveAt: AT.due },
    schedule: {
      feasible: true,
      serveAt: AT.due,
      tasks: tasks.map((entry) => ({
        taskId: entry.id,
        plannedStart: AT.start,
        plannedEnd: AT.due,
        effectiveResources: [],
      })),
    },
  };
}
