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

/**
 * The banner artwork. The real product ships illustrated themes, never a flat
 * fill, and a plain gradient behind the class name is the difference between
 * "a class page" and "a green rectangle with words on it". This is an original
 * abstract in the same register: a dotted field, soft arcs, and a stack of
 * books anchored right, all held at low contrast so the class name stays the
 * brightest thing in the box.
 *
 * `slice` on a 1000×240 viewBox means the art crops from the edges as the
 * banner narrows rather than squashing, which keeps the books the right shape
 * on a phone.
 */
function BannerArt(): ReactElement {
  return (
    <svg
      viewBox="0 0 1000 240"
      preserveAspectRatio="xMaxYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="hp-cr-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1aa863" />
          <stop offset="1" stopColor="#0a7b41" />
        </linearGradient>
        <pattern id="hp-cr-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.5" fill="#ffffff" opacity="0.16" />
        </pattern>
      </defs>

      <rect width="1000" height="240" fill="url(#hp-cr-field)" />
      <rect width="1000" height="240" fill="url(#hp-cr-dots)" />

      <g fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="14">
        <circle cx="742" cy="250" r="150" />
        <circle cx="742" cy="250" r="210" />
      </g>
      <circle cx="176" cy="26" r="104" fill="#ffffff" opacity="0.05" />

      <g transform="translate(712 6)">
        <rect x="16" y="168" width="204" height="24" rx="4" fill="#ffffff" opacity="0.2" />
        <rect x="26" y="174" width="8" height="12" rx="2" fill="#0a7b41" opacity="0.3" />
        <rect x="34" y="142" width="172" height="24" rx="4" fill="#f7c948" opacity="0.28" />
        <rect x="44" y="148" width="8" height="12" rx="2" fill="#0a7b41" opacity="0.25" />
        <rect x="8" y="116" width="188" height="24" rx="4" fill="#ffffff" opacity="0.12" />
        <rect x="18" y="122" width="8" height="12" rx="2" fill="#0a7b41" opacity="0.22" />
        <g transform="rotate(9 224 148)">
          <rect x="212" y="100" width="26" height="92" rx="4" fill="#ffffff" opacity="0.16" />
          <rect x="212" y="126" width="26" height="4" fill="#0a7b41" opacity="0.18" />
        </g>
      </g>
      <g stroke="#ffffff" strokeOpacity="0.13" strokeWidth="6" strokeLinecap="round">
        <path d="M846 44 L890 22" />
        <path d="M866 68 L926 38" />
      </g>
    </svg>
  );
}

/** A left-rail card: the rounded, hairline-bordered box the whole product uses. */
function RailCard({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="rounded-lg border border-[#dadce0] bg-white p-4">{children}</div>
  );
}

/** The square-with-arrow the product puts beside a class code to enlarge it. */
function ExpandIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill={ICON}>
      <path d="M5 5h6v2H7v4H5V5zm14 0v6h-2V7h-4V5h6zM5 13h2v4h4v2H5v-6zm12 0h2v6h-6v-2h4v-4z" />
    </svg>
  );
}

/**
 * The left rail. These three cards are the furniture a student's eye expects
 * down that side, and a bare "Upcoming" box with nothing under it looks like a
 * page still loading — which invites the second look the disguise exists to
 * avoid.
 */
function LeftRail(): ReactElement {
  return (
    <div className="space-y-4">
      <RailCard>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[14px] text-[#3c4043]">Class code</div>
            <div className="mt-1 text-[20px] tracking-[0.02em] text-[#1e8e3e]">q7mp4vd</div>
          </div>
          <ExpandIcon />
        </div>
        <div className="mt-4 border-t border-[#e8eaed] pt-3">
          <div className="text-[14px] text-[#3c4043]">Meet</div>
          <div className="mt-2 flex items-center gap-3">
            <span className="rounded border border-[#dadce0] px-4 py-1.5 text-[13px] font-medium text-[#1e8e3e]">
              Join
            </span>
            <span className="text-[12px] text-[#5f6368]">Link visible to students</span>
          </div>
        </div>
      </RailCard>

      <RailCard>
        <div className="text-[14px] text-[#3c4043]">Upcoming</div>
        <div className="mt-3 text-[13px] text-[#5f6368]">Due Friday, 11:59 PM</div>
        <div className="mt-1 text-[13px] leading-[1.4] text-[#3c4043]">
          Reading response — Chapter 7
        </div>
        <div className="mt-3 text-right text-[13px] font-medium text-[#1967d2]">View all</div>
      </RailCard>
    </div>
  );
}

function MoreIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill={ICON}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function SendIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="#bdc1c6">
      <path d="M2.5 20.5v-6.2l9-2.3-9-2.3V3.5L21.5 12z" />
    </svg>
  );
}

/** The clipboard that marks a post as coursework rather than an announcement. */
function ClipboardIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <rect x="5.5" y="5" width="13" height="15.5" rx="2" fill="#ffffff" />
      <rect
        x="9"
        y="2.8"
        width="6"
        height="3.6"
        rx="1.4"
        fill="#ffffff"
        stroke="#1e8e3e"
        strokeWidth="1.4"
      />
      <g fill="#1e8e3e">
        <rect x="8.2" y="10.6" width="7.6" height="1.5" rx="0.75" />
        <rect x="8.2" y="14" width="5.4" height="1.5" rx="0.75" />
      </g>
    </svg>
  );
}

/** The rounded, hairline-bordered box every card in the stream shares. */
function StreamCard({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="rounded-lg border border-[#dadce0] bg-white px-4 py-4">{children}</div>
  );
}

/**
 * The footer every post carries. It is a small row and easy to leave off, but a
 * card that simply stops after its body reads as a notification, not a post —
 * the comment affordance is what makes the stream look like something students
 * write into.
 */
function CommentRow({ count }: { count?: number }): ReactElement {
  return (
    <div className="mt-4 border-t border-[#e8eaed] pt-3">
      {count ? (
        <div className="mb-3 text-[13px] font-medium text-[#3c4043]">
          {count} class {count === 1 ? "comment" : "comments"}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Avatar initial="T" size={28} color="#1a73e8" />
        <span className="text-[13px] text-[#5f6368]">Add class comment</span>
        <span className="ml-auto">
          <SendIcon />
        </span>
      </div>
    </div>
  );
}

/** Every post the stream renders. Invented copy — generic classwork, no vendor text. */
type Post =
  | { kind: "announcement"; who: string; when: string; body: string; comments?: number }
  | { kind: "assignment"; who: string; when: string; title: string; due: string };

const STREAM: readonly Post[] = [
  {
    kind: "announcement",
    who: "Ms. Aldridge",
    when: "2:14 PM",
    body: "Reminder: the reading response for Chapter 7 is due Friday night. Post your questions here if anything in the chapter is unclear and I will answer before Thursday's lesson.",
    comments: 2,
  },
  {
    kind: "assignment",
    who: "Ms. Aldridge",
    when: "1:05 PM",
    title: "Reading response — Chapter 7",
    due: "Due Friday",
  },
  {
    kind: "announcement",
    who: "Ms. Aldridge",
    when: "Yesterday",
    body: "Good discussion today, everyone. The slides from the lesson are attached under Classwork if you want to review the timeline before you write.",
  },
];

function AnnouncementCard({ post }: { post: Extract<Post, { kind: "announcement" }> }) {
  return (
    <StreamCard>
      <div className="flex items-start gap-3">
        <Avatar initial="A" size={40} color="#0F9D58" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-tight text-[#3c4043]">{post.who}</div>
          <div className="mt-0.5 text-[12px] text-[#5f6368]">{post.when}</div>
        </div>
        <MoreIcon />
      </div>
      <p className="mt-3 text-[14px] leading-[1.5] text-[#3c4043]">{post.body}</p>
      <CommentRow count={post.comments} />
    </StreamCard>
  );
}

/**
 * The coursework variant. A stream of nothing but plain announcements is the
 * quiet tell: real classes are mostly assignments, and the circular clipboard
 * with a due date beside it is the shape a teacher recognises without reading.
 */
function AssignmentCard({ post }: { post: Extract<Post, { kind: "assignment" }> }) {
  return (
    <StreamCard>
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#1e8e3e" }}
        >
          <ClipboardIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-[1.45] text-[#3c4043]">
            {post.who} posted a new assignment: {post.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[#5f6368]">
            <span>{post.when}</span>
            <span aria-hidden>·</span>
            <span>{post.due}</span>
          </div>
        </div>
        <MoreIcon />
      </div>
      <CommentRow />
    </StreamCard>
  );
}

/** The composer that sits above the stream — the row a student types into. */
function Composer(): ReactElement {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-[#dadce0] bg-white px-4 py-4">
      <Avatar initial="T" size={40} color="#1a73e8" />
      <span className="text-[14px] text-[#5f6368]">Announce something to your class</span>
    </div>
  );
}

export function ClassroomScreen() {
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
        <div className="relative h-[240px] overflow-hidden rounded-lg text-white">
          <BannerArt />
          <div className="absolute bottom-6 left-6 right-6">
            <div className="text-[38px] leading-tight font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
              English — Period 4
            </div>
            <div className="mt-1 text-[16px] opacity-95">Section B · Room 214</div>
          </div>
        </div>

        <div className="mt-5 flex gap-6">
          <aside className="hidden w-[260px] shrink-0 sm:block">
            <LeftRail />
          </aside>

          <div className="min-w-0 flex-1 space-y-4">
            <Composer />
            {STREAM.map((post, i) =>
              post.kind === "assignment" ? (
                <AssignmentCard key={i} post={post} />
              ) : (
                <AnnouncementCard key={i} post={post} />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
