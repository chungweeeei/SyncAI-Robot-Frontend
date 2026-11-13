import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  taskState,
} from "./backend";

/*
 * A running charge's staging point is drawn from the charger the job's own
 * read carries (GET /tasks/<id>, `steps[].charge`). The drawing itself is
 * WebGL, which a screen assertion cannot read; what it can read is the Path
 * layer toggle, offered only while there is something on that layer to hide.
 * With no route on the telemetry socket (there is no robot), a charge is the
 * only thing that can put it there — so the toggle is the charge's mark.
 */

const ID = "robot01-task-1758000000-1";
const CHARGER = { x: 3, y: -1.5, theta: 180 };

function charging(status: "IN_PROGRESS" | "PAUSED" | "COMPLETED") {
  return taskState({
    id: ID,
    steps: [
      { id: "1-move", status: "COMPLETED", error_msg: "", charge: null },
      { id: "2-charge", status, error_msg: "", charge: CHARGER },
    ],
  });
}

const pathLayer = (page: Page) => page.getByRole("button", { name: "Path" });

test.describe("a running charge", () => {
  test("offers the path layer while it runs, and drops it once it ends", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const taskStates: Record<string, Record<string, unknown>> = {
      [ID]: charging("IN_PROGRESS"),
    };
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID })],
      taskStates,
    });
    await page.goto("/");

    await expect(pathLayer(page)).toBeVisible();
    await expect(pathLayer(page)).toHaveAttribute("aria-pressed", "true");

    // The fake answers each read from this object, so the next 2 s poll sees
    // the charge done — and a staging point left up would point the operator at
    // a leg the robot has already walked.
    taskStates[ID] = charging("COMPLETED");
    await expect(pathLayer(page)).toHaveCount(0, { timeout: 5000 });
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps it while the charge is held: the charger has not moved", async ({
    page,
  }) => {
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID })],
      taskStates: { [ID]: charging("PAUSED") },
    });
    await page.goto("/");

    await expect(pathLayer(page)).toBeVisible();
  });

  test("is not drawn over another map", async ({ page }) => {
    // A charger on the job's map is somewhere else, or nowhere, on this one.
    await mockBackend(page, {
      activeTasks: [activeTask({ id: ID, map_name: "warehouse" })],
      taskStates: { [ID]: charging("IN_PROGRESS") },
    });
    await page.goto("/");

    // Positive control: the job is read (the strip names its step) ...
    await expect(page.getByRole("status").filter({ hasText: "Charge" })).toBeVisible();
    // ... and still nothing lands on the layer.
    await expect(pathLayer(page)).toHaveCount(0);
  });
});
