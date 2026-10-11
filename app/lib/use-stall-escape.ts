"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { createStallEscape } from "./stall-escape";

/**
 * The React face of `stall-escape.ts`: returns `watch(href)`, to be called from a
 * `<Link onNavigate>` (or right after a `router.push`) so that a router that takes
 * the tap and never commits it is replaced by a plain page load. Read that module
 * for why it arms from `onNavigate` and what counts as a commit.
 *
 * The clock is cancelled whenever `pathname` changes (the commit that makes the
 * escape unnecessary) and on unmount, so a timer can never fire into a page that
 * has moved on. A query-only commit does not move `pathname`; it is caught by the
 * timer's own location check instead.
 */
export function useStallEscape(): (href: string) => void {
  const pathname = usePathname();

  const escape = useMemo(
    () =>
      createStallEscape({
        here: () => window.location.pathname + window.location.search,
        online: () => navigator.onLine,
        visible: () => document.visibilityState !== "hidden",
        assign: (href) => window.location.assign(href),
      }),
    [],
  );

  useEffect(() => {
    escape.cancel();
  }, [pathname, escape]);

  useEffect(() => () => escape.cancel(), [escape]);

  return useCallback((href: string) => escape.watch(href), [escape]);
}
