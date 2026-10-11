/**
 * A meme avatar must reach the page as a coloured circle. The profile header and
 * the welcome toast once drew the ref with a bare `<img>`, which shows the cutout
 * on a white background and silently drops the chosen colour.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MEME_AVATARS, memeAvatarFor } from "@/app/lib/avatars";
import { Avatar } from "./Avatar";

const meme = MEME_AVATARS[0];

describe("Avatar", () => {
  it("draws a stored meme ref in the chosen background colour", () => {
    const image = memeAvatarFor("00000000-0000-4000-8000-000000000000", {
      meme: meme.id,
      colour: "#a9d3f5",
    });
    const html = renderToStaticMarkup(
      createElement(Avatar, { person: { image, displayName: "Ozan" }, size: 64 }),
    );
    expect(html.toLowerCase()).toContain("background-color:#a9d3f5");
    expect(html).toContain(`/avatars/${meme.id}.png`);
  });

  it("falls back to a coloured default meme for a player with no image", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, {
        person: { image: null, displayName: "Ozan", id: "00000000-0000-4000-8000-000000000001" },
      }),
    );
    expect(html).toContain("background-color");
  });
});
