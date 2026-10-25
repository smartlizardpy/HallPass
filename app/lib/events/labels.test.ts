import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_THEME } from "./fright-fest";
import { eventDateLabels } from "./labels";

describe("eventDateLabels", () => {
  it("derives every label from the configured window", () => {
    expect(eventDateLabels(FRIGHT_FEST_THEME)).toEqual({
      startShort: "28 Oct",
      endShort: "31 Oct",
      restoreShort: "1 Nov",
      range: "Wed 28 to Sat 31 Oct",
      endsAt: "Sat 31 Oct, 23:59 UK",
      lastDay: "Sat 31 Oct",
    });
  });

  it("follows a moved window", () => {
    const l = eventDateLabels({
      ...FRIGHT_FEST_THEME,
      startAt: "2026-12-18T00:00:00Z",
      opensAt: "2026-12-20T00:00:00Z",
      endAt: "2026-12-27T00:00:00Z",
    });
    expect(l.startShort).toBe("20 Dec");
    expect(l.endShort).toBe("26 Dec");
  });

  it("starts at the skin when there is no separate opening", () => {
    expect(eventDateLabels({ ...FRIGHT_FEST_THEME, opensAt: undefined }).startShort).toBe("25 Oct");
  });
});
