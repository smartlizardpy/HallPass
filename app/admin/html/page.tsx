/**
 * Legacy game-HTML admin — retired.
 *
 * The password-protected HTML tools that once lived here have moved INTO the
 * dashboard at `/dashboard/games`, where they are gated by the dashboard's own
 * `requireRole("admin")` model instead of a bespoke password cookie. This stub
 * preserves the old URL by permanently sending visitors to the new surface.
 *
 * (`app/lib/admin-html-auth.ts` is intentionally left in place; nothing here
 * depends on it any more, but it is not ours to remove.)
 */

import { redirect } from "next/navigation";

export default function HtmlAdminPage(): never {
  redirect("/dashboard/games");
}
