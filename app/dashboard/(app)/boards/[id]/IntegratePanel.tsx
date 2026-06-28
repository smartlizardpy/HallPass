"use client";

/**
 * "Integrate with an AI agent" surface for a board.
 *
 * Renders the per-board, copy-paste prompt (built server-side by
 * `buildIntegrationPrompt`) two ways from one piece of text:
 *   - a PERMANENT panel on the board detail page, always available to re-copy;
 *   - a one-time celebratory MODAL that auto-opens right after a board is created
 *     (`celebrate` — driven by `?created=1` on the create redirect), so the very
 *     next thing an admin sees is "leaderboard ready → copy this for your AI".
 *
 * Client-only because it owns copy-to-clipboard feedback and the modal's
 * open/Esc/backdrop state; the prompt itself is inert text passed in as a prop.
 */

import { useEffect, useRef, useState } from "react";

export function IntegratePanel({
  prompt,
  celebrate = false,
}: {
  prompt: string;
  celebrate?: boolean;
}) {
  const [showModal, setShowModal] = useState(celebrate);

  // While the modal is open: Esc closes it and the page behind it can't scroll.
  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShowModal(false);
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showModal]);

  return (
    <>
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Integrate with an AI agent</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Copy this prompt and paste it into your AI agent (Gemini Canvas,
              Claude Artifacts, …) with your game open. It interviews you, then
              wires this leaderboard into your game&apos;s HTML.
            </p>
          </div>
          <CopyButton prompt={prompt} />
        </div>
        <PromptBox prompt={prompt} className="mt-4" />
      </section>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Leaderboard ready"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setShowModal(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black tracking-tight text-foreground">
                  🎉 Leaderboard ready
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Copy this prompt and paste it into your AI agent (with your game
                  open in Canvas) to add the leaderboard.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <PromptBox prompt={prompt} className="mt-4 min-h-0 flex-1" />

            <div className="mt-4 flex items-center justify-end gap-2">
              <CopyButton prompt={prompt} />
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 transition hover:bg-surface-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A copy-to-clipboard button with transient "Copied!" feedback. */
function CopyButton({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard API can be unavailable (insecure context / denied permission);
      // fall back to a hidden textarea + execCommand so copy still works.
      try {
        const ta = document.createElement("textarea");
        ta.value = prompt;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        return;
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white transition hover:bg-brand-600"
    >
      {copied ? "Copied!" : "Copy prompt"}
    </button>
  );
}

/** Read-only, scrollable rendering of the prompt text. */
function PromptBox({ prompt, className = "" }: { prompt: string; className?: string }) {
  return (
    <pre className={`max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-4 font-mono text-xs leading-relaxed text-foreground ${className}`}>
      {prompt}
    </pre>
  );
}
