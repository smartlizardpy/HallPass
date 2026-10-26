"use client";

/**
 * The status words after "Candy Hunt" on the hall's noticeboard. The prerendered
 * page says only "Candy Hunt" (it is static, so it cannot know the date); this
 * island adds " · from 28 Oct", " · open", " · spend by 30 Nov" or " · over"
 * from the device clock, to the minute, once it is hydrated. Display only.
 */

import { useMinute } from "@/app/components/championship/data";
import { candyPhase, noticeStatus } from "./logic";
import type { CandyDates, CandyLabels } from "./props";

export function CandyStatus({ dates, labels }: { dates: CandyDates; labels: Pick<CandyLabels, "opens" | "spendEnds"> }) {
  const status = noticeStatus(candyPhase(useMinute(), dates), labels);
  return status ? <> · {status}</> : null;
}
