"use client";

/**
 * First-run walkthrough for the test session screen.
 *
 * Deliberately the SAME modal as `FeaturePromo` — backdrop, rounded-3xl panel,
 * wordmark and badge, title, body, bullet points, a primary action and a quiet
 * one. A tester meets that shape the first time they sign in; meeting it again
 * here means the site has one way of saying "here is something new", not two.
 *
 * WHY IT IS STEPPED RATHER THAN ONE LONG PANEL. The session screen does four
 * separate things — report, capture, screenshot, review — and a single modal
 * listing all of them is a wall of text nobody reads to the end. Four small
 * steps get read, and the step counter tells you it is nearly over.
 *
 * WHY IT IS NOT A `<dialog>`. Same reason `FeaturePromo` is not: `showModal()`
 * promotes to the browser's top layer, above every z-index on the page,
 * including a running game. The focus trap, Esc handling and scroll lock that
 * `<dialog>` would have given for free are hand-rolled below.
 *
 * DISMISSAL IS PER PLAYER. A shared school computer would otherwise let the
 * first tester's "got it" hide the tutorial from everyone else who signs in on
 * that machine. The HUD keeps a `?` button so it can always be reopened —
 * a tutorial you cannot get back is worse than one you never saw.
 */

import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/app/components/Wordmark";

const STORAGE_PREFIX = "hp:beta-tutorial:";

export function tutorialSeen(playerId: string): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${playerId}`) === "1";
  } catch {
    // Storage blocked (private mode). Treat as SEEN: a tutorial that cannot
    // remember being dismissed would reappear on every navigation, which is far
    // more annoying than never seeing it.
    return true;
  }
}

function rememberSeen(playerId: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${playerId}`, "1");
  } catch {
    /* best effort */
  }
}

type Step = {
  badge: string;
  title: string;
  body: string;
  points: { icon: string; text: string }[];
};

const STEPS: Step[] = [
  {
    badge: "1 of 4",
    title: "This is a playtest",
    body: "Play the game like you normally would. When something goes wrong, tell us — that is the whole job.",
    points: [
      { icon: "🎮", text: "The game runs right here, full size" },
      { icon: "🐛", text: "Report bugs and ideas without leaving" },
      { icon: "⭐", text: "Accepted reports earn you XP" },
    ],
  },
  {
    badge: "2 of 4",
    title: "Hit the shortcut the moment it breaks",
    body: "Ctrl/⌘ + Shift + B freezes what you are looking at and opens a report, so you can describe it while it is still on screen.",
    points: [
      { icon: "⏸", text: "Freezes the moment over the game" },
      { icon: "⌨️", text: "Or use the Report bug button" },
      { icon: "💡", text: "Got an idea instead? Use Idea" },
    ],
  },
  {
    badge: "3 of 4",
    title: "We collect the boring parts",
    body: "You describe what happened. Everything technical is gathered for you and shown before you send.",
    points: [
      { icon: "⚠️", text: "The game's own error messages, always" },
      { icon: "📹", text: "The last few seconds of play, if capture is on" },
      { icon: "📸", text: "Screenshots you can pin to the report" },
    ],
  },
  {
    badge: "4 of 4",
    title: "Turn on auto-screenshot",
    body: "One tap, pick this tab, and the session quietly grabs good-looking moments. Only the game is ever captured — never these buttons.",
    points: [
      { icon: "🖼", text: "Your best shots can end up on the game's page" },
      { icon: "🔒", text: "We check you picked a tab, not your screen" },
      { icon: "✍️", text: "Leave a review at the end to finish the test" },
    ],
  },
];

export function SessionTutorial({
  playerId,
  open,
  onClose,
}: {
  playerId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc, scroll lock and initial focus — the parts `<dialog>` would have
  // handled. The previous overflow is restored rather than cleared, so this
  // cannot stomp on a lock another component set.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reopening from the `?` button should start at the beginning.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = () => {
    rememberSeen(playerId);
    onClose();
  };

  /** Keep Tab inside the panel while it is open. */
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="promo-backdrop fixed inset-0 z-[95] flex items-end justify-center bg-zinc-900/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={finish}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDownTrap}
        className="promo-panel relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={finish}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="pointer-events-none"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        {/* Flex ROW, not two inline elements — `Wordmark` is an inline-flex
            span, so a bare inline-block pill beside it shares the line box and
            drags itself over the logo. `pr-10` clears the close button. */}
        <div className="flex items-center gap-2.5 pr-10">
          <Wordmark />
          <span className="rounded-full bg-brand px-2.5 py-1 text-[10px] font-black uppercase leading-none tracking-wider text-white">
            {current.badge}
          </span>
        </div>

        <h2
          id="tutorial-title"
          className="mt-4 text-2xl font-black leading-tight tracking-tight text-zinc-900"
        >
          {current.title}
        </h2>
        <p
          id="tutorial-body"
          className="mt-2 text-[15px] font-semibold leading-relaxed text-muted"
        >
          {current.body}
        </p>

        <ul className="mt-5 space-y-2">
          {current.points.map((point) => (
            <li
              key={point.text}
              className="flex items-center gap-2.5 text-[14px] font-bold text-zinc-700"
            >
              <span aria-hidden className="text-base">
                {point.icon}
              </span>
              {point.text}
            </li>
          ))}
        </ul>

        {/* Progress pips. Decorative — the badge already states the step in
            words, which is what a screen reader gets. */}
        <div aria-hidden className="mt-6 flex justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s.badge}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-5 bg-brand" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            className="rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600"
          >
            {isLast ? "Start testing" : "Next"}
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="text-sm font-bold text-muted transition hover:text-zinc-900"
            >
              Back
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              onClick={finish}
              className="ml-auto text-sm font-bold text-muted transition hover:text-zinc-900"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
