import { describe, expect, it } from "vitest";
import { FRIGHT_FEST_THEME } from "./fright-fest";
import { eventDateLabels } from "./labels";

describe("eventDateLabels", () => {
  it("derives every label from the configured window", () => {
    expect(eventDateLabels(FRIGHT_FEST_THEME)).toEqual({
      startShort: "28 Oct",
      endShort: "2 Nov",
      restoreShort: "3 Nov",
      range: "Wed 28 Oct to Mon 2 Nov",
      endsAt: "Mon 2 Nov, 23:59 UK",
      lastDay: "Mon 2 Nov",
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
    expect(l.range).toBe("Sun 20 to Sat 26 Dec");
  });

  it("starts at the skin when there is no separate opening", () => {
    expect(eventDateLabels({ ...FRIGHT_FEST_THEME, opensAt: undefined }).startShort).toBe("25 Oct");
  });
});
