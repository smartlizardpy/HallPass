/**
 * HallPass — the Google Docs panic disguise.
 *
 * An original, asset-free recreation: hand-built markup and generic placeholder
 * homework, no third-party logos or copied copy. It only has to survive a glance
 * over the shoulder, which is all a panic screen ever needs.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import { SANS } from "./chrome";

export function DocsScreen() {
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
