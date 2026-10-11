"use client";

import { SettingsSubpage } from "@/components/settings/settings-subpage";
import { UnavailableSettings } from "@/components/settings/unavailable-settings";

export default function PlannerSettingsPage() {
  return (
    <SettingsSubpage title="Planner">
      <UnavailableSettings section="Planner" />
    </SettingsSubpage>
  );
}
