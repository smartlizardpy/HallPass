"use client";

import { useState } from "react";
import { MemeAvatarCircle } from "@/app/components/MemeAvatar";
import { AVATAR_COLOURS, MEME_AVATARS, getMemeAvatar } from "@/app/lib/avatars";

/**
 * The avatar chooser: a grid of memes, a row of colour swatches and a live
 * preview. Nothing else - placement and scale are fixed per meme.
 *
 * Selection is local state mirrored into two hidden inputs, so the form posts
 * `meme` and `colour` and the server action (`AvatarCard`) re-validates both.
 * The buttons are real `<button type="button">`s with `aria-pressed`, so they
 * are keyboard- and screen-reader-operable and never submit the form by
 * accident.
 */

const COLOUR_NAMES: Record<string, string> = {
  "#c5b8ff": "Lilac",
  "#ffb49c": "Peach",
  "#a5decf": "Mint",
  "#a9d3f5": "Sky",
  "#ffd982": "Sun",
  "#f3add5": "Pink",
  "#b5bdc9": "Slate",
  "#eee9db": "Cream",
};

export function AvatarPicker({
  initialMeme,
  initialColour,
}: {
  initialMeme: string;
  initialColour: string;
}) {
  const [memeId, setMemeId] = useState(initialMeme);
  const [colour, setColour] = useState(initialColour);
  const meme = getMemeAvatar(memeId) ?? MEME_AVATARS[0];

  return (
    <div>
      <input type="hidden" name="meme" value={meme.id} />
      <input type="hidden" name="colour" value={colour} />

      <div className="flex items-center gap-4">
        <MemeAvatarCircle meme={meme} colour={colour} size={96} />
        <p className="text-sm font-semibold text-foreground" aria-live="polite">
          {meme.name}
          <span className="block text-xs font-normal text-muted">
            {COLOUR_NAMES[colour] ?? "Custom"} background
          </span>
        </p>
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-black uppercase tracking-wider text-muted">
          Background colour
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {AVATAR_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === colour}
              aria-label={COLOUR_NAMES[c] ?? c}
              title={COLOUR_NAMES[c] ?? c}
              onClick={() => setColour(c)}
              style={{ backgroundColor: c }}
              className={`h-9 w-9 rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                c === colour ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : ""
              }`}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-xs font-black uppercase tracking-wider text-muted">
          Meme
        </legend>
        <div className="mt-2 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto p-1 sm:grid-cols-6">
          {MEME_AVATARS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === meme.id}
              aria-label={m.name}
              title={m.name}
              onClick={() => setMemeId(m.id)}
              className={`mx-auto rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                m.id === meme.id ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : ""
              }`}
            >
              <MemeAvatarCircle meme={m} colour={colour} size={56} />
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
