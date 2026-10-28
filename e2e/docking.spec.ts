import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  taskState,
} from "./backend";

/*
 * A running dock's staging point is drawn from the dock pose the job's own
 * read carries (GET /tasks/<id>, `steps[].dock`). The drawing itself is
 * WebGL, which a screen assertion cannot read; what it can read is the Path
 * layer toggle, offered only while there is something on that layer to hide.
 * With no route on the telemetry socket (there is no robot), a dock is the
 * only thing that can put it there — so the toggle is the dock's mark.
 */

const ID = "robot01-task-1758000000-1";
const DOCK = { x: 3, y: -1.5, theta: 180 };

function docking(status: "IN_PROGRESS" | "PAUSED" | "COMPLETED") {
  return taskState({
    id: ID,
    steps: [
      { id: "1-move", status: "COMPLETED", error_msg: "", dock: null },
      { id: "2-dock", status, error_msg: "", dock: DOCK },
    ],
  });
}

const pathLayer = (page: Page) => page.getByRole("button", { name: "Path" });

test.describe("a running dock", () => {
  test("offers the path layer while it runs, and drops it once it ends", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const taskStates: Record<string, Record<string, unknown>> = {
      [ID]: docking("IN_PROGRESS"),
    };
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID })],
      taskStates,
    });
    await page.goto("/");

    await expect(pathLayer(page)).toBeVisible();
    await expect(pathLayer(page)).toHaveAttribute("aria-pressed", "true");

    // The fake answers each read from this object, so the next 2 s poll sees
    // the dock done — and a staging point left up would point the operator at
    // a leg the robot has already walked.
    taskStates[ID] = docking("COMPLETED");
    await expect(pathLayer(page)).toHaveCount(0, { timeout: 5000 });
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps it while the dock is held: the target has not moved", async ({
    page,
  }) => {
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID })],
      taskStates: { [ID]: docking("PAUSED") },
    });
    await page.goto("/");

    await expect(pathLayer(page)).toBeVisible();
  });

  test("is not drawn over another map", async ({ page }) => {
    // A dock pose on the job's map is somewhere else, or nowhere, on this one.
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID, map_name: "warehouse" })],
      taskStates: { [ID]: docking("IN_PROGRESS") },
    });
    await page.goto("/");

    // Positive control: the job is read (the strip names its step) ...
    await expect(page.getByRole("status").filter({ hasText: "Dock" })).toBeVisible();
    // ... and still nothing lands on the layer.
    await expect(pathLayer(page)).toHaveCount(0);
  });
});
