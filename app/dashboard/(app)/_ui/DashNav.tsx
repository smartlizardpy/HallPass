"use client";

/**
 * Dashboard sidebar navigation with active-link highlighting.
 *
 * Split out as a client component because the highlight depends on the live
 * pathname (`usePathname`), which the server layout cannot read per-render. The
 * link set is otherwise static; the only authorization input is `isSuperAdmin`,
 * which gates the super-admin-only Users link. The active test is intentionally
 * asymmetric: the Overview link (`/dashboard`) matches EXACTLY so it does not
 * stay lit on `/dashboard/boards`, while section links match by PREFIX so their
 * own detail/child routes (`/dashboard/boards/new`, `/dashboard/boards/<id>`)
 * keep the parent highlighted.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OpenReportBadge } from "../moderation/_ui/OpenReportBadge";

type NavItem = { href: string; label: string; exact?: boolean };

/**
 * Moderation sits SECOND, directly under Overview, because it is the only link
 * here that can have a child waiting on the other end of it — the shortest reach
 * goes to the highest-urgency surface. Its open-report count rides on the link
 * itself (`OpenReportBadge`), so the backlog is visible from every screen rather
 * than only after someone thinks to look.
 */
const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/moderation", label: "Moderation" },
  { href: "/dashboard/boards", label: "Leaderboards" },
  { href: "/dashboard/games", label: "Games" },
  { href: "/dashboard/external-games", label: "External Games" },
  { href: "/dashboard/curation", label: "Curation" },
  { href: "/dashboard/tags", label: "Tags & genres" },
];

// Super-admin-only links, appended when the caller holds that role.
const SUPER_ADMIN_ITEMS: NavItem[] = [
  { href: "/dashboard/users", label: "Users" },
  { href: "/dashboard/logs", label: "Logs" },
];

export function DashNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const items = isSuperAdmin ? [...ITEMS, ...SUPER_ADMIN_ITEMS] : ITEMS;

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-lg bg-brand-50 px-3 py-2 text-sm font-bold text-brand"
                : "rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2"
            }
          >
            {item.label}
            {item.href === "/dashboard/moderation" && <OpenReportBadge />}
          </Link>
        );
      })}
    </nav>
  );
}
