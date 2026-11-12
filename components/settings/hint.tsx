import * as React from "react";

import { cn } from "@/lib/utils";

/** The small muted line under a settings field or card: what it means, or what is happening. */
export function Hint({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[11px] leading-snug text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  );
}
