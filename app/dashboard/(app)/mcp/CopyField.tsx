"use client";

import { useState } from "react";

/**
 * A one-line read-only value with a Copy button.
 *
 * A sibling of `games/[slug]/_ui/CopyBox`, and client-only for the same single
 * reason: the clipboard. The value itself is computed on the server and handed
 * down as a prop.
 *
 * Smaller than `CopyBox` because what it holds is different. That one wraps
 * kilobytes of game source in a `<details>` with a textarea, because nobody
 * reads it. This holds ONE short string somebody is about to paste into another
 * app's settings screen, so it is always visible and always selectable — a URL
 * hidden behind a disclosure is a URL somebody retypes by hand and gets wrong.
 *
 * `readOnly`, not `disabled`, so the text stays selectable and the native
 * select-all still works for anyone the button fails for — and it does fail, on
 * an insecure context or with clipboard permission denied, which is why that
 * path is silent rather than an error.
 */
export function CopyField({
  value,
  label,
  mono = true,
}: {
  value: string;
  /** Accessible name. Rendered above the field when `showLabel`. */
  label: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        className={`min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand/30 ${
          mono ? "font-mono" : ""
        }`}
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 rounded-full bg-brand px-4 py-2 text-xs font-extrabold text-white transition hover:bg-brand-600"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
