"use client";

import * as React from "react";

import { browserTimeZone } from "@/lib/task/schedule";

/** A useSyncExternalStore subscription for a value that cannot change. */
const neverChanges = () => () => {};

/**
 * The zone this browser keeps time in (`Asia/Taipei`), or "" until the browser
 * exists.
 *
 * A browser fact, not state: it never changes after mount, so there is nothing
 * to synchronise and an effect that set state would only add a render. The
 * server snapshot is "", and every consumer treats "" as "not known yet" —
 * the schedule form holds back its local-time line, the schedule list falls
 * back to UTC — which is what keeps the server render and the first client
 * render identical. Same construction as the bench's microphone probe.
 */
export function useBrowserTimeZone(): string {
  return React.useSyncExternalStore(neverChanges, browserTimeZone, () => "");
}
