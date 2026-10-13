import * as React from "react";

import { fetchMapGrid } from "@/lib/api/map";
import type { GridSession } from "@/lib/map/session";
import { createGridSession, disposeGridSession } from "@/lib/map/session";

export type MapGridStatus = "loading" | "ok" | "error";

export interface UseMapGrid {
  /** The editable session, or null while loading and on failure. */
  session: GridSession | null;
  status: MapGridStatus;
  /** Why the load failed, shown verbatim. */
  error: string | null;
}

/**
 * One name's load outcome, keyed by name so a leftover for the previous name
 * is told apart by comparison rather than a setState in the effect body.
 */
interface Loaded {
  name: string;
  session: GridSession | null;
  error: string | null;
}

/**
 * Loads one map's grid into a session, built in the effect because it touches
 * `document` and the page is prerendered. A strict-mode double mount disposes
 * the first, so no effect mutates a grid it did not create.
 */
export function useMapGrid(name: string): UseMapGrid {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);

  React.useEffect(() => {
    let active = true;
    let created: GridSession | null = null;
    const abort = new AbortController();

    fetchMapGrid(name, abort.signal)
      .then(({ summary, grid }) => {
        if (!active || !summary.grid) return;
        created = createGridSession(name, summary.grid, grid);
        setLoaded({ name, session: created, error: null });
      })
      .catch((cause: unknown) => {
        if (!active || abort.signal.aborted) return;
        setLoaded({
          name,
          session: null,
          error: cause instanceof Error ? cause.message : "Failed to load the map.",
        });
      });

    return () => {
      active = false;
      abort.abort();
      if (created) disposeGridSession(created);
    };
  }, [name]);

  const current = loaded?.name === name ? loaded : null;

  return {
    session: current?.session ?? null,
    status: current ? (current.session ? "ok" : "error") : "loading",
    error: current?.error ?? null,
  };
}
