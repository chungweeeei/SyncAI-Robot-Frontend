"use client";

import * as React from "react";

/**
 * Whether the element has come within `rootMargin` of the viewport, latched:
 * once true it stays true, since what it gates (a download, a decode) is
 * not undone by scrolling away. Without IntersectionObserver (an old
 * browser, a test DOM) it is true at once, so nothing waits forever.
 */
export function useInView<T extends Element>(
  rootMargin = "200px",
): [React.RefCallback<T>, boolean] {
  const [seen, setSeen] = React.useState(() => typeof IntersectionObserver === "undefined");
  const [node, setNode] = React.useState<T | null>(null);

  React.useEffect(() => {
    if (seen || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, seen, rootMargin]);

  return [setNode, seen];
}
