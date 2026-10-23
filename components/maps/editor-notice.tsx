import type * as React from "react";

/**
 * What a map editor shows instead of itself when it cannot open: a title
 * saying so and one line on why. Both editors' refusals look alike, since an
 * operator meets them from the same card.
 */
export function EditorNotice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-md border border-hairline bg-panel p-4">
        <p className="instrument-label text-muted-foreground">{title}</p>
        <p className="mt-2 text-sm">{children}</p>
      </div>
    </div>
  );
}
