"use client";

import { NetworkSettings } from "@/components/settings/network-settings";
import { SettingsSubpage } from "@/components/settings/settings-subpage";

export default function WifiSettingsPage() {
  return (
    <SettingsSubpage title="Wi-Fi">
      {/* Not gated on a state frame: scan and connect do not need one, and
          a console that has never heard from the robot is exactly the one
          that needs to fix its WiFi. The card degrades its own readout. */}
      <NetworkSettings />
    </SettingsSubpage>
  );
}
