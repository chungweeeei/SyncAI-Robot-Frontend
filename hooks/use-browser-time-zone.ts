"use client";

import * as React from "react";

import { browserTimeZone } from "@/lib/task/schedule";

const neverChanges = () => () => {};

/**
 * The browser's time zone (`Asia/Taipei`), or "" on the server. Every consumer
 * treats "" as "not known yet", which keeps the server render and the first
 * client render identical.
 */
export function useBrowserTimeZone(): string {
  return React.useSyncExternalStore(neverChanges, browserTimeZone, () => "");
}
