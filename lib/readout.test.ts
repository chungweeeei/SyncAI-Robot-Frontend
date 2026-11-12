import { describe, expect, it } from "vitest";

import { formatDegrees, formatMetres } from "@/lib/readout";

describe("a pose's printed digits", () => {
  it("prints metres to the centimetre and degrees to the tenth", () => {
    expect(formatMetres(1.5)).toBe("1.50");
    expect(formatMetres(-0.004)).toBe("-0.00");
    expect(formatDegrees(90)).toBe("90.0");
    expect(formatDegrees(-179.96)).toBe("-180.0");
  });
});
