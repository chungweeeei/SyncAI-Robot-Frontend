"use client";

import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { SettingsPage } from "@/components/settings/settings-page";

export default function PreferencesSettingsPage() {
  return (
    <SettingsPage
      title="Preferences"
      description="Customize how the console looks and behaves."
    >
      <AppearanceSettings />
    </SettingsPage>
  );
}
