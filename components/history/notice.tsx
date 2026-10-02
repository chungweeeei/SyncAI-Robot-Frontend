import * as React from "react";

/**
 * Same panel shape /recordings and /maps use when there is nothing to list,
 * or when the robot could not answer. Shared by the dashboard and the list,
 * so a failed count and a failed page read the same way.
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
