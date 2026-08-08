/**
 * HallPass — the Google Search panic disguise.
 *
 * An original, asset-free recreation: hand-built markup and a plausible homework
 * query, no third-party logos or copied copy. It only has to survive a glance
 * over the shoulder, which is all a panic screen ever needs.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import { GoogleWordmark, SANS } from "./chrome";

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
      {/* Header row: logo + search box */}
      <div className="flex items-center gap-6 border-b border-[#ebebeb] px-6 py-4">
        <GoogleWordmark size={26} />
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
