/**
 * HallPass — the Google Search panic disguise.
 *
 * An original, asset-free recreation: hand-built markup and a plausible homework
 * query, no third-party logos or copied copy. It only has to survive a glance
 * over the shoulder, which is all a panic screen ever needs.
 *
 * Every glyph here is drawn by hand as inline SVG, and that is not fastidiousness.
 * An emoji stand-in (🔍) renders in the host platform's own colour and weight —
 * a full-colour cartoon magnifier sitting where a thin blue one belongs is the
 * single fastest way for this screen to read as a fake from across the room.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import type { ReactElement } from "react";
import { AppsGrid, Avatar, GoogleWordmark, SANS } from "./chrome";

/** The homework the screen is pretending to be in the middle of. */
const QUERY = "photosynthesis light dependent reactions";

/**
 * Desktop Google indents everything below the header onto the same rail the
 * search box starts on — about 180px in — and caps the results near 650px. Both
 * numbers live here rather than at each use site because a header and a results
 * column that disagree by a few pixels is exactly the wrongness a passer-by
 * registers before they have read a single word of the page.
 */
const RAIL = "px-4 sm:pl-[180px] sm:pr-8";
const COLUMN = "w-full sm:max-w-[652px]";

/** The 152px slot the wordmark occupies, which is what puts the box on the rail. */
const LOGO_SLOT = "flex w-[152px] shrink-0 items-center";

/**
 * The vertical-search tabs. Nothing else on the page is as instantly diagnostic:
 * a viewer who never reads a word of the results still expects this band, in
 * this order, with one entry underlined in blue.
 */
const TABS = ["All", "Images", "Videos", "News", "Shopping", "Web", "More"] as const;

/**
 * Terms the results page bolds inside its snippets. Real Google emphasises the
 * words it matched on, and a page of uniformly grey snippet text is one of the
 * quieter tells — the eye expects the ragged bold speckle.
 */
const EMPHASIS = /(photosynthesis|light[- ]dependent|chlorophyll|thylakoid)/i;
const EMPHASIS_SPLIT = new RegExp(EMPHASIS.source, "gi");

/**
 * The sites are invented, and deliberately so: made-up study sites can carry
 * made-up copy without borrowing a single word or mark from anyone real, and at
 * glance distance nobody reads a domain anyway. Their favicons are initials on
 * a flat colour for the same reason.
 */
type ResultEntry = {
  site: string;
  domain: string;
  crumbs: string;
  mark: string;
  initial: string;
  title: string;
  date?: string;
  snippet: string;
};

const RESULTS: readonly ResultEntry[] = [
  {
    site: "Open Bio Text",
    domain: "openbiotext.org",
    crumbs: "chapters › light-reactions",
    mark: "#2e7d32",
    initial: "O",
    title: "The light-dependent reactions of photosynthesis",
    snippet:
      "Pigment molecules held in the thylakoid membrane absorb photons and pass the excited electrons down a transport chain. Water is split, oxygen leaves as waste, and the energy is banked as ATP and NADPH.",
  },
  {
    site: "Revise Notes",
    domain: "revisenotes.co.uk",
    crumbs: "biology › a-level › unit-4",
    mark: "#1565c0",
    initial: "R",
    title: "Light-dependent vs light-independent stages — revision summary",
    date: "14 Mar 2024",
    snippet:
      "A side-by-side table for revision: where each stage of photosynthesis happens, what enters, what leaves, and the two things markers most often see written the wrong way round.",
  },
  {
    site: "Plant Science Hub",
    domain: "plantsciencehub.org",
    crumbs: "learn › capturing-light",
    mark: "#ef6c00",
    initial: "P",
    title: "How a leaf captures light energy | Plant Science Hub",
    snippet:
      "Chlorophyll absorbs strongly at the blue and red ends of the spectrum and reflects green, which is why foliage looks the colour it does. An illustrated walk through the pigments involved.",
  },
  {
    site: "Classroom Lab",
    domain: "classroomlab.net",
    crumbs: "practicals › pondweed",
    mark: "#c62828",
    initial: "C",
    title: "Practical: measuring the rate of photosynthesis with pondweed",
    date: "2 Oct 2023",
    snippet:
      "A step-by-step practical for counting oxygen bubbles as light intensity changes, with a blank results table, a worked graph and notes on holding temperature steady.",
  },
];

/* ------------------------------ iconography ------------------------------ */

/** The search box's "clear this query" cross. */
function ClearIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="#70757a">
      <path d="M18.3 5.7 12 12l-6.3-6.3-1.4 1.4L10.6 13.4 4.3 19.7l1.4 1.4L12 14.8l6.3 6.3 1.4-1.4-6.3-6.3 6.3-6.3z" />
    </svg>
  );
}

/**
 * The voice-search microphone. Four brand colours in one 24px box: the arcs are
 * drawn as explicit cubics rather than SVG arc commands so the two halves are
 * guaranteed to meet at the same point under the capsule.
 */
function MicIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d="M12 2.4c1.66 0 3 1.34 3 3V9H9V5.4c0-1.66 1.34-3 3-3z" fill="#4285F4" />
      <path d="M9 9h6v3.3c0 1.66-1.34 3-3 3s-3-1.34-3-3V9z" fill="#EA4335" />
      <g fill="none" strokeWidth="1.8" strokeLinecap="round">
        <path d="M5.2 11.2v1.3C5.2 15.9 8.2 19.3 12 19.3" stroke="#FBBC05" />
        <path d="M18.8 11.2v1.3c0 3.4-3 6.8-6.8 6.8" stroke="#34A853" />
        <path d="M12 19.3v2.3" stroke="#4285F4" />
      </g>
    </svg>
  );
}

/** Search-by-image: a viewfinder with the corner brackets in the four colours. */
function LensIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden
      fill="none"
      strokeWidth="1.9"
      strokeLinecap="round"
    >
      <path d="M4 9.2V6.4A2.4 2.4 0 0 1 6.4 4h2.8" stroke="#4285F4" />
      <path d="M14.8 4h2.8A2.4 2.4 0 0 1 20 6.4v2.8" stroke="#EA4335" />
      <path d="M20 14.8v2.8a2.4 2.4 0 0 1-2.4 2.4h-2.8" stroke="#FBBC05" />
      <path d="M9.2 20H6.4A2.4 2.4 0 0 1 4 17.6v-2.8" stroke="#34A853" />
      <circle cx="12" cy="12" r="3.1" fill="#4285F4" />
    </svg>
  );
}

/** The magnifier, reused wherever a query is being offered rather than run. */
function MagnifierIcon({
  size = 22,
  color = "#4285F4",
  weight = 2,
}: {
  size?: number;
  color?: string;
  weight?: number;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke={color}
      strokeWidth={weight}
      strokeLinecap="round"
    >
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="m15.4 15.4 4.6 4.6" />
    </svg>
  );
}

/* -------------------------------- header --------------------------------- */

/** The pill: the query, its clear cross, then voice, lens and the magnifier. */
function SearchBox(): ReactElement {
  return (
    <div className="flex h-[46px] flex-1 items-center gap-3 rounded-full border border-[#dfe1e5] pl-4 pr-3 sm:max-w-[692px]">
      <span className="min-w-0 flex-1 truncate text-[16px] text-[#202124]">{QUERY}</span>
      <ClearIcon />
      <span className="h-6 w-px shrink-0 bg-[#dadce0]" />
      <MicIcon />
      <LensIcon />
      <span className="pl-1">
        <MagnifierIcon />
      </span>
    </div>
  );
}

/** The vertical kebab that closes every result's URL line. */
function KebabIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="#5f6368" className="shrink-0">
      <circle cx="12" cy="5.5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="18.5" r="1.7" />
    </svg>
  );
}

/** An invented site's mark, sitting in the pale disc Google frames favicons in. */
function Favicon({ mark, initial }: { mark: string; initial: string }): ReactElement {
  return (
    <span
      aria-hidden
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#f1f3f4]"
    >
      <span
        className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[11px] font-bold text-white"
        style={{ background: mark }}
      >
        {initial}
      </span>
    </span>
  );
}

/**
 * A result in the modern layout: source identity — favicon, site name and the
 * breadcrumb path — stacked ABOVE the blue title, rather than the one grey URL
 * line the older design put there. The two shapes are different enough that
 * getting it wrong dates the page by several years at a glance.
 */
function Result({ result }: { result: ResultEntry }): ReactElement {
  return (
    <article className="mb-8">
      <div className="mb-1 flex items-center gap-3">
        <Favicon mark={result.mark} initial={result.initial} />
        <div className="min-w-0 leading-[1.25]">
          <div className="truncate text-[14px] text-[#202124]">{result.site}</div>
          <div className="truncate text-[12px] text-[#4d5156]">
            {result.domain} › {result.crumbs}
          </div>
        </div>
        <KebabIcon />
      </div>
      <h3 className="text-[20px] leading-[1.3] text-[#1a0dab]">{result.title}</h3>
      <p className="mt-1 text-[14px] leading-[1.58] text-[#4d5156]">
        {result.date ? <span className="text-[#70757a]">{result.date} — </span> : null}
        {result.snippet.split(EMPHASIS_SPLIT).map((part, i) =>
          EMPHASIS.test(part) ? (
            <b key={i} className="font-bold">
              {part}
            </b>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </article>
  );
}

/** The tab band, with its hairline doubling as the header's bottom edge. */
function TabRow(): ReactElement {
  return (
    <nav className={`${RAIL} mt-4 border-b border-[#dadce0] text-[14px]`}>
      <div className={`${COLUMN} -mb-px flex items-end`}>
        <ul className="flex gap-6">
          {TABS.map((tab, i) => (
            <li
              key={tab}
              className={
                i === 0
                  ? "border-b-[3px] border-[#1a73e8] pb-3 text-[#1a73e8]"
                  : "border-b-[3px] border-transparent pb-3 text-[#5f6368]"
              }
            >
              {tab}
            </li>
          ))}
        </ul>
        <span className="ml-auto pb-3 text-[#5f6368]">Tools</span>
      </div>
    </nav>
  );
}

export function SearchScreen() {
  return (
    <div className="min-h-full bg-white" style={{ fontFamily: SANS }}>
      <header>
        <div className="flex items-center px-4 pt-4 sm:px-7 sm:pt-5">
          <div className={LOGO_SLOT}>
            <GoogleWordmark size={28} />
          </div>
          <SearchBox />
          <div className="ml-6 flex shrink-0 items-center gap-4">
            <AppsGrid />
            <Avatar initial="S" color="#1a73e8" size={30} />
          </div>
        </div>
        <TabRow />
      </header>

      <main className={RAIL}>
        <div className={COLUMN}>
          <p className="pt-3 pb-4 text-[14px] text-[#70757a]">
            About 4,120,000 results (0.38 seconds)
          </p>
          {RESULTS.map((result) => (
            <Result key={result.domain} result={result} />
          ))}
        </div>
      </main>
    </div>
  );
}
