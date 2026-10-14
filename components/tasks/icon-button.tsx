"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A bare square icon button for a list row's action cluster. Not in
 * `components/ui/`, which is shadcn output.
 *
 * `label` is both the accessible name and the tooltip: an icon-only control
 * needs a title for a mouse and an aria-label for a screen reader.
 */
export function IconButton({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  disabled: boolean;
  /** Handed the event so a caller can tell a finger's press from a mouse's. */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      // 40 px under a finger as a real box, not a Switch-style ::after hit area:
      // at gap-0.5 a sibling's ::after would overlap its neighbour's edge.
      className={cn(
        "flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:size-10",
        className,
      )}
    >
      {children}
    </button>
  );
}
