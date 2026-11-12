import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { applyVertexWrites } from "@/hooks/vertex-write-cache";
import { queryKeys } from "@/lib/api/query-keys";
import type { MapVertex } from "@/lib/types/map";

/**
 * Both doors a waypoint is written through share these consequences: the
 * list both screens read shows the write at once, and the two reads a
 * waypoint feeds — the catalogue's count, the templates' resolution — are
 * told they are stale.
 */

const vertex = (id: string, x = 0): MapVertex => ({ id, name: id, x }) as unknown as MapVertex;

function setup() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.mapVertices("lab"), [vertex("a"), vertex("b"), vertex("c")]);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const list = () => client.getQueryData<MapVertex[]>(queryKeys.mapVertices("lab"));
  return { client, invalidate, list };
}

describe("applyVertexWrites", () => {
  it("splices deletes, updates and creates into the map's list in one pass", () => {
    const { client, list } = setup();

    applyVertexWrites(client, "lab", {
      deleted: ["a"],
      updated: [vertex("b", 7)],
      created: [vertex("d")],
    });

    expect(list()).toEqual([vertex("b", 7), vertex("c"), vertex("d")]);
  });

  it("marks the catalogue and the templates stale", () => {
    const { client, invalidate } = setup();

    applyVertexWrites(client, "lab", { deleted: ["a"] });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.maps });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.taskTemplates });
  });

  it("touches only the map that was written", () => {
    const { client } = setup();
    client.setQueryData(queryKeys.mapVertices("yard"), [vertex("a")]);

    applyVertexWrites(client, "lab", { deleted: ["a"] });

    expect(client.getQueryData(queryKeys.mapVertices("yard"))).toEqual([vertex("a")]);
  });

  it("does nothing for a save that wrote nothing", () => {
    const { client, invalidate, list } = setup();
    const before = list();

    applyVertexWrites(client, "lab", {});

    expect(list()).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not invent a list that was never read", () => {
    const client = new QueryClient();

    applyVertexWrites(client, "lab", { created: [vertex("d")] });

    expect(client.getQueryData(queryKeys.mapVertices("lab"))).toBeUndefined();
  });
});
