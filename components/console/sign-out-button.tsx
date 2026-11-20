"use client";

import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

/**
 * Sign out: the session gate sees the session go and returns to /login.
 * Nothing to send — the token is the whole session, and a sign-out is the
 * console forgetting it.
 *
 * `rail` is the nav rail's icon face, beside the day / night toggle; the
 * default is a labelled button for a page (Settings, where a phone, whose
 * bottom bar has no room left, finds it).
 */
export function SignOutButton({
  variant = "button",
  className,
}: {
  variant?: "rail" | "button";
  className?: string;
}) {
  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className={cn(
          "flex size-10 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:size-9",
          className,
        )}
      >
        <LogOutIcon aria-hidden className="size-[18px]" />
      </button>
    );
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={signOut} className={className}>
      <LogOutIcon data-icon="inline-start" />
      Sign out
    </Button>
  );
}
