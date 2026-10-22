// The OcTree `.bt` format, as the robot's clean_map writes octomap.bt and the
// backend serves it: a short text header, then the tree depth first, two bytes
// an inner node. Decoded here rather than on the robot because the file is a
// third the size of its voxel centres as floats, and the floor rules
// (lib/map/ground.ts) read the tree's own keys, not metres.
//
// Both halves of the format live in this file: the console only ever decodes,
// but the encoder is how the tests and the e2e fake build a tree with known
// contents, and keeping it beside the decoder is what keeps the two agreeing
// on the bit order.

import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

/** The first line of every `.bt`; anything else is not a tree. */
const BANNER = "# Octomap OcTree binary file";
/** The only node record this decoder reads (a ColorOcTree's differs). */
const TREE_ID = "OcTree";
/** 16 levels under the root, so a key is 16 bits and the root spans 65536 cells. */
const TREE_DEPTH = 16;
/** The record a corrupt stream is reported as; see `decodeOctomapBt`. */
const UNREADABLE = "The 3D map is not in a form this console can read.";
const INCOMPLETE =
  "The 3D map arrived incomplete. Turn 3D map off and on to try again.";

/** The centre of a voxel, metres, from an absolute key on one axis. */
export function keyToMetres(key: number, res: number): number {
  return (key - OCTREE_KEY_ORIGIN + 0.5) * res;
}

/** The absolute key of the voxel a coordinate falls in, on one axis. */
export function metresToKey(metres: number, res: number): number {
  return Math.floor(metres / res) + OCTREE_KEY_ORIGIN;
}

interface Header {
  res: number;
  /** Offset of the first tree byte. */
  dataStart: number;
}

/**
 * The text header: the banner, `id`, `size`, `res`, then `data` on its own
 * line and the tree. Comment lines (`#`) are skipped; the banner is the one
 * comment that has to be there.
 */
function readHeader(bytes: Uint8Array): Header {
  const limit = Math.min(bytes.length, 4096);
  let res: number | null = null;
  let id: string | null = null;
  let lineStart = 0;
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    const line = String.fromCharCode(...bytes.subarray(lineStart, i)).trim();
    const first = lineStart === 0;
    lineStart = i + 1;
    if (first && line !== BANNER) throw new Error(UNREADABLE);
    if (line.startsWith("#")) continue;
    if (line === "data") {
      if (res === null || !(res > 0) || id !== TREE_ID) throw new Error(UNREADABLE);
      return { res, dataStart: lineStart };
    }
    const space = line.indexOf(" ");
    if (space < 0) throw new Error(UNREADABLE);
    const key = line.slice(0, space);
    const value = line.slice(space + 1).trim();
    if (key === "res") res = Number(value);
    else if (key === "id") id = value;
  }
  throw new Error(UNREADABLE);
}

/**
 * Decode a `.bt` into its occupied voxels.
 *
 * The tree is one record per inner node, depth first in child order, two
 * bits a child: `01` an occupied leaf, `10` a free leaf, `11` a child with a
 * record of its own, `00` no child. Child `i` sits in the upper half of the
 * parent's box on each axis whose bit of `i` is set (x = 1, y = 2, z = 4),
 * which is the key arithmetic octomap's reader uses. A leaf above the finest
 * level is a pruned block and is expanded to its cells, so what comes back
 * is every occupied cell whatever the tree chose to merge.
 *
 * Free leaves are counted and dropped: the layer draws what is solid, and a
 * column's ground is its lowest solid cell, which the occupied set answers. Throws one operator sentence for a file that is not
 * a tree and another for one cut short, since a 2xx truncated in transit has
 * no backend sentence of its own.
 */
export function decodeOctomapBt(buffer: ArrayBuffer): OccupiedVoxels {
  const bytes = new Uint8Array(buffer);
  const { res, dataStart } = readHeader(bytes);

  // Absolute keys, grown as needed; made relative once the box is known.
  let keys = new Uint16Array(3 * 65536);
  let count = 0;
  let occupiedLeaves = 0;
  let freeLeaves = 0;

  const emit = (x: number, y: number, z: number, size: number) => {
    const cells = size * size * size;
    if ((count + cells) * 3 > keys.length) {
      const grown = new Uint16Array(Math.max(keys.length * 2, (count + cells) * 3));
      grown.set(keys);
      keys = grown;
    }
    let at = count * 3;
    for (let dz = 0; dz < size; dz += 1) {
      for (let dy = 0; dy < size; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) {
          keys[at] = x + dx;
          keys[at + 1] = y + dy;
          keys[at + 2] = z + dz;
          at += 3;
        }
      }
    }
    count += cells;
  };

  // The explicit stack of octomap's recursion: a node's corner and the size of
  // its children. At most eight pushes a level, so it never grows past this.
  const stack = new Int32Array(4 * 8 * (TREE_DEPTH + 1));
  let top = 0;
  const push = (x: number, y: number, z: number, half: number) => {
    stack[top] = x;
    stack[top + 1] = y;
    stack[top + 2] = z;
    stack[top + 3] = half;
    top += 4;
  };
  push(0, 0, 0, 1 << (TREE_DEPTH - 1));

  let pos = dataStart;
  // Inner children of one node, pushed in reverse so they pop in child order.
  const pending = new Int32Array(3 * 8);
  while (top > 0) {
    top -= 4;
    const x = stack[top];
    const y = stack[top + 1];
    const z = stack[top + 2];
    const half = stack[top + 3];
    if (pos + 2 > bytes.length) throw new Error(INCOMPLETE);
    const record = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2;

    let inner = 0;
    for (let i = 0; i < 8; i += 1) {
      const lo = (record >> (2 * i)) & 1;
      const hi = (record >> (2 * i + 1)) & 1;
      if (!lo && !hi) continue;
      const cx = x + (i & 1 ? half : 0);
      const cy = y + (i & 2 ? half : 0);
      const cz = z + (i & 4 ? half : 0);
      if (lo && hi) {
        // A record marks a finest-level cell as inner only in a torn stream.
        if (half === 1) throw new Error(UNREADABLE);
        pending[inner * 3] = cx;
        pending[inner * 3 + 1] = cy;
        pending[inner * 3 + 2] = cz;
        inner += 1;
      } else if (hi) {
        occupiedLeaves += 1;
        emit(cx, cy, cz, half);
      } else {
        freeLeaves += 1;
      }
    }
    for (let j = inner - 1; j >= 0; j -= 1) {
      push(pending[j * 3], pending[j * 3 + 1], pending[j * 3 + 2], half >> 1);
    }
  }
  if (pos !== bytes.length) throw new Error(INCOMPLETE);

  const keyMin: [number, number, number] = [65535, 65535, 65535];
  const keyMax: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count * 3; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const v = keys[i + a];
      if (v < keyMin[a]) keyMin[a] = v;
      if (v > keyMax[a]) keyMax[a] = v;
    }
  }
  if (count === 0) {
    keyMin[0] = keyMin[1] = keyMin[2] = OCTREE_KEY_ORIGIN;
    keyMax[0] = keyMax[1] = keyMax[2] = OCTREE_KEY_ORIGIN - 1;
  }
  const relative = keys.subarray(0, count * 3);
  for (let i = 0; i < relative.length; i += 3) {
    relative[i] -= keyMin[0];
    relative[i + 1] -= keyMin[1];
    relative[i + 2] -= keyMin[2];
  }

  return {
    res,
    keyMin,
    size: [keyMax[0] - keyMin[0] + 1, keyMax[1] - keyMin[1] + 1, keyMax[2] - keyMin[2] + 1],
    keys: relative,
    count,
    leaves: { occupied: occupiedLeaves, free: freeLeaves },
  };
}

export interface OctomapBtSpec {
  res: number;
  /** Absolute keys of the cells to mark occupied. */
  occupied: ReadonlyArray<readonly [number, number, number]>;
  /** Absolute keys of the cells to mark free; none by default. */
  free?: ReadonlyArray<readonly [number, number, number]>;
  /**
   * Merge a block whose cells are all occupied (or all free) into one leaf,
   * as octomap's `prune` does. Off by default so a test's cells land one leaf
   * each; on, it is the decoder's expansion that is under test.
   */
  prune?: boolean;
}

/**
 * Build a `.bt` holding exactly these cells — the inverse of
 * `decodeOctomapBt`, for the tests and the e2e fake; the console never
 * writes a tree. Linear in cells per level, which a fixture never notices.
 */
export function encodeOctomapBt(spec: OctomapBtSpec): Uint8Array {
  const occupied = spec.occupied;
  const free = spec.free ?? [];
  const prune = spec.prune ?? false;
  const records: number[] = [];
  let nodes = 0;

  const inBox = (
    keys: ReadonlyArray<readonly [number, number, number]>,
    x: number,
    y: number,
    z: number,
    size: number,
  ) =>
    keys.filter(
      ([kx, ky, kz]) =>
        kx >= x && kx < x + size && ky >= y && ky < y + size && kz >= z && kz < z + size,
    );

  const node = (
    x: number,
    y: number,
    z: number,
    half: number,
    occ: ReadonlyArray<readonly [number, number, number]>,
    fre: ReadonlyArray<readonly [number, number, number]>,
  ) => {
    nodes += 1;
    const at = records.length;
    records.push(0, 0);
    let record = 0;
    const children: Array<() => void> = [];
    for (let i = 0; i < 8; i += 1) {
      const cx = x + (i & 1 ? half : 0);
      const cy = y + (i & 2 ? half : 0);
      const cz = z + (i & 4 ? half : 0);
      const occHere = inBox(occ, cx, cy, cz, half);
      const freHere = inBox(fre, cx, cy, cz, half);
      if (occHere.length === 0 && freHere.length === 0) continue;
      const cells = half * half * half;
      const solid = occHere.length === cells && freHere.length === 0;
      const empty = freHere.length === cells && occHere.length === 0;
      if (half === 1 || (prune && (solid || empty))) {
        if (occHere.length > 0 && freHere.length > 0) {
          throw new Error(`cell ${cx},${cy},${cz} is both occupied and free`);
        }
        record |= (occHere.length > 0 ? 2 : 1) << (2 * i);
      } else {
        record |= 3 << (2 * i);
        children.push(() => node(cx, cy, cz, half >> 1, occHere, freHere));
      }
    }
    records[at] = record & 0xff;
    records[at + 1] = record >> 8;
    for (const child of children) child();
  };
  node(0, 0, 0, 1 << (TREE_DEPTH - 1), occupied, free);

  const header =
    `${BANNER}\n# (feel free to add / change comments, but leave the first line as it is!)\n` +
    `id ${TREE_ID}\nsize ${nodes}\nres ${spec.res}\ndata\n`;
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(headerBytes.length + records.length);
  out.set(headerBytes);
  out.set(records, headerBytes.length);
  return out;
}
