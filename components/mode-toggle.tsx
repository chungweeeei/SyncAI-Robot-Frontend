"use client";

import * as React from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

const subscribeNoop = () => () => {};

/**
 * Day / night in one click: the 56 px rail has no room for a three-way
 * dropdown, so light / dark / system lives in Settings → Preferences.
 */
export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // The resolved theme is unknown during SSR, so the icon *and* the aria-label
  // wait for mount — gating only the icon still mismatched on the label.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const dark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      // 40 px in the phone bar, 36 px in the rail, like the tabs beside it.
      className="flex size-10 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground lg:size-9"
      aria-label={
        mounted
          ? dark
            ? "Switch to daylight mode"
            : "Switch to night mode"
          : "Switch day or night mode"
      }
    >
      {mounted ? (
        dark ? (
          <SunIcon className="size-[18px]" />
        ) : (
          <MoonIcon className="size-[18px]" />
        )
      ) : (
        <span className="size-[18px]" />
      )}
    </button>
  );
}
