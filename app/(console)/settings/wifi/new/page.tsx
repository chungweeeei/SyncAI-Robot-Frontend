"use client";

import { NetworkSettings } from "@/components/settings/network-settings";
import { SettingsPage } from "@/components/settings/settings-page";

export default function AddWifiNetworkPage() {
  return (
    <SettingsPage
      title="Add network"
      description="Choose a Wi-Fi network the robot can see. The password is optional for an open network. The robot saves the network once it joins."
      parents={[
        { href: "/settings", label: "Settings" },
        { href: "/settings/wifi", label: "Wi-Fi" },
      ]}
    >
      <NetworkSettings />
    </SettingsPage>
  );
}
