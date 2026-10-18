import { describe, expect, it } from "vitest";

import {
  decodeOctomapBt,
  encodeOctomapBt,
  keyToMetres,
  metresToKey,
} from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

/** The decoded cells as absolute key triples, sorted, for comparing with a spec. */
function cellsOf(buffer: ArrayBuffer): Array<[number, number, number]> {
  const { keys, keyMin, count } = decodeOctomapBt(buffer);
  const cells: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    cells.push([keys[i * 3] + keyMin[0], keys[i * 3 + 1] + keyMin[1], keys[i * 3 + 2] + keyMin[2]]);
  }
  return cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

const bytesOf = (view: Uint8Array) =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;

describe("decodeOctomapBt", () => {
  it("returns every occupied cell with its key, relative to the box's corner", () => {
    const occupied: Array<[number, number, number]> = [
      [O + 2, O, O - 5],
      [O + 3, O, O - 5],
      [O + 3, O + 1, O - 4],
    ];
    const voxels = decodeOctomapBt(bytesOf(encodeOctomapBt({ res: 0.1, occupied })));

    expect(voxels.res).toBe(0.1);
    expect(voxels.count).toBe(3);
    expect(voxels.keyMin).toEqual([O + 2, O, O - 5]);
    expect(voxels.size).toEqual([2, 2, 2]);
    expect(voxels.leaves).toEqual({ occupied: 3, free: 0 });
    expect(cellsOf(bytesOf(encodeOctomapBt({ res: 0.1, occupied })))).toEqual(occupied);
  });

  it("expands a pruned block to its cells, so a merged floor is still every cell", () => {
    // A 2×2×2 block the encoder merges into one leaf two levels up.
    const occupied: Array<[number, number, number]> = [];
    for (let z = 0; z < 2; z += 1)
      for (let y = 0; y < 2; y += 1)
        for (let x = 0; x < 2; x += 1) occupied.push([O + x, O + 8 + y, O + z]);
    const pruned = encodeOctomapBt({ res: 0.05, occupied, prune: true });
    const unpruned = encodeOctomapBt({ res: 0.05, occupied });

    expect(pruned.length).toBeLessThan(unpruned.length);
    const voxels = decodeOctomapBt(bytesOf(pruned));
    expect(voxels.count).toBe(8);
    expect(voxels.leaves.occupied).toBe(1);
    expect(cellsOf(bytesOf(pruned))).toEqual(cellsOf(bytesOf(unpruned)));
  });

  it("counts free leaves and returns none of them", () => {
    const voxels = decodeOctomapBt(
      bytesOf(
        encodeOctomapBt({
          res: 0.1,
          occupied: [[O, O, O]],
          free: [
            [O, O, O + 1],
            [O, O, O + 2],
          ],
        }),
      ),
    );
    expect(voxels.count).toBe(1);
    expect(voxels.leaves).toEqual({ occupied: 1, free: 2 });
  });

  it("holds an empty tree without a box to divide by", () => {
    const voxels = decodeOctomapBt(bytesOf(encodeOctomapBt({ res: 0.1, occupied: [] })));
    expect(voxels.count).toBe(0);
    expect(voxels.size).toEqual([0, 0, 0]);
  });

  it("refuses a stream cut short as incomplete, not as a crash", () => {
    const whole = encodeOctomapBt({ res: 0.1, occupied: [[O, O, O]] });
    const cut = whole.subarray(0, whole.length - 3);
    expect(() => decodeOctomapBt(bytesOf(cut))).toThrow(/arrived incomplete/);
  });

  it("refuses trailing bytes, which mean the tree and the file disagree", () => {
    const whole = encodeOctomapBt({ res: 0.1, occupied: [[O, O, O]] });
    const padded = new Uint8Array(whole.length + 2);
    padded.set(whole);
    expect(() => decodeOctomapBt(bytesOf(padded))).toThrow(/arrived incomplete/);
  });

  it("refuses a file that is not a tree, in the operator's words", () => {
    const text = new TextEncoder().encode("# .PCD v0.7 - Point Cloud Data file format\nres 0.1\ndata\n");
    expect(() => decodeOctomapBt(bytesOf(text))).toThrow(/not in a form this console can read/);
  });

  it("refuses a tree of another node type, whose records it cannot read", () => {
    const whole = encodeOctomapBt({ res: 0.1, occupied: [[O, O, O]] });
    const text = new TextDecoder("latin1").decode(whole).replace("id OcTree", "id ColorOcTree");
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(() => decodeOctomapBt(bytesOf(bytes))).toThrow(/not in a form this console can read/);
  });

  it("reads the resolution off the header and ignores its comments", () => {
    const whole = encodeOctomapBt({ res: 0.25, occupied: [[O, O, O]] });
    expect(decodeOctomapBt(bytesOf(whole)).res).toBe(0.25);
  });
});

describe("key arithmetic", () => {
  it("puts the origin cell's centre half a cell past zero, as octomap does", () => {
    expect(keyToMetres(O, 0.1)).toBeCloseTo(0.05);
    expect(keyToMetres(O - 5, 0.1)).toBeCloseTo(-0.45);
  });

  it("maps a coordinate back to the key of the cell it lies in", () => {
    expect(metresToKey(0.05, 0.1)).toBe(O);
    expect(metresToKey(-0.45, 0.1)).toBe(O - 5);
    expect(metresToKey(keyToMetres(O + 123, 0.1), 0.1)).toBe(O + 123);
  });
});
