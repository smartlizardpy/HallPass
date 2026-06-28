"use client";

/**
 * HallPass dashboard — CHIP tag editor.
 *
 * A self-contained, form-friendly replacement for the old comma-separated tags
 * box. It owns the selected-tag list in React state and renders the current
 * selection as removable CHIPS plus a typeahead input that autocompletes from
 * `suggestions` (the catalogue's existing tags) and can also CREATE a brand-new
 * custom tag when what's typed matches nothing.
 *
 * Form integration (the load-bearing bit): the editor emits ONE hidden
 * `<input name={name}>` PER selected tag, so a surrounding server-action `<form>`
 * collects the full list via `FormData.getAll(name)` — no JSON, no joining. With
 * zero tags it emits zero inputs (an action reading `getAll` then sees `[]`).
 *
 * Tag hygiene mirrors the action layer: every value is trimmed, empties are
 * ignored, and duplicates are rejected CASE-INSENSITIVELY (first spelling wins),
 * so the chips never collide and each hidden input's value is unique.
 *
 * Accessibility: the input is an ARIA combobox over a listbox of suggestions +
 * an optional "create" row. Enter adds the highlighted option (or, with the menu
 * closed, the typed value); Up/Down move the highlight; Escape closes the menu;
 * Backspace on an EMPTY input removes the last chip. Options use `onMouseDown`
 * preventDefault so clicking one never blurs the input mid-selection.
 */

import { useId, useMemo, useRef, useState } from "react";

/**
 * Trim, drop empties, and de-duplicate CASE-INSENSITIVELY while preserving order
 * and the first-seen spelling — the canonical cleanup applied to both the initial
 * `defaultTags` and the `suggestions` pool.
 */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

type Option = { kind: "suggestion" | "create"; value: string };

export function TagEditor({
  name = "tags",
  defaultTags,
  suggestions,
}: {
  name?: string;
  defaultTags: string[];
  suggestions: string[];
}) {
  const [tags, setTags] = useState<string[]>(() => dedupe(defaultTags));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const pool = useMemo(() => dedupe(suggestions), [suggestions]);
  const selectedKeys = useMemo(
    () => new Set(tags.map((t) => t.toLowerCase())),
    [tags],
  );

  const q = query.trim().toLowerCase();

  // Suggestions still available (not already chosen) that contain the query.
  const matches = useMemo(
    () =>
      pool.filter((s) => {
        const key = s.toLowerCase();
        return !selectedKeys.has(key) && key.includes(q);
      }),
    [pool, selectedKeys, q],
  );

  // Offer "Create" only when the typed value is non-empty, isn't already a chip,
  // and doesn't exactly match a known tag (which would be addable from the list).
  const canCreate =
    q.length > 0 &&
    !selectedKeys.has(q) &&
    !pool.some((s) => s.toLowerCase() === q);

  const options: Option[] = [
    ...matches.map((value) => ({ kind: "suggestion" as const, value })),
    ...(canCreate ? [{ kind: "create" as const, value: query.trim() }] : []),
  ];
  const showMenu = open && options.length > 0;
  // Clamp the highlight into range — `options` shrinks as the user types.
  const activeIndex = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  function addTag(value: string): void {
    const trimmed = value.trim();
    setQuery("");
    setActive(0);
    setOpen(false);
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === key) ? prev : [...prev, trimmed],
    );
    inputRef.current?.focus();
  }

  function removeTag(value: string): void {
    setTags((prev) => prev.filter((t) => t !== value));
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const option = showMenu ? options[activeIndex] : undefined;
        if (option) addTag(option.value);
        else if (query.trim()) addTag(query);
        return;
      }
      case "ArrowDown": {
        if (options.length === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((i) => (Math.min(i, options.length - 1) + 1) % options.length);
        return;
      }
      case "ArrowUp": {
        if (options.length === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive(
          (i) =>
            (Math.min(i, options.length - 1) - 1 + options.length) %
            options.length,
        );
        return;
      }
      case "Backspace": {
        if (query === "" && tags.length > 0) {
          event.preventDefault();
          removeTag(tags[tags.length - 1]);
        }
        return;
      }
      case "Escape": {
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
    }
  }

  return (
    <div>
      {/* One hidden field per tag → the parent <form> reads them with getAll(name). */}
      {tags.map((tag) => (
        <input key={tag} type="hidden" name={name} value={tag} />
      ))}

      {tags.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-sm font-semibold text-brand">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-base leading-none text-brand/70 transition-colors hover:bg-brand hover:text-white"
                >
                  &times;
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
          autoComplete="off"
          placeholder="Add a tag…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
        />

        {showMenu && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            {options.map((option, i) => {
              const isActive = i === activeIndex;
              return (
                <li key={`${option.kind}:${option.value}`}>
                  <button
                    type="button"
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={isActive}
                    // Keep focus on the input so onBlur doesn't fire before the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => addTag(option.value)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                      isActive
                        ? "bg-brand-50 text-brand"
                        : "text-foreground hover:bg-surface-2"
                    }`}
                  >
                    {option.kind === "create" ? (
                      <span>
                        Create{" "}
                        <span className="font-bold">&ldquo;{option.value}&rdquo;</span>
                      </span>
                    ) : (
                      <span>{option.value}</span>
                    )}
                    {option.kind === "create" && (
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        New
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
