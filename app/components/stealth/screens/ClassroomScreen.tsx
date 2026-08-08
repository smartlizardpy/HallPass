/**
 * HallPass — the Google Classroom panic disguise.
 *
 * An original, asset-free recreation: hand-built markup and invented class
 * content, no third-party logos or copied copy. It only has to survive a glance
 * over the shoulder, which is all a panic screen ever needs.
 *
 * Every icon here is drawn as inline SVG rather than typed as a glyph (`☰`,
 * `▦`). A typed symbol inherits the text stroke weight and optical size, so it
 * lands heavier and larger than the 24px Material icon it stands in for, and a
 * bar of subtly wrong icons is what a passer-by notices before they read a word
 * of the page. Drawing them costs a few lines and removes the tell entirely.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import type { ReactElement } from "react";
import { AppsGrid, Avatar, SANS } from "./chrome";

/** Icon grey, the one colour every glyph in the app bar shares. */
const ICON = "#5f6368";

/** The tabs a student sees on a class page, in the product's order. */
const TABS = ["Stream", "Classwork", "People", "Grades"] as const;

function MenuIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill={ICON}>
      <rect x="3" y="6" width="18" height="2" rx="1" />
      <rect x="3" y="11" width="18" height="2" rx="1" />
      <rect x="3" y="16" width="18" height="2" rx="1" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill={ICON}>
      <rect x="11" y="4" width="2" height="16" rx="1" />
      <rect x="4" y="11" width="16" height="2" rx="1" />
    </svg>
  );
}

/**
 * The product mark: a green board with a figure at it. An approximation of the
 * shape language, not a copy — the silhouette is what carries at a glance, and
 * the real mark is nobody's to ship.
 */
function ClassroomMark(): ReactElement {
  return (
    <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden>
      <rect x="3" y="6" width="34" height="28" rx="3" fill="#0F9D58" />
      <rect x="8" y="11" width="24" height="18" rx="1.5" fill="#fff" />
      <circle cx="20" cy="18" r="3.2" fill="#0F9D58" />
      <path d="M13.8 27.5c0-2.9 2.8-4.8 6.2-4.8s6.2 1.9 6.2 4.8z" fill="#0F9D58" />
      <rect x="3" y="30" width="34" height="4" rx="1" fill="#0b8043" />
    </svg>
  );
}

/**
 * The class tab row. Every class page in the real product carries it, so its
 * absence is one of the loudest tells the disguise can have — a green-underlined
 * "Stream" is the single detail that says "a class is open" from across a room.
 * It scrolls horizontally rather than wrapping, because a second row of tabs on
 * a phone would look like nothing the product has ever shipped.
 */
function TabRow(): ReactElement {
  return (
    <nav
      className="flex overflow-x-auto border-b border-[#dadce0] bg-white px-2 sm:px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-hidden
    >
      {TABS.map((tab) => {
        const active = tab === "Stream";
        return (
          <span
            key={tab}
            className="shrink-0 border-b-[3px] px-4 py-4 text-[14px] font-medium tracking-[0.01em]"
            style={{
              color: active ? "#1e8e3e" : ICON,
              borderColor: active ? "#1e8e3e" : "transparent",
            }}
          >
            {tab}
          </span>
        );
      })}
    </nav>
  );
}

export function ClassroomScreen() {
  const stream = [
    {
      who: "Ms. Aldridge",
      when: "Posted 2:14 PM",
      body: "Reminder: reading response for Chapter 7 is due Friday. Submit through the assignment below.",
    },
    {
      who: "Ms. Aldridge",
      when: "Yesterday",
      body: "Great discussion today, everyone. Slides from the lesson are attached to the class materials.",
    },
  ];
  return (
    <div className="min-h-full bg-[#f5f5f5]" style={{ fontFamily: SANS }}>
      {/* Top app bar */}
      <header className="flex h-16 items-center gap-4 bg-white px-4">
        <MenuIcon />
        <div className="flex items-center gap-2">
          <ClassroomMark />
          <span className="text-[22px] leading-none text-[#5f6368]">Classroom</span>
        </div>
        <div className="ml-auto flex items-center gap-3 sm:gap-5">
          <PlusIcon />
          <AppsGrid />
          <Avatar initial="T" size={32} color="#1a73e8" />
        </div>
      </header>
      <TabRow />

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
