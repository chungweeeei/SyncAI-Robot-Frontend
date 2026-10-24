"use client";

import { SettingsPage } from "@/components/settings/settings-page";
import { UnavailableSettings } from "@/components/settings/unavailable-settings";

export default function PlannerSettingsPage() {
  return (
    <SettingsPage title="Planner">
      <UnavailableSettings section="Planner" />
    </SettingsPage>
  );
}
