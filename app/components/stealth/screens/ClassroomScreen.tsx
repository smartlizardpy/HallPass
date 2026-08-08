/**
 * HallPass — the Google Classroom panic disguise.
 *
 * An original, asset-free recreation: hand-built markup and invented class
 * content, no third-party logos or copied copy. It only has to survive a glance
 * over the shoulder, which is all a panic screen ever needs.
 *
 * Purely presentational. {@link file://../StealthController.tsx} owns when it
 * mounts and every way it dismisses; this file renders and nothing more.
 */

import { SANS } from "./chrome";

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
