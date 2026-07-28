"use client";

import { useState } from "react";

/**
 * A read-only code block with a one-click Copy button, collapsed by default.
 *
 * Client-only for one reason: the clipboard. Everything else — the code string,
 * the label — is computed on the server and handed down as props, so no game
 * source or SDK stub is bundled into the page's JavaScript.
 *
 * Collapsed behind a `<details>` because a game's `index.html` can be tens of
 * kilobytes and this panel is not the main event; the summary shows the size so
 * an admin knows what they are about to expand. The textarea is genuinely
 * read-only (`readOnly`, not `disabled`) so its text stays selectable and the
 * native select-all still works for anyone who does not trust the button.
 */
export function CopyBox({
  label,
  code,
  language = "html",
  defaultOpen = false,
  note,
}: {
  label: string;
  code: string;
  language?: string;
  defaultOpen?: boolean;
  note?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      // Reset the label after a moment; the check is confirmation, not a mode.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context, denied permission). The textarea is
      // selectable, so the fallback is manual select-all + copy — never an error.
      setCopied(false);
    }
  };

  const sizeKb = (new Blob([code]).size / 1024).toFixed(1);

  return (
    <details open={defaultOpen} className="rounded-xl border border-border bg-surface-2">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-zinc-900">
        <span>
          {label}{" "}
          <span className="font-mono text-xs font-normal text-muted">{sizeKb} KB</span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            // Copy without toggling the disclosure open/closed.
            e.preventDefault();
            void copy();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void copy();
            }
          }}
          className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-xs font-extrabold text-white transition hover:bg-brand-600"
        >
          {copied ? "Copied ✓" : "Copy"}
        </span>
      </summary>

      <div className="border-t border-border p-3">
        {note && <p className="mb-2 px-1 text-xs text-muted">{note}</p>}
        <textarea
          readOnly
          value={code}
          spellCheck={false}
          rows={12}
          aria-label={`${label} (${language})`}
          onFocus={(e) => e.currentTarget.select()}
          className="block w-full resize-y rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-900 outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
    </details>
  );
}
