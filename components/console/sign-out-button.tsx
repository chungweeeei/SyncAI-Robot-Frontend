"use client";

import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/hooks/use-session";

/**
 * Sign out: the session gate sees the session go and returns to /login.
 * Nothing to send — the token is the whole session, and a sign-out is the
 * console forgetting it.
 *
 * A labelled button for a page (Settings, where a phone, whose bottom bar
 * has no room left, finds it); the nav rail draws the same press as the last
 * row of its foot.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={signOut} className={className}>
      <LogOutIcon data-icon="inline-start" />
      Sign out
    </Button>
  );
}
