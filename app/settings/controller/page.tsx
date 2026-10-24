"use client";

import { SettingsPage } from "@/components/settings/settings-page";
import { UnavailableSettings } from "@/components/settings/unavailable-settings";

export default function ControllerSettingsPage() {
  return (
    <SettingsPage title="Controller">
      <UnavailableSettings section="Controller" />
    </SettingsPage>
  );
}
