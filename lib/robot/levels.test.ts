import { describe, expect, it } from "vitest";

import {
  BATTERY_CAUTION_PCT,
  BATTERY_WARN_PCT,
  SIGNAL_BARS,
  TEMP_CAUTION_C,
  TEMP_WARN_C,
  batteryTone,
  motorTempTone,
  rssiToBars,
} from "@/lib/robot/levels";

/**
 * Each reading's thresholds, stated at their edges: the value on a threshold
 * and the one just past it. A cut-off that moved by a unit changes what
 * colour an operator sees, and nothing else would notice.
 */

describe("rssiToBars", () => {
  it("fills the meter at -50 dBm and above", () => {
    expect(rssiToBars(-50)).toBe(SIGNAL_BARS);
    expect(rssiToBars(-30)).toBe(SIGNAL_BARS);
  });

  it("steps down a bar every 10 dB", () => {
    expect(rssiToBars(-51)).toBe(3);
    expect(rssiToBars(-60)).toBe(3);
    expect(rssiToBars(-61)).toBe(2);
    expect(rssiToBars(-70)).toBe(2);
  });

  it("never shows zero bars for a network that answers", () => {
    expect(rssiToBars(-71)).toBe(1);
    expect(rssiToBars(-100)).toBe(1);
  });

  it("never returns more bars than the meter draws", () => {
    for (let rssi = -110; rssi <= 0; rssi += 1) {
      const bars = rssiToBars(rssi);
      expect(bars).toBeGreaterThanOrEqual(1);
      expect(bars).toBeLessThanOrEqual(SIGNAL_BARS);
    }
  });
});

describe("batteryTone", () => {
  it("is live while there is margin", () => {
    expect(batteryTone(BATTERY_CAUTION_PCT)).toBe("live");
    expect(batteryTone(100)).toBe("live");
  });

  it("is caution below the caution level, and warn below the warn level", () => {
    expect(batteryTone(BATTERY_CAUTION_PCT - 1)).toBe("caution");
    expect(batteryTone(BATTERY_WARN_PCT)).toBe("caution");
    expect(batteryTone(BATTERY_WARN_PCT - 1)).toBe("warn");
    expect(batteryTone(0)).toBe("warn");
  });

  it("warns before it cautions, never the other way round", () => {
    expect(BATTERY_WARN_PCT).toBeLessThan(BATTERY_CAUTION_PCT);
  });
});

describe("motorTempTone", () => {
  it("stays neutral below caution, so a hot joint is the only colour in the grid", () => {
    expect(motorTempTone(TEMP_CAUTION_C - 1)).toBe("neutral");
    expect(motorTempTone(20)).toBe("neutral");
  });

  it("is caution from the caution level, and warn from the warn level", () => {
    expect(motorTempTone(TEMP_CAUTION_C)).toBe("caution");
    expect(motorTempTone(TEMP_WARN_C - 1)).toBe("caution");
    expect(motorTempTone(TEMP_WARN_C)).toBe("warn");
  });

  it("cautions before it warns", () => {
    expect(TEMP_CAUTION_C).toBeLessThan(TEMP_WARN_C);
  });
});
