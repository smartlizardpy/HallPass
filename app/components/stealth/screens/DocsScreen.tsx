/**
 * HallPass — the Google Docs panic disguise.
 *
 * An original, asset-free recreation: hand-built markup, hand-drawn glyphs and
 * generic placeholder homework — no third-party logos, icon fonts or copied
 * copy. What it has to survive is a glance from a few feet away, and at that
 * distance the giveaway is never the wording. It is weight, spacing and colour.
 *
 * Which is why the toolbar below is inline SVG on one 24px grid at one stroke
 * weight rather than the Unicode lookalikes it replaces: `↶` and `🖶` land in
 * whatever weight the system font happens to have, and the pictographic ones
 * render in full colour on most platforms. A row of mismatched, half-emoji
 * symbols reads as "not an office app" from across a room even when every label
 * beside it is right.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import type { ReactElement, ReactNode } from "react";
import { Avatar, SANS } from "./chrome";

/* ------------------------------ iconography ------------------------------ */

/**
 * Every toolbar glyph shares this frame: one 24px grid, one 1.7px stroke, round
 * joins. Consistency between the icons matters far more than the fidelity of any
 * single one — the eye reads the row as a texture, and a single heavier or
 * squarer glyph is what makes the whole strip look hand-made.
 */
function Glyph({
  children,
  size = 20,
  className = "",
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const Undo = () => (
  <Glyph>
    <path d="M9 5.5 4.5 10 9 14.5" />
    <path d="M4.5 10h9a4.5 4.5 0 0 1 0 9H9" />
  </Glyph>
);

const Redo = () => (
  <Glyph>
    <path d="M15 5.5 19.5 10 15 14.5" />
    <path d="M19.5 10h-9a4.5 4.5 0 0 0 0 9h4.5" />
  </Glyph>
);

const Print = () => (
  <Glyph>
    <path d="M7 9V4h10v5" />
    <path d="M7 15H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 13h10v7H7z" />
  </Glyph>
);

const SpellCheck = () => (
  <Glyph>
    <path d="M3 16.5 6.75 7.5l3.75 9" />
    <path d="M4.5 13.5h4.5" />
    <path d="M13 13.5 16 16.5 21.2 10.5" />
  </Glyph>
);

const PaintFormat = () => (
  <Glyph>
    <path d="M4.5 4.5h9v4h-9z" />
    <path d="M13.5 6.5h4A1.5 1.5 0 0 1 19 8v2a1.5 1.5 0 0 1-1.5 1.5H13a1 1 0 0 0-1 1v1" />
    <path d="M10.25 14.5h3.5V20h-3.5z" />
  </Glyph>
);

/** The letter-A icons: a hand-drawn A over a colour bar (text colour, highlight). */
function BarredA({ bar }: { bar: string }): ReactElement {
  return (
    <Glyph>
      <path d="M6.5 15 12 5l5.5 10" />
      <path d="M8.6 12.2h6.8" />
      <rect x="4" y="17.5" width="16" height="3.2" rx="0.8" fill={bar} stroke="none" />
    </Glyph>
  );
}

const Highlight = () => (
  <Glyph>
    <path d="M9.5 14.8 15.3 9l2.9 2.9-5.8 5.8H9.5z" />
    <path d="m14.2 7.9 1.1-1.1a1.4 1.4 0 0 1 2 0l.9.9a1.4 1.4 0 0 1 0 2l-1.1 1.1" />
    <rect x="4" y="17.5" width="16" height="3.2" rx="0.8" fill="#fdd633" stroke="none" />
  </Glyph>
);

const Link = () => (
  <Glyph>
    <path d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
    <path d="M13.5 10.5a3.6 3.6 0 0 0-5.1 0L6 12.9a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
  </Glyph>
);

const Comment = ({ plus = false }: { plus?: boolean }) => (
  <Glyph>
    <path d="M19.5 15.5A1.5 1.5 0 0 1 18 17H8.5L5 20V6.5A1.5 1.5 0 0 1 6.5 5H18a1.5 1.5 0 0 1 1.5 1.5z" />
    {plus ? (
      <>
        <path d="M9.75 11h5" />
        <path d="M12.25 8.5v5" />
      </>
    ) : null}
  </Glyph>
);

const InsertImage = () => (
  <Glyph>
    <rect x="4" y="5.5" width="16" height="13" rx="1.2" />
    <circle cx="8.6" cy="9.8" r="1.4" />
    <path d="m4.5 17 5-5.5 3.5 3.5 3-2.5 3.5 4" />
  </Glyph>
);

const AlignLeft = () => (
  <Glyph>
    <path d="M4 6h16" />
    <path d="M4 10.5h10" />
    <path d="M4 15h16" />
    <path d="M4 19.5h10" />
  </Glyph>
);

const LineSpacing = () => (
  <Glyph>
    <path d="M5 8 7.5 5.5 10 8" />
    <path d="M5 16 7.5 18.5 10 16" />
    <path d="M7.5 5.5v13" />
    <path d="M13 7h7" />
    <path d="M13 12h7" />
    <path d="M13 17h7" />
  </Glyph>
);

const Checklist = () => (
  <Glyph>
    <path d="m4 7.5 1.8 1.8L9 6" />
    <path d="m4 15.5 1.8 1.8L9 14" />
    <path d="M12 7.5h8" />
    <path d="M12 15.5h8" />
  </Glyph>
);

const BulletList = () => (
  <Glyph>
    {[7, 12, 17].map((y) => (
      <circle key={y} cx="4.8" cy={y} r="1.3" fill="currentColor" stroke="none" />
    ))}
    <path d="M9.5 7h10.5" />
    <path d="M9.5 12h10.5" />
    <path d="M9.5 17h10.5" />
  </Glyph>
);

const NumberList = () => (
  <Glyph>
    <g fill="currentColor" stroke="none" fontSize="7.5" fontFamily={SANS}>
      <text x="2.6" y="9.4">
        1
      </text>
      <text x="2.6" y="14.4">
        2
      </text>
      <text x="2.6" y="19.4">
        3
      </text>
    </g>
    <path d="M9.5 7h10.5" />
    <path d="M9.5 12h10.5" />
    <path d="M9.5 17h10.5" />
  </Glyph>
);

const Indent = ({ out = false }: { out?: boolean }) => (
  <Glyph>
    <path d="M20 5.5H4" />
    <path d="M20 10.5h-9" />
    <path d="M20 15h-9" />
    <path d="M20 20H4" />
    <path d={out ? "M7.5 9 4.5 12.75 7.5 16.5" : "M4.5 9l3 3.75-3 3.75"} />
  </Glyph>
);

const ClearFormat = () => (
  <Glyph>
    <path d="M5 6h9" />
    <path d="M9.5 6v12" />
    <path d="m14.5 13.5 5.5 5.5" />
    <path d="M20 13.5 14.5 19" />
  </Glyph>
);

const EditMode = () => (
  <Glyph>
    <circle cx="12" cy="12" r="8" />
    <path d="m9.6 14.4.5-2.1 4.5-4.5 1.6 1.6-4.5 4.5z" />
  </Glyph>
);

const Chevron = ({ size = 18 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="m7.5 10 4.5 4.5L16.5 10" />
  </Glyph>
);

const Star = () => (
  <Glyph size={19}>
    <path d="m12 4 2.45 5.2 5.55.78-4 4.02.94 5.6L12 16.98 7.06 19.6 8 14l-4-4.02 5.55-.78z" />
  </Glyph>
);

const MoveToFolder = () => (
  <Glyph size={19}>
    <path d="M3.5 7.2a1.5 1.5 0 0 1 1.5-1.5h3.4l1.9 2.1h8.2a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
  </Glyph>
);

const VersionHistory = () => (
  <Glyph size={19}>
    <path d="M12 7.5V12l3.2 1.9" />
    <path d="M20 12a8 8 0 1 1-2.35-5.65" />
    <path d="M20.2 3.6V7.1h-3.5" />
  </Glyph>
);

const Camera = () => (
  <Glyph size={19}>
    <rect x="3.5" y="7" width="11" height="10" rx="2" />
    <path d="m14.5 11.2 5.5-3.2v8l-5.5-3.2z" />
  </Glyph>
);

/** The person-and-padlock on the Share button — the one glyph nobody misreads. */
const SharePerson = () => (
  <Glyph size={18}>
    <circle cx="9.2" cy="7.8" r="3.2" />
    <path d="M3.4 19.2c0-3.2 2.6-5.2 5.8-5.2 1 0 1.9.2 2.7.5" />
    <rect x="14.6" y="14.4" width="6.4" height="5.4" rx="1" />
    <path d="M16.1 14.4v-1.6a1.7 1.7 0 0 1 3.4 0v1.6" />
  </Glyph>
);

/** The Docs file mark: a blue sheet with a lighter folded corner and ruled lines. */
const DocsMark = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      d="M6.2 2h7.3L19 7.5v13.1A1.4 1.4 0 0 1 17.6 22H6.2a1.4 1.4 0 0 1-1.4-1.4V3.4A1.4 1.4 0 0 1 6.2 2z"
      fill="#4285F4"
    />
    <path d="M13.5 2 19 7.5h-5.5z" fill="#A1C2FA" />
    <g fill="#fff">
      <rect x="7.6" y="11" width="8.8" height="1.2" rx=".6" />
      <rect x="7.6" y="13.8" width="8.8" height="1.2" rx=".6" />
      <rect x="7.6" y="16.6" width="5.6" height="1.2" rx=".6" />
    </g>
  </svg>
);

/* -------------------------------- toolbar -------------------------------- */

/** A 1px rule between icon groups — the thing that gives the strip its rhythm. */
const Divider = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-[#c7c7c7]" />;

/** One square icon cell. Everything in the toolbar sits on the same 28px hit box. */
function Cell({ children }: { children: ReactNode }): ReactElement {
  return (
    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded">
      {children}
    </span>
  );
}

/** A labelled dropdown (zoom, paragraph style, font) with its trailing chevron. */
function Dropdown({ label, width }: { label: string; width?: number }): ReactElement {
  return (
    <span
      aria-hidden
      className="flex h-7 shrink-0 items-center justify-between gap-1 rounded px-2 text-[14px] text-[#1f1f1f]"
      style={width ? { width } : undefined}
    >
      {label}
      <Chevron size={16} />
    </span>
  );
}

function Toolbar(): ReactElement {
  return (
    <div className="shrink-0 px-2 pb-1 sm:px-4">
      <div className="flex items-center gap-0.5 overflow-x-auto rounded-full bg-[#edf2fa] px-3 py-1 text-[#444746] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Cell>
          <Undo />
        </Cell>
        <Cell>
          <Redo />
        </Cell>
        <Cell>
          <Print />
        </Cell>
        <Cell>
          <SpellCheck />
        </Cell>
        <Cell>
          <PaintFormat />
        </Cell>
        <Divider />
        <Dropdown label="100%" width={72} />
        <Divider />
        <Dropdown label="Normal text" width={124} />
        <Divider />
        <Dropdown label="Arial" width={96} />
        <Divider />
        <span aria-hidden className="flex shrink-0 items-center gap-1">
          <Cell>
            <Glyph size={18}>
              <path d="M6 12h12" />
            </Glyph>
          </Cell>
          <span className="flex h-7 w-9 items-center justify-center rounded bg-white text-[14px] text-[#1f1f1f]">
            11
          </span>
          <Cell>
            <Glyph size={18}>
              <path d="M6 12h12" />
              <path d="M12 6v12" />
            </Glyph>
          </Cell>
        </span>
        <Divider />
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[16px] font-bold text-[#1f1f1f]"
        >
          B
        </span>
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded font-serif text-[16px] italic text-[#1f1f1f]"
        >
          I
        </span>
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[16px] text-[#1f1f1f] underline"
        >
          U
        </span>
        <Cell>
          <BarredA bar="#1f1f1f" />
        </Cell>
        <Cell>
          <Highlight />
        </Cell>
        <Divider />
        <Cell>
          <Link />
        </Cell>
        <Cell>
          <Comment plus />
        </Cell>
        <Cell>
          <InsertImage />
        </Cell>
        <Divider />
        <span aria-hidden className="flex shrink-0 items-center">
          <Cell>
            <AlignLeft />
          </Cell>
          <Chevron size={14} />
        </span>
        <span aria-hidden className="flex shrink-0 items-center">
          <Cell>
            <LineSpacing />
          </Cell>
          <Chevron size={14} />
        </span>
        <Cell>
          <Checklist />
        </Cell>
        <span aria-hidden className="flex shrink-0 items-center">
          <Cell>
            <BulletList />
          </Cell>
          <Chevron size={14} />
        </span>
        <span aria-hidden className="flex shrink-0 items-center">
          <Cell>
            <NumberList />
          </Cell>
          <Chevron size={14} />
        </span>
        <Cell>
          <Indent out />
        </Cell>
        <Cell>
          <Indent />
        </Cell>
        <Cell>
          <ClearFormat />
        </Cell>
        <span
          aria-hidden
          className="ml-auto flex h-8 shrink-0 items-center gap-1 rounded-full bg-[#c2e7ff] px-2 text-[#001d35]"
        >
          <EditMode />
          <Chevron size={16} />
        </span>
        <Cell>
          <Chevron />
        </Cell>
      </div>
    </div>
  );
}

/* --------------------------------- header -------------------------------- */

const MENUS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Extensions", "Help"];

/**
 * The title block. The row of small icons trailing the filename is doing more
 * work than it looks: a bare filename with nothing after it is the single most
 * common tell in a mocked-up editor, because every real document has been
 * starred, filed and saved at least once.
 */
function Header(): ReactElement {
  return (
    <div className="flex shrink-0 items-start gap-2.5 bg-white px-4 pt-2.5 pb-1">
      <span aria-hidden className="pt-1">
        <DocsMark />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[#444746]">
          <span className="truncate text-[18px] leading-6 text-[#1f1f1f]">Untitled document</span>
          <Star />
          <MoveToFolder />
          <VersionHistory />
        </div>

        <div className="flex items-center text-[14px] text-[#444746]">
          {MENUS.map((m) => (
            <span key={m} aria-hidden className="rounded px-2 py-0.5 leading-5">
              {m}
            </span>
          ))}
          <span aria-hidden className="ml-2 text-[13px] text-[#5f6368]">
            Last edit was 4 minutes ago
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1.5">
        <span
          aria-hidden
          className="flex h-9 items-center gap-1.5 rounded-full border border-[#747775] px-3 text-[#444746]"
        >
          <Camera />
          <Chevron size={16} />
        </span>
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full">
          <Comment />
        </span>
        <span
          aria-hidden
          className="flex h-9 items-center gap-2 rounded-full bg-[#1a73e8] pr-5 pl-4 text-[14px] font-medium text-white"
        >
          <SharePerson />
          Share
        </span>
        <Avatar initial="S" size={32} color="#0b57d0" />
      </div>
    </div>
  );
}

/* --------------------------------- screen -------------------------------- */

export function DocsScreen() {
  return (
    <div
      className="flex min-h-full flex-col bg-[#f9fbfd] text-[#202124]"
      style={{ fontFamily: SANS }}
    >
      <Header />

      <div className="bg-white pb-1">
        <Toolbar />
      </div>

      {/* Page */}
      <div className="flex flex-1 justify-center overflow-auto py-6">
        <div className="w-full max-w-[720px] bg-white px-[72px] py-[84px] shadow-[0_1px_3px_rgba(60,64,67,.3)]">
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
