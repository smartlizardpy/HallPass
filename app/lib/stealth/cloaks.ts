/**
 * HallPass — tab-cloak presets ("stealth mode").
 *
 * A cloak disguises the browser TAB — its `document.title` and its favicon — so a
 * glance at the tab strip reads as schoolwork, not an arcade. This is the single
 * most-requested feature of the unblocked-games genre and the whole reason the
 * site is called HALLPASS.
 *
 * Design constraints that shape this file:
 *   - PURE DATA, no `window`. It is imported by three very different callers and
 *     must be safe in every one: the React controller (client), the settings
 *     modal (client), AND the `beforeInteractive` inline script in the root
 *     layout, which is emitted by SERIALISING {@link CLOAK_LIST} into a string on
 *     the server. A single source of truth keeps the no-flash script and the
 *     live controller from ever disagreeing.
 *   - FAVICONS ARE SELF-CONTAINED `data:` URIs. No network request (so nothing to
 *     precache, nothing to fail offline) and no shipped bitmap of a third party's
 *     exact logo — each is a small, recognisable SVG approximation drawn in the
 *     right colours, which is all a 16px tab needs to sell the disguise.
 *
 * `id` is the stable key persisted in localStorage; renaming one would silently
 * reset a user's saved choice, so treat these as an append-only enum.
 */

/** Encode an SVG string as an inline favicon `data:` URI. Computed once per preset. */
function favicon(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s{2,}/g, " ").trim())}`;
}

export type Cloak = {
  /** Stable localStorage key — append-only, never rename. */
  id: string;
  /** Human label shown in the settings picker. */
  label: string;
  /** What the browser tab's title becomes. */
  title: string;
  /** Favicon `data:` URI, or `null` to keep the site's real icon (the "off" preset). */
  favicon: string | null;
};

/* -------------------------------------------------------------------------- *
 * Favicon art — 24×24 viewBox, drawn to read at 16px. Approximations, not the
 * vendors' exact marks (see the header note).
 * -------------------------------------------------------------------------- */

const DOCS_ICON = favicon(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M6 2h8l4 4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#4285F4"/>
    <path d="M14 2l4 4h-4z" fill="#A1C2FA"/>
    <g fill="#fff"><rect x="8" y="9" width="8" height="1.5" rx=".75"/><rect x="8" y="12" width="8" height="1.5" rx=".75"/><rect x="8" y="15" width="5" height="1.5" rx=".75"/></g>
  </svg>`);

const CLASSROOM_ICON = favicon(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <rect x="2" y="4" width="20" height="16" rx="2" fill="#0F9D58"/>
    <circle cx="12" cy="11" r="2.4" fill="#fff"/>
    <path d="M6.5 18a5.5 5.5 0 0 1 11 0z" fill="#fff"/>
  </svg>`);

const DRIVE_ICON = favicon(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <polygon points="12,4 4,20 12,14.67" fill="#00AC47"/>
    <polygon points="12,4 20,20 12,14.67" fill="#FFBA00"/>
    <polygon points="4,20 20,20 12,14.67" fill="#2684FC"/>
  </svg>`);

const SEARCH_ICON = favicon(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M12 4a8 8 0 1 0 5.66 13.66" fill="none" stroke="#4285F4" stroke-width="3.4"/>
    <path d="M12 4a8 8 0 0 1 7.6 5.5" fill="none" stroke="#EA4335" stroke-width="3.4"/>
    <path d="M19.6 9.5A8 8 0 0 1 20 12h-8" fill="none" stroke="#FBBC05" stroke-width="3.4"/>
    <path d="M20 12a8 8 0 0 1-2.34 5.66" fill="none" stroke="#0F9D58" stroke-width="3.4"/>
  </svg>`);

const NEWTAB_ICON = favicon(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" fill="none" stroke="#9aa0a6" stroke-width="2"/>
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="#9aa0a6" stroke-width="1.6"/>
  </svg>`);

/* -------------------------------------------------------------------------- *
 * The presets. `off` MUST stay first and is the default (no disguise).
 * -------------------------------------------------------------------------- */

export const CLOAK_LIST: readonly Cloak[] = [
  { id: "off", label: "Off (HALLPASS)", title: "HALLPASS — Unblocked Games", favicon: null },
  { id: "docs", label: "Google Docs", title: "Untitled document - Google Docs", favicon: DOCS_ICON },
  { id: "classroom", label: "Google Classroom", title: "Classes", favicon: CLASSROOM_ICON },
  { id: "drive", label: "Google Drive", title: "My Drive - Google Drive", favicon: DRIVE_ICON },
  { id: "search", label: "Google", title: "Google", favicon: SEARCH_ICON },
  { id: "newtab", label: "New Tab", title: "New Tab", favicon: NEWTAB_ICON },
];

/** The default cloak id (no disguise). */
export const DEFAULT_CLOAK_ID = CLOAK_LIST[0].id;

/**
 * Resolve an id to its preset, falling back to `off` for an unknown/stale id so a
 * corrupt localStorage value can never leave the tab in an undefined state.
 */
export function cloakById(id: string | null | undefined): Cloak {
  return CLOAK_LIST.find((c) => c.id === id) ?? CLOAK_LIST[0];
}
