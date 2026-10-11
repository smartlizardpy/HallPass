import { ImageResponse } from "next/og";
import { getInvitePreview } from "@/app/lib/invites";
import { normalizeInviteCode } from "@/app/lib/invites/code";
import { invitePreviewKicker } from "@/app/lib/invites/preview";
import {
  BRAND,
  DIM,
  DOT,
  INK,
  INK_MID,
  OG_SIZE,
  PAPER,
  Wordmark,
  coverDataUri,
  nunito,
} from "@/app/lib/og/brand";

/**
 * A HallPass INVITE card: "Ozan invited you to play LAST BELL."
 *
 * What WhatsApp, Snapchat or Discord shows when an `/i/<code>` link is pasted.
 * It is the sibling of the challenge card in `app/c/[code]/opengraph-image.tsx`
 * and wears the game's own colours and cover for the same reasons — read that
 * header, and `lib/og/brand` for the Satori rules, before editing this.
 *
 * ── A PREVIEW IS HARDER TO UN-PUBLISH THAN THE PAGE ────────────────────────
 * The chat platform fetches it and caches it on its servers and on every
 * device in the thread. So the card carries only what the landing page already
 * shows a stranger: the inviter's PUBLIC display name and the game. No avatar
 * (sign-in is Google-only, so it would often be a child's photograph), no
 * profile link, no room data, and no countdown, which would be wrong the moment
 * it was cached.
 *
 * ── EVERY DEAD END IS THE SAME PLAIN CARD ──────────────────────────────────
 * Unknown, collected, expired and staged invites all get the generic card that
 * names nobody. A crawler is signed out, so a staged game's invite lands here
 * too — and must look like the rest, or the card would confirm the game exists.
 * A plain card is also the better failure for platforms that cache a bad
 * preview and keep showing it.
 */

export const alt = "A HallPass invite";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const fonts = await nunito();
  const code = normalizeInviteCode((await params).code);
  const preview = await getInvitePreview(code).catch(() => null);

  if (!preview) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: `linear-gradient(120deg, ${INK} 0%, ${INK_MID} 100%)`,
          }}
        >
          <div style={{ display: "flex", fontSize: 30, fontWeight: 900, color: DIM, letterSpacing: 6 }}>
            HALLPASS
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 64, fontWeight: 900, color: PAPER }}>
            You&apos;re invited to play
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const { game, from } = preview;
  const cover = !game.externalUrl ? await coverDataUri(game.slug) : null;
  const hot = game.gradient?.[0] ?? BRAND;
  const accent = game.accent ?? DOT;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          // Dark under the words, the game's colour out to the right where the
          // art sits — the challenge card's reasoning: pale accents stay legible.
          background: `linear-gradient(110deg, ${INK} 0%, ${INK} 38%, ${INK_MID} 62%, ${hot} 130%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "64px 56px",
            width: cover ? 700 : 1200,
          }}
        >
          <Wordmark />

          <div
            style={{
              display: "flex",
              marginTop: 36,
              fontSize: 30,
              fontWeight: 900,
              color: accent,
              letterSpacing: 3,
              maxWidth: 600,
            }}
          >
            {invitePreviewKicker(from)}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 12,
              fontSize: 92,
              fontWeight: 900,
              color: PAPER,
              lineHeight: 1.02,
              letterSpacing: -2,
              maxWidth: 600,
            }}
          >
            {game.title}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 30,
              fontSize: 26,
              fontWeight: 600,
              color: DIM,
            }}
          >
            Tap to join · no account needed
          </div>
        </div>

        {cover ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 500,
              height: "100%",
            }}
          >
            <img
              src={cover}
              alt=""
              width={380}
              height={380}
              style={{
                borderRadius: 36,
                objectFit: "cover",
                border: `6px solid rgba(255,255,255,0.16)`,
              }}
            />
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts },
  );
}
