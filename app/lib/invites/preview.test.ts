/**
 * The invite link preview's wording. The rule worth pinning: a guest's link has
 * no inviter name, and the preview still reads as a sentence.
 */

import { describe, expect, it } from "vitest";
import {
  GENERIC_PREVIEW_TITLE,
  inviterName,
  invitePreviewKicker,
  invitePreviewTitle,
} from "./preview";

describe("invite preview wording", () => {
  it("names the inviter and the game", () => {
    expect(invitePreviewTitle("Ozan", "LAST BELL")).toBe("Ozan invited you to play LAST BELL");
    expect(invitePreviewKicker("Ozan")).toBe("OZAN INVITED YOU TO PLAY");
  });

  it("falls back to 'A friend' for a guest's link or a blank name", () => {
    expect(inviterName(null)).toBe("A friend");
    expect(inviterName("   ")).toBe("A friend");
    expect(invitePreviewTitle(null, "LAST BELL")).toBe("A friend invited you to play LAST BELL");
    expect(invitePreviewKicker(null)).toBe("A FRIEND INVITED YOU TO PLAY");
  });

  it("keeps the generic title free of any name", () => {
    expect(GENERIC_PREVIEW_TITLE).toBe("You're invited · HallPass");
  });
});
