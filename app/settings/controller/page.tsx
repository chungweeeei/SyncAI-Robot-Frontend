"use client";

import { ControllerSettings } from "@/components/settings/controller-settings";
import { SettingsPage } from "@/components/settings/settings-page";

export default function ControllerSettingsPage() {
  return (
    <SettingsPage
      title="Controller"
      description="How the robot walks and arrives. Changes are kept on the robot."
    >
      <ControllerSettings />
    </SettingsPage>
  );
}
