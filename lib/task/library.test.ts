import { describe, expect, it } from "vitest";

import type { TemplateStep, TaskTemplate } from "@/lib/api/task-template";
import {
  compareTaskNames,
  groupTasks,
  routeLine,
  routeStops,
  taskStops,
  taskSummary,
} from "@/lib/task/library";

/**
 * The rules the /tasks list keeps: the tasks that can run now come first, a
 * search hides only what it does not match, and a card reads a stored task as
 * the stops it was built from.
 */

function template(name: string, map_name: string | null): TaskTemplate {
  return {
    id: name,
    name,
    description: "",
    map_name,
    steps: [],
    map_matches_active: true,
    missing_vertex_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function nav(
  id: string,
  name: string | null,
  over: { type?: "MOVE" | "DOCK"; missing?: boolean; group?: string } = {},
): TemplateStep {
  const pose = { x: 0, y: 0, theta: 0 };
  return {
    id,
    type: over.type ?? "MOVE",
    params: pose,
    resolved_params: pose,
    vertex_id: name,
    vertex_name: name,
    vertex_status: over.missing ? "MISSING" : "CURRENT",
    group: over.group ?? null,
  };
}

function speak(id: string, group: string | null = null): TemplateStep {
  return {
    id,
    type: "SPEAK",
    params: { text: id },
    resolved_params: { text: id },
    vertex_id: null,
    vertex_name: null,
    vertex_status: "NONE",
    group,
  };
}

function wait(id: string, seconds: number): TemplateStep {
  return {
    id,
    type: "WAIT",
    params: { seconds },
    resolved_params: { seconds },
    vertex_id: null,
    vertex_name: null,
    vertex_status: "NONE",
    group: null,
  };
}

describe("compareTaskNames", () => {
  it("orders the numbers in a name as numbers", () => {
    const names = ["Patrol 10", "patrol 2", "Patrol 1"];
    expect(names.sort(compareTaskNames)).toEqual(["Patrol 1", "patrol 2", "Patrol 10"]);
  });
});

describe("groupTasks", () => {
  const tasks = [
    template("Lab round", "lab"),
    template("Greet", null),
    template("Round 10", "office"),
    template("Round 2", "office"),
    template("Archive", "attic"),
  ];

  it("puts the loaded map first, then the tasks bound to no map, then the rest by name", () => {
    const groups = groupTasks(tasks, "office");
    expect(groups.map((group) => [group.mapName, group.loaded])).toEqual([
      ["office", true],
      [null, false],
      ["attic", false],
      ["lab", false],
    ]);
    expect(groups[0]!.tasks.map((task) => task.name)).toEqual(["Round 2", "Round 10"]);
  });

  it("marks no group loaded when the robot has no map", () => {
    const groups = groupTasks(tasks, null);
    expect(groups[0]!.mapName).toBeNull();
    expect(groups.some((group) => group.loaded)).toBe(false);
  });

  it("keeps only what a search matches, on every map, and drops an emptied group", () => {
    const groups = groupTasks(tasks, "office", "  ROUND ");
    expect(groups.map((group) => group.mapName)).toEqual(["office", "lab"]);
    expect(groupTasks(tasks, "office", "nothing")).toEqual([]);
  });
});

describe("routeLine", () => {
  const stops = ["a", "b", "c", "d", "e", "f"].map((name) => ({
    name,
    missing: false,
    dock: false,
  }));

  it("shows every stop up to the limit", () => {
    expect(routeLine(stops.slice(0, 5))).toHaveLength(5);
  });

  it("keeps where a long route starts and ends, and counts the stops between", () => {
    expect(routeLine(stops)).toEqual([stops[0], stops[1], { hidden: 3 }, stops[5]]);
  });
});

describe("routeStops and taskSummary", () => {
  const steps = [
    speak("hello"),
    nav("1", "lobby"),
    wait("w1", 30),
    nav("2", "hall", { missing: true }),
    wait("w2", 60),
    nav("3", "charger", { type: "DOCK" }),
  ];

  it("names each stop, and marks one whose waypoint was deleted", () => {
    expect(routeStops(steps)).toEqual([
      { name: "lobby", missing: false, dock: false },
      { name: "hall", missing: true, dock: false },
      { name: "charger", missing: false, dock: true },
    ]);
  });

  it("counts the stops, sums the waiting and says whether it ends on a charger", () => {
    expect(taskSummary(steps)).toEqual({ stops: 3, waitSeconds: 90, endsDocked: true });
    expect(taskSummary(steps.slice(0, 3)).endsDocked).toBe(false);
  });
});

describe("taskStops", () => {
  it("reads the stored list as the editor's stops", () => {
    const steps = [
      speak("before"),
      nav("1", "lobby", { group: "g1" }),
      speak("walking", "g1"),
      wait("there", 5),
      nav("2", "hall"),
    ];
    const read = taskStops(steps);
    expect(read.start.map((step) => step.id)).toEqual(["before"]);
    expect(read.stops.map((stop) => stop.step.id)).toEqual(["1", "2"]);
    expect(read.stops[0]!.transit.map((step) => step.id)).toEqual(["walking"]);
    expect(read.stops[0]!.arrival.map((step) => step.id)).toEqual(["there"]);
    expect(read.stops[1]!.arrival).toEqual([]);
  });

  it("reads a group saved with its stop second as that stop's walk", () => {
    const read = taskStops([speak("walking", "g1"), nav("1", "lobby", { group: "g1" })]);
    expect(read.start).toEqual([]);
    expect(read.stops[0]!.transit.map((step) => step.id)).toEqual(["walking"]);
  });

  it("keeps a task without stops as actions before setting off", () => {
    const read = taskStops([speak("a"), wait("b", 1)]);
    expect(read.stops).toEqual([]);
    expect(read.start).toHaveLength(2);
  });
});
