"use client";

import { SettingsForm } from "@/components/settings/settings-form";
import { SettingsPage } from "@/components/settings/settings-page";

export default function PlannerSettingsPage() {
  return (
    <SettingsPage
      title="Planner"
      description="How the robot chooses its route. Changes are kept on the robot."
    >
      <SettingsForm page="planner" />
    </SettingsPage>
  );
}
