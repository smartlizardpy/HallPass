"use client";

import { copy } from "@/app/lib/boardpass/copy";
import { isFiltering, NO_FILTER, type CategoryCount, type LibraryFilter } from "./board-filter";

/**
 * Category chips, search and Clear. Search opens the same on-screen keyboard panel
 * the sign-in uses, so a board with no hardware keyboard can still search. The
 * field itself still takes physical typing; it is `inputmode="none"` only while
 * the panel is open, so the OS touch keyboard doesn't open on top of ours.
 */
export function LibraryControls({
  categories,
  filter,
  onChange,
  keyboardOpen,
  onToggleKeyboard,
}: {
  categories: CategoryCount[];
  filter: LibraryFilter;
  onChange: (next: LibraryFilter) => void;
  keyboardOpen: boolean;
  onToggleKeyboard: () => void;
}) {
  const total = categories.reduce((n, c) => n + c.count, 0);
  return (
    <div className="bp-controls">
      <div className="bp-chips" role="group" aria-label={copy.filterGroup}>
        <button type="button" className="bp-chip" aria-pressed={filter.category === null} onClick={() => onChange({ ...filter, category: null })}>
          {copy.allCategories} <small>{total}</small>
        </button>
        {categories.map((c) => (
          <button
            key={c.category}
            type="button"
            className="bp-chip"
            aria-pressed={filter.category === c.category}
            onClick={() => onChange({ ...filter, category: filter.category === c.category ? null : c.category })}
          >
            {c.category} <small>{c.count}</small>
          </button>
        ))}
      </div>
      {isFiltering(filter) && (
        <button type="button" className="bp-btn" onClick={() => onChange(NO_FILTER)}>
          {copy.clearFilters}
        </button>
      )}
      <div className="bp-search">
        <input
          type="search"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value.slice(0, 40) })}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          inputMode={keyboardOpen ? "none" : undefined}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" onClick={onToggleKeyboard} aria-label={keyboardOpen ? copy.hideKeyboard : copy.showKeyboard} aria-pressed={keyboardOpen}>
          ⌨
        </button>
      </div>
    </div>
  );
}
