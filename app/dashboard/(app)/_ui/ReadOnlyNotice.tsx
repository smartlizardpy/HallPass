/**
 * "You can look, but you cannot change this" — the banner a beta admin sees on
 * every dashboard screen outside the beta programme.
 *
 * WHY A BANNER AND NOT JUST HIDDEN CONTROLS. Hiding the buttons alone produces
 * a page that looks BROKEN rather than restricted: the reader has no way to tell
 * "this site has no edit control" from "this site is not letting me". One line
 * saying which it is, and where they can act instead, is the difference between
 * a permission and a bug report.
 *
 * A server component with no props: the role is decided by the page (which has
 * already resolved it for its own guard), so this renders only where a page has
 * concluded the viewer may not write. Keeping the decision out of here means
 * there is exactly one place per page that asks the question — `canEditSite`.
 */

import Link from "next/link";

export function ReadOnlyNotice({ what }: { what: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
      <span aria-hidden>👀</span>
      <span className="font-semibold text-foreground">Read-only.</span>
      <span>Your role can view {what} but not change {what}.</span>
      <Link
        href="/dashboard/beta"
        className="font-bold text-brand hover:text-brand-600"
      >
        Go to the beta programme →
      </Link>
    </div>
  );
}
