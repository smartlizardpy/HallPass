"use client";

import { CATALOG_SORTS, type CatalogSort } from "../lib/catalog-order";
import { CATALOG_VIEWS, type CatalogView } from "../lib/catalog-prefs";

/**
 * The main grid's controls: how many games are in it, what order they are in,
 * and whether they are drawn as cards or as a list.
 *
 * ── IT SITS ON THE FILTERED GRID AND NOTHING ELSE ──────────────────────────
 * "Jump back in", "Your favorites", "New games" and "Popular this week" each
 * mean one specific thing, and their order IS that meaning — a "Popular this
 * week" row sorted A-Z would be a row with its own title crossed out. So this
 * governs the one row that has no editorial claim on its order: the All-games
 * grid, and the category and search results that replace it.
 *
 * ── PRESENTATION: TWO SEGMENTED CONTROLS, NOT A DROPDOWN ───────────────────
 * Four orders and two layouts fit on one line at every width this grid renders
 * at, and a segmented control shows the current choice WITHOUT being opened,
 * which a `<select>` does not. It is also the language the rest of the site
 * already speaks: the category rail and the review sort are both rows of pills.
 *
 * `aria-pressed` per button rather than a radio group, matching the review
 * sort — a radio group would promise arrow-key roving that this does not
 * implement, and a promise the keyboard does not keep is worse than plain
 * buttons that tab.
 */
export function CatalogToolbar({
  count,
  sort,
  onSortChange,
  view,
  onViewChange,
}: {
  /** How many games the grid below is showing. */
  count: number;
  sort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
  view: CatalogView;
  onViewChange: (view: CatalogView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* The count is the listing's own statement of what it contains, and it
          is the thing the heading cannot say: "All games" is the same words at
          36 games and at 4 filtered ones. */}
      <span className="text-[13px] font-bold text-muted">
        {count} {count === 1 ? "game" : "games"}
      </span>

      <div
        role="group"
        aria-label="Order the games"
        className="flex items-center gap-0.5 rounded-full bg-surface-2 p-1"
      >
        {CATALOG_SORTS.map((option) => (
          <Segment
            key={option.value}
            active={option.value === sort}
            onClick={() => onSortChange(option.value)}
          >
            {option.label}
          </Segment>
        ))}
      </div>

      <div
        role="group"
        aria-label="Layout"
        className="flex items-center gap-0.5 rounded-full bg-surface-2 p-1"
      >
        {CATALOG_VIEWS.map((option) => (
          <Segment
            key={option.value}
            active={option.value === view}
            onClick={() => onViewChange(option.value)}
            label={`${option.label} view`}
          >
            <ViewIcon view={option.value} />
          </Segment>
        ))}
      </div>
    </div>
  );
}

/**
 * One cell of a segmented control.
 *
 * The ACTIVE cell is a raised `--surface` chip on the `--surface-2` track, which
 * is the one styling decision here worth writing down: colour alone would carry
 * it in light mode and lose it in dark, where the two greys sit much closer
 * together. The chip also picks up `--brand` for its text, so the selected cell
 * is doing it twice — a lift and a hue — and survives either theme.
 *
 * `label` names the cell for a screen reader when its content is an icon; a
 * text cell is its own label and passes nothing.
 */
function Segment({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[13px] font-extrabold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        active
          ? "bg-surface text-brand shadow-sm"
          : "text-foreground-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** 20px line icons, drawn to the same spec as the rail's. */
function ViewIcon({ view }: { view: CatalogView }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="block"
    >
      {view === "grid" ? (
        <>
          <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
        </>
      ) : (
        <>
          <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          <path d="M8 6h13M8 12h13M8 18h13" />
        </>
      )}
    </svg>
  );
}
