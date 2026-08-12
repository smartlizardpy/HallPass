import { ImageResponse } from "next/og";
import { getLink } from "@/app/lib/challenges";
import { normalizeLinkCode } from "@/app/lib/challenges/link";

/**
 * The preview card a challenge link shows in a chat.
 *
 * This is the first thing almost everybody sees of HallPass — before the
 * landing page, before the game. In a Snapchat or WhatsApp thread the card is
 * the entire pitch, and a link with no card is a grey rectangle nobody taps.
 *
 * ── IT CARRIES A HANDLE AND A NUMBER. NO AVATAR. ───────────────────────────
 * The store does not select one (see `LinkOwner`), and this is the surface that
 * decision was made for. A preview card is fetched by the CHAT PLATFORM and
 * cached on ITS servers and on the devices of everybody in the thread — so it
 * travels further than the page it advertises and is the hardest thing to
 * un-publish. Sign-in is Google-only, so an avatar here would frequently be a
 * real photograph of a child. A name and a score carry "beat me" fine.
 *
 * ── FAILURE IS A CARD, NOT A 500 ───────────────────────────────────────────
 * A crawler asking about a revoked or mistyped code still gets a valid image,
 * because a broken preview is worse than a plain one: some platforms cache the
 * failure and keep showing a grey box long after the link works again. The
 * generic card says nothing about anybody.
 *
 * No custom font is loaded. `ImageResponse`'s built-in face is enough for two
 * lines and a number, and a font file is a build asset that can go missing —
 * which would turn every preview on the site into a 500 at exactly the moment
 * nobody is looking at logs.
 */

export const alt = "A HallPass challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Brand values, inlined — this renders outside the app's CSS entirely. */
const INK = "#18181b";
const BRAND = "#e11d63";
const PAPER = "#ffffff";
const MUTED = "#71717a";

export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = normalizeLinkCode((await params).code);
  const link = code ? await getLink(code) : null;
  const live = link && link.revokedAt === null ? link : null;

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
          background: PAPER,
          padding: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 34,
            fontWeight: 800,
            color: INK,
            letterSpacing: -1,
          }}
        >
          HallPass
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 99,
              background: BRAND,
              marginLeft: 8,
            }}
          />
        </div>

        {live ? (
          <>
            <div
              style={{
                display: "flex",
                marginTop: 40,
                fontSize: 52,
                fontWeight: 700,
                color: INK,
                textAlign: "center",
                maxWidth: 980,
              }}
            >
              {live.owner.displayName} says you can&apos;t beat this
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 24,
                fontSize: 150,
                fontWeight: 900,
                color: BRAND,
                lineHeight: 1,
              }}
            >
              {live.targetScore.toLocaleString("en-US")}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 20,
                fontSize: 34,
                fontWeight: 600,
                color: MUTED,
              }}
            >
              {live.boardTitle} · no account needed
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              marginTop: 40,
              fontSize: 56,
              fontWeight: 700,
              color: INK,
            }}
          >
            Beat somebody&apos;s high score
          </div>
        )}
      </div>
    ),
    size,
  );
}
