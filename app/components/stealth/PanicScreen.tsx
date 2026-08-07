"use client";

/**
 * HallPass — the PANIC screen: a full-viewport disguise the boss key throws up
 * over the arcade in one keystroke, so a glance over the shoulder sees homework.
 *
 * These are ORIGINAL, asset-free recreations — hand-built markup and generic
 * placeholder text, no third-party logos or copyrighted copy — that read as the
 * real thing at a passing glance, which is all a panic screen needs. They are
 * purely presentational; {@link file://./StealthController.tsx} owns when they
 * mount and every way they dismiss (the panic key, Escape, or the discreet
 * corner tap target for touch devices with no keyboard).
 *
 * The root deliberately opts OUT of the site's Nunito font — real Google surfaces
 * are Arial/Roboto, and the arcade's rounded display font would give the game away.
 */

import type { ReactElement } from "react";
import type { PanicScreenId } from "../../lib/stealth/config";

const SANS = "Arial, Roboto, Helvetica, sans-serif";

/** A near-invisible 44px corner target so touch users can dismiss without a key. */
function DismissDot({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Return to HALLPASS"
      className="fixed bottom-0 right-0 z-10 h-11 w-11 cursor-default opacity-0"
    />
  );
}

/* ============================ Google Docs ============================ */

function DocsScreen() {
  return (
    <div className="flex min-h-full flex-col bg-[#f9fbfd] text-[#202124]">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 pt-3">
        <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 2h8l4 4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#4285F4" />
          <path d="M14 2l4 4h-4z" fill="#A1C2FA" />
          <g fill="#fff">
            <rect x="8" y="9" width="8" height="1.4" rx=".7" />
            <rect x="8" y="12" width="8" height="1.4" rx=".7" />
            <rect x="8" y="15" width="5" height="1.4" rx=".7" />
          </g>
        </svg>
        <div className="flex flex-col">
          <span className="text-[18px] leading-tight">Untitled document</span>
          <div className="flex gap-4 text-[13px] text-[#5f6368]">
            {["File", "Edit", "View", "Insert", "Format", "Tools", "Help"].map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mx-4 mt-2 flex items-center gap-4 rounded-full bg-[#edf2fa] px-4 py-1.5 text-[15px] text-[#444746]">
        <span>↶</span>
        <span>↷</span>
        <span>🖶</span>
        <span className="text-[13px]">100%</span>
        <span className="ml-2 border-l border-[#c4c7c5] pl-4 font-serif">Normal text</span>
        <span className="ml-2 border-l border-[#c4c7c5] pl-4 font-bold">B</span>
        <span className="italic">I</span>
        <span className="underline">U</span>
      </div>

      {/* Page */}
      <div className="flex flex-1 justify-center overflow-auto py-6">
        <div
          className="w-full max-w-[720px] bg-white px-[72px] py-[84px] shadow-[0_1px_3px_rgba(60,64,67,.3)]"
          style={{ fontFamily: SANS }}
        >
          <h1 className="mb-4 text-[20pt] font-normal">The Causes of the First World War</h1>
          <p className="mb-3 text-[11pt] leading-[1.6] text-[#202124]">
            The outbreak of war in 1914 was the product of long-building tensions rather
            than any single event. Historians point to four intertwined pressures:
            militarism, the alliance system, imperial rivalry, and a surge of nationalism
            across the continent.
          </p>
          <p className="text-[11pt] leading-[1.6] text-[#202124]">
            This essay argues that while the assassination in Sarajevo was the immediate
            trigger, it was the rigidity of the alliance networks that turned a regional
            dispute into a general war<span className="animate-pulse motion-reduce:animate-none">|</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ========================== Google Classroom ========================== */

function ClassroomScreen() {
  const stream = [
    { who: "Ms. Aldridge", when: "Posted 2:14 PM", body: "Reminder: reading response for Chapter 7 is due Friday. Submit through the assignment below." },
    { who: "Ms. Aldridge", when: "Yesterday", body: "Great discussion today, everyone. Slides from the lesson are attached to the class materials." },
  ];
  return (
    <div className="min-h-full bg-[#f5f5f5]" style={{ fontFamily: SANS }}>
      {/* Top app bar */}
      <div className="flex items-center gap-4 bg-white px-5 py-3 shadow-sm">
        <span className="text-[22px] text-[#5f6368]">☰</span>
        <span className="text-[22px] text-[#5f6368]">Classroom</span>
        <span className="ml-auto text-[22px] text-[#5f6368]">▦</span>
      </div>

      {/* Class banner */}
      <div className="mx-auto mt-6 max-w-[1000px] px-4">
        <div className="relative h-[240px] overflow-hidden rounded-lg bg-gradient-to-br from-[#0F9D58] to-[#0b8043] p-6 text-white">
          <div className="absolute bottom-5 left-6">
            <div className="text-[34px] font-medium">English — Period 4</div>
            <div className="text-[16px] opacity-90">Section B · Room 214</div>
          </div>
        </div>

        <div className="mt-5 flex gap-5">
          <aside className="hidden w-[260px] shrink-0 sm:block">
            <div className="rounded-lg border border-[#e0e0e0] bg-white p-4">
              <div className="text-[14px] font-medium text-[#3c4043]">Upcoming</div>
              <div className="mt-2 text-[13px] text-[#5f6368]">Due Friday</div>
              <div className="text-[13px] text-[#1967d2]">Reading response — Ch. 7</div>
            </div>
          </aside>

          <div className="flex-1 space-y-4">
            {stream.map((post, i) => (
              <div key={i} className="rounded-lg border border-[#e0e0e0] bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F9D58] text-[16px] font-medium text-white">
                    A
                  </div>
                  <div>
                    <div className="text-[14px] text-[#3c4043]">{post.who}</div>
                    <div className="text-[12px] text-[#5f6368]">{post.when}</div>
                  </div>
                </div>
                <p className="mt-3 text-[14px] leading-[1.5] text-[#3c4043]">{post.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================== Google Search =========================== */

const GOOGLE_LETTERS: Array<[string, string]> = [
  ["G", "#4285F4"],
  ["o", "#EA4335"],
  ["o", "#FBBC05"],
  ["g", "#4285F4"],
  ["l", "#0F9D58"],
  ["e", "#EA4335"],
];

function SearchScreen() {
  const results = [
    {
      url: "https://www.britannica.com › science › photosynthesis",
      title: "Photosynthesis | Definition, Formula, Process & Facts",
      snippet:
        "Photosynthesis, the process by which green plants and certain other organisms transform light energy into chemical energy stored in glucose.",
    },
    {
      url: "https://en.wikipedia.org › wiki › Photosynthesis",
      title: "Photosynthesis - Wikipedia",
      snippet:
        "Photosynthesis is a system of biological processes by which photosynthetic organisms, such as most plants, algae, and cyanobacteria, convert light energy.",
    },
    {
      url: "https://www.nationalgeographic.org › encyclopedia › photosynthesis",
      title: "Photosynthesis - Education | National Geographic",
      snippet:
        "Most life on Earth depends on photosynthesis. The process is carried out by plants, algae, and some types of bacteria, which capture energy from sunlight.",
    },
  ];
  return (
    <div className="min-h-full bg-white" style={{ fontFamily: SANS }}>
      {/* Header row: logo + search box */}
      <div className="flex items-center gap-6 border-b border-[#ebebeb] px-6 py-4">
        <div className="text-[26px] font-medium tracking-tight">
          {GOOGLE_LETTERS.map(([ch, color], i) => (
            <span key={i} style={{ color }}>
              {ch}
            </span>
          ))}
        </div>
        <div className="flex max-w-[560px] flex-1 items-center gap-3 rounded-full border border-[#dfe1e5] px-5 py-2.5 shadow-[0_1px_6px_rgba(32,33,36,.12)]">
          <span className="text-[15px] text-[#202124]">photosynthesis definition</span>
          <span className="ml-auto text-[18px] text-[#4285F4]">🔍</span>
        </div>
      </div>

      {/* Result stats */}
      <div className="px-6 pt-4 text-[13px] text-[#70757a] sm:pl-[180px]">
        About 84,900,000 results (0.42 seconds)
      </div>

      {/* Results */}
      <div className="max-w-[640px] px-6 py-2 sm:pl-[180px]">
        {results.map((r, i) => (
          <div key={i} className="mb-7">
            <div className="text-[13px] text-[#202124]">{r.url}</div>
            <a className="text-[20px] leading-tight text-[#1a0dab] hover:underline">{r.title}</a>
            <p className="mt-1 text-[14px] leading-[1.58] text-[#4d5156]">{r.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== Wrapper ============================== */

const SCREENS: Record<PanicScreenId, () => ReactElement> = {
  docs: DocsScreen,
  classroom: ClassroomScreen,
  search: SearchScreen,
};

/**
 * The panic overlay. `fixed inset-0` at the top of the stacking order so it
 * covers everything — the arcade, the player overlay, modals — completely.
 */
export function PanicScreen({
  screen,
  onDismiss,
}: {
  screen: PanicScreenId;
  onDismiss: () => void;
}) {
  const Screen = SCREENS[screen] ?? DocsScreen;
  return (
    <div className="fixed inset-0 z-[2147483647] overflow-auto bg-white" role="presentation">
      <Screen />
      <DismissDot onDismiss={onDismiss} />
    </div>
  );
}
