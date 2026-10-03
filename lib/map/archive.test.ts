import { describe, expect, it } from "vitest";

import { exportFilename, importNameFromFilename } from "@/lib/map/archive";

describe("exportFilename", () => {
  it("mirrors the backend's Content-Disposition, which the browser cannot read", () => {
    expect(exportFilename("dp2f")).toBe("dp2f.zip");
    expect(exportFilename("dp2f", "tar.gz")).toBe("dp2f.tar.gz");
  });
});

describe("importNameFromFilename", () => {
  it("takes the map name back off an export's filename", () => {
    expect(importNameFromFilename("site-A.zip")).toBe("site-A");
    expect(importNameFromFilename("site-A.tar.gz")).toBe("site-A");
  });

  it("does not care how the extension is cased", () => {
    expect(importNameFromFilename("x.ZIP")).toBe("x");
  });

  it("suggests nothing rather than a name the catalogue would refuse", () => {
    // A space fails the name rule; so does an empty stem.
    expect(importNameFromFilename("my map.zip")).toBe("");
    expect(importNameFromFilename(".zip")).toBe("");
    // Not an archive extension at all: the whole filename is the stem, and
    // ".pcd" is admitted by the name rule, so it is offered as typed.
    expect(importNameFromFilename("map.pcd")).toBe("map.pcd");
  });
});
