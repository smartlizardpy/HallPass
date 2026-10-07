/**
 * Small shared pieces for the survey screens.
 *
 * The buttons and the result banner are the tracker's own, re-exported rather
 * than copied so the two work surfaces cannot drift apart visually. Only the
 * status chip is survey-specific, because it draws from `surveys/config`.
 */

import {
  SURVEY_STATUS_CHIP_CLASS,
  SURVEY_STATUS_LABEL,
  type SurveyStatus,
} from "@/app/lib/surveys/config";

export {
  PRIMARY_BUTTON,
  ResultBanner,
  SECONDARY_BUTTON,
} from "../../tracker/_ui/Chips";

export function SurveyStatusChip({ status }: { status: SurveyStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${SURVEY_STATUS_CHIP_CLASS[status]}`}
    >
      {SURVEY_STATUS_LABEL[status]}
    </span>
  );
}
