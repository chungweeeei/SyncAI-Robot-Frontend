"use client";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { SettingsSubpage } from "@/components/settings/settings-subpage";

export default function PreferencesSettingsPage() {
  return (
    <SettingsSubpage title="Preferences">
      <AppearanceSettings />
    </SettingsSubpage>
  );
}
