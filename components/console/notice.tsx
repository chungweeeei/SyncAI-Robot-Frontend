import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The empty / failed panel every list screen uses, so "nothing here" and
 * "could not read" look the same on /maps, /recordings and /history.
 */
export function Notice({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline bg-panel p-4">
      <p className="instrument-label text-muted-foreground">{label}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

/**
 * A list's stand-in while its first read is out: three rows in the list's
 * own frame, so the page does not jump when the rows arrive. `children` is
 * one row's skeletons, in the shape the real row has.
 */
export function LoadingList({
  rowClassName,
  children,
}: {
  rowClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="divide-y divide-hairline rounded-md border border-hairline bg-panel"
      aria-busy
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("px-4 py-3", rowClassName)}>
          {children}
        </div>
      ))}
    </div>
  );
}

/** One row of a two-line list: a title and a line of detail under it. */
export function TwoLineSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-2/3" />
    </>
  );
}
