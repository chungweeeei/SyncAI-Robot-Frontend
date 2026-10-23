import { expect, test } from "@playwright/test";

import {
  mockBackend,
  recording,
} from "./backend";

/**
 * The recorder: starting and stopping a recording on the robot.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
test.describe("the recorder", () => {
  test("shows the idle form when nothing is recording", async ({ page }) => {
    // Which face is shown comes from the server, not from a local flag, so a
    // recording started from a shell is reflected correctly.
    await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  });

  test("shows the live face and the robot's own elapsed clock", async ({
    page,
  }) => {
    await mockBackend(page, {
      activeRecording: {
        name: "rec_live",
        path: "/home/syncai/record/rec_live",
        topics: ["/robot01/livox/lidar"],
        started_at: "2026-09-18T09:22:00Z",
        elapsed_seconds: 75,
        compression: false,
        size_bytes: 1024 * 1024,
      },
    });
    await page.goto("/recordings");

    // Exact, because "Recordings" (the rail link and the page heading) would
    // otherwise match too.
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    // 75 s as the robot measured it, not a timer this console started.
    await expect(page.getByText("1:15")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toHaveCount(0);
  });

  test("posts a start with the name and topics that were on screen", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("field-run-3");
    await page.getByRole("button", { name: /start recording/i }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/recordings"))
      .toHaveLength(1);
    const body = writes[0].body as {
      name: string;
      topics: string[];
      compression: boolean;
    };
    expect(body.name).toBe("field-run-3");
    // The scanner pair a map is rebuilt from; the camera is opt-in.
    // Relative names: the backend expands them under the robot's namespace.
    expect(body.topics).toEqual(["livox/lidar", "livox/imu"]);
    // Compressed unless the operator turns it off.
    expect(body.compression).toBe(true);
  });

  test("refuses the reserved name before a request goes out", async ({
    page,
  }) => {
    // "active" is the status route's own path; a directory called that could
    // never be read back, and the backend refuses it too.
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("active");
    await expect(page.getByText(/reserved/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toBeDisabled();
    expect(writes).toHaveLength(0);
  });

  test("lists what is on disk", async ({ page }) => {
    await mockBackend(page, {
      recordings: [recording({ name: "rec_a" }), recording({ name: "rec_b" })],
    });
    await page.goto("/recordings");

    await expect(page.getByText("rec_a")).toBeVisible();
    await expect(page.getByText("rec_b")).toBeVisible();
  });
});
