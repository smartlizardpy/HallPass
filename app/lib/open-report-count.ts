import "server-only";
import { isMissingColumnError, sql } from "@/app/lib/db";
import { createModerationStore } from "@/app/lib/reviews/moderation";
import { createProfileReportStore } from "@/app/lib/profile-reports/store";

const moderation = createModerationStore(sql);
const profileReports = createProfileReportStore(sql);

/**
 * Open review reports plus open profile reports: the number on the moderation
 * badge. Shared by the badge's route and its Server Function so the two cannot
 * disagree. Each half fails soft on its own, so one missing table cannot zero
 * the other half's count.
 */
export async function countOpenReports(): Promise<number> {
  let total = 0;
  try {
    total += await moderation.openReportCount();
  } catch (error) {
    console.error("[moderation] open report count failed", error);
  }
  // Profile reports arrive in their own migration; its absence must not zero the
  // review count above.
  try {
    total += await profileReports.openCount();
  } catch (error) {
    if (!isMissingColumnError(error)) {
      console.error("[moderation] open profile report count failed", error);
    }
  }
  return total;
}
