"use client";

import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { SettingsSubpage } from "@/components/settings/settings-subpage";
import {
  ADD_NETWORK_HREF,
  WifiConnections,
} from "@/components/settings/wifi-connections";
import { buttonVariants } from "@/components/ui/button";

export default function WifiSettingsPage() {
  return (
    <SettingsSubpage
      title="Wi-Fi"
      wide
      action={
        <Link href={ADD_NETWORK_HREF} className={buttonVariants({ size: "sm" })}>
          <PlusIcon data-icon="inline-start" />
          Add network
        </Link>
      }
    >
      {/* Not gated on a state frame: a console that never heard from the
          robot is the one that needs to fix its Wi-Fi. */}
      <WifiConnections />
    </SettingsSubpage>
  );
}
