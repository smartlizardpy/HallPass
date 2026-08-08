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
            About 84,900,000 results (0.42 seconds)
          </p>
          {results.map((r, i) => (
            <div key={i} className="mb-7">
              <div className="text-[13px] text-[#202124]">{r.url}</div>
              <a className="text-[20px] leading-tight text-[#1a0dab] hover:underline">{r.title}</a>
              <p className="mt-1 text-[14px] leading-[1.58] text-[#4d5156]">{r.snippet}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
