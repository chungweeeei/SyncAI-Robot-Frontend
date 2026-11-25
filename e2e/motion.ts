import type { Page } from "@playwright/test";

/**
 * Waits for every animation on the page that ends: a panel the strip drops
 * opens with a 150 ms zoom and drop (strip-disclosure.tsx's panelEnter), and
 * a box measured inside it is 95 % of the panel and a few pixels high. The
 * endless ones (the loud state's ping, a marquee) never finish, so they are
 * left out rather than waited on.
 */
export async function openingSettled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
