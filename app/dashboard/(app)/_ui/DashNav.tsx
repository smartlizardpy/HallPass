"use client";

/**
 * Dashboard sidebar navigation with active-link highlighting.
 *
 * Split out as a client component because the highlight depends on the live
 * pathname (`usePathname`), which the server layout cannot read per-render. The
 * active test is intentionally asymmetric: the Overview link (`/dashboard`)
 * matches EXACTLY so it does not stay lit on `/dashboard/boards`, while section
 * links match by PREFIX so their own detail/child routes
 * (`/dashboard/boards/new`, `/dashboard/boards/<id>`) keep the parent
 * highlighted.
 *
 * ── THE LINK SET IS PER-ROLE, AND ONE PART OF IT IS NOT COSMETIC ────────────
 * Every other "hide the control" in this codebase is UX with a real guard
 * behind it. This one has a second job. `OpenReportBadge` rides on the
 * Moderation link, and it POLLS `openReportCountAction` — a Server Function
 * guarded at `SITE_WRITE_ROLE`, which now REDIRECTS a role below that rung
 * rather than waving it through. Rendering that link for a beta admin would
 * therefore drag them off whatever dashboard page they were reading, every 60
 * seconds, from a background timer. So the nav shows a role only the sections it
 * can actually open, and the Moderation entry in particular must not render
 * below `SITE_WRITE_ROLE`.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/app/lib/dashboard-users";
import { canEditSite } from "@/app/lib/permissions";
import { OpenReportBadge } from "../moderation/_ui/OpenReportBadge";

/**
 * `edit: true` marks a section that only a role with site-write rights may open
 * at all — the page's own guard bounces everyone else, so linking to it from a
 * nav that cannot follow the link is an invitation to a redirect.
 */
type NavItem = { href: string; label: string; exact?: boolean; edit?: boolean };

/**
 * Moderation sits SECOND, directly under Overview, because it is the only link
 * here that can have a child waiting on the other end of it — the shortest reach
 * goes to the highest-urgency surface. Its open-report count rides on the link
 * itself (`OpenReportBadge`), so the backlog is visible from every screen rather
 * than only after someone thinks to look.
 */
const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/moderation", label: "Moderation", edit: true },
  // THIRD, directly under Moderation, and deliberately not second: Moderation's
  // placement is earned by being the only link with a child waiting on the other
  // end of it, and a work board does not outrank that. Third is still the
  // shortest reach that is going spare, which is right for the surface people
  // open to answer "what is being built".
  { href: "/dashboard/tracker", label: "Tracker", edit: true },
  { href: "/dashboard/boards", label: "Leaderboards", edit: true },
  // Below the three surfaces with something waiting on them and above the
  // catalogue admin: Growth is a read-only screen nobody is blocked on, but it
  // is the one that answers "is any of this working", so it sits with the other
  // things you open to think rather than with the things you open to edit.
  { href: "/dashboard/growth", label: "Growth" },
  { href: "/dashboard/games", label: "Games" },
  { href: "/dashboard/curation", label: "Curation" },
  { href: "/dashboard/beta", label: "Beta" },
  // LAST in the main list, and deliberately not in the super-admin block below.
  // `/dashboard/users` is about other people's access and is rightly restricted;
  // this is about your own — a beta admin who connects a laptop needs somewhere
  // to disconnect it, and gating that on a role they do not hold would make
  // asking somebody else the only way out. It sits last because nothing is ever
  // waiting on it: it is an account surface, not a work surface.
  { href: "/dashboard/mcp", label: "Connections" },
];

// Super-admin-only links, appended when the caller holds that role.
//
// "Blob ops" sits LAST, below Logs, and that is the right place for it rather
// than an oversight: it is the screen you open when something has already gone
// wrong (the advanced-operation allowance is spent and publishing is failing),
// not one you pass through on an ordinary day. Ranking it above Users or Logs
// would cost the surfaces people actually use a shorter reach in exchange for a
// link that should ideally never be clicked.
const SUPER_ADMIN_ITEMS: NavItem[] = [
  { href: "/dashboard/users", label: "Users" },
  { href: "/dashboard/logs", label: "Logs" },
  { href: "/dashboard/blob", label: "Blob ops" },
];

export function DashNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const mayEdit = canEditSite(role);
  const visible = mayEdit ? ITEMS : ITEMS.filter((item) => !item.edit);
  const items =
    role === "super_admin" ? [...visible, ...SUPER_ADMIN_ITEMS] : visible;

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
