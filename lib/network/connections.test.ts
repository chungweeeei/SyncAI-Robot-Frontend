import { describe, expect, it } from "vitest";

import type { WifiConnection } from "@/lib/api/network";
import {
  IP_BLANK,
  MAC_BLANK,
  RSSI_BLANK,
  lastUsedLabel,
  linkReadout,
  orderConnections,
} from "@/lib/network/connections";
import type { RobotNetworkStatus } from "@/lib/types/robot";

const saved = (
  ssid: string,
  last_used_at: string | null,
  active = false,
): WifiConnection => ({ uuid: `u-${ssid}`, name: ssid, ssid, active, last_used_at });

describe("orderConnections", () => {
  const list = [
    saved("never-b", null),
    saved("old", "2026-01-01T00:00:00Z"),
    saved("never-a", null),
    saved("on", "2025-06-01T00:00:00Z", true),
    saved("recent", "2026-10-01T00:00:00Z"),
  ];

  it("puts the live network first, then most recent, then never-used by name", () => {
    expect(orderConnections(list, "on").map((c) => c.ssid)).toEqual([
      "on",
      "recent",
      "old",
      "never-a",
      "never-b",
    ]);
  });

  it("trusts the state poll over the list's own active flag", () => {
    // The robot roamed to "old" after the list was read.
    expect(orderConnections(list, "old")[0].ssid).toBe("old");
  });

  it("falls back to the list's flag before the robot has reported in", () => {
    expect(orderConnections(list, null)[0].ssid).toBe("on");
  });

  it("does not reorder the caller's array", () => {
    const copy = [...list];
    orderConnections(list, "on");
    expect(list).toEqual(copy);
  });
});

describe("linkReadout", () => {
  const current: RobotNetworkStatus = {
    ssid: "site-wifi",
    bssid: "aa:bb:cc:dd:ee:ff",
    rssi: -52,
    ip_address: "10.8.140.138",
    mac_address: "11:22:33:44:55:66",
  };
  const blank = { rssi: null, ip: null, mac: null };

  it("reads the state poll out on the card of the network it reports", () => {
    expect(linkReadout("site-wifi", current)).toEqual({
      rssi: -52,
      ip: "10.8.140.138",
      mac: "11:22:33:44:55:66",
    });
  });

  it("never shows one network's address on another network's card", () => {
    expect(linkReadout("lab-5g", current)).toEqual(blank);
  });

  it("is blank before the robot has reported in, and off any network", () => {
    expect(linkReadout("site-wifi", null)).toEqual(blank);
    expect(linkReadout("", { ...current, ssid: "" })).toEqual(blank);
  });

  it("blanks an address the robot has not been given yet", () => {
    expect(linkReadout("site-wifi", { ...current, ip_address: "" })).toEqual({
      rssi: -52,
      ip: null,
      mac: "11:22:33:44:55:66",
    });
  });

  it("keeps each blank in the shape of the value it stands in for", () => {
    expect(IP_BLANK.split(".")).toHaveLength(current.ip_address.split(".").length);
    expect(MAC_BLANK.split(":")).toHaveLength(current.mac_address.split(":").length);
    expect(RSSI_BLANK).toMatch(/ dBm$/);
  });
});

describe("lastUsedLabel", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");

  it("has its own line for a network saved but never joined", () => {
    expect(lastUsedLabel(null, now)).toBe("Never joined");
  });

  it("is relative within the week", () => {
    expect(lastUsedLabel("2026-10-12T11:59:40Z", now)).toBe("Last joined just now");
    expect(lastUsedLabel("2026-10-12T11:15:00Z", now)).toBe("Last joined 45 min ago");
    expect(lastUsedLabel("2026-10-12T07:00:00Z", now)).toBe("Last joined 5 h ago");
    expect(lastUsedLabel("2026-10-11T10:00:00Z", now)).toBe("Last joined yesterday");
    expect(lastUsedLabel("2026-10-08T12:00:00Z", now)).toBe("Last joined 4 days ago");
  });

  it("is a date past the week", () => {
    expect(lastUsedLabel("2026-08-01T12:00:00Z", now)).toMatch(/^Last joined .*2026/);
  });
});
