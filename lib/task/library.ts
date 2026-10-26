// The /tasks list: saved tasks grouped by the map they run on, and each one
// read as the route an engineer on site recognises it by.
//
// The editor builds a task as stops (lib/task/stops.ts); the list reads the
// stored wire steps back in the same terms, so a task looks on its card the
// way it looked when it was built — waypoints by name, not one letter a step.

import type { TemplateStep, TaskTemplate } from "@/lib/api/task-template";
import { isNavStep, wireLinked } from "@/lib/task/step";

/**
 * Names as a person orders them: `Patrol 2` before `Patrol 10`. The backend's
 * `ORDER BY name` compares characters, which puts 10 first and is what an SI
 * numbering their tasks would read as shuffled.
 */
export function compareTaskNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export interface TaskGroup {
  /** The map's name, or null for the tasks that move nowhere and run on any. */
  mapName: string | null;
  /** The robot's loaded map: the one group whose tasks can run now. */
  loaded: boolean;
  tasks: TaskTemplate[];
}

/**
 * Every task, grouped by map: the loaded map first, then the tasks bound to
 * no map (they run anywhere, so they are as runnable as the first group),
 * then every other map by name. Nothing is hidden by map — another floor's
 * task is still someone's work — only by `query`, which keeps a task whose
 * name contains it, ignoring case, and drops a group left empty.
 */
export function groupTasks(
  templates: readonly TaskTemplate[],
  activeMapName: string | null,
  query = "",
): TaskGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const byMap = new Map<string | null, TaskTemplate[]>();
  for (const template of templates) {
    if (needle && !template.name.toLocaleLowerCase().includes(needle)) continue;
    const list = byMap.get(template.map_name);
    if (list) list.push(template);
    else byMap.set(template.map_name, [template]);
  }

  const rank = (mapName: string | null) =>
    mapName !== null && mapName === activeMapName ? 0 : mapName === null ? 1 : 2;
  return [...byMap.entries()]
    .map(([mapName, tasks]) => ({
      mapName,
      loaded: mapName !== null && mapName === activeMapName,
      tasks: tasks.sort((a, b) => compareTaskNames(a.name, b.name)),
    }))
    .sort(
      (a, b) =>
        rank(a.mapName) - rank(b.mapName) ||
        compareTaskNames(a.mapName ?? "", b.mapName ?? ""),
    );
}

/** One stop on a card's route line. */
export interface RouteStop {
  /** The waypoint's name, or null when the step names none. */
  name: string | null;
  /** The waypoint was deleted: the robot goes where it was when saved. */
  missing: boolean;
  dock: boolean;
}

export function routeStops(steps: readonly TemplateStep[]): RouteStop[] {
  return steps.filter(isNavStep).map((step) => ({
    name: step.vertex_name,
    missing: step.vertex_status === "MISSING",
    dock: step.type === "DOCK",
  }));
}

/**
 * The route as a card shows it on one line: every stop up to `max`, else the
 * first two, a count of the ones between, and the last — where the task
 * starts and where it leaves the robot are what tells two patrols apart.
 */
export function routeLine(
  stops: readonly RouteStop[],
  max = 5,
): (RouteStop | { hidden: number })[] {
  if (stops.length <= max) return [...stops];
  return [stops[0]!, stops[1]!, { hidden: stops.length - 3 }, stops[stops.length - 1]!];
}

/** What a task comes to, in the words of the editor's Route strip. */
export interface TaskSummary {
  stops: number;
  /** Every Wait, summed. */
  waitSeconds: number;
  /** The last stop is a Dock: the task leaves the robot on its charger. */
  endsDocked: boolean;
}

export function taskSummary(steps: readonly TemplateStep[]): TaskSummary {
  let stops = 0;
  let waitSeconds = 0;
  let endsDocked = false;
  for (const step of steps) {
    if (isNavStep(step)) {
      stops += 1;
      endsDocked = step.type === "DOCK";
    } else if (step.type === "WAIT") {
      waitSeconds += step.resolved_params?.seconds ?? 0;
    }
  }
  return { stops, waitSeconds, endsDocked };
}

/** One stop of a saved task, with the actions that belong to it. */
export interface TaskStop {
  step: TemplateStep;
  /** Started together with the walk there. */
  transit: TemplateStep[];
  /** Done on arrival, before the next stop. */
  arrival: TemplateStep[];
}

export interface TaskStops {
  /** Done before setting off. */
  start: TemplateStep[];
  stops: TaskStop[];
}

/**
 * The stored list read as the editor's stops (see lib/task/stops.ts): a
 * group's other members are done on the way to its stop, and the steps after
 * it up to the next stop on arrival. A group saved with its stop not first
 * (`[Speak, Move]`, which starts alike) still reads as that stop's walk.
 */
export function taskStops(steps: readonly TemplateStep[]): TaskStops {
  const result: TaskStops = { start: [], stops: [] };
  let index = 0;
  while (index < steps.length) {
    let end = index + 1;
    while (end < steps.length && wireLinked(steps, end)) end += 1;
    const span = steps.slice(index, end);
    const leader = span.find(isNavStep);
    if (leader) {
      result.stops.push({
        step: leader,
        transit: span.filter((step) => step !== leader),
        arrival: [],
      });
    } else {
      const current = result.stops[result.stops.length - 1];
      (current ? current.arrival : result.start).push(...span);
    }
    index = end;
  }
  return result;
}
