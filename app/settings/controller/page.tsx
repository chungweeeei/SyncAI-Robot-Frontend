"use client";

import { SettingsSubpage } from "@/components/settings/settings-subpage";
import { UnavailableSettings } from "@/components/settings/unavailable-settings";

export default function ControllerSettingsPage() {
  return (
    <SettingsSubpage title="Controller">
      <UnavailableSettings section="Controller" />
    </SettingsSubpage>
  );
}
