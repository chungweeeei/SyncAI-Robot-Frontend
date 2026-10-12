"use client";

import { NetworkSettings } from "@/components/settings/network-settings";
import { SettingsSubpage } from "@/components/settings/settings-subpage";

export default function AddWifiNetworkPage() {
  return (
    <SettingsSubpage
      title="Add network"
      back={{ href: "/settings/wifi", label: "Wi-Fi" }}
    >
      <NetworkSettings />
    </SettingsSubpage>
  );
}
